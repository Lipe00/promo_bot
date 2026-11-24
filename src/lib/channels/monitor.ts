import { DEFAULTS } from '../config.ts';
import { buildChannelMatchMessage, buildCouponMessage, buildCouponOverflowMessage } from '../format.ts';
import { matchesQuery } from '../matching.ts';
import { formatBRL, priceCeiling } from '../price.ts';
import type { ChannelDb, ChatSettings, ParsedPost, TgChannel, Watch } from '../types.ts';
import { parsePost, resolveStoreLink } from './parse.ts';
import type { ChannelReader } from './reader.ts';

export const POST_RETENTION_MS = 48 * 60 * 60 * 1000;
export const COUPON_REALERT_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_COUPON_ALERTS_PER_RUN = 10;
export const DEFAULT_COUPON_STORES = ['amazon', 'shopee', 'mercadolivre'];

export interface ChannelDeps {
  db: ChannelDb;
  readers: { publico: ChannelReader; conta: ChannelReader | null };
  notify(chatId: number, html: string): Promise<void>;
  /** Segue encurtadores desconhecidos para descobrir a loja. */
  resolveLink?: (url: string) => Promise<{ store: string | null; finalUrl: string }>;
  now?: () => Date;
  clock?: () => number;
  budgetMs?: number;
}

export interface ChannelSummary {
  channels: number;
  read: number;
  posts: number;
  matches: number;
  coupons: number;
  couponAlerts: number;
  errors: { channel: string; error: string }[];
}

/** Texto usado para comparar com a busca: título + a linha seguinte (sem links). */
function matchText(p: ParsedPost): string {
  const lines = p.text
    .split('\n')
    .map((l) => l.replace(/https?:\/\/\S+/g, '').trim())
    .filter((l) => l.length > 2);
  return [p.title, lines[1] ?? ''].join(' ');
}

/** Post de canal × busca: palavras, piso, teto e "apenas promoções". */
export function matchPost(p: ParsedPost, w: Watch): { ok: boolean; price: number | null } {
  if (!w.active || w.category_url) return { ok: false, price: null };
  if (!matchesQuery(matchText(p), w.query)) return { ok: false, price: null };
  const price = p.price;
  if (price !== null) {
    const floor = w.kind === 'categoria' ? 0 : w.target_price * DEFAULTS.minPriceRatio;
    if (price < floor || price > priceCeiling(w.target_price, w.margin_pct)) return { ok: false, price };
  }
  const deal = p.coupons.length > 0 || (p.regularPrice !== null && price !== null && p.regularPrice > price);
  if (w.only_deals && !deal) return { ok: false, price };
  return { ok: true, price };
}

interface ChatCtx {
  watches: Watch[];
  settings: ChatSettings;
  couponAlerts: number;
  overflow: number;
}

