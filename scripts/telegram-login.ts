/**
 * Conecta a SUA conta do Telegram ao bot (userbot, só leitura de canais) e grava a sessão no .env.deploy.local.
 * Você digita o número, o código que chega no Telegram e a senha de 2 etapas (se tiver). Nada disso é salvo,
 * só a sessão resultante (TELEGRAM_USER_SESSION).
 *
 * Rode no seu terminal (precisa de -it para digitar):
 *   docker run --rm -it -v "${PWD}:/app" -v promobot_nm:/app/node_modules -w /app --env-file .env.deploy.local \
 *     node:22-bookworm-slim node --experimental-strip-types --no-warnings scripts/telegram-login.ts
 *
 * Para desconectar depois: Telegram → Configurações → Dispositivos → encerrar "promo-bot".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { TelegramClient } from 'telegram';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';
import { StringSession } from 'telegram/sessions/index.js';

const ENV_FILE = '.env.deploy.local';
const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH ?? '';
if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) {
  console.error('Coloque TELEGRAM_API_ID e TELEGRAM_API_HASH no .env.deploy.local (my.telegram.org → API development tools).');
  process.exit(1);
}

const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });

/** Pergunta sem mostrar o que é digitado (senha de 2 etapas). */
async function askHidden(question: string): Promise<string> {
  const out = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WriteStream };
  const original = out._writeToOutput;
  stdout.write(question);
  out._writeToOutput = (s: string) => {
    if (s.includes('\n') || s.includes('\r')) stdout.write('\n');
  };
  try {
    return await rl.question('');
  } finally {
    out._writeToOutput = original;
  }
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 3,
  deviceModel: 'promo-bot',
  systemVersion: 'servidor',
  appVersion: '1.0',
  baseLogger: new Logger(LogLevel.ERROR),
});

await client.start({
  phoneNumber: async () => (await rl.question('Seu número do Telegram (ex.: +5518999999999): ')).trim(),
  phoneCode: async () => (await rl.question('Código que chegou no seu Telegram: ')).trim(),
  password: async () => askHidden('Senha de verificação em 2 etapas (se não tiver, só Enter): '),
  onError: (e) => {
    console.error('Erro:', e.message);
  },
});

const me = (await client.getMe()) as unknown as { firstName?: string; username?: string };
const session = String(client.session.save());
await client.disconnect();
rl.close();

let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
const line = `TELEGRAM_USER_SESSION=${session}`;
env = /^TELEGRAM_USER_SESSION=.*$/m.test(env) ? env.replace(/^TELEGRAM_USER_SESSION=.*$/m, line) : `${env.replace(/\n?$/, '\n')}${line}\n`;
writeFileSync(ENV_FILE, env);
console.log(`\n✅ Conectado como ${me.firstName ?? ''}${me.username ? ` (@${me.username})` : ''}. Sessão gravada em ${ENV_FILE}.`);
console.log('Agora me avise para eu cadastrar a sessão na Vercel. Não compartilhe esse valor com ninguém.');
process.exit(0);
