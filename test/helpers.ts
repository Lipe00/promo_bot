// Bancos em memória usados pelos testes (mesma interface do Supabase).
import type {
  AuthDb,
  ChannelDb,
  CouponRow,
  StoredPost,
  TgChannel,
  ChatSettings,
  CheckerDb,
  CommandDb,
  DashboardDb,
  NewOffer,
  OfferPatch,
  PricePoint,
  SessionRow,
  Source,
  StoredOffer,
  StoreStatusRow,
  User,
  Watch,
} from '../src/lib/types.ts';

export function memoryDb(initial: { watches?: Watch[]; sources?: Source[]; settings?: Partial<ChatSettings> } = {}) {
  const state = {
    watches: [...(initial.watches ?? [])] as Watch[],
    offers: [] as StoredOffer[],
    sources: [...(initial.sources ?? [])] as Source[],
    settings: new Map<number, ChatSettings>(),
    statuses: [] as Omit<StoreStatusRow, 'checked_at'>[],
    checked: [] as number[],
    history: [] as PricePoint[],
    users: [] as User[],
    sessions: [] as SessionRow[],
    pruned: [] as string[],
    channels: [] as TgChannel[],
    posts: [] as StoredPost[],
    matches: [] as { post_id: number; watch_id: number; price: number | null; notified_at: string | null }[],
    coupons: [] as CouponRow[],
    seq: 100,
  };
  const settingsOf = (chatId: number): ChatSettings =>
    state.settings.get(chatId) ?? {
      cep: initial.settings?.cep ?? null,
      freight_mode: initial.settings?.freight_mode ?? 'total',
      coupon_stores: initial.settings?.coupon_stores ?? ['amazon', 'shopee', 'mercadolivre'],
    };

  const db: CommandDb & CheckerDb & AuthDb & DashboardDb & ChannelDb = {
    // ----- canais e cupons -----
    async listEnabledChannels() {
      return state.channels
        .filter((c) => c.enabled)
        .sort((a, b) => (a.last_checked_at ?? '').localeCompare(b.last_checked_at ?? ''));
    },
    async updateChannel(id, patch) {
      const c = state.channels.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
    async insertPost(channelId, p) {
      if (state.posts.some((x) => x.channel_id === channelId && x.message_id === p.messageId)) return null;
      const row: StoredPost = {
        id: ++state.seq,
        channel_id: channelId,
        message_id: p.messageId,
        posted_at: p.postedAt,
        title: p.title,
        text: p.text,
        price: p.price,
        coupons: p.coupons.map((c) => c.code),
        store: p.store,
        offer_url: p.offerUrl,
        post_url: p.postUrl,
      };
      state.posts.push(row);
      return row.id;
    },
    async insertMatch(postId, watchId, price) {
      if (state.matches.some((m) => m.post_id === postId && m.watch_id === watchId)) return false;
      state.matches.push({ post_id: postId, watch_id: watchId, price, notified_at: null });
      return true;
    },
    async markMatchNotified(postId, watchId, at) {
      const m = state.matches.find((x) => x.post_id === postId && x.watch_id === watchId);
      if (m) m.notified_at = at;
    },
    async getCoupon(chatId, store, code) {
      return state.coupons.find((c) => c.chat_id === chatId && c.store === store && c.code === code) ?? null;
    },
    async upsertCoupon(c) {
      const { seen_at, ...rest } = c;
      const found = state.coupons.find((x) => x.chat_id === c.chat_id && x.store === c.store && x.code === c.code);
      if (found) {
        Object.assign(found, rest, { last_seen_at: seen_at });
        return found;
      }
      const row: CouponRow = { id: ++state.seq, ...rest, first_seen_at: seen_at, last_seen_at: seen_at, notified_at: null };
      state.coupons.push(row);
      return row;
    },
    async markCouponNotified(id, at) {
      const c = state.coupons.find((x) => x.id === id);
      if (c) c.notified_at = at;
    },
    async prunePosts(before) {
      const gone = new Set(state.posts.filter((p) => p.posted_at < before).map((p) => p.id));
      state.posts = state.posts.filter((p) => !gone.has(p.id));
      state.matches = state.matches.filter((m) => !gone.has(m.post_id));
    },
    async listChannels(chatId) {
      return state.channels.filter((c) => c.chat_id === chatId);
    },
    async addChannel(chatId, c) {
      const row: TgChannel = {
        id: ++state.seq,
        chat_id: chatId,
        enabled: true,
        last_message_id: null,
        last_checked_at: null,
        last_error: null,
        ...c,
      };
      state.channels.push(row);
      return row;
    },
    async setChannelEnabled(chatId, id, enabled) {
      const c = state.channels.find((x) => x.id === id && x.chat_id === chatId);
      if (!c) return null;
      c.enabled = enabled;
      return c;
    },
    async deleteChannel(chatId, id) {
      const before = state.channels.length;
      state.channels = state.channels.filter((x) => !(x.id === id && x.chat_id === chatId));
      return state.channels.length < before;
    },
    async listCoupons(chatId, limit) {
      return state.coupons
        .filter((c) => c.chat_id === chatId)
        .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
        .slice(0, limit);
    },
    async listWatchMatches(watchId) {
      return state.matches
        .filter((m) => m.watch_id === watchId)
        .flatMap((m) => {
          const post = state.posts.find((p) => p.id === m.post_id);
          if (!post) return [];
          const ch = state.channels.find((c) => c.id === post.channel_id);
          return [{ ...m, post: { ...post, channel_title: ch?.title ?? '' } }];
        });
    },
    async setCouponStores(chatId, stores) {
      state.settings.set(chatId, { ...settingsOf(chatId), coupon_stores: stores });
    },
    async lastPricePoints(offerIds, since) {
      const out = new Map<number, { offer_id: number; price: number; seen_at: string }>();
      for (const p of [...state.history].sort((a, b) => a.seen_at.localeCompare(b.seen_at))) {
        if (offerIds.includes(p.offer_id) && p.seen_at >= since) out.set(p.offer_id, { offer_id: p.offer_id, price: p.price, seen_at: p.seen_at });
      }
      return [...out.values()];
    },
    async insertPricePoints(rows) {
      for (const r of rows) state.history.push({ id: ++state.seq, ...r });
    },
    async pruneHistory(before) {
      state.pruned.push(before);
      state.history = state.history.filter((p) => p.seen_at >= before);
    },
    async listOffersByWatches(ids) {
      return state.offers.filter((o) => ids.includes(o.watch_id)).sort((a, b) => a.price - b.price);
    },
    async listHistory(watchId, since) {
      return state.history.filter((p) => p.watch_id === watchId && p.seen_at >= since);
    },
    async getUserByUsername(u) {
      return state.users.find((x) => x.username === u) ?? null;
    },
    async getUserById(id) {
      return state.users.find((x) => x.id === id) ?? null;
    },
    async touchLogin(id, at) {
      const u = state.users.find((x) => x.id === id);
      if (u) u.last_login_at = at;
    },
    async upsertUser(username, hash, chatId) {
      const u = state.users.find((x) => x.username === username);
      if (u) {
        Object.assign(u, { password_hash: hash, chat_id: chatId });
        return u;
      }
      const created: User = { id: ++state.seq, username, password_hash: hash, chat_id: chatId, last_login_at: null };
      state.users.push(created);
      return created;
    },
    async createSession(row) {
      state.sessions.push({ ...row });
    },
    async getSessionRow(id) {
      return state.sessions.find((s) => s.id === id) ?? null;
    },
    async deleteSession(id) {
      state.sessions = state.sessions.filter((s) => s.id !== id);
    },
    async deleteUserSessions(userId) {
      state.sessions = state.sessions.filter((s) => s.user_id !== userId);
    },
    async addWatch(chatId, w) {
      const row: Watch = { id: state.watches.length + 1, chat_id: chatId, active: true, created_at: '2026-11-22T00:00:00Z', last_checked_at: null, ...w };
      state.watches.push(row);
      return row;
    },
    async listWatches(chatId) {
      return state.watches.filter((w) => w.chat_id === chatId);
    },
    async updateWatch(chatId, id, patch) {
      const w = state.watches.find((x) => x.id === id && x.chat_id === chatId);
      if (!w) return null;
      Object.assign(w, patch);
      return w;
    },
    async deleteWatch(chatId, id) {
      const before = state.watches.length;
      state.watches = state.watches.filter((x) => !(x.id === id && x.chat_id === chatId));
      return state.watches.length < before;
    },
    async getCep(chatId) {
      return settingsOf(chatId).cep;
    },
    async setCep(chatId, cep) {
      state.settings.set(chatId, { ...settingsOf(chatId), cep });
    },
    async getSettings(chatId) {
      return settingsOf(chatId);
    },
    async setFreightMode(chatId, mode) {
      state.settings.set(chatId, { ...settingsOf(chatId), freight_mode: mode });
    },
    async getStoreStatus(): Promise<StoreStatusRow[]> {
      return state.statuses.map((s) => ({ ...s, checked_at: '2026-11-22T12:00:00Z' }));
    },
    async listSources(chatId) {
      return state.sources.filter((s) => s.chat_id === chatId);
    },
    async setBuiltinEnabled(chatId, storeId, name, enabled) {
      const s = state.sources.find((x) => x.chat_id === chatId && x.kind === 'builtin' && x.store_id === storeId);
      if (s) s.enabled = enabled;
      else state.sources.push({ id: ++state.seq, chat_id: chatId, kind: 'builtin', store_id: storeId, name, search_url: null, domains: [], enabled });
    },
    async addCustomSource(chatId, s) {
      const row: Source = { id: ++state.seq, chat_id: chatId, kind: 'custom', store_id: null, enabled: true, ...s };
      state.sources.push(row);
      return row;
    },
    async deleteSource(chatId, id) {
      const before = state.sources.length;
      state.sources = state.sources.filter((x) => !(x.id === id && x.chat_id === chatId && x.kind === 'custom'));
      return state.sources.length < before;
    },
    async listActiveWatches(chatId) {
      return state.watches.filter((w) => w.active && (chatId === undefined || w.chat_id === chatId));
    },
    async getOffersByUrl(watchId, urls) {
      return state.offers.filter((o) => o.watch_id === watchId && urls.includes(o.url));
    },
    async insertOffer(row: NewOffer) {
      const o: StoredOffer = { id: ++state.seq, ...row, first_seen_at: 'now', last_seen_at: 'now', last_alerted_price: null, last_alerted_at: null };
      state.offers.push(o);
      return o;
    },
    async updateOffer(id: number, patch: OfferPatch) {
      const o = state.offers.find((x) => x.id === id);
      if (o) Object.assign(o, patch);
    },
    async saveStoreStatus(rows) {
      for (const r of rows) {
        const i = state.statuses.findIndex((s) => s.store === r.store);
        if (i >= 0) state.statuses[i] = r;
        else state.statuses.push(r);
      }
    },
    async markChecked(ids, at) {
      state.checked.push(...ids);
      for (const w of state.watches) if (ids.includes(w.id)) w.last_checked_at = at;
    },
    async tryLock() {
      return true;
    },
    async unlock() {},
  };
  return { db, state };
}

export function watch(p: Partial<Watch> = {}): Watch {
  return {
    id: 1,
    chat_id: 99,
    query: 'force one kabuto -almofada',
    target_price: 300,
    margin_pct: 15,
    active: true,
    created_at: 'x',
    kind: 'produto',
    category_url: null,
    stores: null,
    last_checked_at: null,
    ...p,
  };
}
