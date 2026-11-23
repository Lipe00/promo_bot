import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runChecks, testStores } from '../src/lib/checker.ts';
import type { CheckDeps } from '../src/lib/checker.ts';
import type { AdapterEnv, RawOffer, Source, StoreAdapter, StoreResult } from '../src/lib/types.ts';
import { memoryDb, watch as makeWatch } from './helpers.ts';

const watch = makeWatch();

function adapter(id: string, domains: string[], get: (terms: string) => StoreResult, extra: Partial<StoreAdapter> = {}): StoreAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    name: id.toUpperCase(),
    domains,
    calls,
    search: async (terms) => {
      calls.push(terms);
      return get(terms);
    },
    ...extra,
  };
}

function setup(state: { kabumPrice: number }) {
  const kabumOffers = (): RawOffer[] => [
    { title: 'Headset Gamer Force One Kabuto 7.1', url: 'https://www.kabum.com.br/produto/1?tracking=abc', price: state.kabumPrice },
    { title: 'Almofada Force One Kabuto', url: 'https://www.kabum.com.br/produto/2', price: 49.9 },
    { title: 'Headset Force One Kabuto Premium', url: 'https://www.kabum.com.br/produto/3', price: 500 },
    { title: 'Headset Gamer Outro Modelo', url: 'https://www.kabum.com.br/produto/4', price: 280 },
    { title: 'Force One Kabuto (link de outro site)', url: 'https://evil.example/produto/5', price: 100 },
  ];
  const pichauOffers = (): RawOffer[] => [
    { title: 'Headset Force One Kabuto RGB', url: 'https://www.pichau.com.br/headset-kabuto', price: 305.87, cashPrice: 259.99, endsAt: '2026-11-28T02:59:59Z' },
  ];
  return [
    adapter('kabum', ['kabum.com.br'], () => ({ status: 'ok', message: 'ok', offers: kabumOffers() })),
    adapter('pichau', ['pichau.com.br'], () => ({ status: 'ok', message: 'ok', offers: pichauOffers() })),
    adapter('amazon', ['amazon.com.br'], () => ({ status: 'blocked', message: 'HTTP 503', offers: [] })),
  ];
}

const env: AdapterEnv = { fetchHtml: async () => ({ kind: 'error', message: 'não usado' }) };

function deps(db: CheckDeps['db'], adapters: StoreAdapter[], sent: string[], extra: Partial<CheckDeps> = {}): CheckDeps {
  return {
    db,
    adapters,
    env,
    notify: async (_chat, html) => {
      sent.push(html);
    },
    now: () => new Date('2026-11-22T12:00:00Z'),
    ...extra,
  };
}

test('fluxo completo: filtra, respeita margem, deduplica e reavisa só quando muda', async () => {
  const state = { kabumPrice: 289.9 };
  const { db, state: mem } = memoryDb({ watches: [watch], settings: { cep: '16010-000' } });
  const sent: string[] = [];
  const d = deps(db, setup(state), sent);

  // Rodada 1: Pichau (Pix 259,99) e Kabum (289,90). Fora: acessório, acima da margem, outro modelo, outro domínio.
  const r1 = await runChecks(d);
  assert.equal(r1.alerts, 2);
  assert.equal(sent.length, 2);
  assert.match(sent[0]!, /PICHAU/); // mais barato primeiro
  assert.match(sent[0]!, /Promoção até 27\/11 às 23:59/);
  assert.match(sent[1]!, /href="https:\/\/www\.kabum\.com\.br\/produto\/1"/); // sem parâmetro de rastreio
  // Na faixa (2) + a "Premium" de R$ 500, guardada só para o painel/histórico (não gera alerta).
  assert.equal(mem.offers.length, 3);
  assert.ok(mem.offers.some((o) => o.price === 500 && o.last_alerted_price === null));
  assert.equal(r1.stores.amazon?.status, 'blocked');
  assert.equal(r1.stores.amazon?.name, 'AMAZON');
  assert.equal(mem.statuses.find((s) => s.store === 'amazon')?.status, 'blocked');
  assert.deepEqual(mem.checked, [1]);

  // Rodada 2: nada mudou → nenhum aviso.
  assert.equal((await runChecks(d)).alerts, 0);

  // Rodada 3: preço da Kabum cai >2% → avisa de novo.
  state.kabumPrice = 270;
  const r3 = await runChecks(d);
  assert.equal(r3.alerts, 1);
  assert.match(sent.at(-1)!, /caiu desde o último aviso/);

  // Rodada 4: sobe acima da margem → zera; Rodada 5: volta → avisa como novo.
  state.kabumPrice = 400;
  assert.equal((await runChecks(d)).alerts, 0);
  state.kabumPrice = 270;
  const r5 = await runChecks(d);
  assert.equal(r5.alerts, 1);
  assert.doesNotMatch(sent.at(-1)!, /caiu desde/);
});

