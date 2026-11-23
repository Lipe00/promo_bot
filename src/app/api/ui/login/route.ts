import { login, sameOrigin } from '../../../../lib/auth.ts';
import { getRuntime } from '../../../../lib/runtime.ts';
import { authConfig, isSecureRequest, json, setSessionCookie } from '../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Entra no painel. Corpo JSON: { username, password }. Senha errada nunca trava a conta. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: 'origem não permitida' }, 403);
  const body = (await req.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  try {
    const result = await login(username, password, getRuntime().db, authConfig());
    if (!result.ok) return json({ error: 'usuário ou senha inválidos' }, 401);
    const res = json({ ok: true, username: result.session.user.username, expiresAt: result.session.expiresAt });
    setSessionCookie(res, result.token, isSecureRequest(req));
    return res;
  } catch (e) {
    console.error('login falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return json({ error: 'erro ao entrar; tente de novo' }, 500);
  }
}
