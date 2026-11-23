import { BUILTIN_IDS, STORE_META } from './config.ts';
import { storeName, watchLabel } from './format.ts';
import { priceCeiling } from './price.ts';
import type { CommandDb, DashboardDb, Source, StoredOffer, Watch } from './types.ts';

/**
 * Dados do painel web. Tudo sai do banco pelo servidor; o navegador só recebe estes objetos.
 */

export type CardStatus = 'abaixo' | 'margem' | 'acima' | 'sem_dados';

export interface BestPrice {
  price: number;
  store: string;
  storeName: string;
  title: string;
  url: string;
  seenAt: string;
  isDeal: boolean;
  /** Vista na última checagem (senão, é o último preço conhecido). */
  current: boolean;
}

export interface WatchCard {
  id: number;
  label: string;
  kind: 'produto' | 'categoria';
  active: boolean;
  onlyDeals: boolean;
  target: number;
  marginPct: number;
  ceiling: number;
  status: CardStatus;
  best: BestPrice | null;
  /** Menor preço já visto (histórico das ofertas guardadas). */
  lowestEver: number | null;
  lastCheckedAt: string | null;
}

export interface OfferView {
  id: number;
  store: string;
  storeName: string;
  title: string;
  url: string;
  price: number;
  regularPrice: number | null;
  endsAt: string | null;
  shippingPrice: number | null;
  isDeal: boolean;
  lowestPrice: number;
  lastSeenAt: string;
  current: boolean;
}

export interface HistoryPoint {
  seenAt: string;
  store: string;
  storeName: string;
  price: number;
}

export interface DailyPoint {
  /** AAAA-MM-DD no horário de Brasília */
  day: string;
  min: number;
  store: string;
}

export interface WatchDetail {
  card: WatchCard;
  query: string;
  categoryUrl: string | null;
  stores: string[] | null;
  offers: OfferView[];
  history: { daily: DailyPoint[]; points: HistoryPoint[] };
}

export interface StoreOption {
  id: string;
  name: string;
  enabled: boolean;
}

/** Tolerância para considerar uma oferta "da última checagem". */
const CURRENT_SLACK_MS = 60 * 60 * 1000;
const HISTORY_DAYS = 180;

function nameResolver(sources: Source[]) {
  const custom = new Map(sources.filter((s) => s.kind === 'custom').map((s) => [`custom:${s.id}`, s.name]));
  return (id: string) => storeName(id, custom.get(id) ?? null);
}

function isCurrent(o: StoredOffer, w: Watch): boolean {
  if (!w.last_checked_at) return true;
  return Date.parse(o.last_seen_at) >= Date.parse(w.last_checked_at) - CURRENT_SLACK_MS;
}

function statusOf(price: number | null, w: Watch): CardStatus {
  if (price === null) return 'sem_dados';
  if (price <= w.target_price) return 'abaixo';
  if (price <= priceCeiling(w.target_price, w.margin_pct)) return 'margem';
  return 'acima';
}

function toCard(w: Watch, offers: StoredOffer[], name: (id: string) => string): WatchCard {
  const current = offers.filter((o) => isCurrent(o, w));
  const pool = current.length > 0 ? current : offers;
  const bestOffer = pool.reduce<StoredOffer | null>((b, o) => (!b || o.price < b.price ? o : b), null);
  const lowestEver = offers.length > 0 ? Math.min(...offers.map((o) => o.lowest_price)) : null;
  return {
    id: w.id,
    label: watchLabel(w),
    kind: w.kind === 'categoria' ? 'categoria' : 'produto',
    active: w.active,
    onlyDeals: !!w.only_deals,
    target: w.target_price,
    marginPct: w.margin_pct,
    ceiling: priceCeiling(w.target_price, w.margin_pct),
    status: statusOf(bestOffer?.price ?? null, w),
    best: bestOffer
      ? {
          price: bestOffer.price,
          store: bestOffer.store,
          storeName: name(bestOffer.store),
          title: bestOffer.title,
          url: bestOffer.url,
          seenAt: bestOffer.last_seen_at,
          isDeal: !!bestOffer.is_deal,
          current: current.length > 0,
        }
      : null,
    lowestEver,
    lastCheckedAt: w.last_checked_at ?? null,
  };
}

export async function buildCards(db: CommandDb & DashboardDb, chatId: number): Promise<WatchCard[]> {
  const [watches, sources] = await Promise.all([db.listWatches(chatId), db.listSources(chatId)]);
  if (watches.length === 0) return [];
  const offers = await db.listOffersByWatches(watches.map((w) => w.id));
  const name = nameResolver(sources);
  const byWatch = new Map<number, StoredOffer[]>();
  for (const o of offers) byWatch.set(o.watch_id, [...(byWatch.get(o.watch_id) ?? []), o]);
  return watches
    .map((w) => toCard(w, byWatch.get(w.id) ?? [], name))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id);
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

export function dailyMin(points: HistoryPoint[]): DailyPoint[] {
  const byDay = new Map<string, DailyPoint>();
  for (const p of points) {
    const day = dayFmt.format(new Date(p.seenAt));
    const prev = byDay.get(day);
    if (!prev || p.price < prev.min) byDay.set(day, { day, min: p.price, store: p.storeName });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export async function buildDetail(
  db: CommandDb & DashboardDb,
  chatId: number,
  watchId: number,
  nowMs = Date.now(),
): Promise<WatchDetail | null> {
  const [watches, sources] = await Promise.all([db.listWatches(chatId), db.listSources(chatId)]);
  const w = watches.find((x) => x.id === watchId);
  if (!w) return null;
  const name = nameResolver(sources);
  const offers = (await db.listOffersByWatches([w.id])).sort((a, b) => a.price - b.price);
  const since = new Date(nowMs - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const raw = await db.listHistory(w.id, since);
  const points: HistoryPoint[] = raw
    .map((p) => ({ seenAt: p.seen_at, store: p.store, storeName: name(p.store), price: p.price }))
    .sort((a, b) => a.seenAt.localeCompare(b.seenAt));
  return {
    card: toCard(w, offers, name),
    query: w.query,
    categoryUrl: w.category_url ?? null,
    stores: w.stores ?? null,
    offers: offers.map((o) => ({
      id: o.id,
      store: o.store,
      storeName: name(o.store),
      title: o.title,
      url: o.url,
      price: o.price,
      regularPrice: o.regular_price,
      endsAt: o.ends_at,
      shippingPrice: o.shipping_price ?? null,
      isDeal: !!o.is_deal,
      lowestPrice: o.lowest_price,
      lastSeenAt: o.last_seen_at,
      current: isCurrent(o, w),
    })),
    history: { daily: dailyMin(points), points },
  };
}

/** Lojas para o formulário: embutidas (com estado) + fontes cadastradas. */
export async function storeOptions(db: CommandDb, chatId: number): Promise<StoreOption[]> {
  const sources = await db.listSources(chatId);
  const disabled = new Set(sources.filter((s) => s.kind === 'builtin' && !s.enabled).map((s) => s.store_id));
  return [
    ...BUILTIN_IDS.map((id) => ({ id, name: STORE_META[id].name, enabled: !disabled.has(id) })),
    ...sources.filter((s) => s.kind === 'custom').map((s) => ({ id: `custom:${s.id}`, name: s.name, enabled: s.enabled })),
  ];
}
