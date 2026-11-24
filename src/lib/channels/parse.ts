import { parsePriceBRL } from '../price.ts';
import type { ParsedCoupon, ParsedPost, RawPost } from '../types.ts';

/**
 * Interpreta posts de canais de promoção. Formato típico (conferido em canais reais, 24/11/2026):
 *
 *   ➡️ Monitor Gamer Tcl 25" Qled 300Hz
 *   ✅ R$ 873 😱😱
 *   🏷 Cupom: DESCONTOSMELI
 *   🛒 https://meli.la/1y1PuUj
 *   🚀 Mais grupos de ofertas e cupons: https://nerdofertas.com/t   ← rodapé, ignorado
 */

/** Lojas reconhecidas pelo domínio do link (inclusive encurtadores das próprias lojas). */
const DOMAIN_STORES: [RegExp, string][] = [
  [/(^|\.)(meli\.la|mercadolivre\.com(\.br)?|mercadolibre\.com|mercadolivre\.com\.br|mlb\.am)$/, 'mercadolivre'],
  [/(^|\.)(amzn\.to|amzn\.com|link\.amazon|amazon\.com\.br|amazon\.com|a\.co)$/, 'amazon'],
  [/(^|\.)(shopee\.com\.br|shope\.ee|shp\.ee)$/, 'shopee'],
  [/(^|\.)kabum\.com\.br$/, 'kabum'],
  [/(^|\.)aliexpress\.(com|us)$/, 'aliexpress'],
  [/(^|\.)(magazineluiza\.com\.br|magalu\.com)$/, 'magalu'],
  [/(^|\.)pichau\.com\.br$/, 'pichau'],
  [/(^|\.)terabyteshop\.com\.br$/, 'terabyte'],
];

/** Palavras no título ou no link que indicam a loja quando o domínio não diz. */
const KEYWORD_STORES: [RegExp, string][] = [
  [/mercado\s*livre|mercadolivre|\bmeli\b/i, 'mercadolivre'],
  [/amazon/i, 'amazon'],
  [/shopee/i, 'shopee'],
  [/kabum/i, 'kabum'],
  [/aliexpress|\bali\s*express\b/i, 'aliexpress'],
  [/magalu|magazine\s*luiza/i, 'magalu'],
  [/pichau/i, 'pichau'],
  [/terabyte/i, 'terabyte'],
];

export const STORE_LABELS: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  amazon: 'Amazon',
  shopee: 'Shopee',
  kabum: 'KaBuM!',
  aliexpress: 'AliExpress',
  magalu: 'Magalu',
  pichau: 'Pichau',
  terabyte: 'TerabyteShop',
  outra: 'Outra loja',
};

export function storeLabel(id: string | null | undefined): string {
  return (id && STORE_LABELS[id]) || 'Outra loja';
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function storeFromUrl(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const [re, store] of DOMAIN_STORES) if (re.test(host)) return store;
  return null;
}

function storeFromKeywords(text: string): string | null {
  for (const [re, store] of KEYWORD_STORES) if (re.test(text)) return store;
  return null;
}

/** Linhas de rodapé/divulgação do próprio canal: os links delas não são a oferta. */
const FOOTER_LINE = /grupo|grupos|canal|canais|whatsapp|telegram|instagram|siga|participe|convite|entre no|indique|compartilhe/i;

function isTelegramLink(url: string): boolean {
  const host = hostOf(url);
  return !!host && /(^|\.)(t\.me|telegram\.me|telegram\.org)$/.test(host);
}

