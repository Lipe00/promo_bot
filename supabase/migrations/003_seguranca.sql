-- Endurecimento de segurança. Pode rodar mais de uma vez.
-- Supabase → SQL Editor → New query → cole e rode.
--
-- O bot só acessa o banco com a secret key (service_role). As roles públicas
-- (anon = publishable key, authenticated = usuário logado) não precisam de nada.

-- 1) Tabelas do bot: tira todos os privilégios das roles públicas.
--    O RLS já bloqueava linhas, mas TRUNCATE não passa pelo RLS. Sem GRANT, nem isso.
revoke all on table
  public.chat_settings, public.watches, public.offers, public.sources, public.store_status, public.locks
from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function public.try_lock(text, int) from public, anon, authenticated;

-- Tabelas criadas no futuro (pelo dono do banco) também nascem sem acesso público.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- 2) try_lock com search_path fixo (aviso "function_search_path_mutable" do Supabase).
alter function public.try_lock(text, int) set search_path = '';

-- 3) pg_net (usado pelo agendamento): fica no schema "extensions" e sem acesso das roles públicas.
--    Ao habilitar o pg_net, o Supabase libera as funções net.http_* e a fila de requisições
--    (que guarda os headers, inclusive o Authorization do cron) para anon/authenticated.
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'net') then
    revoke usage on schema net from anon, authenticated;
    revoke all on all tables in schema net from anon, authenticated;
    revoke execute on all functions in schema net from anon, authenticated;
  end if;
end $$;
