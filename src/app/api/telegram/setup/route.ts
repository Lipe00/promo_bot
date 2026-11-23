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
 * Chame uma vez depois do deploy, com o segredo no header (nunca na URL: URLs ficam em logs e histórico):
 *   curl -X POST -H "Authorization: Bearer SEU_CRON_SECRET" https://SEU-APP.vercel.app/api/telegram/setup
 * Registra o webhook do Telegram e o menu de comandos.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });

  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: 'forbidden', hint: 'envie o segredo no header Authorization: Bearer <CRON_SECRET>' },
      { status: 403 },
    );
  }

  try {
    const token = requireEnv('TELEGRAM_BOT_TOKEN');
    const webhookSecret = requireEnv('TELEGRAM_WEBHOOK_SECRET');
    const webhookUrl = `${new URL(req.url).origin}/api/telegram`;
    await telegramCall(token, 'setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    await telegramCall(token, 'setMyCommands', { commands: COMMANDS });
    return NextResponse.json({ ok: true, webhook: webhookUrl });
  } catch (e) {
    // Sem detalhes: a mensagem do Telegram pode repetir dados da chamada.
    console.error('setup falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return NextResponse.json({ ok: false, error: 'falha ao registrar o webhook; veja os logs' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
