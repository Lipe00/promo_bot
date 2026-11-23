import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, cookieFrom, sameOrigin, validateSession } from './auth.ts';
import type { AuthConfig, ValidSession } from './auth.ts';
import { getRuntime, requireEnv } from './runtime.ts';

/** Segredos do login, lidos das variáveis de ambiente. */
export function authConfig(): AuthConfig {
  return { pepper: requireEnv('PASSWORD_SALT'), secret: requireEnv('SESSION_SECRET') };
}

/** Sessão válida da requisição (rotas da API), ou null. */
export async function sessionFromRequest(req: Request): Promise<ValidSession | null> {
  const token = cookieFrom(req.headers.get('cookie'), SESSION_COOKIE);
  if (!token) return null;
  return validateSession(token, getRuntime().db, authConfig());
}

/** Sessão válida da página (Server Components), ou null. */
export async function sessionFromCookies(): Promise<ValidSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token, getRuntime().db, authConfig());
}

export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production';
}

export function setSessionCookie(res: NextResponse, token: string, secure: boolean): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse, secure: boolean): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Exige sessão válida e, para métodos que mudam dados, Origin do próprio app.
 * Devolve a sessão ou a resposta de erro pronta.
 */
export async function requireSession(req: Request): Promise<{ session: ValidSession } | { error: NextResponse }> {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    return { error: json({ error: 'origem não permitida' }, 403) };
  }
  try {
    const session = await sessionFromRequest(req);
    if (!session) return { error: json({ error: 'não autenticado' }, 401) };
    return { session };
  } catch (e) {
    console.error('sessão falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return { error: json({ error: 'erro ao validar a sessão' }, 500) };
  }
}
