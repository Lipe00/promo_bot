import type { RawPost, TgChannel } from '../types.ts';
import type { AccountDialog, ChannelRead, ChannelReader } from './reader.ts';

/**
 * Canais privados e grupos pela SUA conta do Telegram (MTProto oficial, biblioteca GramJS).
 * Só leitura: nunca envia mensagens. Precisa de TELEGRAM_API_ID, TELEGRAM_API_HASH (my.telegram.org)
 * e TELEGRAM_USER_SESSION (gerada pelo scripts/telegram-login.ts, com você digitando o código).
 *
 * A lógica de leitura usa a interface UserbotApi; o GramJS fica isolado em connectUserbot(),
 * assim os testes usam um cliente falso.
 */

export interface UserbotMessage {
  id: number;
  date: number; // segundos desde 1970
  text: string;
  links: string[];
}

export interface UserbotPeer {
  tgId: number;
  accessHash: string | null;
  peerType: 'channel' | 'chat';
}

export interface UserbotApi {
  dialogs(): Promise<AccountDialog[]>;
  /** Mensagens mais novas que minId (ou só a última, se minId = null), em qualquer ordem. */
  messages(peer: UserbotPeer, opts: { minId: number | null; limit: number }): Promise<UserbotMessage[]>;
  close(): Promise<void>;
}

export interface UserbotConfig {
  apiId: number;
  apiHash: string;
  session: string;
}

export function userbotConfigFromEnv(env: Record<string, string | undefined> = process.env): UserbotConfig | null {
  const apiId = Number(env.TELEGRAM_API_ID);
  const apiHash = env.TELEGRAM_API_HASH;
  const session = env.TELEGRAM_USER_SESSION;
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash || !session) return null;
  return { apiId, apiHash, session };
}

function postUrl(channel: Pick<TgChannel, 'username' | 'tg_id' | 'peer_type'>, id: number): string | null {
  if (channel.username) return `https://t.me/${channel.username}/${id}`;
  if (channel.peer_type === 'channel' && channel.tg_id) return `https://t.me/c/${channel.tg_id}/${id}`;
  return null;
}

function floodSeconds(e: unknown): number | null {
  const err = e as { seconds?: unknown; errorMessage?: unknown; className?: unknown } | null;
  if (err && typeof err.seconds === 'number' && /FLOOD/i.test(String(err.errorMessage ?? err.className ?? ''))) return err.seconds;
  return null;
}

export const MAX_MESSAGES_PER_READ = 50;

