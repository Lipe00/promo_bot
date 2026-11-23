import { buildDetail } from '../../../../../lib/dashboard.ts';
import { getRuntime } from '../../../../../lib/runtime.ts';
import { STORE_ADAPTERS } from '../../../../../lib/stores/index.ts';
import { patchFromJson } from '../../../../../lib/watch-input.ts';
import { json, requireSession } from '../../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function idOf(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  return /^\d{1,9}$/.test(id) ? Number(id) : null;
}

/** Detalhe: ofertas atuais e histórico de preços. */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const id = await idOf(ctx);
  if (id === null) return json({ error: 'id inválido' }, 400);
  const detail = await buildDetail(getRuntime().db, auth.session.user.chat_id, id);
  return detail ? json(detail) : json({ error: 'não encontrado' }, 404);
}

/** Edita alvo, margem, lojas, "apenas promoções" ou pausa/ativa. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const id = await idOf(ctx);
  if (id === null) return json({ error: 'id inválido' }, 400);
  const { db } = getRuntime();
  const chatId = auth.session.user.chat_id;
  const parsed = patchFromJson(await req.json().catch(() => null), {
    builtins: STORE_ADAPTERS,
    sources: await db.listSources(chatId),
  });
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const updated = await db.updateWatch(chatId, id, parsed.patch);
  return updated ? json({ ok: true }) : json({ error: 'não encontrado' }, 404);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const id = await idOf(ctx);
  if (id === null) return json({ error: 'id inválido' }, 400);
  const ok = await getRuntime().db.deleteWatch(auth.session.user.chat_id, id);
  return ok ? json({ ok: true }) : json({ error: 'não encontrado' }, 404);
}
