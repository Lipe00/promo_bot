import { after } from 'next/server';
import { runLocked } from '../../../../lib/runtime.ts';
import { json, requireSession } from '../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** "Checar agora": responde na hora e roda a checagem das buscas da conta em seguida. */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const chatId = auth.session.user.chat_id;
  after(async () => {
    try {
      await runLocked(chatId);
    } catch (e) {
      console.error('checagem pelo painel falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    }
  });
  return json({ ok: true, started: true }, 202);
}
