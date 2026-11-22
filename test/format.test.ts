import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAlertMessage, buildStatusMessage, escapeHtml, formatDateTimeBR, splitMessage } from '../src/lib/format.ts';
import type { Watch } from '../src/lib/types.ts';

const watch: Watch = {
  id: 3,
  chat_id: 1,
  query: 'force one kabuto',
  target_price: 300,
  margin_pct: 15,
  active: true,
  created_at: '2026-11-22T00:00:00Z',
};

test('formatDateTimeBR usa horário de Brasília', () => {
  assert.equal(formatDateTimeBR('2026-11-28T02:59:59Z'), '27/11 às 23:59');
  assert.equal(formatDateTimeBR('2026-11-27T03:00:00Z'), '27/11 às 00:00');
});

test('alerta completo: preço, Pix, prazo da promoção, CEP e link escapado', () => {
  const msg = buildAlertMessage({
    watch,
    storeName: 'Pichau',
    offer: {
      title: 'Headset <Kabuto> & cia',
      url: 'https://www.pichau.com.br/produto?a=1&b="2"',
      price: 305.87,
      cashPrice: 259.99,
      regularPrice: 576.46,
      endsAt: '2026-11-28T02:59:59Z',
    },
    level: 'abaixo_do_alvo',
    reason: 'novo',
    cep: '16010-000',
  });
  assert.match(msg, /Achei abaixo do seu preço/);
  assert.match(msg, /Headset &lt;Kabuto&gt; &amp; cia/);
  assert.match(msg, /R\$ 305,87 · à vista\/Pix R\$ 259,99/);
  assert.match(msg, /de R\$ 576,46/);
  assert.match(msg, /alvo R\$ 300,00 \(\+15% = até R\$ 345,00\)/);
  assert.match(msg, /Promoção até 27\/11 às 23:59/);
  assert.match(msg, /CEP 16010-000/);
  assert.match(msg, /href="https:\/\/www\.pichau\.com\.br\/produto\?a=1&amp;b=&quot;2&quot;"/);
});

test('alerta sem fim de promoção não inventa prazo; frete informado pela loja aparece', () => {
  const msg = buildAlertMessage({
    watch,
    storeName: 'Kabum',
    offer: { title: 'Kabuto', url: 'https://www.kabum.com.br/p/1', price: 330, freightNote: 'frete grátis informado pela loja' },
    level: 'dentro_da_margem',
    reason: 'preco_caiu',
    cep: null,
  });
  assert.doesNotMatch(msg, /Promoção até/);
  assert.match(msg, /dentro da sua margem/);
  assert.match(msg, /caiu desde o último aviso/);
  assert.match(msg, /frete grátis informado pela loja/);
});

test('status e quebra de mensagens longas', () => {
  assert.match(buildStatusMessage([]), /Ainda não rodei/);
  const msg = buildStatusMessage([
    { store: 'kabum', status: 'blocked', message: 'HTTP 403', items_found: 0, checked_at: '2026-11-22T12:00:00Z' },
  ]);
  assert.match(msg, /⛔ <b>KaBuM!<\/b>: HTTP 403/);
  assert.match(msg, /Pichau: sem dados/);

  const long = Array.from({ length: 300 }, (_, i) => `linha ${i} ${'x'.repeat(30)}`).join('\n');
  const chunks = splitMessage(long, 1000);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 1000));
  assert.equal(chunks.join('\n'), long);
  assert.equal(escapeHtml('<&>'), '&lt;&amp;&gt;');
});
