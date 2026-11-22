import { STORE_META } from '../config.ts';
import { parseJson } from '../http.ts';
import { absoluteUrl, parseEndDate } from '../jsonld.ts';
import { firstPrice, parsePriceBRL } from '../price.ts';
import type { AdapterEnv, RawOffer, StoreAdapter, StoreResult } from '../types.ts';
import { FREE_SHIPPING_HINT, hasFreeShippingText, readPage, textOf } from './pipeline.ts';
import type { CheerioDoc, CheerioSel } from './pipeline.ts';

const META = STORE_META.mercadolivre;
export const ML_API = 'https://api.mercadolibre.com';

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// ---------------------------------------------------------------------------
// API oficial (recomendado). Conferido em 22/11/2026: sem token, /sites/MLB/search responde 403,
// e a página lista.mercadolivre.com.br mostra a tela de "tráfego suspeito" para robôs.
// Crie um app grátis em https://developers.mercadolivre.com.br/devcenter e use ML_CLIENT_ID / ML_CLIENT_SECRET.
// ---------------------------------------------------------------------------

let cachedToken: { value: string; until: number; key: string } | null = null;

export function resetMlToken(): void {
  cachedToken = null;
}

async function getToken(env: AdapterEnv, id: string, secret: string): Promise<{ token: string } | { error: string }> {
  const key = `${id}:${secret.length}`;
  if (cachedToken && cachedToken.key === key && cachedToken.until > Date.now()) return { token: cachedToken.value };
  const out = await env.fetchHtml(`${ML_API}/oauth/token`, {
    api: true,
    accept: 'json',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
  });
  if (out.kind !== 'ok') return { error: out.message };
  const body = asRecord(parseJson(out.html));
  const token = typeof body?.access_token === 'string' ? body.access_token : null;
  if (!token) return { error: `token recusado: ${String(body?.message ?? body?.error ?? out.status)}` };
  const ttl = typeof body?.expires_in === 'number' ? body.expires_in : 21600;
  cachedToken = { value: token, until: Date.now() + (ttl - 120) * 1000, key };
  return { token };
}

export function mlFromApi(body: unknown): RawOffer[] {
  const results = asRecord(body)?.results;
  const out: RawOffer[] = [];
  for (const raw of Array.isArray(results) ? results : []) {
    const r = asRecord(raw);
    if (!r || typeof r.title !== 'string' || typeof r.permalink !== 'string') continue;
    if (r.currency_id && r.currency_id !== 'BRL') continue;
    const price = firstPrice(r.price);
    if (price === null) continue;
    const shipping = asRecord(r.shipping);
    out.push({
      title: r.title,
      url: r.permalink,
      price,
      regularPrice: firstPrice(r.original_price),
      itemId: typeof r.id === 'string' ? r.id : null,
      freightNote: shipping?.free_shipping === true ? 'frete grátis informado pelo Mercado Livre' : null,
    });
  }
  return out;
}

/** Menor custo entre as opções de entrega para o CEP. */
export function mlShippingCost(body: unknown): number | null {
  const options = asRecord(body)?.options;
  let best: number | null = null;
  for (const raw of Array.isArray(options) ? options : []) {
    const o = asRecord(raw);
    const cost = typeof o?.cost === 'number' ? o.cost : typeof o?.list_cost === 'number' ? o.list_cost : null;
    if (cost !== null && cost >= 0 && (best === null || cost < best)) best = cost;
  }
  return best;
}

/** Fim da promoção vigente (endpoint /items/{id}/prices). */
export function mlPromotionEnd(body: unknown, now = Date.now()): string | null {
  const prices = asRecord(body)?.prices;
  for (const raw of Array.isArray(prices) ? prices : []) {
    const p = asRecord(raw);
    if (p?.type !== 'promotion') continue;
    const cond = asRecord(p.conditions);
    const end = parseEndDate(cond?.end_time);
    const start = cond?.start_time ? Date.parse(String(cond.start_time)) : 0;
    if (end && Date.parse(end) > now && (!start || start <= now)) return end;
  }
  return null;
}

function keysFrom(env: AdapterEnv) {
  const s = env.secrets ?? {};
  return s.ML_CLIENT_ID && s.ML_CLIENT_SECRET ? { id: s.ML_CLIENT_ID, secret: s.ML_CLIENT_SECRET } : null;
}

async function searchApi(terms: string, env: AdapterEnv, token: string): Promise<StoreResult> {
  const url = `${ML_API}/sites/MLB/search?${new URLSearchParams({ q: terms, limit: '40' }).toString()}`;
  const out = await env.fetchHtml(url, { api: true, accept: 'json', headers: { authorization: `Bearer ${token}` } });
  if (out.kind !== 'ok') return { status: out.kind, message: out.message, offers: [] };
  if (out.status === 401 || out.status === 403) {
    return {
      status: 'blocked',
      message: `a API do ML recusou a busca (HTTP ${out.status}); confira se o app está ativo em developers.mercadolivre.com.br`,
      offers: [],
    };
  }
  if ((out.status ?? 200) >= 400) return { status: 'error', message: `API do ML respondeu ${out.status}`, offers: [] };
  const offers = mlFromApi(parseJson(out.html));
  if (offers.length === 0) return { status: 'empty', message: 'API sem resultados', offers: [] };
  return { status: 'ok', message: `${offers.length} itens (API)`, offers };
}

