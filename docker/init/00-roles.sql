-- Só para o ambiente local: cria as roles que o Supabase já tem prontas.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login password 'authpass' noinherit;
grant anon, authenticated, service_role to authenticator;
