import { accountChannelFromJson, addPublicChannel } from '../../../../lib/channels/admin.ts';
import { userbotConfigFromEnv } from '../../../../lib/channels/userbot.ts';
import { getRuntime } from '../../../../lib/runtime.ts';
import { json, requireSession } from '../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Canais cadastrados + se a conta do Telegram (userbot) está configurada. */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const channels = await getRuntime().db.listChannels(auth.session.user.chat_id);
  return json({ channels, accountConfigured: userbotConfigFromEnv() !== null });
}

/**
 * Cadastra um canal.
 *   { "username": "@canal" }                         → canal público (conferido na hora)
 *   { "tgId", "accessHash", "peerType", "title", ... } → canal/grupo da sua conta (userbot)
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const rt = getRuntime();
  const chatId = auth.session.user.chat_id;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (typeof body?.username === 'string' && body.tgId === undefined) {
    const r = await addPublicChannel(rt.db, chatId, body.username, rt.deps.env);
    return r.ok ? json({ ok: true, channel: r.channel }, 201) : json({ error: r.error }, 400);
  }

  if (!userbotConfigFromEnv()) return json({ error: 'a conta do Telegram não está conectada' }, 400);
  const parsed = accountChannelFromJson(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const v = parsed.value;
  const existing = (await rt.db.listChannels(chatId)).find((c) => c.tg_id === v.tgId);
  if (existing) return json({ error: `já cadastrado (#${existing.id})` }, 400);
  const channel = await rt.db.addChannel(chatId, {
    source: 'conta',
    username: v.username,
    tg_id: v.tgId,
    access_hash: v.accessHash,
    peer_type: v.peerType,
    title: v.title,
  });
  return json({ ok: true, channel }, 201);
}
