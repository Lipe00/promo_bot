/**
 * Cria (ou atualiza a senha de) uma conta do painel web.
 * A senha vem de uma variável de ambiente só na hora de rodar; ela não é gravada em arquivo nenhum.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PASSWORD_SALT=... \
 *   NEW_USER_NAME=felipe NEW_USER_PASSWORD='...' NEW_USER_CHAT_ID=123 \
 *   node --experimental-strip-types scripts/create-user.ts
 *
 * Rodar de novo para uma conta existente troca a senha e encerra as sessões abertas dela.
 */
import { hashPassword, normalizeUsername, verifyPassword } from '../src/lib/auth.ts';
import { createDb } from '../src/lib/db.ts';

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta a variável ${name}`);
    process.exit(1);
  }
  return v;
}

const url = need('SUPABASE_URL').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const db = createDb(url, need('SUPABASE_SERVICE_ROLE_KEY'));
const pepper = need('PASSWORD_SALT');
const username = normalizeUsername(need('NEW_USER_NAME'));
const password = need('NEW_USER_PASSWORD');
const chatId = Number(process.env.NEW_USER_CHAT_ID ?? process.env.TELEGRAM_ALLOWED_CHAT_ID);

if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error('Usuário inválido: use 3 a 32 caracteres a-z, 0-9, ponto, _ ou -');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Senha muito curta (mínimo 8 caracteres)');
  process.exit(1);
}
if (!Number.isSafeInteger(chatId)) {
  console.error('Informe NEW_USER_CHAT_ID (ou TELEGRAM_ALLOWED_CHAT_ID): o chat do Telegram dono das buscas');
  process.exit(1);
}

const hash = await hashPassword(password, username, pepper);
const before = await db.getUserByUsername(username);
const user = await db.upsertUser(username, hash, chatId);
// Senha nova: encerra as sessões abertas da conta em todos os aparelhos.
await db.deleteUserSessions(user.id);
const ok = await verifyPassword(password, username, user.password_hash, pepper);
console.log(
  `${before ? "Conta atualizada" : "Conta criada"}: ${user.username} (id ${user.id}, chat ${user.chat_id}; sessões anteriores encerradas). ` +
    `Conferência da senha: ${ok ? 'ok' : 'FALHOU'}`,
);
if (!ok) process.exit(1);
