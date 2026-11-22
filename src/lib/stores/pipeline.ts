import * as cheerio from 'cheerio';
import { STORE_META, hostAllowed } from '../config.ts';
import { canonicalUrl, extractJsonLd, extractNextData, offersFromJsonLd } from '../jsonld.ts';
import { parsePriceBRL } from '../price.ts';
import type { AdapterEnv, BuiltinStoreId, RawOffer, StoreAdapter, StoreResult } from '../types.ts';

export type CheerioDoc = cheerio.CheerioAPI;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CheerioSel = cheerio.Cheerio<any>;

export interface HtmlStoreConfig {
  id: BuiltinStoreId;
  /** Monta a URL de busca da loja a partir das palavras (já normalizadas, sem acento). */
  searchUrl(terms: string): string;
  /** Lê produtos de dados embutidos (ex.: __NEXT_DATA__). Opcional. */
  fromJson?: (root: unknown, baseUrl: string) => RawOffer[];
  /** Lê produtos de dados embutidos de outro jeito (ex.: objeto JS no HTML). Opcional. */
  fromHtmlData?: (html: string, baseUrl: string) => RawOffer[];
  /** Lê produtos do HTML renderizado. Opcional. */
  fromDom?: ($: CheerioDoc, baseUrl: string) => RawOffer[];
  /** Mensagem quando a página abre sem produtos. */
  emptyMessage?: string;
}

function dedupe(offers: RawOffer[]): RawOffer[] {
  const best = new Map<string, RawOffer>();
  for (const o of offers) {
    const key = canonicalUrl(o.url);
    const prev = best.get(key);
    if (!prev || o.price < prev.price) best.set(key, o);
  }
  return [...best.values()];
}

const FILLABLE = ['cashPrice', 'regularPrice', 'endsAt', 'freightNote', 'shippingPrice', 'itemId'] as const;

/**
 * Tenta as fontes (dados da loja, HTML, JSON-LD) e fica com a que achar mais produtos.
 * Em empate vale a ordem: dados da loja primeiro (costumam ter preço à vista e prazo da promoção).
 * Campos que faltarem são completados pelas outras fontes (mesmo link).
 */
export function parseHtml(html: string, baseUrl: string, cfg: Omit<HtmlStoreConfig, 'id' | 'searchUrl'>): RawOffer[] {
  const candidates: RawOffer[][] = [];
  if (cfg.fromHtmlData) candidates.push(cfg.fromHtmlData(html, baseUrl));
  if (cfg.fromJson) {
    const next = extractNextData(html);
    if (next) candidates.push(cfg.fromJson(next, baseUrl));
  }
  if (cfg.fromDom) candidates.push(cfg.fromDom(cheerio.load(html), baseUrl));
  candidates.push(offersFromJsonLd(extractJsonLd(html), baseUrl));

  let best: RawOffer[] = [];
  for (const c of candidates) if (c.length > best.length) best = c;
  const chosen = dedupe(best);

  const extra = new Map<string, RawOffer>();
  for (const c of candidates) {
    if (c === best) continue;
    for (const o of c) if (!extra.has(canonicalUrl(o.url))) extra.set(canonicalUrl(o.url), o);
  }
  return chosen.map((o) => {
    const other = extra.get(canonicalUrl(o.url));
    if (!other) return o;
    const merged: RawOffer = { ...o };
    for (const k of FILLABLE) {
      if ((merged[k] === undefined || merged[k] === null) && other[k] !== undefined && other[k] !== null) {
        (merged as unknown as Record<string, unknown>)[k] = other[k];
      }
    }
    return merged;
  });
}

/** Abre uma URL de loja e lê os produtos. Usado na busca e em links de categoria. */
export async function readPage(
  url: string,
  env: AdapterEnv,
  domains: string[],
  cfg: Omit<HtmlStoreConfig, 'id' | 'searchUrl'>,
): Promise<StoreResult> {
  const out = await env.fetchHtml(url);
  if (out.kind !== 'ok') return { status: out.kind, message: out.message, offers: [] };
  if (!hostAllowed(out.finalUrl, domains)) {
    return { status: 'blocked', message: 'a loja redirecionou para outro domínio', offers: [] };
  }
  const offers = parseHtml(out.html, out.finalUrl, cfg);
  if (offers.length === 0) {
    return {
      status: 'empty',
      message: cfg.emptyMessage ?? 'a página abriu, mas não achei produtos (sem resultado ou layout da loja mudou)',
      offers: [],
    };
  }
  return { status: 'ok', message: `${offers.length} itens`, offers };
}

export function makeHtmlStore(cfg: HtmlStoreConfig): StoreAdapter {
  const meta = STORE_META[cfg.id];
  return {
    id: cfg.id,
    name: meta.name,
    domains: meta.domains,
    via: 'html',
    search: (terms, env) => readPage(cfg.searchUrl(terms), env, meta.domains, cfg),
    async listing(url, env) {
      if (!hostAllowed(url, meta.domains)) {
        return { status: 'error', message: `o link não é da ${meta.name}`, offers: [] };
      }
      return readPage(url, env, meta.domains, cfg);
    },
  };
}

/** Texto de um elemento, sem espaços sobrando. */
export function textOf(el: CheerioSel): string {
  return el.text().replace(/\s+/g, ' ').trim();
}

/** Todos os valores "R$ ..." de um texto, na ordem em que aparecem. */
export function moneyIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/R\$\s*\d[\d.]*(?:,\d{1,2})?/g)) {
    const p = parsePriceBRL(m[0]);
    if (p !== null) out.push(p);
  }
  return out;
}

export function hasFreeShippingText(text: string): boolean {
  return /frete\s+gr[aá]tis/i.test(text);
}

export const FREE_SHIPPING_HINT = 'frete grátis indicado na listagem (sem CEP; pode variar)';

/**
 * Lê o objeto/array JSON que começa logo depois de `marker` dentro de um HTML
 * (ex.: `"itemList":{...}` de um script). Respeita strings e escapes.
 */
export function jsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  let i = at + marker.length;
  while (i < html.length && html[i] !== '{' && html[i] !== '[') {
    if (!/[\s:=]/.test(html[i] ?? '')) return null;
    i += 1;
  }
  const start = i;
  let depth = 0;
  let inStr = false;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
