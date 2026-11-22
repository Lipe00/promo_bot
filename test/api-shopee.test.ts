// API de afiliados da Shopee. A resposta segue o formato documentado (productOfferV2);
// não foi capturada ao vivo porque depende de conta de afiliado aprovada.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { SHOPEE_API, shopee, shopeeAuthHeader, shopeeFromApi, shopeeQueryBody } from '../src/lib/stores/shopee.ts';
import type { FetchInit } from '../src/lib/types.ts';

const RESPONSE = {
  data: {
    productOfferV2: {
      nodes: [
        {
          itemId: 22334455,
          productName: 'Headset Gamer Force One Kabuto RGB',
          priceMin: '260.00',
          priceMax: '289.90',
          priceDiscountRate: 20,
          offerLink: 'https://s.shopee.com.br/AbCdEf',
          productLink: 'https://shopee.com.br/product/1/22334455',
          shopName: 'Loja Oficial',
        },
        { itemId: 1, productName: 'sem preço', offerLink: 'https://s.shopee.com.br/x' },
      ],
    },
  },
};

test('assinatura SHA256(AppId + timestamp + corpo + segredo)', () => {
  const body = shopeeQueryBody('kabuto');
  const h = shopeeAuthHeader('123', 'abc', body, 1700000000);
  const expected = createHash('sha256').update(`1231700000000${body}abc`).digest('hex');
  assert.equal(h, `SHA256 Credential=123, Timestamp=1700000000, Signature=${expected}`);
  assert.deepEqual(JSON.parse(body).variables, { keyword: 'kabuto', limit: 30 });
});

test('shopeeFromApi: link de afiliado, menor preço, preço "de" pelo desconto', () => {
  const { offers, error } = shopeeFromApi(RESPONSE);
  assert.equal(error, null);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.url, 'https://s.shopee.com.br/AbCdEf');
  assert.equal(offers[0]?.price, 260);
  assert.equal(offers[0]?.regularPrice, 325);
  assert.equal(offers[0]?.itemId, '22334455');
  assert.equal(shopeeFromApi({ errors: [{ message: 'Invalid Signature' }] }).error, 'Invalid Signature');
});

test('com chaves: POST na API com cabeçalho de autorização', async () => {
  let call: { url: string; init?: FetchInit } | null = null;
  const res = await shopee.search('force one kabuto', {
    secrets: { SHOPEE_AFFILIATE_APP_ID: '123', SHOPEE_AFFILIATE_SECRET: 'abc' },
    fetchHtml: async (url, init) => {
      call = { url, init };
      return { kind: 'ok', html: JSON.stringify(RESPONSE), finalUrl: url, status: 200 };
    },
  });
  assert.equal(res.status, 'ok');
  assert.ok(call);
  const c = call as { url: string; init?: FetchInit };
  assert.equal(c.url, SHOPEE_API);
  assert.equal(c.init?.method, 'POST');
  assert.equal(c.init?.api, true);
  assert.match(c.init?.headers?.authorization ?? '', /^SHA256 Credential=123, Timestamp=\d+, Signature=[0-9a-f]{64}$/);
});

test('conta sem acesso à Open API (resposta real, erro 10035) vira "bloqueou" com instrução', async () => {
  // Resposta capturada em 22/11/2026 chamando a API com assinatura válida e conta sem acesso.
  const real = {
    errors: [
      {
        message:
          'error [10035]: You currently do not have access to the Shopee Affiliate Open API Platform. Please check the error code description on the front-end page and contact the Shopee Affiliate team',
        extensions: {
          code: 10035,
          message:
            'You currently do not have access to the Shopee Affiliate Open API Platform. Please check the error code description on the front-end page and contact the Shopee Affiliate team',
        },
      },
    ],
  };
  const res = await shopee.search('ssd', {
    secrets: { SHOPEE_AFFILIATE_APP_ID: '1', SHOPEE_AFFILIATE_SECRET: '2' },
    fetchHtml: async (url) => ({ kind: 'ok', html: JSON.stringify(real), finalUrl: url, status: 200 }),
  });
  assert.equal(res.status, 'blocked');
  assert.match(res.message, /não tem acesso à Open API \(erro 10035\)/);
  assert.match(res.message, /affiliate\.shopee\.com\.br/);
});

test('erro da API vira status de erro com a mensagem', async () => {
  const res = await shopee.search('x', {
    secrets: { SHOPEE_AFFILIATE_APP_ID: '1', SHOPEE_AFFILIATE_SECRET: '2' },
    fetchHtml: async (url) => ({ kind: 'ok', html: JSON.stringify({ errors: [{ message: 'Invalid Credential' }] }), finalUrl: url }),
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /Invalid Credential/);
});
