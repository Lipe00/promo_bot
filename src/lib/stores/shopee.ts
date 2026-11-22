import { createHash } from 'node:crypto';
import { STORE_META } from '../config.ts';
import { parseJson } from '../http.ts';
import { firstPrice } from '../price.ts';
import type { AdapterEnv, RawOffer, StoreAdapter } from '../types.ts';

const META = STORE_META.shopee;

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * Shopee só é lida pela API oficial de afiliados.
 * Conferido em 22/11/2026: a página de busca é montada por JavaScript (o HTML não tem produtos)
 * e a API interna do site responde 403 para robôs. Não há leitura sem chave.
 *
 * API: https://open-api.affiliate.shopee.com.br/graphql (Shopee Affiliates → Open API)
 * Autorização: "SHA256 Credential=<AppId>, Timestamp=<ts>, Signature=sha256(AppId + ts + corpo + Secret)".
 */
export const SHOPEE_API = 'https://open-api.affiliate.shopee.com.br/graphql';

export function shopeeAuthHeader(appId: string, secret: string, body: string, timestamp: number): string {
  const signature = createHash('sha256').update(`${appId}${timestamp}${body}${secret}`, 'utf8').digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

export function shopeeQueryBody(terms: string): string {
  const query = `query($keyword: String, $limit: Int) {
  productOfferV2(keyword: $keyword, limit: $limit, sortType: 1) {
    nodes { itemId productName priceMin priceMax priceDiscountRate offerLink productLink shopName }
  }
}`;
  return JSON.stringify({ query, variables: { keyword: terms, limit: 30 } });
}

/**
 * Erro 10035 (conferido em 22/11/2026): a assinatura foi aceita, mas a conta ainda não tem acesso
 * à Open API. O acesso é pedido no portal de afiliados (affiliate.shopee.com.br → Open API).
 */
export const SHOPEE_NO_ACCESS = 10035;

export function shopeeFromApi(body: unknown): { offers: RawOffer[]; error: string | null; code?: number } {
  const root = asRecord(body);
  const errors = Array.isArray(root?.errors) ? root.errors : [];
  if (errors.length > 0) {
    const first = asRecord(errors[0]);
    const code = Number(asRecord(first?.extensions)?.code);
    if (code === SHOPEE_NO_ACCESS) {
      return {
        offers: [],
        code,
        error: 'sua conta ainda não tem acesso à Open API (erro 10035); peça em affiliate.shopee.com.br → Open API',
      };
    }
    return { offers: [], error: String(first?.message ?? 'erro da API'), ...(Number.isFinite(code) ? { code } : {}) };
  }
  const nodes = asRecord(asRecord(root?.data)?.productOfferV2)?.nodes;
  const out: RawOffer[] = [];
  for (const raw of Array.isArray(nodes) ? nodes : []) {
    const n = asRecord(raw);
    if (!n || typeof n.productName !== 'string') continue;
    const price = firstPrice(n.priceMin, n.priceMax);
    const url = typeof n.offerLink === 'string' ? n.offerLink : typeof n.productLink === 'string' ? n.productLink : null;
    if (price === null || !url) continue;
    const discount = Number(n.priceDiscountRate);
    out.push({
      title: n.productName,
      url,
      price,
      regularPrice: Number.isFinite(discount) && discount > 0 && discount < 100 ? Math.round((price / (1 - discount / 100)) * 100) / 100 : null,
      itemId: n.itemId !== undefined ? String(n.itemId) : null,
      priceFrom: (firstPrice(n.priceMax) ?? price) > price,
    });
  }
  return { offers: out, error: null };
}

function keysFrom(env: AdapterEnv) {
  const s = env.secrets ?? {};
  return s.SHOPEE_AFFILIATE_APP_ID && s.SHOPEE_AFFILIATE_SECRET
    ? { appId: s.SHOPEE_AFFILIATE_APP_ID, secret: s.SHOPEE_AFFILIATE_SECRET }
    : null;
}

export const shopee: StoreAdapter = {
  id: 'shopee',
  name: META.name,
  domains: META.domains,
  via: 'unsupported',
  async search(terms, env) {
    const keys = keysFrom(env);
    if (!keys) {
      return {
        status: 'unsupported',
        message: 'precisa da API de afiliados (SHOPEE_AFFILIATE_APP_ID e SHOPEE_AFFILIATE_SECRET); o site não abre para robôs',
        offers: [],
      };
    }
    const body = shopeeQueryBody(terms);
    const ts = Math.floor(Date.now() / 1000);
    const out = await env.fetchHtml(SHOPEE_API, {
      api: true,
      accept: 'json',
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', authorization: shopeeAuthHeader(keys.appId, keys.secret, body, ts) },
    });
    if (out.kind !== 'ok') return { status: out.kind, message: out.message, offers: [] };
    const { offers, error, code } = shopeeFromApi(parseJson(out.html));
    if (error) {
      return { status: code === SHOPEE_NO_ACCESS ? 'blocked' : 'error', message: `API Shopee: ${error}`, offers: [] };
    }
    if (offers.length === 0) return { status: 'empty', message: 'API sem resultados', offers: [] };
    return { status: 'ok', message: `${offers.length} itens (API)`, offers };
  },
};
