// Bancos em memória usados pelos testes (mesma interface do Supabase).
import type {
  ChatSettings,
  CheckerDb,
  CommandDb,
  NewOffer,
  OfferPatch,
  Source,
  StoredOffer,
  StoreStatusRow,
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
    seq: 100,
  };
  const settingsOf = (chatId: number): ChatSettings =>
    state.settings.get(chatId) ?? { cep: initial.settings?.cep ?? null, freight_mode: initial.settings?.freight_mode ?? 'total' };

  const db: CommandDb & CheckerDb = {
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
