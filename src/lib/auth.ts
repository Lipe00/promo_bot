import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { AuthDb, User } from './types.ts';

/**
 * Login do painel web.
 *
 * Senha: scrypt (N=2^15, r=8, p=1, 64 bytes). O salt é PASSWORD_SALT (env) + ":" + usuário,
 * então duas contas com a mesma senha têm hashes diferentes, e sem o PASSWORD_SALT
 * um vazamento da tabela `users` não serve para testar senhas.
 *
 * Sessão: uma linha na tabela `sessions` por aparelho, com id aleatório de 256 bits.
 * O cookie leva esse id e a validade, assinados com HMAC-SHA256 (SESSION_SECRET).
 * A validação confere a assinatura, a validade e, no banco, se a sessão ainda existe e se a conta
 * existe. "Sair" apaga a sessão (o cookie antigo deixa de valer mesmo se alguém o copiou);
 * trocar a senha apaga todas as sessões da conta.
 *
 * Não há bloqueio de conta: senha errada só demora ~1s para responder.
 */

export const SESSION_COOKIE = 'pb_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

function derive(password: string, salt: string, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function saltFor(username: string, pepper: string): string {
  if (!pepper || pepper.length < 32) throw new Error('PASSWORD_SALT ausente ou curto demais');
  return `${pepper}:${normalizeUsername(username)}`;
}

export async function hashPassword(password: string, username: string, pepper: string): Promise<string> {
  const key = await derive(password, saltFor(username, pepper));
  return `scrypt$${N}$${R}$${P}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, username: string, stored: string, pepper: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, hex] = parts;
  const expected = Buffer.from(hex ?? '', 'hex');
  if (expected.length !== KEYLEN) return false;
  const key = await derive(password, saltFor(username, pepper), Number(n), Number(r), Number(p));
  return timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

export interface SessionPayload {
  /** id da sessão (linha em `sessions`) */
  sid: string;
  /** validade (segundos desde 1970) */
  exp: number;
}

function sign(data: string, secret: string): string {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET ausente ou curto demais');
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Confere assinatura e validade do cookie. Não olha o banco. */
export function readSession(token: string | undefined | null, secret: string, nowMs = Date.now()): SessionPayload | null {
  if (!token || token.length > 1000) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof p.sid !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(p.sid) || typeof p.exp !== 'number') return null;
    if (p.exp * 1000 <= nowMs) return null;
    return { sid: p.sid, exp: p.exp };
  } catch {
    return null;
  }
}

export interface AuthConfig {
  pepper: string;
  secret: string;
}

export interface ValidSession {
  sessionId: string;
  user: Pick<User, 'id' | 'username' | 'chat_id'>;
  expiresAt: string;
}

/** Sessão completa: assinatura + validade + sessão existe no banco + conta existe. */
export async function validateSession(
  token: string | undefined | null,
  db: Pick<AuthDb, 'getUserById' | 'getSessionRow'>,
  cfg: Pick<AuthConfig, 'secret'>,
  nowMs = Date.now(),
): Promise<ValidSession | null> {
  const payload = readSession(token, cfg.secret, nowMs);
  if (!payload) return null;
  const row = await db.getSessionRow(payload.sid);
  if (!row || Date.parse(row.expires_at) <= nowMs) return null;
  const user = await db.getUserById(row.user_id);
  if (!user) return null;
  return {
    sessionId: row.id,
    user: { id: user.id, username: user.username, chat_id: Number(user.chat_id) },
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

/** Encerra a sessão deste cookie (no banco). Cookie inválido: nada a fazer. */
export async function logout(token: string | undefined | null, db: Pick<AuthDb, 'deleteSession'>, cfg: Pick<AuthConfig, 'secret'>): Promise<void> {
  const payload = readSession(token, cfg.secret);
  if (payload) await db.deleteSession(payload.sid);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LoginResult = { ok: true; token: string; session: ValidSession } | { ok: false };

export async function login(
  username: string,
  password: string,
  db: Pick<AuthDb, 'getUserByUsername' | 'touchLogin' | 'createSession'>,
  cfg: AuthConfig,
  opts: { nowMs?: number; failDelayMs?: number } = {},
): Promise<LoginResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const failDelay = opts.failDelayMs ?? 1000;
  const name = normalizeUsername(username);
  const fail = async (): Promise<LoginResult> => {
    await sleep(failDelay);
    return { ok: false };
  };
  if (!name || !password || name.length > 64 || password.length > 256) return fail();

  const user = await db.getUserByUsername(name);
  if (!user) {
    // Mesmo custo de uma senha errada, para não revelar quais usuários existem.
    await hashPassword(password, name, cfg.pepper);
    return fail();
  }
  if (!(await verifyPassword(password, name, user.password_hash, cfg.pepper))) return fail();

  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const sid = randomBytes(32).toString('base64url');
  await db.createSession({ id: sid, user_id: user.id, expires_at: new Date(exp * 1000).toISOString() });
  await db.touchLogin(user.id, new Date(nowMs).toISOString());
  return {
    ok: true,
    token: signSession({ sid, exp }, cfg.secret),
    session: {
      sessionId: sid,
      user: { id: user.id, username: user.username, chat_id: Number(user.chat_id) },
      expiresAt: new Date(exp * 1000).toISOString(),
    },
  };
}

/** Lê o valor de um cookie do header Cookie. */
export function cookieFrom(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Proteção contra CSRF: se o navegador mandou Origin, ele precisa ser o próprio app.
 * (Clientes sem Origin, como curl, não carregam o cookie de outra pessoa.)
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
