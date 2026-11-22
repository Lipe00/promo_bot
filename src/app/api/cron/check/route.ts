import { after, NextResponse } from 'next/server';
import { runLocked } from '../../../../lib/runtime.ts';
import { safeEqual } from '../../../../lib/security.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Chamado pelo pg_cron do Supabase (ver supabase/cron.sql).
 * Responde 202 na hora e faz o trabalho depois, para a chamada HTTP não ficar pendurada.
 * Para depurar: GET /api/cron/check?sync=1 com o header Authorization: Bearer <CRON_SECRET>.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (new URL(req.url).searchParams.get('sync') === '1') {
    try {
      return NextResponse.json(await runLocked());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
    }
  }

  after(async () => {
    try {
      await runLocked();
    } catch (e) {
      console.error('checagem agendada falhou:', e instanceof Error ? e.message : 'erro');
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
