import { createClient } from '@supabase/supabase-js';
import type {
  AuthDb,
  ChannelAdminDb,
  ChannelDb,
  ChatSettings,
  CheckerDb,
  CommandDb,
  CouponRow,
  DashboardDb,
  FreightMode,
  NewOffer,
  OfferPatch,
  PricePoint,
  Source,
  StoredOffer,
  StoredPost,
  StoreStatusRow,
  TgChannel,
  User,
  Watch,
  WatchPostMatch,
} from './types.ts';

export type Db = CommandDb &
  CheckerDb &
  AuthDb &
  DashboardDb &
  ChannelDb &
  ChannelAdminDb &
  Required<
    Pick<CheckerDb, 'getSettings' | 'listSources' | 'markChecked' | 'lastPricePoints' | 'insertPricePoints' | 'pruneHistory'>
  >;

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

function toPoint(row: Record<string, unknown>): PricePoint {
  return { ...(row as unknown as PricePoint), price: num(row.price) };
}

const nn = (v: unknown) => (v === null || v === undefined ? null : num(v));

function toChannel(row: Record<string, unknown>): TgChannel {
  return { ...(row as unknown as TgChannel), tg_id: nn(row.tg_id), last_message_id: nn(row.last_message_id) };
}

function toPost(row: Record<string, unknown>): StoredPost {
  return { ...(row as unknown as StoredPost), message_id: num(row.message_id), price: nn(row.price) };
}

