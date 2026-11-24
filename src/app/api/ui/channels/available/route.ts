import { getRuntime, openUserbot } from '../../../../../lib/runtime.ts';
import { json, requireSession } from '../../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Canais e grupos em que a sua conta do Telegram está (para escolher quais monitorar). */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const { api, error } = await openUserbot();
  if (!api) return json({ error }, 400);
  try {
    const [dialogs, mine] = await Promise.all([api.dialogs(), getRuntime().db.listChannels(auth.session.user.chat_id)]);
    const taken = new Set(mine.map((c) => c.tg_id));
    return json({ dialogs: dialogs.map((d) => ({ ...d, added: taken.has(d.tgId) })) });
  } catch (e) {
    console.error('lista de canais da conta falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return json({ error: 'não consegui listar os canais da conta' }, 500);
  } finally {
    await api.close().catch(() => {});
  }
}
