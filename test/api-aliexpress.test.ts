// API de afiliados da AliExpress (opcional; sem chave o bot lê a página de busca).
// A resposta segue o formato documentado de aliexpress.affiliate.product.query.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { aliApiUrl, aliFromApi, aliSign, aliexpress } from '../src/lib/stores/aliexpress.ts';
import type { FetchOutcome } from '../src/lib/types.ts';

const RESPONSE = {
  aliexpress_affiliate_product_query_response: {
    resp_result: {
      resp_code: 200,
      result: {
        products: {
          product: [
            {
              product_id: 1005001,
              product_title: 'Headset Force One Kabuto',
              target_sale_price: '230.15',
              target_original_price: '410.00',
              promotion_link: 'https://s.click.aliexpress.com/e/_abc',
              product_detail_url: 'https://pt.aliexpress.com/item/1005001.html',
            },
          ],
        },
      },
    },
  },
};

test('assinatura HMAC-SHA256 com parâmetros em ordem alfabética', () => {
  const sign = aliSign({ b: '2', a: '1', sign: 'ignorado' }, 'segredo');
  assert.equal(sign, createHmac('sha256', 'segredo').update('a1b2').digest('hex').toUpperCase());

  const url = new URL(aliApiUrl('kabuto', { appKey: 'K', secret: 'S', trackingId: 'T' }, 1700000000000));
  const p = Object.fromEntries(url.searchParams);
  assert.equal(p.method, 'aliexpress.affiliate.product.query');
  assert.equal(p.target_currency, 'BRL');
  assert.equal(p.ship_to_country, 'BR');
  assert.equal(p.tracking_id, 'T');
  const { sign: s, ...rest } = p;
  assert.equal(s, aliSign(rest as Record<string, string>, 'S'));
});

test('aliFromApi: link de afiliado e preços em BRL; erro da API', () => {
  const { offers, error } = aliFromApi(RESPONSE);
  assert.equal(error, null);
  assert.deepEqual(offers[0], {
    title: 'Headset Force One Kabuto',
    url: 'https://s.click.aliexpress.com/e/_abc',
    price: 230.15,
    regularPrice: 410,
    itemId: '1005001',
    priceFrom: true,
  });
  assert.equal(aliFromApi({ error_response: { code: 'IncompleteSignature', msg: 'assinatura inválida' } }).error, 'assinatura inválida');
});

test('com chaves usa a API; se a API falhar, cai na página de busca', async () => {
  const page = readFileSync(new URL('./fixtures/aliexpress-busca.html', import.meta.url), 'utf8');
  const secrets = { ALI_APP_KEY: 'K', ALI_APP_SECRET: 'S' };

  const viaApi = await aliexpress.search('kabuto', {
    secrets,
    fetchHtml: async (url): Promise<FetchOutcome> => ({ kind: 'ok', html: JSON.stringify(RESPONSE), finalUrl: url, status: 200 }),
  });
  assert.equal(viaApi.status, 'ok');
  assert.match(viaApi.message, /API/);

  const fallback = await aliexpress.search('kabuto', {
    secrets,
    fetchHtml: async (url): Promise<FetchOutcome> =>
      url.includes('api-sg')
        ? { kind: 'ok', html: JSON.stringify({ error_response: { msg: 'app suspenso' } }), finalUrl: url, status: 200 }
        : { kind: 'ok', html: page, finalUrl: url },
  });
  assert.equal(fallback.status, 'ok');
  assert.equal(fallback.offers.length, 4);
  assert.match(fallback.message, /API falhou: API AliExpress: app suspenso/);
});
