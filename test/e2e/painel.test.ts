// Ponta a ponta do painel web: login, sessão, cadastro, checagem, cards, detalhe/histórico,
// "apenas promoções" e proteções (401 sem login, 403 de outra origem). Roda no Docker:
//   docker compose -f docker/compose.yml --profile mock up -d
//   docker compose -f docker/compose.yml --profile e2e run --rm e2e
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { hashPassword } from '../../src/lib/auth.ts';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const MOCKS = process.env.MOCKS_URL ?? 'http://localhost:4000';
const REST = process.env.REST_URL ?? 'http://localhost:54321/rest/v1';
const KEY = process.env.REST_KEY ?? '';
const PEPPER = process.env.PASSWORD_SALT ?? '';
const CHAT = 7777;
const USER = 'felipe';
const PASS = 'senha-de-teste-e2e-123';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  assert.ok(res.ok, `REST ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function api(path: string, opts: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  return fetch(`${APP}${path}`, {
    method: opts.method ?? 'GET',
    redirect: 'manual',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function loginCookie(password = PASS): Promise<{ res: Response; cookie: string | null; setCookie: string }> {
  const res = await api('/api/ui/login', { method: 'POST', body: { username: USER, password } });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('pb_session=')) ?? '';
  const cookie = setCookie ? setCookie.split(';')[0]! : null;
  return { res, cookie, setCookie };
}

let userId = 0;

before(async () => {
  const until = Date.now() + 180_000;
  for (;;) {
    try {
      if ((await fetch(`${APP}/login`)).ok) break;
    } catch {}
    if (Date.now() > until) throw new Error(`app não respondeu em ${APP}`);
    await sleep(1000);
  }
  await rest(`users?username=eq.${USER}`, { method: 'DELETE' });
  await rest(`watches?chat_id=eq.${CHAT}`, { method: 'DELETE' });
  await rest(`sources?chat_id=eq.${CHAT}`, { method: 'DELETE' });
  const [u] = (await rest('users', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ username: USER, password_hash: await hashPassword(PASS, USER, PEPPER), chat_id: CHAT }),
  })) as { id: number }[];
  userId = u!.id;
  // Só a loja falsa: desliga as embutidas e cadastra a fonte local.
  await rest('sources', {
    method: 'POST',
    body: JSON.stringify([
      ...['mercadolivre', 'amazon', 'shopee', 'aliexpress', 'kabum'].map((id) => ({
        chat_id: CHAT,
        kind: 'builtin',
        store_id: id,
        name: id,
        search_url: null,
        domains: [],
        enabled: false,
      })),
      { chat_id: CHAT, kind: 'custom', store_id: null, name: 'Loja Falsa', search_url: 'http://mocks:4000/loja/busca?q={q}', domains: ['mocks'], enabled: true },
    ]),
  });
});

test('sem login: página manda para /login e a API responde 401', async () => {
  const home = await api('/');
  assert.ok([302, 303, 307, 308].includes(home.status), `status ${home.status}`);
  assert.match(home.headers.get('location') ?? '', /\/login$/);
  assert.equal((await api('/api/ui/session')).status, 401);
  assert.equal((await api('/api/ui/watches')).status, 401);
  assert.equal((await api('/api/ui/watches', { method: 'POST', body: { query: 'x', target: 1 } })).status, 401);
  assert.equal((await api('/api/ui/watches/1')).status, 401);
  assert.equal((await api('/api/ui/check', { method: 'POST' })).status, 401);
  // Cookie inventado também não passa.
  assert.equal((await api('/api/ui/session', { cookie: 'pb_session=abc.def' })).status, 401);
});

test('senha errada: 401 genérico e nunca trava a conta', { timeout: 60_000 }, async () => {
  for (let i = 0; i < 6; i++) {
    const { res } = await loginCookie(`errada-${i}`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'usuário ou senha inválidos' });
  }
  const ok = await loginCookie();
  assert.equal(ok.res.status, 200);
});

test('login, validação da sessão, sair e revogar', async () => {
  const { res, cookie, setCookie } = await loginCookie();
  assert.equal(res.status, 200);
  assert.ok(cookie);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=lax/i);
  assert.match(setCookie, /Path=\//);

  const s = await api('/api/ui/session', { cookie });
  assert.equal(s.status, 200);
  const body = (await s.json()) as { authenticated: boolean; username: string; expiresAt: string };
  assert.equal(body.authenticated, true);
  assert.equal(body.username, USER);
  assert.ok(Date.parse(body.expiresAt) > Date.now() + 6 * 24 * 3600 * 1000);

  // Sair apaga a sessão: o mesmo cookie (copiado) deixa de valer.
  assert.equal((await api('/api/ui/logout', { method: 'POST', cookie })).status, 200);
  assert.equal((await api('/api/ui/session', { cookie })).status, 401);

  // Revogar todas as sessões da conta (o que o script faz ao trocar a senha).
  const again = await loginCookie();
  assert.equal((await api('/api/ui/session', { cookie: again.cookie! })).status, 200);
  await rest(`sessions?user_id=eq.${userId}`, { method: 'DELETE' });
  assert.equal((await api('/api/ui/session', { cookie: again.cookie! })).status, 401);
});

test('outra origem não consegue alterar nada (CSRF)', async () => {
  const { cookie } = await loginCookie();
  const r = await api('/api/ui/watches', { method: 'POST', cookie: cookie!, origin: 'https://evil.example', body: { query: 'x y', target: 10 } });
  assert.equal(r.status, 403);
  const l = await api('/api/ui/login', { method: 'POST', origin: 'https://evil.example', body: { username: USER, password: PASS } });
  assert.equal(l.status, 403);
});

test('painel: cadastra com "apenas promoções", checa, mostra menor preço, detalhe e histórico', { timeout: 180_000 }, async () => {
  const { cookie } = await loginCookie();
  assert.ok(cookie);
  await fetch(`${MOCKS}/__messages`, { method: 'DELETE' });

  const bad = await api('/api/ui/watches', { method: 'POST', cookie, body: { kind: 'produto', query: 'x', target: 'abc' } });
  assert.equal(bad.status, 400);

  const created = await api('/api/ui/watches', {
    method: 'POST',
    cookie,
    body: { kind: 'produto', query: 'mouse gamer pro', target: '200', margin: '', stores: [], onlyDeals: true },
  });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: number };

  const page = await api('/', { cookie });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /mouse gamer pro/);

  assert.equal((await api('/api/ui/check', { method: 'POST', cookie })).status, 202);
  type Cards = { cards: { id: number; onlyDeals: boolean; best: { price: number; storeName: string } | null; status: string }[]; stores: { id: string }[] };
  let cards: Cards | null = null;
  for (let i = 0; i < 90; i++) {
    cards = (await (await api('/api/ui/watches', { cookie })).json()) as Cards;
    if (cards.cards.find((c) => c.id === id)?.best) break;
    await sleep(1000);
  }
  const card = cards!.cards.find((c) => c.id === id)!;
  assert.ok(card.best, 'o card ganhou preço');
  assert.equal(card.best.price, 149.9); // menor preço aparece mesmo sem ser promoção
  assert.equal(card.best.storeName, 'Loja Falsa');
  assert.equal(card.status, 'abaixo');
  assert.equal(card.onlyDeals, true);
  assert.ok(cards!.stores.some((s) => s.id.startsWith('custom:')));

  const det = await api(`/api/ui/watches/${id}`, { cookie });
  assert.equal(det.status, 200);
  const detail = (await det.json()) as {
    offers: { title: string; isDeal: boolean; endsAt: string | null }[];
    history: { points: unknown[]; daily: { min: number }[] };
  };
  assert.equal(detail.offers.length, 2);
  assert.deepEqual(
    detail.offers.map((o) => [o.title, o.isDeal]),
    [
      ['Mouse Gamer Pro X', false],
      ['Mouse Gamer Pro X Edição Limitada', true],
    ],
  );
  assert.equal(detail.history.points.length, 2);
  assert.equal(detail.history.daily[0]?.min, 149.9);

  // Só a oferta com prazo (promoção) virou alerta no Telegram.
  await sleep(1000);
  const msgs = ((await (await fetch(`${MOCKS}/__messages`)).json()) as { method: string; payload: { chat_id?: number; text?: string } }[])
    .filter((m) => m.method === 'sendMessage' && m.payload.chat_id === CHAT)
    .map((m) => m.payload.text ?? '');
  const alerts = msgs.filter((t) => t.includes('Achei'));
  assert.equal(alerts.length, 1, alerts.join('\n---\n'));
  assert.match(alerts[0]!, /Edição Limitada/);
  assert.match(alerts[0]!, /Em promoção/);

  // Configurar: desliga a flag, pausa e depois remove.
  assert.equal((await api(`/api/ui/watches/${id}`, { method: 'PATCH', cookie, body: { onlyDeals: false, target: '180,00' } })).status, 200);
  assert.equal((await api(`/api/ui/watches/${id}`, { method: 'PATCH', cookie, body: { chat_id: 1 } })).status, 400);
  const after = (await (await api(`/api/ui/watches/${id}`, { cookie })).json()) as { card: { onlyDeals: boolean; target: number } };
  assert.equal(after.card.onlyDeals, false);
  assert.equal(after.card.target, 180);
  assert.equal((await api(`/api/ui/watches/${id}`, { method: 'PATCH', cookie, body: { active: false } })).status, 200);

  // Outra conta (ou id de outro chat) não enxerga a busca.
  const foreign = (await rest('watches', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ chat_id: 4242, query: 'de outro chat', target_price: 10 }),
  })) as { id: number }[];
  assert.equal((await api(`/api/ui/watches/${foreign[0]!.id}`, { cookie })).status, 404);
  assert.equal((await api(`/api/ui/watches/${foreign[0]!.id}`, { method: 'DELETE', cookie })).status, 404);

  assert.equal((await api(`/api/ui/watches/${id}`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await api(`/api/ui/watches/${id}`, { cookie })).status, 404);
});
