import { redirect } from 'next/navigation';
import { buildCards, storeOptions } from '../lib/dashboard.ts';
import { getRuntime } from '../lib/runtime.ts';
import { sessionFromCookies } from '../lib/web-auth.ts';
import { Dashboard } from './_ui/Dashboard.tsx';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await sessionFromCookies().catch(() => null);
  if (!session) redirect('/login');
  const { db } = getRuntime();
  const chatId = session.user.chat_id;
  const [cards, stores] = await Promise.all([buildCards(db, chatId), storeOptions(db, chatId)]);
  return <Dashboard username={session.user.username} initialCards={cards} stores={stores} />;
}