test('"one" na busca casa com "1" no título', async () => {
  const { db } = memoryDb({ watches: [makeWatch({ query: 'force one kabuto' })] });
  const sent: string[] = [];
  const a = adapter('amazon', ['amazon.com.br'], () => ({
    status: 'ok',
    message: 'ok',
    offers: [{ title: 'Headset Force 1 Kabuto Wireless', url: 'https://www.amazon.com.br/dp/X', price: 265 }],
  }));
  const r = await runChecks(deps(db, [a], sent));
  assert.equal(r.alerts, 1);
  assert.deepEqual(a.calls, ['force one kabuto']); // a loja recebe o que o usuário digitou
});

test('promoção encerrada não gera alerta', async () => {
  const { db } = memoryDb({ watches: [watch] });
  const sent: string[] = [];
  const r = await runChecks(deps(db, setup({ kabumPrice: 900 }), sent, { now: () => new Date('2026-12-01T00:00:00Z') }));
  assert.equal(r.alerts, 0);
  assert.equal(sent.length, 0);
});

test('falha ao enviar não marca como avisado: tenta de novo na rodada seguinte', async () => {
  const { db, state } = memoryDb({ watches: [watch] });
  let fail = true;
  const d: CheckDeps = {
    ...deps(db, setup({ kabumPrice: 289.9 }), []),
    notify: async () => {
      if (fail) throw new Error('telegram fora');
    },
  };
  const r1 = await runChecks(d);
  assert.equal(r1.alerts, 0);
  assert.equal(r1.notifyErrors, 2);
  assert.ok(state.offers.every((o) => o.last_alerted_price === null));

  fail = false;
  assert.equal((await runChecks(d)).alerts, 2);
});

test('busca pausada é ignorada; sem buscas nada roda', async () => {
  const { db } = memoryDb({ watches: [{ ...watch, active: false }] });
  const spy = adapter('kabum', ['kabum.com.br'], () => ({ status: 'ok', message: '', offers: [] }));
  const r = await runChecks(deps(db, [spy], []));
  assert.equal(r.watches, 0);
  assert.equal(spy.calls.length, 0);
});

test('adaptador que lança exceção vira status de erro, sem derrubar a rodada', async () => {
  const { db } = memoryDb({ watches: [watch] });
  const boom: StoreAdapter = { id: 'terabyte', name: 'T', domains: ['terabyteshop.com.br'], search: async () => { throw new Error('x'); } };
  const r = await runChecks(deps(db, [boom], []));
  assert.equal(r.stores.terabyte?.status, 'error');
});

test('mesma busca em duas buscas = uma consulta por loja', async () => {
  const { db } = memoryDb({ watches: [makeWatch({ id: 1 }), makeWatch({ id: 2, query: 'kabuto force one', target_price: 200 })] });
  const a = adapter('kabum', ['kabum.com.br'], () => ({ status: 'ok', message: 'ok', offers: [] }));
  await runChecks(deps(db, [a], []));
  assert.equal(a.calls.length, 1);
});

