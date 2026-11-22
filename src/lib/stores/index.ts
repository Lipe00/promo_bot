import type { Source, StoreAdapter } from '../types.ts';
import { aliexpress } from './aliexpress.ts';
import { amazon } from './amazon.ts';
import { makeGenericStore } from './generic.ts';
import { kabum } from './kabum.ts';
import { magalu } from './magalu.ts';
import { mercadolivre } from './mercadolivre.ts';
import { pichau } from './pichau.ts';
import { shopee } from './shopee.ts';
import { terabyte } from './terabyte.ts';

export const STORE_ADAPTERS: StoreAdapter[] = [
  mercadolivre,
  amazon,
  magalu,
  kabum,
  pichau,
  terabyte,
  shopee,
  aliexpress,
];

/**
 * Lojas de um chat: as embutidas (menos as desligadas com /lojas off) + as fontes cadastradas.
 * `builtins` vem de fora para os testes poderem trocar as lojas reais por falsas.
 */
export function buildAdapters(builtins: StoreAdapter[], sources: Source[]): StoreAdapter[] {
  const disabled = new Set(
    sources.filter((s) => s.kind === 'builtin' && !s.enabled && s.store_id).map((s) => s.store_id as string),
  );
  const custom = sources.filter((s) => s.kind === 'custom' && s.enabled && s.search_url).map(makeGenericStore);
  return [...builtins.filter((a) => !disabled.has(a.id)), ...custom];
}

/** Variáveis que ativam a API oficial de cada loja. */
export const API_KEYS: Record<string, string[]> = {
  mercadolivre: ['ML_CLIENT_ID', 'ML_CLIENT_SECRET'],
  shopee: ['SHOPEE_AFFILIATE_APP_ID', 'SHOPEE_AFFILIATE_SECRET'],
  aliexpress: ['ALI_APP_KEY', 'ALI_APP_SECRET'],
};

export function hasApiKeys(storeId: string, secrets: Record<string, string | undefined> = {}): boolean {
  const keys = API_KEYS[storeId];
  return !!keys && keys.every((k) => !!secrets[k]);
}

/** Como a loja vai ser lida, para mostrar em /lojas. */
export function viaLabel(adapter: StoreAdapter, secrets: Record<string, string | undefined> = {}): string {
  if (hasApiKeys(adapter.id, secrets)) return 'API oficial';
  if (adapter.id.startsWith('custom:')) return 'fonte cadastrada (JSON-LD)';
  if (adapter.via === 'unsupported') return `sem chave (${(API_KEYS[adapter.id] ?? []).join(', ')})`;
  return 'página da loja';
}
