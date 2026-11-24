// Ponta a ponta dos canais do Telegram e cupons: cadastra canal público pelo site, o canal (falso, no formato
// do t.me/s) publica posts, a rotina de canais lê, avisa no Telegram (falso) e o site mostra cupons e posts.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { hashPassword } from '../../src/lib/auth.ts';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const MOCKS = process.env.MOCKS_URL ?? 'http://localhost:4000';
const REST = process.env.REST_URL ?? 'http://localhost:54321/rest/v1';
const KEY = process.env.REST_KEY ?? '';
const PEPPER = process.env.PASSWORD_SALT ?? '';
const CRON = process.env.CRON_SECRET ?? 'e2e-cron-secret';
const CHAT = 8888;
const USER = 'canais-e2e';
const PASS = 'senha-canais-e2e-123';

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

let cookie = '';
function api(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}) {
  return fetch(`${APP}${path}`, {
    method: opts.method ?? 'GET',
    redirect: 'manual',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.auth === false ? {} : { cookie }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function publish(text: string, links: string[] = []) {
  const r = await fetch(`${MOCKS}/__channel/canalteste`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, links }) });
  assert.equal(r.status, 200);
}

async function telegramTo(chat: number): Promise<string[]> {
  const all = (await (await fetch(`${MOCKS}/__messages`)).json()) as { method: string; payload: { chat_id?: number; text?: string } }[];
  return all.filter((m) => m.method === 'sendMessage' && m.payload.chat_id === chat).map((m) => m.payload.text ?? '');
}

async function runChannels(): Promise<Record<string, unknown>> {
  const r = await fetch(`${APP}/api/cron/channels?sync=1`, { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(r.status, 200);
  return (await r.json()) as Record<string, unknown>;
}

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
  await rest(`tg_channels?chat_id=eq.${CHAT}`, { method: 'DELETE' });
  await rest(`coupons?chat_id=eq.${CHAT}`, { method: 'DELETE' });
  await rest(`sources?chat_id=eq.${CHAT}`, { method: 'DELETE' });
  await rest('users', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password_hash: await hashPassword(PASS, USER, PEPPER), chat_id: CHAT }),
  });
  await fetch(`${MOCKS}/__channel/canalteste`, { method: 'DELETE' });
  await fetch(`${MOCKS}/__messages`, { method: 'DELETE' });
  const login = await api('/api/ui/login', { method: 'POST', auth: false, body: { username: USER, password: PASS } });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().find((c) => c.startsWith('pb_session='))!.split(';')[0]!;
});

test('sem login e sem segredo: tudo fechado', async () => {
  for (const p of ['/api/ui/coupons', '/api/ui/channels', '/api/ui/channels/available']) {
    assert.equal((await api(p, { auth: false })).status, 401, p);
  }
  assert.equal((await api('/api/ui/channels', { method: 'POST', auth: false, body: { username: '@x' } })).status, 401);
  assert.equal((await fetch(`${APP}/api/cron/channels`)).status, 401);
  for (const p of ['/cupons', '/canais']) {
    const r = await api(p, { auth: false });
    assert.ok([302, 303, 307, 308].includes(r.status), `${p} → ${r.status}`);
  }
});

