import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectivePrice, firstPrice, formatBRL, parsePriceBRL, priceCeiling } from '../src/lib/price.ts';

test('parsePriceBRL entende formatos brasileiros e JSON', () => {
  assert.equal(parsePriceBRL('R$ 1.299,90'), 1299.9);
  assert.equal(parsePriceBRL('R$1.299,90 à vista'), 1299.9);
  assert.equal(parsePriceBRL('279,00'), 279);
  assert.equal(parsePriceBRL('279'), 279);
  assert.equal(parsePriceBRL('1299.90'), 1299.9);
  assert.equal(parsePriceBRL('1.299'), 1299);
  assert.equal(parsePriceBRL('1,299.90'), 1299.9);
  assert.equal(parsePriceBRL('279,9'), 279.9);
  assert.equal(parsePriceBRL(259.99), 259.99);
  assert.equal(parsePriceBRL('R$ 12.345.678,00'), null); // acima do teto de sanidade
});

test('parsePriceBRL rejeita lixo', () => {
  assert.equal(parsePriceBRL(''), null);
  assert.equal(parsePriceBRL('sem preço'), null);
  assert.equal(parsePriceBRL(null), null);
  assert.equal(parsePriceBRL(undefined), null);
  assert.equal(parsePriceBRL(0), null);
  assert.equal(parsePriceBRL(-5), null);
  assert.equal(parsePriceBRL({}), null);
});

test('firstPrice pega o primeiro valor válido', () => {
  assert.equal(firstPrice(undefined, 'x', '45,50', 10), 45.5);
  assert.equal(firstPrice(null, ''), null);
});

test('priceCeiling aplica a margem sem erro de ponto flutuante', () => {
  assert.equal(priceCeiling(300, 15), 345);
  assert.equal(priceCeiling(300, 10), 330);
  assert.equal(priceCeiling(259.99, 0), 259.99);
  assert.equal(priceCeiling(100, 12.5), 112.5);
});

test('effectivePrice usa o menor entre normal e à vista', () => {
  assert.equal(effectivePrice({ price: 305.87, cashPrice: 259.99 }), 259.99);
  assert.equal(effectivePrice({ price: 100, cashPrice: null }), 100);
  assert.equal(effectivePrice({ price: 100, cashPrice: 120 }), 100);
});

test('formatBRL', () => {
  assert.equal(formatBRL(1299.9), 'R$ 1.299,90');
  assert.equal(formatBRL(300), 'R$ 300,00');
});
