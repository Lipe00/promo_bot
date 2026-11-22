import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAlertMessage, freightLine } from '../src/lib/format.ts';
import { comparedPrice, parseFreightMode } from '../src/lib/shipping.ts';
import { watch } from './helpers.ts';

test('comparedPrice: menor entre cartão e Pix, mais frete no modo total', () => {
  const o = { title: 't', url: 'u', price: 300, cashPrice: 270 };
  assert.equal(comparedPrice(o, 'total'), 270); // frete desconhecido não soma
  assert.equal(comparedPrice({ ...o, shippingPrice: 25.5 }, 'total'), 295.5);
  assert.equal(comparedPrice({ ...o, shippingPrice: 25.5 }, 'produto'), 270);
  assert.equal(comparedPrice({ ...o, shippingPrice: 0 }, 'total'), 270);
});

test('parseFreightMode', () => {
  assert.equal(parseFreightMode('TOTAL'), 'total');
  assert.equal(parseFreightMode('produto'), 'produto');
  assert.equal(parseFreightMode('sem frete'), 'produto');
  assert.equal(parseFreightMode('talvez'), null);
});

test('linha de frete: calculado, grátis, dica da loja, só CEP, nada', () => {
  const base = { title: 't', url: 'u', price: 1 };
  assert.equal(freightLine({ ...base, shippingPrice: 19.9 }, '16010-000'), '🚚 Frete para 16010-000: R$ 19,90');
  assert.equal(freightLine({ ...base, shippingPrice: 0 }, '16010-000'), '🚚 Frete para 16010-000: grátis');
  assert.equal(freightLine({ ...base, freightNote: 'frete grátis indicado' }, null), '🚚 frete grátis indicado');
  assert.match(freightLine(base, '16010-000'), /confira na página da loja com o CEP 16010-000/);
  assert.match(freightLine(base, null), /cadastre o CEP/);
});

test('alerta no modo total mostra o total com frete', () => {
  const msg = buildAlertMessage({
    watch: watch(),
    storeName: 'Mercado Livre',
    offer: { title: 'Kabuto', url: 'https://www.mercadolivre.com.br/x', price: 280, shippingPrice: 20 },
    compared: 300,
    level: 'abaixo_do_alvo',
    reason: 'novo',
    cep: '16010-000',
    freightMode: 'total',
  });
  assert.match(msg, /Frete para 16010-000: R\$ 20,00/);
  assert.match(msg, /Total com frete: R\$ 300,00/);
  assert.doesNotMatch(msg, /a partir de/);
});

test('preço "a partir de" (anúncio com variações) aparece no alerta', () => {
  const msg = buildAlertMessage({
    watch: watch(),
    storeName: 'AliExpress',
    offer: { title: 'SSD 128GB 256GB 1TB', url: 'https://pt.aliexpress.com/item/1.html', price: 144.99, priceFrom: true },
    level: 'abaixo_do_alvo',
    reason: 'novo',
    cep: null,
  });
  assert.match(msg, /preço "a partir de"/);
});
