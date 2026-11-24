-- Agendamento da checagem. Rode DEPOIS do deploy na Vercel (e depois do schema/migrações).
-- Por que aqui e não no Vercel Cron: no plano Hobby o cron da Vercel roda no máximo 1x por dia.
-- O pg_cron do Supabase aceita qualquer intervalo e só precisa chamar a URL do app.
--
-- Troque SEU-APP e SEU_CRON_SECRET (mesmo valor da variável CRON_SECRET na Vercel).
-- O segredo fica no Vault (criptografado), não no texto do job.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Guarda (ou atualiza) o segredo no Vault.
do $$
declare
  sid uuid;
begin
  select id into sid from vault.secrets where name = 'promo_bot_cron_secret';
  if sid is null then
    perform vault.create_secret('SEU_CRON_SECRET', 'promo_bot_cron_secret', 'Bearer da rotina /api/cron/check');
  else
    perform vault.update_secret(sid, 'SEU_CRON_SECRET');
  end if;
end $$;

-- '0 */3 * * *' = a cada 3 horas, no minuto 0 (UTC). Rodar de novo atualiza o job com o mesmo nome.
-- Não precisa ser mais frequente que 1h: o bot lê páginas de lojas de verdade, e insistir aumenta a chance de bloqueio.
select cron.schedule(
  'promo-bot-check',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://SEU-APP.vercel.app/api/cron/check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'promo_bot_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Leitura dos canais do Telegram (posts que batem com as buscas e cupons): a cada 10 minutos.
select cron.schedule(
  'promo-bot-channels',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-APP.vercel.app/api/cron/channels',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'promo_bot_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- O Supabase libera o pg_net para as roles públicas ao habilitá-lo; o bot não precisa disso.
revoke usage on schema net from anon, authenticated;
revoke all on all tables in schema net from anon, authenticated;
revoke execute on all functions in schema net from anon, authenticated;

-- Ver as últimas execuções:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- Ver respostas HTTP (guardadas por 6 horas):
--   select id, status_code, content, created from net._http_response order by created desc limit 10;
-- Mudar a frequência (exemplo: de hora em hora):
--   select cron.alter_job((select jobid from cron.job where jobname = 'promo-bot-check'), schedule := '0 * * * *');
-- Parar:
--   select cron.unschedule('promo-bot-check');
