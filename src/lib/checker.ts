import { decideAlert } from './alerts.ts';
import type { AlertLevel, AlertReason } from './alerts.ts';
import { DEFAULTS, hostAllowed } from './config.ts';
import { buildAlertMessage, buildCategoryDigest } from './format.ts';
import { canonicalUrl } from './jsonld.ts';
import { matchesQuery, queryKey, searchTerms } from './matching.ts';
import { effectivePrice, isDeal, priceCeiling } from './price.ts';
import { comparedPrice } from './shipping.ts';
import { buildAdapters } from './stores/index.ts';
import type {
  AdapterEnv,
  ChatSettings,
  CheckerDb,
  RawOffer,
  SearchContext,
  StoreAdapter,
  StoreResult,
  StoreStatusKind,
  Watch,
} from './types.ts';

export interface CheckDeps {
  db: CheckerDb;
  /** Lojas embutidas; cada chat pode desligar algumas e somar fontes próprias. */
  adapters: StoreAdapter[];
  env: AdapterEnv;
  notify(chatId: number, html: string): Promise<void>;
  now?: () => Date;
  /** Relógio para o orçamento de tempo (ms). */
  clock?: () => number;
  /** Tempo máximo de trabalho na rodada (ms). */
  budgetMs?: number;
}

export interface StoreSummary {
  name: string;
  status: StoreStatusKind;
  items: number;
  message: string;
}

export interface CheckSummary {
  /** Buscas ativas. */
  watches: number;
  /** Buscas efetivamente checadas nesta rodada (o resto fica para a próxima). */
  checked: number;
  alerts: number;
  notifyErrors: number;
  stores: Record<string, StoreSummary>;
}

function summarizeStore(name: string, results: StoreResult[]): StoreSummary {
  const items = results.reduce((n, r) => n + r.offers.length, 0);
  const ok = results.filter((r) => r.status === 'ok');
  if (ok.length > 0) {
    const partial = ok.length < results.length;
    return {
      name,
      status: 'ok',
      items,
      message: partial ? `${items} itens (${ok.length}/${results.length} buscas leram)` : ok.length === 1 ? ok[0]!.message : `${items} itens`,
    };
  }
  const empty = results.find((r) => r.status === 'empty');
  if (empty) return { name, status: 'empty', items, message: empty.message };
  const first = results[0];
  return first
    ? { name, status: first.status, items, message: first.message }
    : { name, status: 'error', items: 0, message: 'sem resultado' };
}

async function safeCall(fn: () => Promise<StoreResult>): Promise<StoreResult> {
  try {
    return await fn();
  } catch {
    return { status: 'error', message: 'erro inesperado ao ler a loja', offers: [] };
  }
}

interface ChatCtx {
  adapters: StoreAdapter[];
  settings: ChatSettings;
}

interface RunState {
  deps: CheckDeps;
  now: Date;
  summary: CheckSummary;
  chats: Map<number, Promise<ChatCtx>>;
  /** Uma consulta por (loja, termo/link) na rodada, mesmo que várias buscas usem. */
  results: Map<string, Promise<StoreResult>>;
  perStore: Map<string, { name: string; results: StoreResult[] }>;
}

function chatCtx(state: RunState, chatId: number): Promise<ChatCtx> {
  let p = state.chats.get(chatId);
  if (!p) {
    const { db, adapters } = state.deps;
    p = (async () => {
      const sources = db.listSources ? await db.listSources(chatId) : [];
      const settings = db.getSettings
        ? await db.getSettings(chatId)
        : { cep: await db.getCep(chatId), freight_mode: 'total' as const };
      return { adapters: buildAdapters(adapters, sources), settings };
    })();
    state.chats.set(chatId, p);
  }
  return p;
}

function fetchOnce(state: RunState, adapter: StoreAdapter, key: string, run: () => Promise<StoreResult>): Promise<StoreResult> {
  const k = `${adapter.id}|${key}`;
  let p = state.results.get(k);
  if (!p) {
    p = safeCall(run).then((res) => {
      const entry = state.perStore.get(adapter.id) ?? { name: adapter.name, results: [] };
      entry.results.push(res);
      state.perStore.set(adapter.id, entry);
      return res;
    });
    state.results.set(k, p);
  }
  return p;
}

