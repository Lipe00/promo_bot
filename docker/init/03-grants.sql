-- Só para o ambiente local: permissões que o Supabase dá por padrão à service_role.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
notify pgrst, 'reload schema';
