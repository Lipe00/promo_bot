import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cookieFrom,
  hashPassword,
  login,
  logout,
  readSession,
  sameOrigin,
  signSession,
  validateSession,
  verifyPassword,
} from '../src/lib/auth.ts';
import { memoryDb } from './helpers.ts';

const PEPPER = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const cfg = { pepper: PEPPER, secret: SECRET };
const SID = 'x'.repeat(43);

async function withUser() {
  const mem = memoryDb();
  const user = await mem.db.upsertUser('felipe', await hashPassword('Senha-forte-1', 'felipe', PEPPER), 42);
  return { ...mem, user };
}

test('hash scrypt: confere a senha certa, recusa a errada; salt do .env + usuário', async () => {
  const h = await hashPassword('Senha-forte-1', 'felipe', PEPPER);
  assert.match(h, /^scrypt\$32768\$8\$1\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('Senha-forte-1', 'felipe', h, PEPPER), true);
  assert.equal(await verifyPassword('senha-forte-1', 'felipe', h, PEPPER), false);
  // Mesmo usuário e senha com outro PASSWORD_SALT não confere.
  assert.equal(await verifyPassword('Senha-forte-1', 'felipe', h, 'c'.repeat(64)), false);
  // Mesma senha em outra conta gera outro hash.
  assert.notEqual(await hashPassword('Senha-forte-1', 'outra', PEPPER), h);
  // Usuário com maiúsculas é o mesmo.
  assert.equal(await verifyPassword('Senha-forte-1', 'FELIPE', h, PEPPER), true);
  await assert.rejects(() => hashPassword('x', 'felipe', 'curto'), /PASSWORD_SALT/);
  assert.equal(await verifyPassword('x', 'felipe', 'lixo', PEPPER), false);
});

test('cookie de sessão: assinatura, validade e adulteração', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const token = signSession({ sid: SID, exp: now / 1000 + 60 }, SECRET);
  assert.deepEqual(readSession(token, SECRET, now), { sid: SID, exp: now / 1000 + 60 });
  assert.equal(readSession(token, SECRET, now + 61_000), null); // vencido
  assert.equal(readSession(token, 'd'.repeat(64), now), null); // outro segredo
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sid: 'y'.repeat(43), exp: now / 1000 + 60 })).toString('base64url');
  assert.equal(readSession(`${forged}.${sig}`, SECRET, now), null); // trocou a sessão
  assert.equal(readSession(`${body}.x${sig}`, SECRET, now), null);
  assert.equal(readSession(`${body}.${sig}.extra`, SECRET, now), null);
  assert.equal(readSession('', SECRET, now), null);
});

test('login cria uma sessão no banco; validação confere sessão e conta', async () => {
  const { db, state, user } = await withUser();
  assert.equal((await login('felipe', 'errada', db, cfg, { failDelayMs: 0 })).ok, false);
  assert.equal((await login('ninguem', 'Senha-forte-1', db, cfg, { failDelayMs: 0 })).ok, false);
  assert.equal(state.sessions.length, 0);

  const ok = await login(' Felipe ', 'Senha-forte-1', db, cfg, { failDelayMs: 0 });
  assert.ok(ok.ok);
  assert.equal(ok.session.user.chat_id, 42);
  assert.equal(state.sessions.length, 1);
  assert.match(state.sessions[0]!.id, /^[A-Za-z0-9_-]{43}$/);
  assert.ok((await db.getUserById(user.id))?.last_login_at);

  const valid = await validateSession(ok.token, db, cfg);
  assert.equal(valid?.user.username, 'felipe');
});

test('sair encerra só aquela sessão; o cookie antigo deixa de valer', async () => {
  const { db } = await withUser();
  const celular = await login('felipe', 'Senha-forte-1', db, cfg, { failDelayMs: 0 });
  const pc = await login('felipe', 'Senha-forte-1', db, cfg, { failDelayMs: 0 });
  assert.ok(celular.ok && pc.ok);
  await logout(celular.token, db, cfg);
  assert.equal(await validateSession(celular.token, db, cfg), null); // mesmo copiado, não vale mais
  assert.ok(await validateSession(pc.token, db, cfg)); // o outro aparelho continua
});

test('trocar a senha (script) encerra todas as sessões; sessão vencida no banco não vale', async () => {
  const { db, state, user } = await withUser();
  const a = await login('felipe', 'Senha-forte-1', db, cfg, { failDelayMs: 0 });
  assert.ok(a.ok);
  await db.deleteUserSessions(user.id);
  assert.equal(await validateSession(a.token, db, cfg), null);

  const b = await login('felipe', 'Senha-forte-1', db, cfg, { failDelayMs: 0 });
  assert.ok(b.ok);
  state.sessions[0]!.expires_at = '2000-01-01T00:00:00Z';
  assert.equal(await validateSession(b.token, db, cfg), null);
});

test('senha errada várias vezes nunca trava a conta', async () => {
  const { db } = await withUser();
  for (let i = 0; i < 8; i++) assert.equal((await login('felipe', `errada${i}`, db, cfg, { failDelayMs: 0 })).ok, false);
  assert.equal((await login('felipe', 'Senha-forte-1', db, cfg, { failDelayMs: 0 })).ok, true);
});

test('senha errada demora para responder (atrasa robôs)', async () => {
  const { db } = await withUser();
  const t0 = Date.now();
  await login('felipe', 'errada', db, cfg, { failDelayMs: 300 });
  assert.ok(Date.now() - t0 >= 300);
});

test('cookieFrom e sameOrigin (CSRF)', () => {
  assert.equal(cookieFrom('a=1; pb_session=abc.def; b=2', 'pb_session'), 'abc.def');
  assert.equal(cookieFrom('a=1', 'pb_session'), null);
  const req = (origin: string | null, host = 'promo.vercel.app') =>
    new Request('https://promo.vercel.app/api/ui/watches', {
      method: 'POST',
      headers: { host, ...(origin ? { origin } : {}) },
    });
  assert.equal(sameOrigin(req('https://promo.vercel.app')), true);
  assert.equal(sameOrigin(req(null)), true);
  assert.equal(sameOrigin(req('https://evil.example')), false);
  assert.equal(sameOrigin(req('lixo')), false);
});