/** Links que podem ser a oferta: sem Telegram e sem os que aparecem só em linhas de rodapé. */
export function offerLinks(text: string, links: string[]): string[] {
  const footer = new Set<string>();
  for (const line of text.split('\n')) {
    if (!FOOTER_LINE.test(line)) continue;
    for (const l of links) if (line.includes(l) || line.includes(l.replace(/^https?:\/\//, ''))) footer.add(l);
  }
  return [...new Set(links)].filter((l) => /^https?:\/\//i.test(l) && !isTelegramLink(l) && !footer.has(l));
}

/** Primeira linha útil, sem emojis e setas no começo. */
export function titleOf(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/https?:\/\/\S+/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (line.length >= 3) return line.slice(0, 200);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Preços
// ---------------------------------------------------------------------------

const MONEY = /R\$\s*(\d[\d.]*(?:,\d{1,2})?)/gi;

/** Trechos com R$ que NÃO são o preço do produto (desconto, mínimo do cupom, parcela, frete, cashback). */
const NOT_PRICE = [
  /R\$\s*\d[\d.]*(?:,\d{1,2})?\s*(?:de\s+)?(?:off|desconto|de\s+desconto)/gi,
  /(?:acima|a\s+partir|m[íi]nimo|compras?)\s+(?:de\s+)?R\$\s*\d[\d.]*(?:,\d{1,2})?/gi,
  /\d+\s*x\s*(?:de\s+)?R\$\s*\d[\d.]*(?:,\d{1,2})?/gi,
  /frete[^\n]{0,15}R\$\s*\d[\d.]*(?:,\d{1,2})?/gi,
  /cashback[^\n]{0,15}R\$\s*\d[\d.]*(?:,\d{1,2})?/gi,
  /(?:economi[az]e?|economia)[^\n]{0,15}R\$\s*\d[\d.]*(?:,\d{1,2})?/gi,
];

export function pricesOf(text: string): { price: number | null; regularPrice: number | null } {
  // "De R$ 999 por R$ 873"
  const dePor = text.match(/de\s*:?\s*R\$\s*(\d[\d.]*(?:,\d{1,2})?)[^\n\d]{0,30}?por\s*:?\s*R\$\s*(\d[\d.]*(?:,\d{1,2})?)/i);
  if (dePor) {
    const regular = parsePriceBRL(dePor[1]);
    const price = parsePriceBRL(dePor[2]);
    if (price !== null && regular !== null && regular > price) return { price, regularPrice: regular };
  }
  let cleaned = text;
  for (const re of NOT_PRICE) cleaned = cleaned.replace(re, ' ');
  for (const m of cleaned.matchAll(MONEY)) {
    const v = parsePriceBRL(m[1]);
    if (v !== null && v >= 1 && v < 1_000_000) return { price: v, regularPrice: null };
  }
  return { price: null, regularPrice: null };
}

// ---------------------------------------------------------------------------
// Cupons
// ---------------------------------------------------------------------------

const COUPON = /(?:cupom|cup[ãa]o|cupon|c[óo]digo)(?:\s+(?:de\s+desconto|promocional))?\s*[:：=\-–—]?\s*["'“”«]?([A-Za-z0-9][A-Za-z0-9_-]{3,23})/gi;
const NOT_CODES = new Set([
  'CUPOM', 'CUPONS', 'CUPON', 'DESCONTO', 'DESCONTOS', 'FRETE', 'GRATIS', 'GRÁTIS', 'ABAIXO', 'ACIMA', 'LINK', 'APLICADO',
  'AUTOMATICO', 'AUTOMÁTICO', 'NO', 'APP', 'SITE', 'PROMOCIONAL', 'VALIDO', 'VÁLIDO', 'OFF', 'AQUI', 'RESGATE', 'PAGINA',
]);
const DISCOUNT = /(R\$\s*\d[\d.]*(?:,\d{1,2})?\s*(?:off|de\s+desconto)|\d{1,2}\s*%\s*(?:off|de\s+desconto)?)/i;
const MINIMUM = /(?:acima|a\s+partir|m[íi]nimo|compras?)\s+(?:de\s+)?(R\$\s*\d[\d.]*(?:,\d{1,2})?)/i;

export function couponsOf(text: string): ParsedCoupon[] {
  const out = new Map<string, ParsedCoupon>();
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    for (const m of line.matchAll(COUPON)) {
      const code = m[1] ?? '';
      // Códigos vêm em maiúsculas e têm ao menos uma letra; descarta palavras comuns.
      if (code !== code.toUpperCase() || !/[A-Z]/.test(code) || NOT_CODES.has(code)) continue;
      const near = [line, lines[i + 1] ?? ''].join(' ');
      const off = near.match(DISCOUNT)?.[1]?.replace(/\s+/g, ' ').trim();
      const min = near.match(MINIMUM)?.[1]?.replace(/\s+/g, ' ').trim();
      const discount = off ? (min ? `${off} acima de ${min}` : off) : null;
      if (!out.has(code)) out.set(code, { code, discount });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Post completo
// ---------------------------------------------------------------------------

export function parsePost(raw: RawPost): ParsedPost {
  const text = raw.text.replace(/\r/g, '');
  const title = titleOf(text);
  const { price, regularPrice } = pricesOf(text);
  const links = offerLinks(text, raw.links);
  const known = links.find((l) => storeFromUrl(l));
  const offerUrl = known ?? links[0] ?? null;
  const store =
    (known && storeFromUrl(known)) ||
    storeFromKeywords(`${title} ${offerUrl ?? ''}`) ||
    storeFromKeywords(text.replace(/https?:\/\/\S+/g, ''));
  return { ...raw, text, title, price, regularPrice, coupons: couponsOf(text), store: store || null, offerUrl };
}

/** Só endereços públicos (o link vem de canais de terceiros: nada de IP, localhost ou porta estranha). */
export function isSafePublicUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.port && u.port !== '443' && u.port !== '80') return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':')) return false;
  if (/(^|\.)(localhost|local|internal|lan)$/.test(h)) return false;
  return true;
}

/**
 * Segue encurtadores desconhecidos (bit.ly, ofertou.ai…) até achar uma loja conhecida. Até 3 saltos.
 * Só é usado em posts que têm cupom ou bateram com uma busca.
 */
export async function resolveStoreLink(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ store: string | null; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    const store = storeFromUrl(current);
    if (store) return { store, finalUrl: current };
    if (!isSafePublicUrl(current)) break;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetchFn(current, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'promo-bot/0.1' } });
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc || res.status < 300 || res.status >= 400) break;
      current = new URL(loc, current).toString();
    } catch {
      break;
    }
  }
  return { store: storeFromUrl(current) ?? storeFromKeywords(current), finalUrl: current };
}