export async function runChannels(deps: ChannelDeps): Promise<ChannelSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? DEFAULTS.runBudgetMs;
  const { db } = deps;
  const nowIso = now.toISOString();

  const channels = await db.listEnabledChannels();
  const summary: ChannelSummary = { channels: channels.length, read: 0, posts: 0, matches: 0, coupons: 0, couponAlerts: 0, errors: [] };
  const chats = new Map<number, ChatCtx>();
  const ctxOf = async (chatId: number): Promise<ChatCtx> => {
    let c = chats.get(chatId);
    if (!c) {
      const [watches, settings] = await Promise.all([db.listActiveWatches(chatId), db.getSettings(chatId)]);
      c = { watches, settings, couponAlerts: 0, overflow: 0 };
      chats.set(chatId, c);
    }
    return c;
  };

  for (const [i, channel] of channels.entries()) {
    if (i > 0 && clock() - started > budget - DEFAULTS.perWatchReserveMs) break;
    const label = channel.title || (channel.username ? `@${channel.username}` : `#${channel.id}`);
    const reader = channel.source === 'conta' ? deps.readers.conta : deps.readers.publico;
    if (!reader) {
      const error = 'conta do Telegram não conectada (TELEGRAM_USER_SESSION)';
      await db.updateChannel(channel.id, { last_error: error, last_checked_at: nowIso });
      summary.errors.push({ channel: label, error });
      continue;
    }

    const res = await reader.read(channel).catch((e: unknown) => ({
      error: e instanceof Error ? e.message.slice(0, 160) : 'erro ao ler',
      posts: [],
      latestId: null,
    }));
    if (res.error) {
      await db.updateChannel(channel.id, { last_error: res.error, last_checked_at: nowIso });
      summary.errors.push({ channel: label, error: res.error });
      continue;
    }
    summary.read += 1;
    const title = 'title' in res && res.title ? res.title : channel.title;

    // Primeiro acesso: só marca onde parou; não avisa o histórico antigo.
    if (channel.last_message_id !== null) {
      const ctx = await ctxOf(channel.chat_id);
      for (const raw of res.posts) await processPost(deps, channel, title, raw, ctx, summary, now);
    }
    await db.updateChannel(channel.id, {
      title,
      last_message_id: Math.max(res.latestId ?? 0, channel.last_message_id ?? 0) || res.latestId,
      last_checked_at: nowIso,
      last_error: null,
    });
  }

  for (const [chatId, ctx] of chats) {
    if (ctx.overflow > 0) await deps.notify(chatId, buildCouponOverflowMessage(ctx.overflow)).catch(() => {});
  }
  await db.prunePosts(new Date(now.getTime() - POST_RETENTION_MS).toISOString()).catch(() => {});
  return summary;
}

async function processPost(
  deps: ChannelDeps,
  channel: TgChannel,
  channelTitle: string,
  raw: Parameters<typeof parsePost>[0],
  ctx: ChatCtx,
  summary: ChannelSummary,
  now: Date,
): Promise<void> {
  const { db } = deps;
  const post = parsePost(raw);
  const matched = ctx.watches.map((w) => ({ w, m: matchPost(post, w) })).filter((x) => x.m.ok);

  // Loja escondida atrás de encurtador: só vale seguir se o post interessa (cupom ou busca).
  if (!post.store && post.offerUrl && (post.coupons.length > 0 || matched.length > 0)) {
    const resolve = deps.resolveLink ?? ((u: string) => resolveStoreLink(u));
    const r = await resolve(post.offerUrl).catch(() => null);
    if (r?.store) post.store = r.store;
  }

  const postId = await db.insertPost(channel.id, post);
  if (postId === null) return; // já processado
  summary.posts += 1;

  for (const { w, m } of matched) {
    if (!(await db.insertMatch(postId, w.id, m.price))) continue;
    summary.matches += 1;
    try {
      await deps.notify(channel.chat_id, buildChannelMatchMessage({ post, channelTitle, watch: w, price: m.price }));
      await db.markMatchNotified(postId, w.id, now.toISOString());
    } catch {
      // aviso falhou: o post continua salvo e aparece no painel
    }
  }

  const stores = ctx.settings.coupon_stores ?? DEFAULT_COUPON_STORES;
  for (const c of post.coupons) {
    const store = post.store ?? 'outra';
    const existing = await db.getCoupon(channel.chat_id, store, c.code);
    const fresh = !existing || now.getTime() - Date.parse(existing.last_seen_at) >= COUPON_REALERT_MS;
    const row = await db.upsertCoupon({
      chat_id: channel.chat_id,
      store,
      code: c.code,
      description: post.title + (post.price !== null ? ` · ${formatBRL(post.price)}` : ''),
      discount: c.discount ?? existing?.discount ?? null,
      channel_title: channelTitle,
      offer_url: post.offerUrl,
      post_url: post.postUrl,
      seen_at: now.toISOString(),
    });
    summary.coupons += 1;
    if (!fresh || !stores.includes(store)) continue;
    if (ctx.couponAlerts >= MAX_COUPON_ALERTS_PER_RUN) {
      ctx.overflow += 1;
      continue;
    }
    try {
      await deps.notify(channel.chat_id, buildCouponMessage({ coupon: row, post, channelTitle }));
      await db.markCouponNotified(row.id, now.toISOString());
      ctx.couponAlerts += 1;
      summary.couponAlerts += 1;
    } catch {
      // aviso falhou: o cupom continua no painel
    }
  }
}
