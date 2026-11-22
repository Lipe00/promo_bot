// Teste de ponta a ponta: webhook do Telegram → comandos → banco (Postgres + PostgREST) → checagem
// → loja falsa (fonte cadastrada) → alertas no Telegram falso. Roda dentro do Docker:
//   docker compose -f docker/compose.yml --profile mock up -d
//   docker compose -f docker/compose.yml --profile e2e run --rm e2e
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const MOCKS = process.env.MOCKS_URL ?? 'http://localhost:4000';
const REST = process.env.REST_URL ?? 'http://localhost:54321/rest/v1';
const KEY = process.env.REST_KEY ?? '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? 'e2e-webhook-secret';
const CRON = process.env.CRON_SECRET ?? 'e2e-cron-secret';
const CHAT = Number(process.env.CHAT_ID ?? '4242');

interface SentMessage {
  method: string;
  payload: { chat_id?: number; text?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let updateId = 1000;

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  assert.ok(res.ok, `REST ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function messages(): Promise<SentMessage[]> {
  return (await (await fetch(`${MOCKS}/__messages`)).json()) as SentMessage[];
}

async function texts(): Promise<string[]> {
  return (await messages()).filter((m) => m.method === 'sendMessage').map((m) => m.payload.text ?? '');
}

async function waitFor(pred: (all: string[]) => boolean, what: string, timeoutMs = 90_000): Promise<string[]> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const all = await texts();
    if (pred(all)) return all;
    if (Date.now() > until) assert.fail(`esperei "${what}" e não chegou. Mensagens:\n${all.join('\n---\n')}`);
    await sleep(500);
  }
}

/** Manda um comando como se fosse o Telegram e espera a resposta imediata. */
async function say(text: string, chatId = CHAT): Promise<string> {
  const before = (await texts()).length;
  const res = await fetch(`${APP}/api/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: ++updateId, message: { message_id: updateId, chat: { id: chatId }, text } }),
  });
  assert.equal(res.status, 200);
  if (chatId !== CHAT) return '';
  const all = await waitFor((m) => m.length > before, `resposta de ${text}`);
  return all[before]!;
}

before(async () => {
  // O "next dev" compila na primeira chamada; espera o app subir.
  const until = Date.now() + 180_000;
  for (;;) {
    try {
      const r = await fetch(`${APP}/`);
      if (r.ok) break;
    } catch {}
    if (Date.now() > until) throw new Error(`app não respondeu em ${APP}`);
    await sleep(1000);
  }
  for (const t of ['offers', 'watches', 'sources', 'chat_settings', 'store_status', 'locks']) {
    const filter = t === 'chat_settings' ? 'chat_id=gt.-9999999999999' : t === 'store_status' ? 'store=neq.__' : t === 'locks' ? 'name=neq.__' : 'id=gt.0';
    await rest(`${t}?${filter}`, { method: 'DELETE' });
  }
  await fetch(`${MOCKS}/__messages`, { method: 'DELETE' });
});

test('segredo errado do webhook é recusado; cron exige o segredo', async () => {
  const r = await fetch(`${APP}/api/telegram`, {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'errado' },
    body: '{}',
  });
  assert.equal(r.status, 403);
  const c = await fetch(`${APP}/api/cron/check?sync=1`, { headers: { authorization: 'Bearer errado' } });
  assert.equal(c.status, 401);
});

