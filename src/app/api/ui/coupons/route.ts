import { DEFAULT_COUPON_STORES } from '../../../../lib/channels/monitor.ts';
import { STORE_LABELS } from '../../../../lib/channels/parse.ts';
import { getRuntime } from '../../../../lib/runtime.ts';
import { json, requireSession } from '../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cupons vistos nos canais + lojas que avisam no Telegram. */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const { db } = getRuntime();
  const chatId = auth.session.user.chat_id;
  const [coupons, settings] = await Promise.all([db.listCoupons(chatId, 300), db.getSettings(chatId)]);
  return json({ coupons, couponStores: settings.coupon_stores ?? DEFAULT_COUPON_STORES });
}

/** Lojas cujos cupons novos são avisados: { "couponStores": ["amazon", "shopee"] } */
export async function PATCH(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if ('error' in auth) return auth.error;
  const body = (await req.json().catch(() => null)) as { couponStores?: unknown } | null;
  const list = body?.couponStores;
  if (!Array.isArray(list) || !list.every((s) => typeof s === 'string' && s in STORE_LABELS)) {
    return json({ error: 'lojas inválidas' }, 400);
  }
  await getRuntime().db.setCouponStores(auth.session.user.chat_id, [...new Set(list as string[])]);
  return json({ ok: true });
}
