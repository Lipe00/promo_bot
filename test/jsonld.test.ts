import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  absoluteUrl,
  canonicalUrl,
  extractJsonLd,
  extractNextData,
  offersFromJsonLd,
  parseEndDate,
  walkObjects,
} from '../src/lib/jsonld.ts';

const PAGE = `
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Headset Force One Kabuto","url":"/produto/1","offers":{"@type":"Offer","price":"279.00","priceCurrency":"BRL","priceValidUntil":"2026-11-27","availability":"https://schema.org/InStock","shippingDetails":{"shippingRate":{"value":0}}}}</script>
<script type="application/ld+json">{"@graph":[{"@type":"BreadcrumbList"},{"@type":["Product","Thing"],"name":"Esgotado","offers":[{"price":10,"url":"/x","availability":"https://schema.org/OutOfStock"}]}]}</script>
<script type="application/ld+json">{ quebrado</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"items":[{"name":"A","price":1}]}}</script>
</head></html>`;

test('extractJsonLd ignora blocos quebrados', () => {
  assert.equal(extractJsonLd(PAGE).length, 2);
});

test('offersFromJsonLd lê preço, validade e frete; pula esgotado', () => {
  const offers = offersFromJsonLd(extractJsonLd(PAGE), 'https://loja.example/busca');
  assert.equal(offers.length, 1);
  const o = offers[0]!;
  assert.equal(o.title, 'Headset Force One Kabuto');
  assert.equal(o.url, 'https://loja.example/produto/1');
  assert.equal(o.price, 279);
  assert.equal(o.endsAt, '2026-11-28T02:59:59.000Z'); // 23:59:59 em Brasília
  assert.match(o.freightNote ?? '', /frete grátis/);
});

test('extractNextData e walkObjects (inclusive JSON dentro de string)', () => {
  const next = extractNextData(PAGE);
  assert.ok(next);
  const names: string[] = [];
  walkObjects({ data: JSON.stringify({ lista: [{ name: 'dentro da string', price: 5, extra: 'x'.repeat(40) }] }) }, (o) => {
    if (typeof o.name === 'string') names.push(o.name);
  });
  assert.deepEqual(names, ['dentro da string']);
  assert.equal(extractNextData('<html></html>'), null);
});

test('helpers de URL e data', () => {
  assert.equal(absoluteUrl('/a?b=1', 'https://x.example/busca'), 'https://x.example/a?b=1');
  assert.equal(absoluteUrl('', 'https://x.example'), null);
  assert.equal(canonicalUrl('https://x.example/p/123?tracking=abc#frag'), 'https://x.example/p/123');
  assert.equal(parseEndDate('2026-11-27T20:00:00-03:00'), '2026-11-27T23:00:00.000Z');
  assert.equal(parseEndDate('lixo'), null);
  assert.equal(parseEndDate(undefined), null);
});
