import { redirect } from 'next/navigation';
import { sessionFromCookies } from '../../lib/web-auth.ts';
import { LoginForm } from '../_ui/LoginForm.tsx';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await sessionFromCookies().catch(() => null)) redirect('/');
  return <LoginForm />;
}
