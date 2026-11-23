-- Instalação nova: rode este arquivo uma vez no Supabase (SQL Editor → New query → Run).
-- Já tinha rodado uma versão antiga? Rode as migrações de supabase/migrations/ que faltam, em ordem.

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
  -- "Apenas promoções": só avisa ofertas com preço de/por ou com prazo de fim.
  only_deals      boolean not null default false,
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
  is_deal            boolean not null default false,
  lowest_price       numeric(12,2) not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  last_alerted_price numeric(12,2),
  last_alerted_at    timestamptz,
  unique (watch_id, url)
);

-- Histórico de preços (um ponto quando o preço muda ou a cada 24h)
create table if not exists public.price_history (
  id       bigint generated always as identity primary key,
  watch_id bigint not null references public.watches (id) on delete cascade,
  offer_id bigint not null references public.offers (id) on delete cascade,
  store    text not null,
  price    numeric(12,2) not null,
  seen_at  timestamptz not null default now()
);
create index if not exists price_history_watch_idx on public.price_history (watch_id, seen_at);
create index if not exists price_history_offer_idx on public.price_history (offer_id, seen_at desc);

-- Contas do painel web (pronto para várias)
create table if not exists public.users (
  id              bigint generated always as identity primary key,
  username        text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  password_hash   text not null,
  chat_id         bigint not null,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now()
);

-- Sessões do painel (uma por aparelho). "Sair" apaga a sessão; trocar a senha apaga todas da conta.
create table if not exists public.sessions (
  id           text primary key,
  user_id      bigint not null references public.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on public.sessions (user_id);

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
alter table public.price_history enable row level security;
alter table public.users         enable row level security;
alter table public.sessions      enable row level security;

revoke all on function public.try_lock(text, int) from public, anon, authenticated;
grant execute on function public.try_lock(text, int) to service_role;
alter function public.try_lock(text, int) set search_path = '';

-- Defesa extra: as roles públicas (anon = publishable key, authenticated) não têm nenhum privilégio.
-- O RLS já bloqueia linhas, mas TRUNCATE não passa pelo RLS; sem GRANT, nem isso.
revoke all on table
  public.chat_settings, public.watches, public.offers, public.sources, public.store_status, public.locks,
  public.price_history, public.users, public.sessions
from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