/** Ordem de checagem: quem foi checado há mais tempo primeiro (nunca checado vem antes de tudo). */
function byStaleness(a: Watch, b: Watch): number {
  const ta = a.last_checked_at ? Date.parse(a.last_checked_at) : -Infinity;
  const tb = b.last_checked_at ? Date.parse(b.last_checked_at) : -Infinity;
  return ta === tb ? a.id - b.id : ta - tb;
}

/** Roda a checagem das buscas ativas (ou só as de um chat), dentro do orçamento de tempo. */
export async function runChecks(deps: CheckDeps, opts: { chatId?: number } = {}): Promise<CheckSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? DEFAULTS.runBudgetMs;

  const watches = (await deps.db.listActiveWatches(opts.chatId)).filter((w) => w.active).sort(byStaleness);
  const summary: CheckSummary = { watches: watches.length, checked: 0, alerts: 0, notifyErrors: 0, stores: {} };
  if (watches.length === 0) return summary;

  const state: RunState = { deps, now, summary, chats: new Map(), results: new Map(), perStore: new Map() };
  const checked: number[] = [];

  for (const [i, watch] of watches.entries()) {
    const elapsed = clock() - started;
    if (i > 0 && elapsed > budget - DEFAULTS.perWatchReserveMs) break;
    await processWatch(watch, state);
    checked.push(watch.id);
  }
  summary.checked = checked.length;

  for (const [id, entry] of state.perStore) summary.stores[id] = summarizeStore(entry.name, entry.results);
  if (state.perStore.size > 0) {
    await deps.db.saveStoreStatus(
      [...state.perStore.keys()].map((id) => {
        const s = summary.stores[id]!;
        return { store: id, name: s.name, status: s.status, message: s.message, items_found: s.items };
      }),
    );
  }
  if (deps.db.markChecked && checked.length > 0) await deps.db.markChecked(checked, now.toISOString());
  if (deps.db.pruneHistory) {
    const before = new Date(now.getTime() - DEFAULTS.historyRetentionDays * DAY_MS).toISOString();
    await deps.db.pruneHistory(before).catch(() => {});
  }
  return summary;
}

interface Candidate {
  adapter: StoreAdapter;
  offer: RawOffer;
  url: string;
  price: number;
}