/** Leitor de canais pela conta. `api` é aberto uma vez por rodada e fechado no fim. */
export function makeUserbotReader(api: UserbotApi): ChannelReader {
  return {
    async read(channel: TgChannel): Promise<ChannelRead> {
      if (!channel.tg_id || !channel.peer_type) {
        return { error: 'canal sem id do Telegram; adicione de novo pela lista da sua conta', posts: [], latestId: null };
      }
      const peer: UserbotPeer = { tgId: channel.tg_id, accessHash: channel.access_hash, peerType: channel.peer_type };
      try {
        const msgs = await api.messages(peer, {
          minId: channel.last_message_id,
          limit: channel.last_message_id === null ? 1 : MAX_MESSAGES_PER_READ,
        });
        const sorted = [...msgs].sort((a, b) => a.id - b.id);
        const latestId = sorted.at(-1)?.id ?? channel.last_message_id;
        if (channel.last_message_id === null) return { posts: [], latestId };
        const lastId = channel.last_message_id;
        const posts: RawPost[] = sorted
          .filter((m) => m.id > lastId)
          .map((m) => ({
            messageId: m.id,
            postedAt: new Date(m.date * 1000).toISOString(),
            text: m.text,
            links: m.links,
            postUrl: postUrl(channel, m.id),
          }));
        return { posts, latestId };
      } catch (e) {
        const wait = floodSeconds(e);
        if (wait !== null) return { error: `o Telegram pediu para esperar ${wait}s (FLOOD_WAIT); tento na próxima rodada`, posts: [], latestId: null };
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `falha ao ler pela conta: ${msg.slice(0, 160)}`, posts: [], latestId: null };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// GramJS (só carregado quando o userbot está configurado)
// ---------------------------------------------------------------------------

type AnyObj = Record<string, unknown> & { className?: string };

/** Links de uma mensagem do Telegram: entidades de URL, botões com link e prévia de página. */
export function linksFromTgMessage(m: AnyObj): string[] {
  const text = typeof m.message === 'string' ? m.message : '';
  const out = new Set<string>();
  for (const e of (Array.isArray(m.entities) ? m.entities : []) as AnyObj[]) {
    if (e.className === 'MessageEntityTextUrl' && typeof e.url === 'string') out.add(e.url);
    if (e.className === 'MessageEntityUrl' && typeof e.offset === 'number' && typeof e.length === 'number') {
      const raw = text.substr(e.offset, e.length);
      out.add(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    }
  }
  const markup = m.replyMarkup as AnyObj | undefined;
  for (const row of (Array.isArray(markup?.rows) ? markup.rows : []) as AnyObj[]) {
    for (const b of (Array.isArray(row.buttons) ? row.buttons : []) as AnyObj[]) {
      if (typeof b.url === 'string') out.add(b.url);
    }
  }
  const media = m.media as AnyObj | undefined;
  const page = media?.webpage as AnyObj | undefined;
  if (typeof page?.url === 'string') out.add(page.url);
  return [...out];
}

export async function connectUserbot(cfg: UserbotConfig): Promise<UserbotApi> {
  const { TelegramClient, Api } = await import('telegram');
  const { StringSession } = await import('telegram/sessions/index.js');
  const { Logger, LogLevel } = await import('telegram/extensions/Logger.js');
  const { returnBigInt } = await import('telegram/Helpers.js');

  const client = new TelegramClient(new StringSession(cfg.session), cfg.apiId, cfg.apiHash, {
    connectionRetries: 2,
    baseLogger: new Logger(LogLevel.ERROR),
  });
  await client.connect();
  if (!(await client.checkAuthorization())) {
    await client.disconnect().catch(() => {});
    throw new Error('sessão do Telegram inválida ou encerrada; rode o login de novo');
  }

  const inputPeer = (p: UserbotPeer) =>
    p.peerType === 'channel'
      ? new Api.InputPeerChannel({ channelId: returnBigInt(p.tgId), accessHash: returnBigInt(p.accessHash ?? '0') })
      : new Api.InputPeerChat({ chatId: returnBigInt(p.tgId) });

  return {
    async dialogs() {
      const list = await client.getDialogs({ limit: 300 });
      const out: AccountDialog[] = [];
      for (const d of list) {
        const ent = d.entity as unknown as AnyObj | undefined;
        if (!ent) continue;
        if (ent.className === 'Channel') {
          out.push({
            tgId: Number(String(ent.id)),
            accessHash: ent.accessHash !== undefined && ent.accessHash !== null ? String(ent.accessHash) : null,
            peerType: 'channel',
            title: String(ent.title ?? d.title ?? ''),
            username: typeof ent.username === 'string' ? ent.username : null,
            kind: ent.broadcast ? 'canal' : 'grupo',
          });
        } else if (ent.className === 'Chat') {
          out.push({ tgId: Number(String(ent.id)), accessHash: null, peerType: 'chat', title: String(ent.title ?? ''), username: null, kind: 'grupo' });
        }
      }
      return out;
    },
    async messages(peer, opts) {
      const msgs = await client.getMessages(inputPeer(peer), {
        limit: opts.limit,
        ...(opts.minId !== null ? { minId: opts.minId } : {}),
      });
      return msgs
        .filter((m) => (m as unknown as AnyObj).className === 'Message')
        .map((m) => {
          const raw = m as unknown as AnyObj;
          return {
            id: Number(raw.id),
            date: Number(raw.date),
            text: typeof raw.message === 'string' ? raw.message : '',
            links: linksFromTgMessage(raw),
          };
        });
    },
    async close() {
      try {
        await client.destroy();
      } catch {
        await client.disconnect().catch(() => {});
      }
    },
  };
}
