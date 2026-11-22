import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTemplate, fillTemplate, genericFromJson, makeGenericStore } from '../src/lib/stores/generic.ts';
import type { FetchOutcome, Source } from '../src/lib/types.ts';

const source: Source = {
  id: 7,
  chat_id: 1,
  kind: 'custom',
  store_id: null,
  name: 'Loja X',
  search_url: 'https://www.lojax.com.br/busca?q={q}',
  domains: ['lojax.com.br'],
  enabled: true,
};

test('checkTemplate: exige {q}, https e host público', () => {
  const ok = checkTemplate('https://www.lojax.com.br/busca?q={q}');
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.domain, 'lojax.com.br');
  assert.equal(checkTemplate('https://lojax.com.br/busca').ok, false);
  assert.equal(checkTemplate('http://lojax.com.br/?q={q}').ok, false);
  assert.equal(checkTemplate('https://localhost/?q={q}').ok, false);
  assert.equal(checkTemplate('sem link nenhum {q}').ok, false);
  assert.equal(fillTemplate('https://x.com/s/{q}', 'ssd 1tb'), 'https://x.com/s/ssd%201tb');
});

test('loja cadastrada lê JSON-LD e só aceita links do próprio domínio', async () => {
  const ld = [
    { '@type': 'Product', name: 'SSD Kingston 1TB', offers: { price: '399.90', url: 'https://www.lojax.com.br/p/ssd-1tb' } },
    {
      '@type': 'Product',
      name: 'SSD Esgotado',
      offers: { price: '199.90', url: 'https://www.lojax.com.br/p/x', availability: 'https://schema.org/OutOfStock' },
    },
  ];
  const html = `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`;
  const requested: string[] = [];
  const store = makeGenericStore(source);
  assert.equal(store.id, 'custom:7');
  const res = await store.search('ssd 1tb', {
    fetchHtml: async (url): Promise<FetchOutcome> => {
      requested.push(url);
      return { kind: 'ok', html, finalUrl: url };
    },
  });
  assert.deepEqual(requested, ['https://www.lojax.com.br/busca?q=ssd%201tb']);
  assert.equal(res.status, 'ok');
  assert.equal(res.offers.length, 1);
  assert.equal(res.offers[0]?.price, 399.9);

  const redirected = await store.search('x', { fetchHtml: async () => ({ kind: 'ok', html, finalUrl: 'https://outra.com/x' }) });
  assert.equal(redirected.status, 'blocked');

  const empty = await store.search('x', {
    fetchHtml: async (url) => ({ kind: 'ok', html: '<html>sem dados</html>', finalUrl: url }),
  });
  assert.equal(empty.status, 'empty');
  assert.match(empty.message, /JSON-LD/);
});

test('genericFromJson acha produtos em __NEXT_DATA__', () => {
  const offers = genericFromJson(
    { props: { items: [{ name: 'Monitor LG 27', price: { value: 999.9 }, url: '/p/monitor' }, { name: 'Categoria', url: '/c' }] } },
    'https://www.lojax.com.br/busca',
  );
  assert.deepEqual(
    offers.map((o) => [o.title, o.price, o.url]),
    [['Monitor LG 27', 999.9, 'https://www.lojax.com.br/p/monitor']],
  );
});
