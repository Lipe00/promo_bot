import { redirect } from 'next/navigation';
import { DEFAULT_COUPON_STORES } from '../../lib/channels/monitor.ts';
import { getRuntime } from '../../lib/runtime.ts';
import { sessionFromCookies } from '../../lib/web-auth.ts';
import { Coupons } from '../_ui/Coupons.tsx';

export const dynamic = 'force-dynamic';

export default async function CuponsPage() {
  const session = await sessionFromCookies().catch(() => null);
  if (!session) redirect('/login');
  const { db } = getRuntime();
  const chatId = session.user.chat_id;
  const [coupons, settings] = await Promise.all([db.listCoupons(chatId, 300), db.getSettings(chatId)]);
  return <Coupons username={session.user.username} initial={coupons} couponStores={settings.coupon_stores ?? DEFAULT_COUPON_STORES} />;
}
