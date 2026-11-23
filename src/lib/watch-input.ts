import { BUILTIN_IDS, DEFAULTS, STORE_META, hostAllowed } from './config.ts';
import { normalizeText, searchTerms } from './matching.ts';
import { parsePriceBRL } from './price.ts';
import { buildAdapters } from './stores/index.ts';
import type { BuiltinStoreId, NewWatch, Source, StoreAdapter, WatchKind, WatchPatch } from './types.ts';

/**
 * Regras de cadastro de buscas, compartilhadas pelo Telegram (/add, /categoria) e pelo painel web.
 */

export function parseMargin(input: string | number | undefined | null): number | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 && input <= 100 ? input : null;
  const s = input.trim().replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

const STORE_ALIASES: Record<string, BuiltinStoreId> = {
  ml: 'mercadolivre',
  meli: 'mercadolivre',
  mercadolivre: 'mercadolivre',
  mercadolibre: 'mercadolivre',
  amazon: 'amazon',
  amz: 'amazon',
  shopee: 'shopee',
  aliexpress: 'aliexpress',
  ali: 'aliexpress',
  kabum: 'kabum',
};

/** "Mercado Livre", "ml", "KaBuM!" → id da loja embutida. */
export function resolveStore(input: string): BuiltinStoreId | null {
  const key = normalizeText(input).replace(/\s+/g, '');
  return STORE_ALIASES[key] ?? null;
}

/** "kabum, amazon" → ['kabum','amazon']; "todas" → null. */
export function parseStoreList(input: string | undefined): { ok: true; stores: string[] | null } | { ok: false; error: string } {
  const s = (input ?? '').trim();
  if (!s || /^(todas|todos|all|\*)$/i.test(s)) return { ok: true, stores: null };
  const out: string[] = [];
  for (const part of s.split(/[,;]+/)) {
    if (!part.trim()) continue;
    const custom = part.trim().match(/^#?(\d{1,9})$/) ?? part.trim().match(/^custom:(\d{1,9})$/);
    if (custom) {
      out.push(`custom:${custom[1]}`);
      continue;
    }
    const id = resolveStore(part);
    if (!id) return { ok: false, error: `Não conheço a loja "${part.trim()}". Veja /lojas.` };
    out.push(id);
  }
  return { ok: true, stores: out.length > 0 ? [...new Set(out)] : null };
}

export interface WatchDraft {
  kind: WatchKind;
  /** Termo de busca, ou link de categoria (só em kind = categoria). */
  query: string;
  target: number;
  /** null = padrão do tipo (15% produto, 0% categoria). */
  margin: number | null;
  stores: string[] | null;
  onlyDeals?: boolean;
}

export interface WatchCtx {
  builtins: StoreAdapter[];
  sources: Source[];
}

export const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Valida um rascunho e devolve o que vai para o banco. */
export function buildNewWatch(d: WatchDraft, ctx: WatchCtx): { ok: true; watch: NewWatch } | { ok: false; error: string } {
  const query = d.query.trim();
  if (query.length < 2 || query.length > (isUrl(query) ? 300 : 120)) {
    return { ok: false, error: 'O nome do produto precisa ter entre 2 e 120 caracteres.' };
  }
  if (!Number.isFinite(d.target) || d.target <= 0 || d.target >= 10_000_000) {
    return { ok: false, error: 'Não entendi o preço alvo.' };
  }
  if (d.margin !== null && parseMargin(d.margin) === null) {
    return { ok: false, error: 'A margem precisa ser um número entre 0 e 100.' };
  }

  let categoryUrl: string | null = null;
  if (isUrl(query)) {
    if (d.kind !== 'categoria') {
      return { ok: false, error: 'Para link de categoria use /categoria. Ex.: <code>/categoria https://... | 2000</code>' };
    }
    const adapters = buildAdapters(ctx.builtins, ctx.sources);
    const allowed =
      adapters.length > 0
        ? adapters.some((a) => a.listing && hostAllowed(query, a.domains))
        : BUILTIN_IDS.some((id) => hostAllowed(query, STORE_META[id].domains));
    if (!allowed) {
      return { ok: false, error: 'Esse link não é de uma loja cadastrada (veja /lojas). Só aceito https:// de lojas conhecidas.' };
    }
    categoryUrl = query;
  } else if (!searchTerms(query)) {
    return { ok: false, error: 'Escreva pelo menos uma palavra sem “-”.' };
  }

  const stores = categoryUrl ? null : validStores(d.stores, ctx);
  if (stores && 'error' in stores) return { ok: false, error: stores.error };

  return {
    ok: true,
    watch: {
      query,
      target_price: Math.round(d.target * 100) / 100,
      margin_pct: d.margin ?? (d.kind === 'categoria' ? DEFAULTS.categoryMarginPct : DEFAULTS.marginPct),
      kind: d.kind,
      category_url: categoryUrl,
      stores: stores ? stores.list : null,
      only_deals: !!d.onlyDeals,
    },
  };
}

function validStores(stores: string[] | null, ctx: WatchCtx): { list: string[] | null } | { error: string } {
  if (!stores || stores.length === 0) return { list: null };
  const known = new Set([
    ...BUILTIN_IDS,
    ...ctx.sources.filter((s) => s.kind === 'custom').map((s) => `custom:${s.id}`),
  ]);
  for (const s of stores) {
    // Fontes cadastradas só são conferidas quando a lista de fontes foi informada.
    if (s.startsWith('custom:') && ctx.sources.length === 0) continue;
    if (!known.has(s)) return { error: `Loja desconhecida: ${s}` };
  }
  return { list: [...new Set(stores)] };
}

/** Corpo JSON do formulário do painel → rascunho. Aceita números ou textos ("1.299,90", "15%"). */
export function draftFromJson(body: unknown): { ok: true; draft: WatchDraft } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Dados inválidos.' };
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'categoria' ? 'categoria' : b.kind === 'produto' || b.kind === undefined ? 'produto' : null;
  if (!kind) return { ok: false, error: 'Tipo inválido.' };
  if (typeof b.query !== 'string') return { ok: false, error: 'Informe o produto.' };
  const target = typeof b.target === 'number' ? b.target : parsePriceBRL(b.target);
  if (target === null) return { ok: false, error: 'Não entendi o preço alvo.' };
  let margin: number | null = null;
  if (b.margin !== undefined && b.margin !== null && b.margin !== '') {
    margin = parseMargin(b.margin as string | number);
    if (margin === null) return { ok: false, error: 'A margem precisa ser um número entre 0 e 100.' };
  }
  let stores: string[] | null = null;
  if (Array.isArray(b.stores)) {
    if (!b.stores.every((s) => typeof s === 'string')) return { ok: false, error: 'Lojas inválidas.' };
    stores = b.stores.length > 0 ? (b.stores as string[]) : null;
  }
  return { ok: true, draft: { kind, query: b.query, target, margin, stores, onlyDeals: b.onlyDeals === true } };
}

