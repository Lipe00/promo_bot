-- Canais do Telegram e cupons. Pode rodar mais de uma vez.
-- Supabase → SQL Editor → New query → cole e rode.

-- Canais e grupos monitorados.
--   source = 'publico': lido pela página pública t.me/s/<username> (sem login)
--   source = 'conta'  : lido pela sua conta do Telegram (userbot), inclusive privados e grupos
create table if not exists public.tg_channels (
  id              bigint generated always as identity primary key,
  chat_id         bigint not null,
  source          text not null check (source in ('publico', 'conta')),
  username        text,
  tg_id           bigint,
  access_hash     text,
  peer_type       text check (peer_type in ('channel', 'chat')),
  title           text not null default '',
  enabled         boolean not null default true,
  last_message_id bigint,
  last_checked_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (chat_id, username),
  unique (chat_id, tg_id)
);
create index if not exists tg_channels_checked_idx on public.tg_channels (last_checked_at nulls first);

-- Posts lidos (guardados por 48 horas).
create table if not exists public.channel_posts (
  id         bigint generated always as identity primary key,
  channel_id bigint not null references public.tg_channels (id) on delete cascade,
  message_id bigint not null,
  posted_at  timestamptz not null,
  text       text not null default '',
  title      text not null default '',
  links      text[] not null default '{}',
  price      numeric(12,2),
  coupons    text[] not null default '{}',
  store      text,
  offer_url  text,
  post_url   text,
  created_at timestamptz not null default now(),
  unique (channel_id, message_id)
);
create index if not exists channel_posts_posted_idx on public.channel_posts (posted_at);

-- Posts que bateram com uma busca (somem junto com o post).
create table if not exists public.post_matches (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.channel_posts (id) on delete cascade,
  watch_id    bigint not null references public.watches (id) on delete cascade,
  price       numeric(12,2),
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (post_id, watch_id)
);
create index if not exists post_matches_watch_idx on public.post_matches (watch_id);

-- Cupons encontrados (guardam o próprio resumo; não dependem do post, que expira em 48h).
create table if not exists public.coupons (
  id            bigint generated always as identity primary key,
  chat_id       bigint not null,
  store         text not null,
  code          text not null,
  description   text not null default '',
  discount      text,
  channel_title text not null default '',
  offer_url     text,
  post_url      text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  notified_at   timestamptz,
  unique (chat_id, store, code)
);
create index if not exists coupons_seen_idx on public.coupons (chat_id, last_seen_at desc);

-- Lojas cujos cupons novos são avisados no Telegram.
alter table public.chat_settings
  add column if not exists coupon_stores text[] not null default '{amazon,shopee,mercadolivre}';

-- Segurança: só a secret key do servidor acessa.
alter table public.tg_channels   enable row level security;
alter table public.channel_posts enable row level security;
alter table public.post_matches  enable row level security;
alter table public.coupons       enable row level security;
revoke all on table public.tg_channels, public.channel_posts, public.post_matches, public.coupons from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
