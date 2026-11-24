import type { AdapterEnv, ChannelAdminDb, TgChannel } from '../types.ts';
import { makePreviewReader, normalizeChannelUsername } from './preview.ts';

/**
 * Cadastro de canais (painel e Telegram). Canal público é conferido na hora pela prévia pública,
 * e já fica marcado "lido até aqui" para não avisar o histórico antigo.
 */
export async function addPublicChannel(
  db: ChannelAdminDb,
  chatId: number,
  input: string,
  env: AdapterEnv,
): Promise<{ ok: true; channel: TgChannel } | { ok: false; error: string }> {
  const username = normalizeChannelUsername(input);
  if (!username) return { ok: false, error: 'Informe o @ do canal ou o link t.me/… (canais privados: use "Da minha conta").' };
  const existing = (await db.listChannels(chatId)).find((c) => c.username?.toLowerCase() === username.toLowerCase());
  if (existing) return { ok: false, error: `O canal @${username} já está cadastrado (#${existing.id}).` };

  const probe = await makePreviewReader(env, { maxPages: 1 }).read({
    id: 0,
    chat_id: chatId,
    source: 'publico',
    username,
    tg_id: null,
    access_hash: null,
    peer_type: null,
    title: '',
    enabled: true,
    last_message_id: null,
    last_checked_at: null,
    last_error: null,
  });
  if (probe.error) return { ok: false, error: `Não consegui ler @${username}: ${probe.error}` };

  const channel = await db.addChannel(chatId, {
    source: 'publico',
    username,
    tg_id: null,
    access_hash: null,
    peer_type: 'channel',
    title: probe.title || `@${username}`,
    last_message_id: probe.latestId,
  });
  return { ok: true, channel };
}

export interface AccountChannelInput {
  tgId: number;
  accessHash: string | null;
  peerType: 'channel' | 'chat';
  title: string;
  username: string | null;
}

export function accountChannelFromJson(body: unknown): { ok: true; value: AccountChannelInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const tgId = Number(b.tgId);
  if (!Number.isSafeInteger(tgId) || tgId <= 0) return { ok: false, error: 'canal inválido' };
  if (b.peerType !== 'channel' && b.peerType !== 'chat') return { ok: false, error: 'tipo inválido' };
  const accessHash = b.accessHash === null || b.accessHash === undefined ? null : String(b.accessHash);
  if (accessHash !== null && !/^-?\d{1,20}$/.test(accessHash)) return { ok: false, error: 'canal inválido' };
  if (b.peerType === 'channel' && accessHash === null) return { ok: false, error: 'canal sem access_hash' };
  const title = typeof b.title === 'string' ? b.title.slice(0, 120) : '';
  const username = typeof b.username === 'string' && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(b.username) ? b.username : null;
  return { ok: true, value: { tgId, accessHash, peerType: b.peerType, title, username } };
}
