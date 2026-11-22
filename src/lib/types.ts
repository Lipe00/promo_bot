/** Lojas que já vêm com o bot. Fontes cadastradas pelo usuário usam o id `custom:<n>`. */
export type BuiltinStoreId =
  | 'mercadolivre'
  | 'amazon'
  | 'shopee'
  | 'aliexpress'
  | 'kabum';

export type StoreId = string;

/** Uma oferta como a loja a mostrou, antes de qualquer filtro. */
export interface RawOffer {
  title: string;
  url: string;
  /** Preço normal (cartão/parcelado), em reais. */
  price: number;
  /** Preço à vista/Pix quando a loja mostra separado. */
  cashPrice?: number | null;
  /** Preço "de" (riscado), se houver. */
  regularPrice?: number | null;
  /** Fim da promoção (ISO 8601). Só vem preenchido se a loja informar. */
  endsAt?: string | null;
  /** Dica de frete lida na página. Não é cálculo por CEP. */
  freightNote?: string | null;
  /** Frete calculado para o CEP (0 = grátis). null/undefined = desconhecido. */
  shippingPrice?: number | null;
  /** Id do item na loja (usado para consultar frete/prazo da promoção). */
  itemId?: string | null;
  /** Preço "a partir de": o anúncio tem variações e o preço é o da mais barata (AliExpress, Shopee). */
  priceFrom?: boolean;
}

export type StoreStatusKind = 'ok' | 'empty' | 'blocked' | 'robots' | 'unsupported' | 'error';

export interface StoreResult {
  status: StoreStatusKind;
  message: string;
  offers: RawOffer[];
}

export type FetchOutcome =
  | { kind: 'ok'; html: string; finalUrl: string; status?: number }
  | { kind: 'blocked' | 'robots' | 'error'; message: string };

export interface FetchInit {
  /** Resposta esperada; muda o header Accept. */
  accept?: 'html' | 'json';
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /**
   * Chamada a uma API oficial (não é página de loja): não consulta robots.txt,
   * não procura tela de captcha e devolve o corpo mesmo com status 4xx, para o adaptador ler o erro.
   */
  api?: boolean;
}

export interface AdapterEnv {
  fetchHtml(url: string, init?: FetchInit): Promise<FetchOutcome>;
  /** Variáveis de ambiente (chaves de API). */
  secrets?: Record<string, string | undefined>;
}

export interface SearchContext {
  cep?: string | null;
}

export interface StoreAdapter {
  id: StoreId;
  name: string;
  domains: string[];
  /** Como a loja é lida agora: API oficial, página HTML ou não suportada. */
  via?: 'api' | 'html' | 'unsupported';
  search(terms: string, env: AdapterEnv, ctx?: SearchContext): Promise<StoreResult>;
  /** Lê uma página de categoria/ofertas da loja (link colado pelo usuário). */
  listing?(url: string, env: AdapterEnv, ctx?: SearchContext): Promise<StoreResult>;
  /**
   * Completa uma oferta que já entrou na faixa: frete para o CEP e/ou fim da promoção.
   * Só é chamado para poucos itens, para não multiplicar requisições.
   */
  enrich?(offer: RawOffer, env: AdapterEnv, ctx: SearchContext): Promise<Partial<RawOffer>>;
}

export type WatchKind = 'produto' | 'categoria';

export interface Watch {
  id: number;
  chat_id: number;
  query: string;
  target_price: number;
  margin_pct: number;
  active: boolean;
  created_at: string;
  /** produto = todas as palavras, alerta individual; categoria = teto, alerta agrupado. */
  kind?: WatchKind;
  /** Link de categoria/ofertas de uma loja (só para kind = categoria). */
  category_url?: string | null;
  /** Lojas desta busca (ids). null = todas as ligadas. */
  stores?: string[] | null;
  last_checked_at?: string | null;
}