test('canal público: cadastra, lê posts novos, avisa busca e cupons uma vez só', { timeout: 180_000 }, async () => {
  const w = await api('/api/ui/watches', { method: 'POST', body: { kind: 'produto', query: 'force one kabuto', target: '300' } });
  assert.equal(w.status, 201);
  const watchId = ((await w.json()) as { id: number }).id;

  assert.equal((await api('/api/ui/channels', { method: 'POST', body: { username: '@inexistente_xyz' } })).status, 400);
  const add = await api('/api/ui/channels', { method: 'POST', body: { username: 't.me/canalteste' } });
  assert.equal(add.status, 201);
  const ch = ((await add.json()) as { channel: { id: number; title: string; last_message_id: number } }).channel;
  assert.equal(ch.title, 'Canal de Teste');
  assert.ok(ch.last_message_id >= 502); // já marcado: os 2 posts antigos não geram aviso

  // A conta do Telegram não está conectada neste ambiente.
  const avail = await api('/api/ui/channels/available');
  assert.equal(avail.status, 400);
  assert.match(((await avail.json()) as { error: string }).error, /conta do Telegram/);

  await publish('➡️ Headset Gamer Force One Kabuto 7.1\n✅ R$ 259,90\n🏷 Cupom: KABUTO10\n🛒 https://meli.la/kab', ['https://meli.la/kab']);
  await publish('➡️ Monitor Gamer 27\n✅ R$ 873\n🏷 Cupom: DESCONTOSMELI\n🛒 https://meli.la/mon\n🚀 Mais grupos: https://nerdofertas.com/t', [
    'https://meli.la/mon',
    'https://nerdofertas.com/t',
  ]);
  await publish('Fone Bluetooth\n✅ R$ 49,90\n🎟️ CUPOM: SHOPEE20\nR$ 20 OFF acima de R$ 99\nhttps://s.shopee.com.br/fone', ['https://s.shopee.com.br/fone']);
  await publish('Outro monitor\n✅ R$ 900\n🏷 Cupom: DESCONTOSMELI\nhttps://meli.la/mon2', ['https://meli.la/mon2']);
  await publish('Headset Force One Kabuto (caro)\n✅ R$ 999', []);

  const s1 = await runChannels();
  assert.equal(s1.read, 1);
  assert.equal(s1.posts, 5);

  const msgs = await telegramTo(CHAT);
  const seen = msgs.filter((m) => m.includes('Visto no canal'));
  assert.equal(seen.length, 1, seen.join('\n---\n')); // o de R$ 999 passa do teto
  assert.match(seen[0]!, /Canal de Teste/);
  assert.match(seen[0]!, /R\$ 259,90/);
  assert.match(seen[0]!, /KABUTO10/);
  assert.match(seen[0]!, /href="https:\/\/meli\.la\/kab"/);

  const coupons = msgs.filter((m) => m.startsWith('<b>🎟️ Cupom'));
  assert.deepEqual(coupons.map((m) => m.match(/<code>([^<]+)<\/code>/)?.[1]).sort(), ['DESCONTOSMELI', 'KABUTO10', 'SHOPEE20']);
  assert.match(coupons.find((m) => m.includes('SHOPEE20'))!, /Cupom Shopee.*\n.*R\$ 20 OFF acima de R\$ 99/);
  assert.ok(!coupons.some((m) => m.includes('nerdofertas')));

  // Rodada seguinte sem posts novos: nada de novo no Telegram.
  const count = (await telegramTo(CHAT)).length;
  const s2 = await runChannels();
  assert.equal(s2.posts, 0);
  assert.equal((await telegramTo(CHAT)).length, count);

  // Site: cupons, canais e aba Canais da busca.
  const cps = (await (await api('/api/ui/coupons')).json()) as { coupons: { code: string; store: string }[]; couponStores: string[] };
  assert.deepEqual(cps.coupons.map((c) => `${c.store}:${c.code}`).sort(), ['mercadolivre:DESCONTOSMELI', 'mercadolivre:KABUTO10', 'shopee:SHOPEE20']);
  assert.deepEqual(cps.couponStores.sort(), ['amazon', 'mercadolivre', 'shopee']);
  const chs = (await (await api('/api/ui/channels')).json()) as { channels: { last_error: string | null; last_checked_at: string | null }[]; accountConfigured: boolean };
  assert.equal(chs.channels[0]?.last_error, null);
  assert.ok(chs.channels[0]?.last_checked_at);
  assert.equal(chs.accountConfigured, false);
  const det = (await (await api(`/api/ui/watches/${watchId}`)).json()) as { channelPosts: { title: string; coupons: string[] }[] };
  assert.equal(det.channelPosts.length, 1);
  assert.deepEqual(det.channelPosts[0]?.coupons, ['KABUTO10']);
  for (const p of ['/cupons', '/canais']) {
    const r = await api(p);
    assert.equal(r.status, 200, p);
    const html = await r.text();
    assert.match(html, p === '/cupons' ? /SHOPEE20/ : /Canal de Teste/);
  }

  // Desliga cupons da Shopee: um cupom novo dela não avisa (mas aparece no site).
  assert.equal((await api('/api/ui/coupons', { method: 'PATCH', body: { couponStores: ['mercadolivre', 'amazon'] } })).status, 200);
  assert.equal((await api('/api/ui/coupons', { method: 'PATCH', body: { couponStores: ['loja-x'] } })).status, 400);
  await publish('Capa de celular\nCupom: SHOPEE5\nhttps://s.shopee.com.br/capa', ['https://s.shopee.com.br/capa']);
  await runChannels();
  assert.ok(!(await telegramTo(CHAT)).some((m) => m.includes('SHOPEE5')));
  const after = (await (await api('/api/ui/coupons')).json()) as { coupons: { code: string }[] };
  assert.ok(after.coupons.some((c) => c.code === 'SHOPEE5'));

  // Pausar e remover o canal.
  assert.equal((await api(`/api/ui/channels/${ch.id}`, { method: 'PATCH', body: { enabled: false } })).status, 200);
  assert.equal((await runChannels()).channels, 0);
  assert.equal((await api(`/api/ui/channels/${ch.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/ui/channels/${ch.id}`, { method: 'DELETE' })).status, 404);
});