/** Corpo JSON de edição do painel → alterações permitidas. */
export function patchFromJson(body: unknown, ctx: WatchCtx): { ok: true; patch: WatchPatch } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Dados inválidos.' };
  const b = body as Record<string, unknown>;
  const patch: WatchPatch = {};
  if (b.target !== undefined) {
    const t = typeof b.target === 'number' ? b.target : parsePriceBRL(b.target);
    if (t === null || t <= 0) return { ok: false, error: 'Não entendi o preço alvo.' };
    patch.target_price = Math.round(t * 100) / 100;
  }
  if (b.margin !== undefined) {
    const m = parseMargin(b.margin as string | number);
    if (m === null) return { ok: false, error: 'A margem precisa ser um número entre 0 e 100.' };
    patch.margin_pct = m;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return { ok: false, error: 'Valor inválido para ativo.' };
    patch.active = b.active;
  }
  if (b.onlyDeals !== undefined) {
    if (typeof b.onlyDeals !== 'boolean') return { ok: false, error: 'Valor inválido para apenas promoções.' };
    patch.only_deals = b.onlyDeals;
  }
  if (b.stores !== undefined) {
    if (b.stores !== null && !(Array.isArray(b.stores) && b.stores.every((s) => typeof s === 'string'))) {
      return { ok: false, error: 'Lojas inválidas.' };
    }
    const v = validStores((b.stores as string[] | null) ?? null, ctx);
    if ('error' in v) return { ok: false, error: v.error };
    patch.stores = v.list;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nada para alterar.' };
  return { ok: true, patch };
}