export function createDb(url: string, serviceRoleKey: string): Db {
  const sb = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const getSettings = async (chatId: number): Promise<ChatSettings> => {
    const { data, error } = await sb
      .from('chat_settings')
      .select('cep, freight_mode, coupon_stores')
      .eq('chat_id', chatId)
      .maybeSingle();
    check('getSettings', error);
    const row = data as { cep: string | null; freight_mode: FreightMode | null; coupon_stores: string[] | null } | null;
    return {
      cep: row?.cep ?? null,
      freight_mode: row?.freight_mode ?? 'total',
      coupon_stores: row?.coupon_stores ?? ['amazon', 'shopee', 'mercadolivre'],
    };
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

    async lastPricePoints(offerIds, since) {
      const out: { offer_id: number; price: number; seen_at: string }[] = [];
      for (const part of chunk(offerIds, 50)) {
        const { data, error } = await sb
          .from('price_history')
          .select('offer_id, price, seen_at')
          .in('offer_id', part)
          .gte('seen_at', since)
          .order('seen_at', { ascending: false });
        check('lastPricePoints', error);
        const seen = new Set<number>();
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          const id = num(r.offer_id);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ offer_id: id, price: num(r.price), seen_at: String(r.seen_at) });
        }
      }
      return out;
    },

    async insertPricePoints(rows) {
      for (const part of chunk(rows, 200)) {
        const { error } = await sb.from('price_history').insert(part);
        check('insertPricePoints', error);
      }
    },

    async pruneHistory(before) {
      const { error } = await sb.from('price_history').delete().lt('seen_at', before);
      check('pruneHistory', error);
    },

    // ----- painel -----
    async listOffersByWatches(watchIds) {
      const found: StoredOffer[] = [];
      for (const part of chunk(watchIds, 50)) {
        const { data, error } = await sb.from('offers').select('*').in('watch_id', part).order('price');
        check('listOffersByWatches', error);
        found.push(...((data ?? []) as Record<string, unknown>[]).map(toOffer));
      }
      return found;
    },

    async listHistory(watchId, since) {
      const { data, error } = await sb
        .from('price_history')
        .select('*')
        .eq('watch_id', watchId)
        .gte('seen_at', since)
        .order('seen_at')
        .limit(5000);
      check('listHistory', error);
      return ((data ?? []) as Record<string, unknown>[]).map(toPoint);
    },

    // ----- contas -----
    async getUserByUsername(username) {
      const { data, error } = await sb.from('users').select('*').eq('username', username).maybeSingle();
      check('getUserByUsername', error);
      return (data as User | null) ?? null;
    },

    async getUserById(id) {
      const { data, error } = await sb.from('users').select('*').eq('id', id).maybeSingle();
      check('getUserById', error);
      return (data as User | null) ?? null;
    },

    async touchLogin(id, at) {
      const { error } = await sb.from('users').update({ last_login_at: at }).eq('id', id);
      check('touchLogin', error);
    },

    async upsertUser(username, passwordHash, chatId) {
      const { data, error } = await sb
        .from('users')
        .upsert({ username, password_hash: passwordHash, chat_id: chatId }, { onConflict: 'username' })
        .select()
        .single();
      check('upsertUser', error);
      return data as User;
    },

    async createSession(row) {
      const { error } = await sb.from('sessions').insert(row);
      check('createSession', error);
    },

    async getSessionRow(id) {
      const { data, error } = await sb.from('sessions').select('id, user_id, expires_at').eq('id', id).maybeSingle();
      check('getSessionRow', error);
      const row = data as { id: string; user_id: number | string; expires_at: string } | null;
      return row ? { id: row.id, user_id: Number(row.user_id), expires_at: row.expires_at } : null;
    },

    async deleteSession(id) {
      const { error } = await sb.from('sessions').delete().eq('id', id);
      check('deleteSession', error);
    },

    async deleteUserSessions(userId) {
      const { error } = await sb.from('sessions').delete().eq('user_id', userId);
      check('deleteUserSessions', error);
    },

    // ----- canais e cupons -----
    async listEnabledChannels() {
      const { data, error } = await sb
        .from('tg_channels')
        .select('*')
        .eq('enabled', true)
        .order('last_checked_at', { ascending: true, nullsFirst: true });
      check('listEnabledChannels', error);
      return ((data ?? []) as Record<string, unknown>[]).map(toChannel);
    },

    async updateChannel(id, patch) {
      const { error } = await sb.from('tg_channels').update(patch).eq('id', id);
      check('updateChannel', error);
    },

    async insertPost(channelId, p) {
      const { data, error } = await sb
        .from('channel_posts')
        .upsert(
          {
            channel_id: channelId,
            message_id: p.messageId,
            posted_at: p.postedAt,
            text: p.text.slice(0, 4000),
            title: p.title.slice(0, 300),
            links: p.links.slice(0, 20),
            price: p.price,
            coupons: p.coupons.map((c) => c.code),
            store: p.store,
            offer_url: p.offerUrl,
            post_url: p.postUrl,
          },
          { onConflict: 'channel_id,message_id', ignoreDuplicates: true },
        )
        .select('id');
      check('insertPost', error);
      const row = (data ?? [])[0] as { id: number } | undefined;
      return row ? num(row.id) : null;
    },

    async insertMatch(postId, watchId, price) {
      const { data, error } = await sb
        .from('post_matches')
        .upsert({ post_id: postId, watch_id: watchId, price }, { onConflict: 'post_id,watch_id', ignoreDuplicates: true })
        .select('id');
      check('insertMatch', error);
      return (data ?? []).length > 0;
    },

    async markMatchNotified(postId, watchId, at) {
      const { error } = await sb.from('post_matches').update({ notified_at: at }).eq('post_id', postId).eq('watch_id', watchId);
      check('markMatchNotified', error);
    },

    async getCoupon(chatId, store, code) {
      const { data, error } = await sb
        .from('coupons')
        .select('*')
        .eq('chat_id', chatId)
        .eq('store', store)
        .eq('code', code)
        .maybeSingle();
      check('getCoupon', error);
      return (data as CouponRow | null) ?? null;
    },

    async upsertCoupon(c) {
      const { seen_at, ...rest } = c;
      const { data, error } = await sb
        .from('coupons')
        .upsert({ ...rest, last_seen_at: seen_at }, { onConflict: 'chat_id,store,code' })
        .select()
        .single();
      check('upsertCoupon', error);
      return data as CouponRow;
    },

    async markCouponNotified(id, at) {
      const { error } = await sb.from('coupons').update({ notified_at: at }).eq('id', id);
      check('markCouponNotified', error);
    },

    async prunePosts(before) {
      const { error } = await sb.from('channel_posts').delete().lt('posted_at', before);
      check('prunePosts', error);
    },

    async listChannels(chatId) {
      const { data, error } = await sb.from('tg_channels').select('*').eq('chat_id', chatId).order('id');
      check('listChannels', error);
      return ((data ?? []) as Record<string, unknown>[]).map(toChannel);
    },

    async addChannel(chatId, c) {
      const { data, error } = await sb
        .from('tg_channels')
        .insert({ chat_id: chatId, ...c })
        .select()
        .single();
      check('addChannel', error);
      return toChannel(data as Record<string, unknown>);
    },

    async setChannelEnabled(chatId, id, enabled) {
      const { data, error } = await sb
        .from('tg_channels')
        .update({ enabled })
        .eq('id', id)
        .eq('chat_id', chatId)
        .select()
        .maybeSingle();
      check('setChannelEnabled', error);
      return data ? toChannel(data as Record<string, unknown>) : null;
    },

    async deleteChannel(chatId, id) {
      const { data, error } = await sb.from('tg_channels').delete().eq('id', id).eq('chat_id', chatId).select('id');
      check('deleteChannel', error);
      return (data ?? []).length > 0;
    },

    async listCoupons(chatId, limit) {
      const { data, error } = await sb
        .from('coupons')
        .select('*')
        .eq('chat_id', chatId)
        .order('last_seen_at', { ascending: false })
        .limit(limit);
      check('listCoupons', error);
      return (data ?? []) as CouponRow[];
    },

    async listWatchMatches(watchId) {
      const { data, error } = await sb
        .from('post_matches')
        .select('post_id, watch_id, price, notified_at, post:channel_posts(*, channel:tg_channels(title))')
        .eq('watch_id', watchId)
        .order('created_at', { ascending: false })
        .limit(50);
      check('listWatchMatches', error);
      return ((data ?? []) as Record<string, unknown>[]).flatMap((r) => {
        const post = r.post as (Record<string, unknown> & { channel?: { title?: string } | null }) | null;
        if (!post) return [];
        const { channel, ...rest } = post;
        return [
          {
            post_id: num(r.post_id),
            watch_id: num(r.watch_id),
            price: nn(r.price),
            notified_at: (r.notified_at as string | null) ?? null,
            post: { ...toPost(rest), channel_title: channel?.title ?? '' },
          } satisfies WatchPostMatch,
        ];
      });
    },

    async setCouponStores(chatId, stores) {
      const { error } = await sb
        .from('chat_settings')
        .upsert({ chat_id: chatId, coupon_stores: stores, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' });
      check('setCouponStores', error);
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