export interface NewWatch {
  query: string;
  target_price: number;
  margin_pct: number;
  kind: WatchKind;
  category_url: string | null;
  stores: string[] | null;
}

export interface StoredOffer {
  id: number;
  watch_id: number;
  store: StoreId;
  title: string;
  url: string;
  price: number;
  regular_price: number | null;
  ends_at: string | null;
  shipping_price?: number | null;
  lowest_price: number;
  first_seen_at: string;
  last_seen_at: string;
  last_alerted_price: number | null;
  last_alerted_at: string | null;
}

export interface NewOffer {
  watch_id: number;
  store: StoreId;
  title: string;
  url: string;
  price: number;
  regular_price: number | null;
  ends_at: string | null;
  shipping_price: number | null;
  lowest_price: number;
}

export type OfferPatch = Partial<
  Pick<
    StoredOffer,
    | 'title'
    | 'price'
    | 'regular_price'
    | 'ends_at'
    | 'shipping_price'
    | 'lowest_price'
    | 'last_seen_at'
    | 'last_alerted_price'
    | 'last_alerted_at'
  >
>;

export interface StoreStatusRow {
  store: StoreId;
  name?: string | null;
  status: StoreStatusKind;
  message: string;
  items_found: number;
  checked_at: string;
}

export type FreightMode = 'total' | 'produto';

export interface ChatSettings {
  cep: string | null;
  freight_mode: FreightMode;
}

/** Fonte de busca de um chat: liga/desliga uma loja embutida ou cadastra uma loja nova. */
export interface Source {
  id: number;
  chat_id: number;
  kind: 'builtin' | 'custom';
  /** Id da loja embutida (kind = builtin). */
  store_id: string | null;
  name: string;
  /** Modelo de URL de busca com {q} (kind = custom). */
  search_url: string | null;
  domains: string[];
  enabled: boolean;
}

export interface NewCustomSource {
  name: string;
  search_url: string;
  domains: string[];
}

/** O que os comandos do Telegram precisam do banco. */
export interface CommandDb {
  addWatch(chatId: number, w: NewWatch): Promise<Watch>;
  listWatches(chatId: number): Promise<Watch[]>;
  updateWatch(
    chatId: number,
    id: number,
    patch: Partial<Pick<Watch, 'target_price' | 'margin_pct' | 'active' | 'stores'>>,
  ): Promise<Watch | null>;
  deleteWatch(chatId: number, id: number): Promise<boolean>;
  getCep(chatId: number): Promise<string | null>;
  setCep(chatId: number, cep: string): Promise<void>;
  getSettings(chatId: number): Promise<ChatSettings>;
  setFreightMode(chatId: number, mode: FreightMode): Promise<void>;
  getStoreStatus(): Promise<StoreStatusRow[]>;
  listSources(chatId: number): Promise<Source[]>;
  setBuiltinEnabled(chatId: number, storeId: string, name: string, enabled: boolean): Promise<void>;
  addCustomSource(chatId: number, s: NewCustomSource): Promise<Source>;
  deleteSource(chatId: number, id: number): Promise<boolean>;
}

/** O que a rotina de checagem precisa do banco. */
export interface CheckerDb {
  listActiveWatches(chatId?: number): Promise<Watch[]>;
  getOffersByUrl(watchId: number, urls: string[]): Promise<StoredOffer[]>;
  insertOffer(row: NewOffer): Promise<StoredOffer>;
  updateOffer(id: number, patch: OfferPatch): Promise<void>;
  saveStoreStatus(rows: Omit<StoreStatusRow, 'checked_at'>[]): Promise<void>;
  getCep(chatId: number): Promise<string | null>;
  getSettings?(chatId: number): Promise<ChatSettings>;
  listSources?(chatId: number): Promise<Source[]>;
  markChecked?(watchIds: number[], at: string): Promise<void>;
  tryLock(name: string, ttlSeconds: number): Promise<boolean>;
  unlock(name: string): Promise<void>;
}
