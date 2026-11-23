import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runChecks } from '../src/lib/checker.ts';
import { buildCards, buildDetail, dailyMin, storeOptions } from '../src/lib/dashboard.ts';
import type { AdapterEnv, RawOffer, StoreAdapter } from '../src/lib/types.ts';
import { memoryDb, watch } from './helpers.ts';

const env: AdapterEnv = { fetchHtml: async () => ({ kind: 'error', message: 'x' }) };

function store(id: string, offers: () => RawOffer[]): StoreAdapter {
  return { id, name: id.toUpperCase(), domains: [`${id}.com.br`], search: async () => ({ status: 'ok', message: 'ok', offers: offers() }) };
}

test('checagens gravam histórico (só quando o preço muda ou passaram 24h) e o painel mostra o menor preço', async () => {
  const w = watch({ id: 1, query: 'kabuto', target_price: 300, margin_pct: 10 });
  const { db, state } = memoryDb({ watches: [w] });
  let price = 420; // acima do teto (330): antes não seria guardado
  const kabum = store('kabum', () => [
    { title: 'Headset Kabuto', url: 'https://www.kabum.com.br/p/1', price },
    { title: 'Headset Kabuto 2', url: 'https://www.kabum.com.br/p/2', price: 500 },
    { title: 'Headset Kabuto 3', url: 'https://www.kabum.com.br/p/3', price: 510 },
    { title: 'Headset Kabuto 4', url: 'https://www.kabum.com.br/p/4', price: 520 },
  ]);
  const run = (iso: string) => runChecks({ db, adapters: [kabum], env, notify: async () => {}, now: () => new Date(iso) });

  await run('2026-11-20T12:00:00Z');
  assert.equal(state.offers.length, 3); // as 3 mais baratas da loja
  assert.equal(state.history.length, 3);
  await run('2026-11-20T15:00:00Z'); // nada mudou, < 24h
  assert.equal(state.history.length, 3);
  price = 310;
  await run('2026-11-20T18:00:00Z'); // preço mudou
  assert.equal(state.history.length, 4);
  await run('2026-11-21T19:00:00Z'); // > 24h desde o último ponto de cada oferta
  assert.equal(state.history.length, 7);
  assert.ok(state.pruned.length > 0); // limpeza de histórico antigo roda

  const cards = await buildCards(db, 99);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.best?.price, 310);
  assert.equal(cards[0]?.best?.storeName, 'KaBuM!');
  assert.equal(cards[0]?.status, 'margem');
  assert.equal(cards[0]?.lowestEver, 310);

  const detail = await buildDetail(db, 99, 1, Date.parse('2026-11-22T00:00:00Z'));
  assert.ok(detail);
  assert.equal(detail.offers.length, 3);
  assert.deepEqual(detail.history.daily.map((d) => [d.day, d.min]), [
    ['2026-11-20', 310],
    ['2026-11-21', 310],
  ]);
  assert.equal(await buildDetail(db, 12345, 1), null); // outra conta não vê
});

test('"apenas promoções": sem de/por nem prazo não avisa, mas grava; com desconto avisa', async () => {
  const w = watch({ id: 1, query: 'kabuto', target_price: 300, margin_pct: 10, only_deals: true });
  const { db, state } = memoryDb({ watches: [w] });
  const sent: string[] = [];
  let offers: RawOffer[] = [{ title: 'Headset Kabuto', url: 'https://www.kabum.com.br/p/1', price: 250 }];
  const kabum = store('kabum', () => offers);
  const run = () => runChecks({ db, adapters: [kabum], env, notify: async (_c, h) => void sent.push(h), now: () => new Date('2026-11-22T12:00:00Z') });

  assert.equal((await run()).alerts, 0);
  assert.equal(state.offers.length, 1);
  assert.equal(state.offers[0]?.is_deal, false);

  offers = [{ title: 'Headset Kabuto', url: 'https://www.kabum.com.br/p/1', price: 250, regularPrice: 399 }];
  assert.equal((await run()).alerts, 1);
  assert.match(sent[0]!, /Em promoção/);
  assert.equal(state.offers[0]?.is_deal, true);

  // Prazo de fim também conta como promoção.
  const w2 = watch({ id: 2, chat_id: 5, query: 'ssd', target_price: 400, only_deals: true });
  const other = memoryDb({ watches: [w2] });
  const ssd = store('kabum', () => [{ title: 'SSD 1TB', url: 'https://www.kabum.com.br/p/9', price: 350, endsAt: '2099-01-01T00:00:00Z' }]);
  const r = await runChecks({ db: other.db, adapters: [ssd], env, notify: async () => {}, now: () => new Date('2026-11-22T12:00:00Z') });
  assert.equal(r.alerts, 1);
});

test('dailyMin agrupa por dia no horário de Brasília', () => {
  const d = dailyMin([
    { seenAt: '2026-11-21T02:00:00Z', store: 'a', storeName: 'A', price: 100 }, // 20/11 23h em Brasília
    { seenAt: '2026-11-21T12:00:00Z', store: 'b', storeName: 'B', price: 120 },
    { seenAt: '2026-11-21T15:00:00Z', store: 'a', storeName: 'A', price: 90 },
  ]);
  assert.deepEqual(d, [
    { day: '2026-11-20', min: 100, store: 'A' },
    { day: '2026-11-21', min: 90, store: 'A' },
  ]);
});

test('storeOptions: lojas embutidas com estado e fontes cadastradas', async () => {
  const { db } = memoryDb({
    sources: [
      { id: 3, chat_id: 1, kind: 'builtin', store_id: 'amazon', name: 'Amazon', search_url: null, domains: [], enabled: false },
      { id: 4, chat_id: 1, kind: 'custom', store_id: null, name: 'Loja X', search_url: 'https://x.com.br/?q={q}', domains: ['x.com.br'], enabled: true },
    ],
  });
  const opts = await storeOptions(db, 1);
  assert.equal(opts.find((o) => o.id === 'amazon')?.enabled, false);
  assert.equal(opts.find((o) => o.id === 'kabum')?.enabled, true);
  assert.deepEqual(opts.at(-1), { id: 'custom:4', name: 'Loja X', enabled: true });
});
