import { SESSION_COOKIE, cookieFrom, logout, sameOrigin } from '../../../../lib/auth.ts';
import { getRuntime } from '../../../../lib/runtime.ts';
import { authConfig, clearSessionCookie, isSecureRequest, json } from '../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sai deste aparelho: apaga a sessão no banco (o cookie antigo deixa de valer) e limpa o cookie. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: 'origem não permitida' }, 403);
  try {
    await logout(cookieFrom(req.headers.get('cookie'), SESSION_COOKIE), getRuntime().db, authConfig());
  } catch (e) {
    console.error('logout falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
  }
  const res = json({ ok: true });
  clearSessionCookie(res, isSecureRequest(req));
  return res;
}
