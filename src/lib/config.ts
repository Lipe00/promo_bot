import type { BuiltinStoreId } from './types.ts';

/** Lojas embutidas. Só links destes domínios (e dos domínios das fontes cadastradas) viram alerta. */
export const STORE_META: Record<BuiltinStoreId, { name: string; domains: string[] }> = {
  mercadolivre: { name: 'Mercado Livre', domains: ['mercadolivre.com.br', 'mercadolibre.com'] },
  amazon: { name: 'Amazon', domains: ['amazon.com.br'] },
  shopee: { name: 'Shopee', domains: ['shopee.com.br'] },
  aliexpress: { name: 'AliExpress', domains: ['aliexpress.com'] },
  magalu: { name: 'Magalu', domains: ['magazineluiza.com.br'] },
  kabum: { name: 'KaBuM!', domains: ['kabum.com.br'] },
  pichau: { name: 'Pichau', domains: ['pichau.com.br'] },
  terabyte: { name: 'TerabyteShop', domains: ['terabyteshop.com.br'] },
};

export const BUILTIN_IDS = Object.keys(STORE_META) as BuiltinStoreId[];

export function isBuiltinId(id: string): id is BuiltinStoreId {
  return (BUILTIN_IDS as string[]).includes(id);
}

export const DEFAULTS = {
  /** Margem padrão acima do preço alvo, em %. */
  marginPct: 15,
  /** Margem padrão de categoria (o valor informado já é o teto). */
  categoryMarginPct: 0,
  /** Ofertas abaixo disso (fração do alvo) são ignoradas: costumam ser acessório, peça ou anúncio errado. */
  minPriceRatio: 0.4,
  /** Só reavisa a mesma oferta se o preço cair pelo menos isso (%) desde o último alerta. */
  realertDropPct: 2,
  /** Lembrete se a oferta continua boa e o último alerta tem mais que isso (dias). */
  reminderDays: 7,
  /** Teto de alertas por busca em cada rodada, para não virar spam. */
  maxAlertsPerWatchPerRun: 5,
  /** Quantos itens entram no resumo de uma categoria. */
  categoryDigestSize: 5,
  /** Quantas ofertas por busca recebem consulta extra de frete/prazo. */
  maxEnrichPerWatch: 6,
  /** Intervalo mínimo entre duas requisições ao mesmo site (ms). */
  requestGapMs: 1500,
  requestTimeoutMs: 12000,
  /** Tempo de trabalho por rodada. A função da Vercel tem 60s; o que sobrar vai para a próxima rodada. */
  runBudgetMs: 45_000,
  /** Se faltar menos que isso, não começa outra busca. */
  perWatchReserveMs: 12_000,
} as const;

/** Hosts liberados em HTTP só para testes locais (ex.: PROMO_DEV_HTTP_HOSTS=mocks). */
function devHttpHosts(): string[] {
  const raw = typeof process !== 'undefined' ? process.env.PROMO_DEV_HTTP_HOSTS : undefined;
  return raw ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
}

export function hostAllowed(url: string, domains: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') {
    if (!(parsed.protocol === 'http:' && devHttpHosts().includes(host))) return false;
  }
  return domains.some((d) => host === d || host.endsWith('.' + d));
}