test('orçamento de tempo: para antes do limite e começa pelas buscas mais antigas na próxima rodada', async () => {
  const watches = [
    makeWatch({ id: 1, query: 'item um', last_checked_at: '2026-11-22T09:00:00Z' }),
    makeWatch({ id: 2, query: 'item dois', last_checked_at: null }),
    makeWatch({ id: 3, query: 'item tres', last_checked_at: '2026-11-22T08:00:00Z' }),
  ];
  const { db, state } = memoryDb({ watches });
  let t = 0;
  const slow = adapter('kabum', ['kabum.com.br'], () => {
    t += 20_000; // cada busca "leva" 20s
    return { status: 'ok', message: 'ok', offers: [] };
  });
  const d = deps(db, [slow], [], { clock: () => t, budgetMs: 45_000 });

  const r1 = await runChecks(d);
  assert.equal(r1.watches, 3);
  assert.equal(r1.checked, 2); // 20s + 20s; a terceira não começa (faltariam < 12s)
  assert.deepEqual(slow.calls, ['item dois', 'item tres']); // nunca checada, depois a mais antiga
  assert.deepEqual(state.checked, [2, 3]);

  const r2 = await runChecks(d);
  assert.equal(r2.checked, 2);
  assert.equal(slow.calls[2], 'item um'); // a que ficou para trás vem primeiro
});

test('categoria por termo: sem piso de preço, teto sem margem, um resumo só e sem repetir', async () => {
  const w = makeWatch({ id: 5, kind: 'categoria', query: 'rtx 4060', target_price: 2000, margin_pct: 0 });
  const { db } = memoryDb({ watches: [w] });
  const offers: RawOffer[] = [
    { title: 'Placa de Vídeo RTX 4060 8GB Asus', url: 'https://www.kabum.com.br/produto/10', price: 1899, cashPrice: 1799 },
    { title: 'Placa de Vídeo RTX 4060 Ti 16GB', url: 'https://www.kabum.com.br/produto/11', price: 2600 },
    { title: 'Suporte para placa RTX 4060', url: 'https://www.kabum.com.br/produto/12', price: 49.9 },
    ...Array.from({ length: 6 }, (_, i) => ({ title: `RTX 4060 modelo ${i}`, url: `https://www.kabum.com.br/produto/2${i}`, price: 1900 + i })),
  ];
  const a = adapter('kabum', ['kabum.com.br'], () => ({ status: 'ok', message: 'ok', offers }));
  const sent: string[] = [];
  const r = await runChecks(deps(db, [a], sent));
  assert.equal(r.alerts, 1);
  assert.equal(sent.length, 1);
  const msg = sent[0]!;
  assert.match(msg, /📦 rtx 4060/);
  assert.match(msg, /8 item\(ns\) até R\$ 2\.000,00/); // o "suporte" de R$ 49,90 entra: categoria não tem piso
  assert.match(msg, /1\. <b>R\$ 49,90<\/b>/);
  assert.match(msg, /R\$ 1\.799,00 no Pix/);
  assert.match(msg, /\+3 outro\(s\) na faixa/);
  assert.doesNotMatch(msg, /Ti 16GB/);

  // Rodada seguinte: nada novo → nada enviado.
  assert.equal((await runChecks(deps(db, [a], sent))).alerts, 0);
});

test('categoria por link: usa a página da loja certa, sem filtro de palavras', async () => {
  const url = 'https://www.kabum.com.br/hardware/placa-de-video-vga';
  const w = makeWatch({ id: 6, kind: 'categoria', query: url, category_url: url, target_price: 1500, margin_pct: 0 });
  const { db } = memoryDb({ watches: [w] });
  const listed: string[] = [];
  const kabum = adapter('kabum', ['kabum.com.br'], () => ({ status: 'ok', message: '', offers: [] }), {
    listing: async (u) => {
      listed.push(u);
      return { status: 'ok', message: 'ok', offers: [{ title: 'Placa de Vídeo RX 7600', url: 'https://www.kabum.com.br/produto/9', price: 1399 }] };
    },
  });
  const other = adapter('pichau', ['pichau.com.br'], () => ({ status: 'ok', message: '', offers: [] }), { listing: async () => { throw new Error('não'); } });
  const sent: string[] = [];
  const r = await runChecks(deps(db, [kabum, other], sent));
  assert.deepEqual(listed, [url]);
  assert.equal(kabum.calls.length, 0);
  assert.equal(r.alerts, 1);
  assert.match(sent[0]!, /📦 kabum\.com\.br\/hardware\/placa-de-video-vga/);
  assert.match(sent[0]!, /RX 7600/);
});

