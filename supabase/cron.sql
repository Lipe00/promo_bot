-- Agendamento da checagem. Rode DEPOIS do deploy na Vercel.
-- Por que aqui e não no Vercel Cron: no plano Hobby o cron da Vercel roda no máximo 1x por dia.
-- O pg_cron do Supabase aceita qualquer intervalo e só precisa chamar a URL do app.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Troque SEU-APP e SEU_CRON_SECRET (mesmo valor da variável CRON_SECRET na Vercel).
-- '0 */3 * * *' = a cada 3 horas, no minuto 0 (horário UTC). Não precisa ser mais frequente que 1h:
-- o bot lê páginas de lojas de verdade, e quanto mais você insiste, maior a chance de bloqueio.
select cron.schedule(
  'promo-bot-check',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://SEU-APP.vercel.app/api/cron/check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer SEU_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Ver as últimas execuções:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- Ver respostas HTTP (guardadas por 6 horas):
--   select id, status_code, content, created from net._http_response order by created desc limit 10;
-- Mudar a frequência (exemplo: de hora em hora):
--   select cron.alter_job((select jobid from cron.job where jobname = 'promo-bot-check'), schedule := '0 * * * *');
-- Parar:
--   select cron.unschedule('promo-bot-check');
