-- Instalação nova: rode este arquivo uma vez no Supabase (SQL Editor → New query → Run).
-- Já tinha rodado a versão antiga? Rode só supabase/migrations/002_fontes_categorias_frete.sql.

-- Preferências por chat do Telegram
create table if not exists public.chat_settings (
  chat_id      bigint primary key,
  cep          text,
  freight_mode text not null default 'total' check (freight_mode in ('total', 'produto')),
  updated_at   timestamptz not null default now()
);

-- Buscas: produto (termo + alvo + margem) ou categoria (termo ou link + teto)
create table if not exists public.watches (
  id              bigint generated always as identity primary key,
  chat_id         bigint not null,
  query           text not null,
  target_price    numeric(12,2) not null check (target_price > 0),
  margin_pct      numeric(5,2) not null default 15 check (margin_pct >= 0 and margin_pct <= 100),
  active          boolean not null default true,
  kind            text not null default 'produto' check (kind in ('produto', 'categoria')),
  category_url    text,
  stores          text[],
  last_checked_at timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists watches_chat_idx on public.watches (chat_id);
create index if not exists watches_checked_idx on public.watches (last_checked_at nulls first);

-- Ofertas encontradas (link salvo) e estado dos alertas
create table if not exists public.offers (
  id                 bigint generated always as identity primary key,
  watch_id           bigint not null references public.watches (id) on delete cascade,
  store              text not null,
  title              text not null,
  url                text not null,
  price              numeric(12,2) not null,
  regular_price      numeric(12,2),
  ends_at            timestamptz,
  shipping_price     numeric(12,2),
  lowest_price       numeric(12,2) not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  last_alerted_price numeric(12,2),
  last_alerted_at    timestamptz,
  unique (watch_id, url)
);

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

-- Saúde de cada loja na última checagem (usado pelo comando /status)
create table if not exists public.store_status (
  store       text primary key,
  name        text,
  status      text not null,
  message     text not null default '',
  items_found int not null default 0,
  checked_at  timestamptz not null default now()
);

-- Trava simples para duas checagens não rodarem ao mesmo tempo
create table if not exists public.locks (
  name         text primary key,
  locked_until timestamptz not null default now()
);

create or replace function public.try_lock(p_name text, p_ttl_seconds int)
returns boolean
language plpgsql
as $$
declare
  got boolean;
begin
  insert into public.locks (name, locked_until)
  values (p_name, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set locked_until = excluded.locked_until
    where public.locks.locked_until < now()
  returning true into got;
  return coalesce(got, false);
end;
$$;

-- Segurança: RLS ligado e sem nenhuma policy = só a service_role (servidor) acessa.
alter table public.chat_settings enable row level security;
alter table public.watches       enable row level security;
alter table public.offers        enable row level security;
alter table public.sources       enable row level security;
alter table public.store_status  enable row level security;
alter table public.locks         enable row level security;

revoke all on function public.try_lock(text, int) from public, anon, authenticated;
grant execute on function public.try_lock(text, int) to service_role;
