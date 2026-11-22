// Leitores das lojas contra páginas REAIS (reduzidas) capturadas em 22/11/2026 com scripts/calibrate.ts
// e scripts/make-fixtures.mjs. Para recapturar: veja o README ("Quando uma loja quebrar").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { detectBlock } from '../src/lib/http.ts';
import { aliSearchUrl } from '../src/lib/stores/aliexpress.ts';
import { STORE_ADAPTERS, buildAdapters, viaLabel } from '../src/lib/stores/index.ts';
import type { AdapterEnv, FetchInit, FetchOutcome, Source, StoreAdapter } from '../src/lib/types.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function adapterOf(id: string): StoreAdapter {
  const a = STORE_ADAPTERS.find((s) => s.id === id);
  assert.ok(a, `adaptador ${id} existe`);
  return a;
}

function envServing(html: string, finalUrl?: string): { env: AdapterEnv; requested: { url: string; init?: FetchInit }[] } {
  const requested: { url: string; init?: FetchInit }[] = [];
  return {
    requested,
    env: {
      fetchHtml: async (url, init): Promise<FetchOutcome> => {
        requested.push({ url, init });
        return { kind: 'ok', html, finalUrl: finalUrl ?? url };
      },
    },
  };
}

test('as 5 lojas embutidas estão registradas (Magalu, Pichau e Terabyte saíram: bloqueiam robôs)', () => {
  assert.deepEqual(STORE_ADAPTERS.map((a) => a.id).sort(), ['aliexpress', 'amazon', 'kabum', 'mercadolivre', 'shopee']);
});

test('URLs de busca de cada loja', async () => {
  const expected: [string, string][] = [
    ['mercadolivre', 'https://lista.mercadolivre.com.br/force-one-kabuto'],
    ['amazon', 'https://www.amazon.com.br/s?k=force+one+kabuto'],
    ['kabum', 'https://www.kabum.com.br/busca/force-one-kabuto'],
    ['aliexpress', 'https://pt.aliexpress.com/w/wholesale-force-one-kabuto.html'],
  ];
  for (const [id, url] of expected) {
    const { env, requested } = envServing('<html></html>');
    await adapterOf(id).search('force one kabuto', env);
    assert.equal(requested[0]?.url, url, id);
  }
  assert.equal(aliSearchUrl('SSD 1TB'), 'https://pt.aliexpress.com/w/wholesale-ssd-1tb.html');
});

test('KaBuM (página real): cartão, Pix, oferta relâmpago com horário de fim', async () => {
  const res = await adapterOf('kabum').search('headset force one', envServing(fixture('kabum-busca.html')).env);
  assert.equal(res.status, 'ok');
  assert.equal(res.offers.length, 4);

  const normal = res.offers.find((o) => o.itemId === '670579')!;
  assert.equal(normal.url, 'https://www.kabum.com.br/produto/670579/headset-gamer-force-one-supersonic-7-1-surround-usb-branco-fr-au-su-02');
  assert.equal(normal.price, 495.29);
  assert.equal(normal.cashPrice, 421);
  assert.equal(normal.endsAt, null);

  // Oferta "ESQUENTA BLACK": preço da oferta substitui o normal; o normal vira o "de".
  const flash = res.offers.find((o) => o.itemId === '670577')!;
  assert.equal(flash.price, 176.46);
  assert.equal(flash.cashPrice, 149.99);
  assert.equal(flash.regularPrice, 588.22);
  assert.equal(flash.endsAt, '2026-11-26T14:00:00.000Z');

  // Marketplace sem Pix separado.
  const mkt = res.offers.find((o) => o.itemId === '468215')!;
  assert.equal(mkt.price, 94.99);
  assert.equal(mkt.cashPrice, null);
});

test('KaBuM: link de categoria usa o mesmo leitor e recusa link de outra loja', async () => {
  const kabum = adapterOf('kabum');
  const ok = await kabum.listing!('https://www.kabum.com.br/hardware/placa-de-video-vga', envServing(fixture('kabum-busca.html')).env);
  assert.equal(ok.status, 'ok');
  const bad = await kabum.listing!('https://www.amazon.com.br/b?node=1', envServing('<html></html>').env);
  assert.equal(bad.status, 'error');
});

test('AliExpress (página real): itens do JSON embutido, em BRL, com frete grátis indicado', async () => {
  const { env, requested } = envServing(fixture('aliexpress-busca.html'));
  const res = await adapterOf('aliexpress').search('headset force one', env);
  assert.equal(res.status, 'ok');
  assert.equal(res.offers.length, 4);
  const first = res.offers[0]!;
  assert.match(first.title, /ATTACK SHARK G800/);
  assert.equal(first.price, 185.49);
  assert.equal(first.url, 'https://pt.aliexpress.com/item/1005013529656733.html');
  assert.match(first.freightNote ?? '', /frete grátis/);
  assert.equal(first.priceFrom, true); // preço mínimo entre as variações do anúncio
  assert.equal(res.offers[3]?.freightNote, null);
  // Pede a página em português/BRL.
  assert.match(requested[0]?.init?.headers?.cookie ?? '', /c_tp=BRL/);
});

