import { after, NextResponse } from 'next/server';
import { getRuntime, runLocked } from '../../../lib/runtime.ts';
import { safeEqual } from '../../../lib/security.ts';
import { STORE_ADAPTERS } from '../../../lib/stores/index.ts';
import { sendTelegram } from '../../../lib/telegram.ts';
import { handleUpdate } from '../../../lib/webhook.ts';
import type { TelegramUpdate } from '../../../lib/webhook.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Webhook do Telegram. Sempre responde 200 depois de validar o segredo, para o Telegram não reenviar. */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('TELEGRAM_WEBHOOK_SECRET não configurado', { status: 500 });
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN não configurado');
    return NextResponse.json({ ok: true });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  await handleUpdate(update, {
    allowedChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID,
    send: (chatId, html) => sendTelegram(token, chatId, html),
    getDb: () => getRuntime().db,
    builtins: STORE_ADAPTERS,
    get env() {
      return getRuntime().deps.env;
    },
    adaptersFor: (chatId) => getRuntime().adaptersFor(chatId),
    runCheck: (chatId) => runLocked(chatId),
    defer: (task) => after(task),
  });
  return NextResponse.json({ ok: true });
}
