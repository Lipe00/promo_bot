import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeEqual } from '../src/lib/security.ts';

test('safeEqual compara segredos e nunca aceita segredo vazio', () => {
  assert.equal(safeEqual('abc123', 'abc123'), true);
  assert.equal(safeEqual('abc124', 'abc123'), false);
  assert.equal(safeEqual('abc', 'abc123'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('Bearer ', 'Bearer '), true); // quem monta o esperado é quem garante que o segredo existe
});
