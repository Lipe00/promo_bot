import { buildCards, storeOptions } from '../../../../lib/dashboard.ts';
import { getRuntime } from '../../../../lib/runtime.ts';
import { STORE_ADAPTERS } from '../../../../lib/stores/index.ts';
import { buildNewWatch, draftFromJson } from '../../../../lib/watch-input.ts';
import { json, requireSession } from '../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cards do painel + lojas disponíveis para o formulário. */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const { db } = getRuntime();
  const chatId = auth.session.user.chat_id;
  const [cards, stores] = await Promise.all([buildCards(db, chatId), storeOptions(db, chatId)]);
  return json({ cards, stores });
}

/** Cadastra produto ou categoria. Mesmas regras do /add e /categoria do Telegram. */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const parsed = draftFromJson(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { db } = getRuntime();
  const chatId = auth.session.user.chat_id;
  const built = buildNewWatch(parsed.draft, { builtins: STORE_ADAPTERS, sources: await db.listSources(chatId) });
  if (!built.ok) return json({ error: built.error.replace(/<[^>]+>/g, '') }, 400);
  const watch = await db.addWatch(chatId, built.watch);
  return json({ ok: true, id: watch.id }, 201);
}