test('Amazon (página real): título, preço e preço "de"', async () => {
  const res = await adapterOf('amazon').search('headset force one kabuto', envServing(fixture('amazon-busca.html')).env);
  assert.equal(res.status, 'ok');
  const kabuto = res.offers.find((o) => /KABUTO/.test(o.title))!;
  assert.equal(kabuto.url, 'https://www.amazon.com.br/dp/B0CJ5R59FB');
  assert.equal(kabuto.price, 265.05);
  assert.equal(kabuto.regularPrice, 279);
});

test('Mercado Livre (página real): tela de "tráfego suspeito" é reconhecida como bloqueio', async () => {
  const page = fixture('mercadolivre-bloqueio.html');
  assert.equal(detectBlock(200, page)?.kind, 'blocked');
  const res = await adapterOf('mercadolivre').search('x', {
    fetchHtml: async () => ({ kind: 'blocked', message: 'a loja mostrou uma tela de verificação (captcha)' }),
  });
  assert.equal(res.status, 'blocked');
  assert.match(res.message, /ML_CLIENT_ID/);
});

test('JSON-LD funciona em qualquer loja, com prazo da promoção', async () => {
  const ld = {
    '@type': 'ItemList',
    itemListElement: [
      { '@type': 'ListItem', item: { '@type': 'Product', name: 'Headset Force One Kabuto', url: 'https://www.amazon.com.br/dp/B0TESTE', offers: { price: '489.90', priceValidUntil: '2026-11-27' } } },
    ],
  };
  const html = `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`;
  const res = await adapterOf('amazon').search('force one kabuto', envServing(html).env);
  assert.equal(res.status, 'ok');
  assert.equal(res.offers[0]?.price, 489.9);
  assert.equal(res.offers[0]?.endsAt, '2026-11-28T02:59:59.000Z');
});

test('dados da loja e JSON-LD se completam (mesmo link)', async () => {
  const next = { props: { pageProps: { data: { catalogServer: { data: [{ code: 1, name: 'Headset X', friendlyName: 'headset-x', price: 300, priceWithDiscount: 250 }] } } } } };
  const ld = { '@type': 'Product', name: 'Headset X', offers: { price: '300', url: 'https://www.kabum.com.br/produto/1/headset-x', priceValidUntil: '2026-12-01' } };
  const html =
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>` +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const res = await adapterOf('kabum').search('headset', envServing(html).env);
  assert.equal(res.offers[0]?.cashPrice, 250); // da KaBuM
  assert.equal(res.offers[0]?.endsAt, '2026-12-02T02:59:59.000Z'); // do JSON-LD
});

test('página sem produtos vira "empty"; bloqueio e robots passam adiante; redirect para outro domínio é barrado', async () => {
  const empty = await adapterOf('kabum').search('x', envServing('<html>nada</html>').env);
  assert.equal(empty.status, 'empty');

  const blocked = await adapterOf('amazon').search('x', {
    fetchHtml: async () => ({ kind: 'blocked', message: 'HTTP 503: provável bloqueio ou captcha' }),
  });
  assert.equal(blocked.status, 'blocked');

  const robots = await adapterOf('kabum').search('x', {
    fetchHtml: async () => ({ kind: 'robots', message: 'o robots.txt da loja proíbe robôs nesta página' }),
  });
  assert.equal(robots.status, 'robots');

  const redirected = await adapterOf('kabum').search('x', envServing('<html></html>', 'https://evil.example/x').env);
  assert.equal(redirected.status, 'blocked');
});

test('Shopee sem chave: "não suportada" sem abrir a rede', async () => {
  const env: AdapterEnv = {
    fetchHtml: async () => {
      throw new Error('não deveria chamar a rede');
    },
  };
  const res = await adapterOf('shopee').search('x', env);
  assert.equal(res.status, 'unsupported');
  assert.match(res.message, /SHOPEE_AFFILIATE_APP_ID/);
});

test('buildAdapters: desliga embutidas e soma fontes cadastradas; viaLabel', () => {
  const sources: Source[] = [
    { id: 1, chat_id: 1, kind: 'builtin', store_id: 'amazon', name: 'Amazon', search_url: null, domains: [], enabled: false },
    { id: 2, chat_id: 1, kind: 'custom', store_id: null, name: 'Loja X', search_url: 'https://lojax.com.br/busca?q={q}', domains: ['lojax.com.br'], enabled: true },
    { id: 3, chat_id: 1, kind: 'custom', store_id: null, name: 'Desligada', search_url: 'https://y.com.br/?q={q}', domains: ['y.com.br'], enabled: false },
  ];
  const list = buildAdapters(STORE_ADAPTERS, sources);
  assert.ok(!list.some((a) => a.id === 'amazon'));
  assert.ok(list.some((a) => a.id === 'custom:2' && a.name === 'Loja X'));
  assert.ok(!list.some((a) => a.id === 'custom:3'));
  assert.equal(list.length, STORE_ADAPTERS.length);

  assert.equal(viaLabel(adapterOf('shopee')), 'sem chave (SHOPEE_AFFILIATE_APP_ID, SHOPEE_AFFILIATE_SECRET)');
  assert.equal(viaLabel(adapterOf('shopee'), { SHOPEE_AFFILIATE_APP_ID: 'a', SHOPEE_AFFILIATE_SECRET: 'b' }), 'API oficial');
  assert.equal(viaLabel(adapterOf('kabum')), 'página da loja');
});
