import { redirect } from 'next/navigation';
import { userbotConfigFromEnv } from '../../lib/channels/userbot.ts';
import { getRuntime } from '../../lib/runtime.ts';
import { sessionFromCookies } from '../../lib/web-auth.ts';
import { Channels } from '../_ui/Channels.tsx';

export const dynamic = 'force-dynamic';

export default async function CanaisPage() {
  const session = await sessionFromCookies().catch(() => null);
  if (!session) redirect('/login');
  const channels = await getRuntime().db.listChannels(session.user.chat_id);
  return <Channels username={session.user.username} initial={channels} accountConfigured={userbotConfigFromEnv() !== null} />;
}
