-- Painel web: contas, histórico de preços e flag "apenas promoções". Pode rodar mais de uma vez.
-- Supabase → SQL Editor → New query → cole e rode.

-- Contas do painel (pronto para várias; hoje só existe uma).
create table if not exists public.users (
  id              bigint generated always as identity primary key,
  username        text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  password_hash   text not null,
  -- De qual chat do Telegram são as buscas desta conta.
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

-- Histórico de preços (um ponto quando o preço muda ou a cada 24h).
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

-- "Apenas promoções": só avisa ofertas com preço de/por ou com prazo de fim.
alter table public.watches add column if not exists only_deals boolean not null default false;
-- A oferta tinha desconto ou prazo na última vez que foi vista.
alter table public.offers add column if not exists is_deal boolean not null default false;

-- Segurança: mesmas regras das outras tabelas (só a secret key do servidor acessa).
alter table public.users         enable row level security;
alter table public.price_history enable row level security;
alter table public.sessions      enable row level security;
revoke all on table public.users, public.sessions, public.price_history from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
