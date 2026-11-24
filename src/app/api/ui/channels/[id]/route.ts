import { getRuntime } from '../../../../../lib/runtime.ts';
import { json, requireSession } from '../../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function idOf(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  return /^\d{1,9}$/.test(id) ? Number(id) : null;
}

/** Pausa ou retoma: { "enabled": false } */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const id = await idOf(ctx);
  if (id === null) return json({ error: 'id inválido' }, 400);
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') return json({ error: 'informe enabled true/false' }, 400);
  const ch = await getRuntime().db.setChannelEnabled(auth.session.user.chat_id, id, body.enabled);
  return ch ? json({ ok: true, channel: ch }) : json({ error: 'não encontrado' }, 404);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const id = await idOf(ctx);
  if (id === null) return json({ error: 'id inválido' }, 400);
  const ok = await getRuntime().db.deleteChannel(auth.session.user.chat_id, id);
  return ok ? json({ ok: true }) : json({ error: 'não encontrado' }, 404);
}