// ---------------------------------------------------------------------------
// Página HTML (reserva). Costuma cair na tela de verificação; aí o status mostra "bloqueou".
// ---------------------------------------------------------------------------

function readAndesMoney(scope: CheerioSel, previous: boolean): number | null {
  const boxes = scope.find('.andes-money-amount');
  const box = (previous ? boxes.filter('.andes-money-amount--previous') : boxes.not('.andes-money-amount--previous')).first();
  if (box.length === 0) return null;
  const fraction = textOf(box.find('.andes-money-amount__fraction').first());
  const cents = textOf(box.find('.andes-money-amount__cents').first());
  return parsePriceBRL(cents ? `${fraction},${cents}` : fraction);
}

export function mlFromDom($: CheerioDoc, base: string): RawOffer[] {
  const out: RawOffer[] = [];
  $('li.ui-search-layout__item, div.poly-card, div.ui-search-result__wrapper').each((_i, el) => {
    const card = $(el);
    const link = card.find('a.poly-component__title, a.ui-search-link, h2 a, h3 a').first();
    const title = textOf(link) || (link.attr('title') ?? '').trim();
    const href = link.attr('href') ?? '';
    if (!title || !href || href.includes('click1.mercadolivre')) return;
    const url = absoluteUrl(href, base);
    const current = card.find('.poly-price__current, .ui-search-price__second-line').first();
    const price = readAndesMoney(current.length ? current : card, false);
    if (!url || price === null) return;
    out.push({
      title,
      url,
      price,
      regularPrice: readAndesMoney(card, true),
      freightNote: hasFreeShippingText(textOf(card)) ? FREE_SHIPPING_HINT : null,
    });
  });
  return out;
}

export function mlSearchUrl(terms: string): string {
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(terms.trim().replace(/\s+/g, '-'))}`;
}

const PAGE_CFG = { fromDom: mlFromDom };

export const mercadolivre: StoreAdapter = {
  id: 'mercadolivre',
  name: META.name,
  domains: META.domains,
  via: 'html',
  async search(terms, env) {
    const keys = keysFrom(env);
    if (keys) {
      const tok = await getToken(env, keys.id, keys.secret);
      if ('token' in tok) {
        const api = await searchApi(terms, env, tok.token);
        if (api.status === 'ok' || api.status === 'empty') return api;
        const page = await readPage(mlSearchUrl(terms), env, META.domains, PAGE_CFG);
        return page.status === 'ok' ? page : api;
      }
      const page = await readPage(mlSearchUrl(terms), env, META.domains, PAGE_CFG);
      return page.status === 'ok' ? page : { status: 'error', message: `ML: ${tok.error}`, offers: [] };
    }
    const page = await readPage(mlSearchUrl(terms), env, META.domains, PAGE_CFG);
    if (page.status === 'blocked') {
      return { ...page, message: `${page.message}. Cadastre ML_CLIENT_ID e ML_CLIENT_SECRET para usar a API oficial` };
    }
    return page;
  },
  listing: (url, env) => readPage(url, env, META.domains, PAGE_CFG),
  async enrich(offer, env, ctx) {
    const keys = keysFrom(env);
    if (!keys || !offer.itemId) return {};
    const tok = await getToken(env, keys.id, keys.secret);
    if (!('token' in tok)) return {};
    const headers = { authorization: `Bearer ${tok.token}` };
    const patch: Partial<RawOffer> = {};
    if (ctx.cep) {
      const zip = ctx.cep.replace(/\D/g, '');
      const out = await env.fetchHtml(
        `${ML_API}/items/${encodeURIComponent(offer.itemId)}/shipping_options?zip_code=${zip}`,
        { api: true, accept: 'json', headers },
      );
      if (out.kind === 'ok' && (out.status ?? 200) < 400) {
        const cost = mlShippingCost(parseJson(out.html));
        if (cost !== null) patch.shippingPrice = cost;
      }
    }
    if (!offer.endsAt) {
      const out = await env.fetchHtml(`${ML_API}/items/${encodeURIComponent(offer.itemId)}/prices`, {
        api: true,
        accept: 'json',
        headers,
      });
      if (out.kind === 'ok' && (out.status ?? 200) < 400) {
        const end = mlPromotionEnd(parseJson(out.html));
        if (end) patch.endsAt = end;
      }
    }
    return patch;
  },
};
