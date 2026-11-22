import { createClient } from '@supabase/supabase-js';
import type {
  ChatSettings,
  CheckerDb,
  CommandDb,
  FreightMode,
  NewOffer,
  OfferPatch,
  Source,
  StoredOffer,
  StoreStatusRow,
  Watch,
} from './types.ts';

export type Db = CommandDb & CheckerDb & Required<Pick<CheckerDb, 'getSettings' | 'listSources' | 'markChecked'>>;

function check(ctx: string, error: { message: string } | null): void {
  if (error) throw new Error(`${ctx}: ${error.message}`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** O PostgREST devolve numeric como número ou texto, dependendo da configuração. */
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

function toWatch(row: Record<string, unknown>): Watch {
  return { ...(row as unknown as Watch), target_price: num(row.target_price), margin_pct: num(row.margin_pct) };
}

function toOffer(row: Record<string, unknown>): StoredOffer {
  const n = (v: unknown) => (v === null || v === undefined ? null : num(v));
  return {
    ...(row as unknown as StoredOffer),
    price: num(row.price),
    lowest_price: num(row.lowest_price),
    regular_price: n(row.regular_price),
    shipping_price: n(row.shipping_price),
    last_alerted_price: n(row.last_alerted_price),
  };
}

export function createDb(url: string, serviceRoleKey: string): Db {
  const sb = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const getSettings = async (chatId: number): Promise<ChatSettings> => {
    const { data, error } = await sb.from('chat_settings').select('cep, freight_mode').eq('chat_id', chatId).maybeSingle();
    check('getSettings', error);
    const row = data as { cep: string | null; freight_mode: FreightMode | null } | null;
    return { cep: row?.cep ?? null, freight_mode: row?.freight_mode ?? 'total' };
  };

  return {
    // ----- comandos -----
    async addWatch(chatId, w) {
      const { data, error } = await sb
        .from('watches')
        .insert({ chat_id: chatId, ...w })
        .select()
        .single();
      check('addWatch', error);
      return toWatch(data as Record<string, unknown>);
    },

    async listWatches(chatId) {
      const { data, error } = await sb.from('watches').select('*').eq('chat_id', chatId).order('id');
      check('listWatches', error);
      return ((data ?? []) as Record<string, unknown>[]).map(toWatch);
    },

    async updateWatch(chatId, id, patch) {
      const { data, error } = await sb
        .from('watches')
        .update(patch)
        .eq('id', id)
        .eq('chat_id', chatId)
        .select()
        .maybeSingle();
      check('updateWatch', error);
      return data ? toWatch(data as Record<string, unknown>) : null;
    },

    async deleteWatch(chatId, id) {
      const { data, error } = await sb.from('watches').delete().eq('id', id).eq('chat_id', chatId).select('id');
      check('deleteWatch', error);
      return (data ?? []).length > 0;
    },

    async getCep(chatId) {
      return (await getSettings(chatId)).cep;
    },

    async setCep(chatId, cep) {
      const { error } = await sb
        .from('chat_settings')
        .upsert({ chat_id: chatId, cep, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' });
      check('setCep', error);
    },

    getSettings,

    async setFreightMode(chatId, mode) {
      const { error } = await sb
        .from('chat_settings')
        .upsert({ chat_id: chatId, freight_mode: mode, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' });
      check('setFreightMode', error);
    },

    async getStoreStatus() {
      const { data, error } = await sb.from('store_status').select('*');
      check('getStoreStatus', error);
      return (data ?? []) as StoreStatusRow[];
    },

    async listSources(chatId) {
      const { data, error } = await sb.from('sources').select('*').eq('chat_id', chatId).order('id');
      check('listSources', error);
      return (data ?? []) as Source[];
    },

    async setBuiltinEnabled(chatId, storeId, name, enabled) {
      const { error } = await sb
        .from('sources')
        .upsert(
          { chat_id: chatId, kind: 'builtin', store_id: storeId, name, enabled },
          { onConflict: 'chat_id,kind,store_id' },
        );
      check('setBuiltinEnabled', error);
    },

    async addCustomSource(chatId, s) {
      const { data, error } = await sb
        .from('sources')
        .insert({ chat_id: chatId, kind: 'custom', store_id: null, ...s })
        .select()
        .single();
      check('addCustomSource', error);
      return data as Source;
    },

    async deleteSource(chatId, id) {
      const { data, error } = await sb
        .from('sources')
        .delete()
        .eq('id', id)
        .eq('chat_id', chatId)
        .eq('kind', 'custom')
        .select('id');
      check('deleteSource', error);
      return (data ?? []).length > 0;
    },

    // ----- checagem -----
    async listActiveWatches(chatId) {
      let query = sb.from('watches').select('*').eq('active', true).order('id');
      if (chatId !== undefined) query = query.eq('chat_id', chatId);
      const { data, error } = await query;
      check('listActiveWatches', error);
      return ((data ?? []) as Record<string, unknown>[]).map(toWatch);
    },

    async getOffersByUrl(watchId, urls) {
      const found: StoredOffer[] = [];
      for (const part of chunk(urls, 40)) {
        const { data, error } = await sb.from('offers').select('*').eq('watch_id', watchId).in('url', part);
        check('getOffersByUrl', error);
        found.push(...((data ?? []) as Record<string, unknown>[]).map(toOffer));
      }
      return found;
    },

    async insertOffer(row: NewOffer) {
      const { data, error } = await sb.from('offers').insert(row).select().single();
      check('insertOffer', error);
      return toOffer(data as Record<string, unknown>);
    },

    async updateOffer(id: number, patch: OfferPatch) {
      const { error } = await sb.from('offers').update(patch).eq('id', id);
      check('updateOffer', error);
    },

    async saveStoreStatus(rows) {
      const checkedAt = new Date().toISOString();
      const { error } = await sb
        .from('store_status')
        .upsert(rows.map((r) => ({ ...r, checked_at: checkedAt })), { onConflict: 'store' });
      check('saveStoreStatus', error);
    },

    async markChecked(watchIds, at) {
      for (const part of chunk(watchIds, 100)) {
        const { error } = await sb.from('watches').update({ last_checked_at: at }).in('id', part);
        check('markChecked', error);
      }
    },

    async tryLock(name, ttlSeconds) {
      const { data, error } = await sb.rpc('try_lock', { p_name: name, p_ttl_seconds: ttlSeconds });
      check('tryLock', error);
      return data === true;
    },

    async unlock(name) {
      const { error } = await sb.from('locks').update({ locked_until: new Date().toISOString() }).eq('name', name);
      check('unlock', error);
    },
  };
}