test('fluxo completo pelo Telegram', { timeout: 300_000 }, async () => {
  assert.match(await say('/start'), /Promo Bot/);

  // Estranhos são ignorados.
  const count = (await texts()).length;
  await say('/lista', 999);
  await sleep(500);
  assert.equal((await texts()).length, count);

  // Desliga as lojas reais: o teste usa só a loja falsa.
  for (const id of ['mercadolivre', 'amazon', 'shopee', 'aliexpress', 'magalu', 'kabum', 'pichau', 'terabyte']) {
    assert.match(await say(`/lojas off ${id}`), /Desligada/);
  }

  assert.match(await say('/cep 16010000'), /16010-000/);
  const settings = (await rest(`chat_settings?chat_id=eq.${CHAT}`)) as { cep: string; freight_mode: string }[];
  assert.equal(settings[0]?.cep, '16010-000');
  assert.equal(settings[0]?.freight_mode, 'total');

  // Fonte cadastrada + teste automático dela.
  const added = await say('/fonte add Loja Falsa | http://mocks:4000/loja/busca?q={q} | kabuto');
  assert.match(added, /Fonte #\d+ cadastrada: <b>Loja Falsa<\/b> \(mocks\)/);
  await waitFor((m) => m.some((t) => /Loja Falsa<\/b>: \d+ itens/.test(t)), 'teste da fonte');

  assert.match(await say('/add force one kabuto | 300 | 15'), /Busca #\d+ criada/);
  assert.match(await say('/categoria rtx 4060 | 2000'), /Categoria #\d+ criada/);
  // Editar uma mensagem não cria busca nova.
  await fetch(`${APP}/api/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: ++updateId, edited_message: { chat: { id: CHAT }, text: '/add duplicada | 10' } }),
  });
  const watches = (await rest(`watches?chat_id=eq.${CHAT}&order=id`)) as { kind: string; query: string }[];
  assert.deepEqual(watches.map((w) => [w.kind, w.query]), [['produto', 'force one kabuto'], ['categoria', 'rtx 4060']]);

  const list = await say('/lista');
  assert.match(list, /force one kabuto/);
  assert.match(list, /📦 <b>rtx 4060<\/b>/);

  // Checagem: um alerta do Kabuto (a almofada é barata demais; o Supersonic não tem "kabuto")
  // e um resumo da categoria (o Ti passa do teto).
  assert.match(await say('/checar'), /Checando agora/);
  const all = await waitFor((m) => m.some((t) => t.startsWith('<b>Checagem concluída</b>')), 'fim da checagem');
  const alert = all.find((t) => t.includes('Achei abaixo do seu preço'));
  assert.ok(alert, 'chegou o alerta do produto');
  assert.match(alert, /Headset Gamer Force One Kabuto 7\.1 Wireless/);
  assert.match(alert, /R\$ 279,90/);
  assert.match(alert, /⏰ Promoção até 31\/12 às 23:59/);
  assert.match(alert, /CEP 16010-000/);
  assert.match(alert, /href="http:\/\/mocks:4000\/loja\/p\/kabuto"/);
  assert.ok(!all.some((t) => /Almofada|Supersonic/.test(t) && t.includes('Achei')));

  const digest = all.find((t) => t.includes('📦 rtx 4060'));
  assert.ok(digest, 'chegou o resumo da categoria');
  assert.match(digest, /2 item\(ns\) até R\$ 2\.000,00/);
  assert.match(digest, /1\. <b>R\$ 1\.899,00<\/b> · Loja Falsa/);
  assert.doesNotMatch(digest, /Ti 16GB/);

  const summary = all.find((t) => t.startsWith('<b>Checagem concluída</b>'))!;
  assert.match(summary, /2 busca\(s\), 2 alerta\(s\)/);
  assert.match(summary, /Loja Falsa/);

  // Banco: links salvos, status da loja, buscas marcadas como checadas.
  const offers = (await rest('offers?select=title,url,price,ends_at&order=price')) as { title: string; url: string; price: number }[];
  assert.deepEqual(offers.map((o) => o.url), [
    'http://mocks:4000/loja/p/kabuto',
    'http://mocks:4000/loja/p/rtx4060',
    'http://mocks:4000/loja/p/rtx4060oc',
  ]);
  const status = (await rest('store_status?store=like.custom*')) as { name: string; status: string }[];
  assert.equal(status[0]?.name, 'Loja Falsa');
  assert.equal(status[0]?.status, 'ok');
  const checked = (await rest(`watches?chat_id=eq.${CHAT}&last_checked_at=not.is.null`)) as unknown[];
  assert.equal(checked.length, 2);

  // Segunda checagem: nada novo, nenhum alerta repetido.
  const before2 = (await texts()).length;
  await say('/checar');
  const after2 = await waitFor(
    (m) => m.slice(before2).some((t) => t.startsWith('<b>Checagem concluída</b>')),
    'segunda checagem',
  );
  assert.match(after2.slice(before2).find((t) => t.startsWith('<b>Checagem'))!, /0 alerta\(s\)/);

  // /status mostra a fonte cadastrada; /frete muda o modo.
  assert.match(await say('/status'), /Loja Falsa<\/b>: \d+ itens/);
  assert.match(await say('/frete produto'), /só o preço/);
});

test('rotina agendada (/api/cron/check) roda com o segredo', { timeout: 120_000 }, async () => {
  const r = await fetch(`${APP}/api/cron/check?sync=1`, { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { watches?: number; checked?: number; skipped?: string };
  if (!body.skipped) {
    assert.equal(body.watches, 2);
    assert.equal(body.checked, 2);
  }
});
