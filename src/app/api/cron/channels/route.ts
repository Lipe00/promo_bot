import { after, NextResponse } from 'next/server';
import { runChannelsLocked } from '../../../../lib/runtime.ts';
import { safeEqual } from '../../../../lib/security.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Lê os canais do Telegram (chamado pelo pg_cron a cada 10 min; ver supabase/cron.sql).
 * Responde 202 na hora e trabalha depois. Para depurar: ?sync=1 com Authorization: Bearer <CRON_SECRET>.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (new URL(req.url).searchParams.get('sync') === '1') {
    try {
      return NextResponse.json(await runChannelsLocked());
    } catch (e) {
      console.error('canais falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
      return NextResponse.json({ error: 'falha ao ler os canais; veja os logs' }, { status: 500 });
    }
  }
  after(async () => {
    try {
      await runChannelsLocked();
    } catch (e) {
      console.error('leitura agendada de canais falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