test('lojas por busca e lojas desligadas pelo chat não são consultadas; fonte cadastrada entra', async () => {
  const sources: Source[] = [
    { id: 1, chat_id: 99, kind: 'builtin', store_id: 'pichau', name: 'Pichau', search_url: null, domains: [], enabled: false },
  ];
  const { db } = memoryDb({ watches: [makeWatch({ id: 1, stores: ['kabum', 'amazon', 'pichau'] })], sources });
  const [kabum, pichau, amazon] = setup({ kabumPrice: 289.9 });
  const r = await runChecks(deps(db, [kabum!, pichau!, amazon!], []));
  assert.equal(kabum!.calls.length, 1);
  assert.equal((pichau as unknown as { calls: string[] }).calls.length, 0); // desligada
  assert.ok(r.stores.amazon);
  assert.ok(!r.stores.pichau);
});

test('frete pelo CEP: enrich só para quem está na faixa; modo total soma o frete', async () => {
  const w = makeWatch({ id: 1, query: 'kabuto', target_price: 300, margin_pct: 0 });
  const enriched: string[] = [];
  const ml = adapter(
    'mercadolivre',
    ['mercadolivre.com.br'],
    () => ({
      status: 'ok',
      message: 'ok',
      offers: [
        { title: 'Kabuto A', url: 'https://www.mercadolivre.com.br/a', price: 280, itemId: 'A' },
        { title: 'Kabuto B', url: 'https://www.mercadolivre.com.br/b', price: 295, itemId: 'B' },
        { title: 'Kabuto C', url: 'https://www.mercadolivre.com.br/c', price: 900, itemId: 'C' },
      ],
    }),
    {
      enrich: async (offer, _env, ctx) => {
        enriched.push(`${offer.itemId}@${ctx.cep}`);
        return { shippingPrice: offer.itemId === 'A' ? 30 : 0, endsAt: '2099-01-01T00:00:00Z' };
      },
    },
  );

  // total: A = 280 + 30 = 310 > 300 → fora; B = 295 + 0 → dentro
  const total = memoryDb({ watches: [w], settings: { cep: '16010-000', freight_mode: 'total' } });
  const sent: string[] = [];
  const r = await runChecks(deps(total.db, [ml], sent));
  assert.deepEqual(enriched.sort(), ['A@16010-000', 'B@16010-000']); // C (R$ 900) não gasta requisição
  assert.equal(r.alerts, 1);
  assert.match(sent[0]!, /Kabuto B/);
  assert.match(sent[0]!, /Frete para 16010-000: grátis/);
  assert.match(sent[0]!, /Promoção até/);
  assert.equal(total.state.offers.find((o) => o.title === 'Kabuto B')?.shipping_price, 0);

  // produto: A volta a valer (280), e o alerta mostra o frete
  const produto = memoryDb({ watches: [w], settings: { cep: '16010-000', freight_mode: 'produto' } });
  const sent2: string[] = [];
  await runChecks(deps(produto.db, [ml], sent2));
  assert.equal(sent2.length, 2);
  assert.match(sent2[0]!, /Kabuto A[\s\S]*Frete para 16010-000: R\$ 30,00/);
});

test('testStores devolve o resultado de cada loja, com nome', async () => {
  const res = await testStores(setup({ kabumPrice: 100 }), env, 'force one kabuto');
  assert.deepEqual(res.map((r) => r.id), ['kabum', 'pichau', 'amazon']);
  assert.equal(res[2]?.name, 'AMAZON');
  assert.equal(res[2]?.result.status, 'blocked');
});
