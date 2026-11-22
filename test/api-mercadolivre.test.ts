// API oficial do Mercado Livre. As respostas abaixo seguem o formato documentado da API
// (não foram capturadas ao vivo: sem ML_CLIENT_ID a API responde 403).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { mercadolivre, mlFromApi, mlPromotionEnd, mlShippingCost, resetMlToken } from '../src/lib/stores/mercadolivre.ts';
import type { AdapterEnv, FetchInit, FetchOutcome } from '../src/lib/types.ts';

const SEARCH = {
  results: [
    {
      id: 'MLB123',
      title: 'Headset Gamer Force One Kabuto 7.1 Wireless',
      price: 279.9,
      original_price: 349.9,
      currency_id: 'BRL',
      permalink: 'https://www.mercadolivre.com.br/headset-kabuto/p/MLB123',
      shipping: { free_shipping: true },
    },
    { id: 'MLB9', title: 'Sem link', price: 10, currency_id: 'BRL' },
    { id: 'MLB8', title: 'Em dólar', price: 10, currency_id: 'USD', permalink: 'https://x' },
  ],
};

function apiEnv(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; init?: FetchInit }[] = [];
  const env: AdapterEnv = {
    secrets: { ML_CLIENT_ID: 'id', ML_CLIENT_SECRET: 'segredo' },
    fetchHtml: async (url, init): Promise<FetchOutcome> => {
      calls.push({ url, init });
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return { kind: 'error', message: `sem rota para ${url}` };
      const r = routes[key]!;
      return { kind: 'ok', html: JSON.stringify(r.body), finalUrl: url, status: r.status ?? 200 };
    },
  };
  return { env, calls };
}

beforeEach(() => resetMlToken());

test('mlFromApi lê título, preço, preço "de", link, id e frete grátis', () => {
  const offers = mlFromApi(SEARCH);
  assert.equal(offers.length, 1);
  assert.deepEqual(offers[0], {
    title: 'Headset Gamer Force One Kabuto 7.1 Wireless',
    url: 'https://www.mercadolivre.com.br/headset-kabuto/p/MLB123',
    price: 279.9,
    regularPrice: 349.9,
    itemId: 'MLB123',
    freightNote: 'frete grátis informado pelo Mercado Livre',
  });
});

test('busca com token client_credentials; token fica em cache', async () => {
  const { env, calls } = apiEnv({
    '/oauth/token': { body: { access_token: 'TOKEN-1', expires_in: 21600 } },
    '/sites/MLB/search': { body: SEARCH },
  });
  const r1 = await mercadolivre.search('force one kabuto', env);
  assert.equal(r1.status, 'ok');
  assert.match(r1.message, /API/);
  const tokenCall = calls.find((c) => c.url.includes('/oauth/token'))!;
  assert.equal(tokenCall.init?.method, 'POST');
  assert.match(tokenCall.init?.body ?? '', /grant_type=client_credentials/);
  assert.equal(calls.find((c) => c.url.includes('/search'))?.init?.headers?.authorization, 'Bearer TOKEN-1');
  assert.equal(tokenCall.init?.api, true); // API não passa pelo robots.txt

  await mercadolivre.search('outra coisa', env);
  assert.equal(calls.filter((c) => c.url.includes('/oauth/token')).length, 1);
});

test('API recusando (403) vira "bloqueou" com dica, sem quebrar', async () => {
  const { env } = apiEnv({
    '/oauth/token': { body: { access_token: 'T', expires_in: 100 } },
    '/sites/MLB/search': { status: 403, body: { message: 'forbidden' } },
    'lista.mercadolivre': { body: '' },
  });
  const r = await mercadolivre.search('x', env);
  assert.equal(r.status, 'blocked');
  assert.match(r.message, /developers\.mercadolivre/);
});

test('credencial errada: mensagem clara', async () => {
  const { env } = apiEnv({
    '/oauth/token': { status: 400, body: { message: 'invalid client_id or client_secret' } },
    'lista.mercadolivre': { body: '<html>nada</html>' },
  });
  const r = await mercadolivre.search('x', env);
  assert.equal(r.status, 'error');
  assert.match(r.message, /invalid client_id/);
});

test('frete por CEP e fim da promoção pelo enrich', async () => {
  const { env, calls } = apiEnv({
    '/oauth/token': { body: { access_token: 'T', expires_in: 100 } },
    '/shipping_options': { body: { options: [{ cost: 23.9 }, { cost: 18.5 }, { list_cost: 40 }] } },
    '/prices': {
      body: {
        prices: [
          { type: 'standard', amount: 349.9, conditions: {} },
          { type: 'promotion', amount: 279.9, conditions: { start_time: '2026-11-01T00:00:00Z', end_time: '2099-11-30T02:59:59Z' } },
        ],
      },
    },
  });
  const patch = await mercadolivre.enrich!({ title: 't', url: 'u', price: 279.9, itemId: 'MLB123' }, env, { cep: '16010-000' });
  assert.equal(patch.shippingPrice, 18.5);
  assert.equal(patch.endsAt, '2099-11-30T02:59:59.000Z');
  assert.ok(calls.some((c) => c.url.endsWith('/items/MLB123/shipping_options?zip_code=16010000')));
});

test('helpers: sem opções de frete e promoção vencida', () => {
  assert.equal(mlShippingCost({ options: [] }), null);
  assert.equal(mlShippingCost({ options: [{ cost: 0 }] }), 0);
  assert.equal(
    mlPromotionEnd({ prices: [{ type: 'promotion', conditions: { end_time: '2020-01-01T00:00:00Z' } }] }),
    null,
  );
});
