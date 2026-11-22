-- Atualização para quem já rodou o schema.sql antigo. Pode rodar mais de uma vez sem problema.
-- Supabase → SQL Editor → New query → cole e rode.

-- Categorias, lojas por busca e ordem de checagem
alter table public.watches add column if not exists kind text not null default 'produto';
alter table public.watches add column if not exists category_url text;
alter table public.watches add column if not exists stores text[];
alter table public.watches add column if not exists last_checked_at timestamptz;
do $$ begin
  alter table public.watches add constraint watches_kind_check check (kind in ('produto', 'categoria'));
exception when duplicate_object then null; end $$;
create index if not exists watches_checked_idx on public.watches (last_checked_at nulls first);

-- Frete
alter table public.offers add column if not exists shipping_price numeric(12,2);
alter table public.chat_settings add column if not exists freight_mode text not null default 'total';
do $$ begin
  alter table public.chat_settings add constraint chat_settings_freight_check check (freight_mode in ('total', 'produto'));
exception when duplicate_object then null; end $$;

-- Nome da loja no /status (fontes cadastradas não têm nome fixo no código)
alter table public.store_status add column if not exists name text;

-- Fontes: liga/desliga lojas embutidas e lojas cadastradas pelo usuário
create table if not exists public.sources (
  id         bigint generated always as identity primary key,
  chat_id    bigint not null,
  kind       text not null check (kind in ('builtin', 'custom')),
  store_id   text,
  name       text not null,
  search_url text,
  domains    text[] not null default '{}',
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (chat_id, kind, store_id)
);
create index if not exists sources_chat_idx on public.sources (chat_id);
alter table public.sources enable row level security;
