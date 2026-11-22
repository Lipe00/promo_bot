import { createHmac } from 'node:crypto';
import { STORE_META } from '../config.ts';
import { parseJson } from '../http.ts';
import { firstPrice } from '../price.ts';
import type { AdapterEnv, RawOffer, StoreAdapter, StoreResult } from '../types.ts';
import { jsonAfter, readPage } from './pipeline.ts';

const META = STORE_META.aliexpress;

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// ---------------------------------------------------------------------------
// Página de busca (sem chave). Conferido em 22/11/2026: a busca /w/wholesale-<termo>.html
// traz os itens num JSON embutido ("itemList": { content: [...] }), com preço em BRL.
// O robots.txt não proíbe /w/. O cookie aep_usuc_f só escolhe Brasil/BRL/português.
// ---------------------------------------------------------------------------

export function aliSearchUrl(terms: string): string {
  const slug = terms.trim().toLowerCase().replace(/\s+/g, '-');
  return `https://pt.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;
}

export function aliFromHtml(html: string): RawOffer[] {
  const list = asRecord(jsonAfter(html, '"itemList":'));
  const content = Array.isArray(list?.content) ? list.content : [];
  const out: RawOffer[] = [];
  for (const raw of content) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = typeof item.productId === 'string' || typeof item.productId === 'number' ? String(item.productId) : null;
    const title = asRecord(item.title)?.displayTitle;
    const prices = asRecord(item.prices);
    const sale = asRecord(prices?.salePrice);
    const original = asRecord(prices?.originalPrice);
    if (!id || typeof title !== 'string' || !sale) continue;
    if (sale.currencyCode && sale.currencyCode !== 'BRL') continue;
    const price = firstPrice(sale.minPrice);
    if (price === null) continue;
    const points = JSON.stringify(item.sellingPoints ?? '');
    out.push({
      title: title.trim(),
      url: `https://pt.aliexpress.com/item/${id}.html`,
      price,
      regularPrice: firstPrice(original?.minPrice),
      itemId: id,
      freightNote: /Free_Shipping|Frete gr[aá]tis/i.test(points) ? 'frete grátis para o Brasil indicado na listagem' : null,
      // A busca mostra o preço mínimo (minPrice) entre as variações do anúncio.
      priceFrom: true,
    });
  }
  return out;
}

const PAGE_CFG = {
  fromHtmlData: (html: string) => aliFromHtml(html),
  emptyMessage: 'a página abriu, mas não achei produtos (sem resultado ou layout mudou)',
};

function htmlEnv(env: AdapterEnv): AdapterEnv {
  return {
    ...env,
    fetchHtml: (url, init) =>
      env.fetchHtml(url, {
        ...init,
        headers: { cookie: 'aep_usuc_f=site=bra&c_tp=BRL&region=BR&b_locale=pt_BR', ...(init?.headers ?? {}) },
      }),
  };
}

// ---------------------------------------------------------------------------
// API oficial de afiliados (opcional). Com as chaves, os links saem como link de afiliado.
// Docs: https://openservice.aliexpress.com → aliexpress.affiliate.product.query
// ---------------------------------------------------------------------------

export const ALI_API = 'https://api-sg.aliexpress.com/sync';

/** Assinatura HMAC-SHA256 do gateway da AliExpress: chaves em ordem, "chavevalor" concatenados. */
export function aliSign(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== 'sign')
    .sort()
    .map((k) => k + params[k])
    .join('');
  return createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

export function aliApiUrl(terms: string, keys: { appKey: string; secret: string; trackingId?: string }, now = Date.now()): string {
  const params: Record<string, string> = {
    app_key: keys.appKey,
    method: 'aliexpress.affiliate.product.query',
    sign_method: 'sha256',
    timestamp: String(now),
    keywords: terms,
    target_currency: 'BRL',
    target_language: 'PT',
    ship_to_country: 'BR',
    page_size: '30',
    sort: 'SALE_PRICE_ASC',
  };
  if (keys.trackingId) params.tracking_id = keys.trackingId;
  params.sign = aliSign(params, keys.secret);
  return `${ALI_API}?${new URLSearchParams(params).toString()}`;
}

export function aliFromApi(body: unknown): { offers: RawOffer[]; error: string | null } {
  const root = asRecord(body);
  const err = asRecord(root?.error_response);
  if (err) return { offers: [], error: String(err.msg ?? err.code ?? 'erro da API') };
  const resp = asRecord(asRecord(root?.aliexpress_affiliate_product_query_response)?.resp_result);
  if (resp && resp.resp_code !== undefined && Number(resp.resp_code) !== 200) {
    return { offers: [], error: String(resp.resp_msg ?? `código ${String(resp.resp_code)}`) };
  }
  const products = asRecord(asRecord(resp?.result)?.products)?.product;
  const out: RawOffer[] = [];
  for (const raw of Array.isArray(products) ? products : []) {
    const p = asRecord(raw);
    if (!p || typeof p.product_title !== 'string') continue;
    const price = firstPrice(p.target_sale_price, p.target_app_sale_price, p.sale_price);
    const url = typeof p.promotion_link === 'string' ? p.promotion_link : typeof p.product_detail_url === 'string' ? p.product_detail_url : null;
    if (price === null || !url) continue;
    out.push({
      title: p.product_title,
      url,
      price,
      regularPrice: firstPrice(p.target_original_price, p.original_price),
      itemId: p.product_id !== undefined ? String(p.product_id) : null,
      priceFrom: true,
    });
  }
  return { offers: out, error: null };
}

function keysFrom(env: AdapterEnv) {
  const s = env.secrets ?? {};
  return s.ALI_APP_KEY && s.ALI_APP_SECRET
    ? { appKey: s.ALI_APP_KEY, secret: s.ALI_APP_SECRET, trackingId: s.ALI_TRACKING_ID }
    : null;
}

async function searchApi(terms: string, env: AdapterEnv, keys: NonNullable<ReturnType<typeof keysFrom>>): Promise<StoreResult> {
  const out = await env.fetchHtml(aliApiUrl(terms, keys), { api: true, accept: 'json' });
  if (out.kind !== 'ok') return { status: out.kind, message: out.message, offers: [] };
  const { offers, error } = aliFromApi(parseJson(out.html));
  if (error) return { status: 'error', message: `API AliExpress: ${error}`, offers: [] };
  if (offers.length === 0) return { status: 'empty', message: 'API sem resultados', offers: [] };
  return { status: 'ok', message: `${offers.length} itens (API)`, offers };
}

export const aliexpress: StoreAdapter = {
  id: 'aliexpress',
  name: META.name,
  domains: META.domains,
  via: 'html',
  async search(terms, env) {
    const keys = keysFrom(env);
    if (keys) {
      const api = await searchApi(terms, env, keys);
      if (api.status === 'ok') return api;
      const page = await readPage(aliSearchUrl(terms), htmlEnv(env), META.domains, PAGE_CFG);
      return page.status === 'ok' ? { ...page, message: `${page.message} (API falhou: ${api.message})` } : api;
    }
    return readPage(aliSearchUrl(terms), htmlEnv(env), META.domains, PAGE_CFG);
  },
  listing: (url, env) => readPage(url, htmlEnv(env), META.domains, PAGE_CFG),
};
