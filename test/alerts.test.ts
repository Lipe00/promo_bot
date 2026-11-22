import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideAlert } from '../src/lib/alerts.ts';

const NOW = new Date('2026-11-22T12:00:00Z');
const base = { target: 300, marginPct: 15, endsAt: null, prev: null, now: NOW };

test('abaixo do alvo e dentro da margem são níveis diferentes', () => {
  assert.deepEqual(decideAlert({ ...base, price: 290 }), { send: true, level: 'abaixo_do_alvo', reason: 'novo' });
  assert.deepEqual(decideAlert({ ...base, price: 330 }), { send: true, level: 'dentro_da_margem', reason: 'novo' });
  assert.deepEqual(decideAlert({ ...base, price: 345 }), { send: true, level: 'dentro_da_margem', reason: 'novo' });
});

test('acima do teto não avisa e zera o estado', () => {
  assert.deepEqual(decideAlert({ ...base, price: 345.01 }), {
    send: false,
    reason: 'acima da margem',
    resetAlertState: true,
  });
});

test('não repete o aviso da mesma oferta', () => {
  const prev = { last_alerted_price: 290, last_alerted_at: '2026-11-21T12:00:00Z' };
  assert.deepEqual(decideAlert({ ...base, price: 290, prev }), {
    send: false,
    reason: 'já avisado',
    resetAlertState: false,
  });
  // queda pequena (<2%) não conta
  assert.equal(decideAlert({ ...base, price: 286, prev }).send, false);
});

test('reavisa quando o preço cai pelo menos 2%', () => {
  const prev = { last_alerted_price: 300, last_alerted_at: '2026-11-21T12:00:00Z' };
  assert.deepEqual(decideAlert({ ...base, price: 293, prev }), {
    send: true,
    level: 'abaixo_do_alvo',
    reason: 'preco_caiu',
  });
});

test('lembra depois de 7 dias se continua na faixa', () => {
  const prev = { last_alerted_price: 290, last_alerted_at: '2026-11-14T12:00:00Z' };
  assert.deepEqual(decideAlert({ ...base, price: 290, prev }), {
    send: true,
    level: 'abaixo_do_alvo',
    reason: 'lembrete',
  });
});

test('promoção que já terminou não avisa', () => {
  const d = decideAlert({ ...base, price: 250, endsAt: '2026-11-22T11:59:00Z' });
  assert.deepEqual(d, { send: false, reason: 'promoção encerrada', resetAlertState: true });
  assert.equal(decideAlert({ ...base, price: 250, endsAt: '2026-11-23T02:59:00Z' }).send, true);
});