/** Links das N ofertas mais baratas de cada loja. */
function cheapestPerStore(cands: Candidate[], n: number): Set<string> {
  const byStore = new Map<string, Candidate[]>();
  for (const c of cands) byStore.set(c.adapter.id, [...(byStore.get(c.adapter.id) ?? []), c]);
  const out = new Set<string>();
  for (const list of byStore.values()) {
    for (const c of list.sort((a, b) => a.price - b.price).slice(0, n)) out.add(c.url);
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Um ponto de histórico por oferta quando o preço mudou ou o último ponto tem mais de 24h. */
async function recordHistory(
  deps: CheckDeps,
  watchId: number,
  saved: { offerId: number; store: string; price: number }[],
  now: Date,
): Promise<void> {
  const { db } = deps;
  if (!db.insertPricePoints || !db.lastPricePoints || saved.length === 0) return;
  try {
    const since = new Date(now.getTime() - DAY_MS).toISOString();
    const last = new Map((await db.lastPricePoints(saved.map((s) => s.offerId), since)).map((p) => [p.offer_id, p]));
    const rows = saved
      .filter((s) => {
        const p = last.get(s.offerId);
        return !p || Math.abs(p.price - s.price) >= 0.01;
      })
      .map((s) => ({ watch_id: watchId, offer_id: s.offerId, store: s.store, price: s.price, seen_at: now.toISOString() }));
    if (rows.length > 0) await db.insertPricePoints(rows);
  } catch (e) {
    // Histórico é extra: se falhar, a checagem e os alertas continuam.
    console.error('histórico falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
  }
}

/** Lojas e resultados que valem para uma busca. */
async function gather(watch: Watch, state: RunState, ctx: ChatCtx): Promise<{ adapter: StoreAdapter; res: StoreResult }[]> {
  const { env } = state.deps;
  const search: SearchContext = { cep: ctx.settings.cep };

  if (watch.category_url) {
    const url = watch.category_url;
    const adapter = ctx.adapters.find((a) => a.listing && hostAllowed(url, a.domains));
    if (!adapter?.listing) return [];
    const listing = adapter.listing.bind(adapter);
    return [{ adapter, res: await fetchOnce(state, adapter, `url:${url}`, () => listing(url, env, search)) }];
  }

  const key = queryKey(watch.query);
  const terms = searchTerms(watch.query);
  if (!terms) return [];
  const wanted = watch.stores && watch.stores.length > 0 ? new Set(watch.stores) : null;
  const chosen = ctx.adapters.filter((a) => !wanted || wanted.has(a.id));
  return Promise.all(
    chosen.map(async (adapter) => ({
      adapter,
      res: await fetchOnce(state, adapter, key, () => adapter.search(terms, env, search)),
    })),
  );
}

async function processWatch(watch: Watch, state: RunState): Promise<void> {
  const { deps, now, summary } = state;
  const ctx = await chatCtx(state, watch.chat_id);
  const isCategory = watch.kind === 'categoria';
  const ceiling = priceCeiling(watch.target_price, watch.margin_pct);
  const floor = isCategory ? 0 : watch.target_price * DEFAULTS.minPriceRatio;

  // 1) Filtra: domínio da loja, palavras da busca, piso de preço. Melhor oferta por link.
  const byUrl = new Map<string, Candidate>();
  for (const { adapter, res } of await gather(watch, state, ctx)) {
    for (const offer of res.offers) {
      const url = canonicalUrl(offer.url);
      if (!hostAllowed(url, adapter.domains)) continue;
      if (!watch.category_url && !matchesQuery(offer.title, watch.query)) continue;
      const base = effectivePrice(offer);
      if (base < floor) continue;
      const prev = byUrl.get(url);
      if (!prev || base < prev.price) byUrl.set(url, { adapter, offer, url, price: base });
    }
  }
  if (byUrl.size === 0) return;

  // 2) Completa frete/prazo só de quem já está na faixa pelo preço do produto (poucas requisições).
  const inRange = [...byUrl.values()].filter((c) => c.price <= ceiling).sort((a, b) => a.price - b.price);
  for (const cand of inRange.slice(0, DEFAULTS.maxEnrichPerWatch)) {
    if (!cand.adapter.enrich) continue;
    if (!ctx.settings.cep && cand.offer.endsAt) continue;
    try {
      const patch = await cand.adapter.enrich(cand.offer, deps.env, { cep: ctx.settings.cep });
      cand.offer = { ...cand.offer, ...patch };
    } catch {
      // frete/prazo são extras: se falhar, segue sem eles
    }
  }
  for (const cand of byUrl.values()) cand.price = comparedPrice(cand.offer, ctx.settings.freight_mode);

  // 3) Salva as ofertas (as que estão na faixa e as mais baratas de cada loja, para o painel
  //    mostrar o menor preço e o histórico) e decide quem recebe alerta.
  const keep = cheapestPerStore([...byUrl.values()], DEFAULTS.historyPerStore);
  const existing = await deps.db.getOffersByUrl(watch.id, [...byUrl.keys()]);
  const known = new Map(existing.map((o) => [o.url, o]));
  const toAlert: { cand: Candidate; offerId: number; level: AlertLevel; reason: AlertReason }[] = [];
  const saved: { offerId: number; store: string; price: number }[] = [];

  for (const cand of byUrl.values()) {
    const prev = known.get(cand.url) ?? null;
    const within = cand.price <= ceiling;
    if (!prev && !within && !keep.has(cand.url)) continue;

    const deal = isDeal(cand.offer);
    let decision = decideAlert({
      price: cand.price,
      target: watch.target_price,
      marginPct: watch.margin_pct,
      endsAt: cand.offer.endsAt ?? null,
      prev: prev ? { last_alerted_price: prev.last_alerted_price, last_alerted_at: prev.last_alerted_at } : null,
      now,
    });
    // "Apenas promoções": sem preço de/por nem prazo, não avisa (e avisa como nova quando virar promoção).
    if (watch.only_deals && !deal && decision.send) {
      decision = { send: false, reason: 'sem promoção', resetAlertState: true };
    }

    const shipping = typeof cand.offer.shippingPrice === 'number' ? cand.offer.shippingPrice : null;
    let offerId: number;
    if (prev) {
      offerId = prev.id;
      await deps.db.updateOffer(prev.id, {
        title: cand.offer.title,
        price: cand.price,
        regular_price: cand.offer.regularPrice ?? null,
        ends_at: cand.offer.endsAt ?? null,
        shipping_price: shipping,
        is_deal: deal,
        lowest_price: Math.min(prev.lowest_price, cand.price),
        last_seen_at: now.toISOString(),
        ...(!decision.send && decision.resetAlertState ? { last_alerted_price: null, last_alerted_at: null } : {}),
      });
    } else {
      const created = await deps.db.insertOffer({
        watch_id: watch.id,
        store: cand.adapter.id,
        title: cand.offer.title,
        url: cand.url,
        price: cand.price,
        regular_price: cand.offer.regularPrice ?? null,
        ends_at: cand.offer.endsAt ?? null,
        shipping_price: shipping,
        is_deal: deal,
        lowest_price: cand.price,
      });
      offerId = created.id;
    }
    saved.push({ offerId, store: cand.adapter.id, price: cand.price });

    if (decision.send) toAlert.push({ cand, offerId, level: decision.level, reason: decision.reason });
  }
  await recordHistory(deps, watch.id, saved, now);
  if (toAlert.length === 0) return;

  // 4) Envia: mais baratos primeiro. Produto = uma mensagem por oferta; categoria = um resumo.
  toAlert.sort((a, b) => a.cand.price - b.cand.price);
  const cep = ctx.settings.cep;
  const markAlerted = async (items: typeof toAlert) => {
    for (const item of items) {
      await deps.db.updateOffer(item.offerId, { last_alerted_price: item.cand.price, last_alerted_at: now.toISOString() });
    }
  };

  if (isCategory) {
    const shown = toAlert.slice(0, DEFAULTS.categoryDigestSize);
    try {
      await deps.notify(
        watch.chat_id,
        buildCategoryDigest({
          watch,
          items: shown.map((t) => ({ storeName: t.cand.adapter.name, offer: { ...t.cand.offer, url: t.cand.url }, compared: t.cand.price })),
          more: toAlert.length - shown.length,
          cep,
          freightMode: ctx.settings.freight_mode,
        }),
      );
      // Marca todos (inclusive os que só entraram no "+N outros"), para o resumo não repetir a cada rodada.
      await markAlerted(toAlert);
      summary.alerts += 1;
    } catch {
      summary.notifyErrors += 1;
    }
    return;
  }

  for (const item of toAlert.slice(0, DEFAULTS.maxAlertsPerWatchPerRun)) {
    try {
      await deps.notify(
        watch.chat_id,
        buildAlertMessage({
          watch,
          storeName: item.cand.adapter.name,
          offer: { ...item.cand.offer, url: item.cand.url },
          compared: item.cand.price,
          level: item.level,
          reason: item.reason,
          cep,
          freightMode: ctx.settings.freight_mode,
        }),
      );
      await markAlerted([item]);
      summary.alerts += 1;
    } catch {
      // Não marca como avisada: tenta de novo na próxima rodada.
      summary.notifyErrors += 1;
    }
  }
}

/** Diagnóstico: o que cada loja devolve para um termo, sem salvar nada. */
export async function testStores(
  adapters: StoreAdapter[],
  env: AdapterEnv,
  terms: string,
  ctx: SearchContext = {},
): Promise<{ id: string; name: string; result: StoreResult }[]> {
  return Promise.all(
    adapters.map(async (a) => ({ id: a.id, name: a.name, result: await safeCall(() => a.search(terms, env, ctx)) })),
  );
}
