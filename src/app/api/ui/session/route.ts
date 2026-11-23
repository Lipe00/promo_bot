import { json, sessionFromRequest } from '../../../../lib/web-auth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diz se o login atual é válido: assinatura do cookie, validade, conta existente e sessão não revogada.
 * 200 { authenticated: true, username, expiresAt } · 401 { authenticated: false }
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const s = await sessionFromRequest(req);
    if (!s) return json({ authenticated: false }, 401);
    return json({ authenticated: true, username: s.user.username, expiresAt: s.expiresAt });
  } catch (e) {
    console.error('sessão falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return json({ authenticated: false, error: 'erro ao validar a sessão' }, 500);
  }
}
