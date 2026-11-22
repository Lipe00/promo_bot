import { NextResponse } from 'next/server';
import { requireEnv } from '../../../../lib/runtime.ts';
import { safeEqual } from '../../../../lib/security.ts';
import { telegramCall } from '../../../../lib/telegram.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMANDS = [
  { command: 'add', description: 'Monitorar: /add termo | preço | margem%' },
  { command: 'categoria', description: 'Categoria: /categoria termo ou link | teto' },
  { command: 'lista', description: 'Ver suas buscas' },
  { command: 'lojas', description: 'Lojas: listar, /lojas on|off nome' },
  { command: 'fonte', description: 'Loja nova: /fonte add Nome | url com {q}' },
  { command: 'frete', description: 'Comparar com ou sem frete' },
  { command: 'checar', description: 'Rodar a checagem agora' },
  { command: 'testar', description: 'Ver o que cada loja devolve' },
  { command: 'status', description: 'Saúde de cada loja' },
  { command: 'cep', description: 'Guardar seu CEP' },
  { command: 'ajuda', description: 'Ver todos os comandos' },
];

/**
 * Abra uma vez depois do deploy: https://SEU-APP.vercel.app/api/telegram/setup?key=SEU_CRON_SECRET
 * Registra o webhook do Telegram e o menu de comandos.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });

  const url = new URL(req.url);
  if (!safeEqual(url.searchParams.get('key') ?? '', secret)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const token = requireEnv('TELEGRAM_BOT_TOKEN');
    const webhookSecret = requireEnv('TELEGRAM_WEBHOOK_SECRET');
    const webhookUrl = `${url.origin}/api/telegram`;
    await telegramCall(token, 'setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    await telegramCall(token, 'setMyCommands', { commands: COMMANDS });
    return NextResponse.json({ ok: true, webhook: webhookUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  }
}
