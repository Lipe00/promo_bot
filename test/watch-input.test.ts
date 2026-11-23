import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORE_ADAPTERS } from '../src/lib/stores/index.ts';
import type { Source } from '../src/lib/types.ts';
import { buildNewWatch, draftFromJson, patchFromJson } from '../src/lib/watch-input.ts';

const ctx = { builtins: STORE_ADAPTERS, sources: [] as Source[] };

test('produto: margem padrão 15%, apenas promoções, lojas validadas', () => {
  const r = buildNewWatch({ kind: 'produto', query: ' force one kabuto ', target: 300, margin: null, stores: ['kabum'], onlyDeals: true }, ctx);
  assert.ok(r.ok);
  assert.deepEqual(r.watch, {
    query: 'force one kabuto',
    target_price: 300,
    margin_pct: 15,
    kind: 'produto',
    category_url: null,
    stores: ['kabum'],
    only_deals: true,
  });
  assert.equal(buildNewWatch({ kind: 'produto', query: 'x y', target: 1, margin: null, stores: ['loja-x'] }, ctx).ok, false);
});

test('categoria: termo com teto (margem 0) e link só de loja conhecida', () => {
  const termo = buildNewWatch({ kind: 'categoria', query: 'rtx 4060', target: 2000, margin: null, stores: null }, ctx);
  assert.ok(termo.ok);
  assert.equal(termo.watch.margin_pct, 0);
  const link = buildNewWatch(
    { kind: 'categoria', query: 'https://www.kabum.com.br/hardware/placa-de-video-vga', target: 2000, margin: null, stores: ['amazon'] },
    ctx,
  );
  assert.ok(link.ok);
  assert.equal(link.watch.category_url, 'https://www.kabum.com.br/hardware/placa-de-video-vga');
  assert.equal(link.watch.stores, null); // link ignora lojas
  assert.equal(buildNewWatch({ kind: 'categoria', query: 'https://evil.example/x', target: 1, margin: null, stores: null }, ctx).ok, false);
  assert.equal(buildNewWatch({ kind: 'produto', query: 'https://www.kabum.com.br/x', target: 1, margin: null, stores: null }, ctx).ok, false);
});

test('erros: nome curto, só exclusões, preço e margem inválidos', () => {
  const base = { kind: 'produto' as const, stores: null };
  assert.equal(buildNewWatch({ ...base, query: 'x', target: 10, margin: null }, ctx).ok, false);
  assert.equal(buildNewWatch({ ...base, query: '-almofada', target: 10, margin: null }, ctx).ok, false);
  assert.equal(buildNewWatch({ ...base, query: 'kabuto', target: 0, margin: null }, ctx).ok, false);
  assert.equal(buildNewWatch({ ...base, query: 'kabuto', target: 10, margin: 150 }, ctx).ok, false);
});

test('draftFromJson (formulário do painel): aceita texto em reais e porcentagem', () => {
  const r = draftFromJson({ kind: 'produto', query: 'kabuto', target: '1.299,90', margin: '10%', stores: ['kabum'], onlyDeals: true });
  assert.deepEqual(r, { ok: true, draft: { kind: 'produto', query: 'kabuto', target: 1299.9, margin: 10, stores: ['kabum'], onlyDeals: true } });
  assert.equal(draftFromJson({ kind: 'outro', query: 'x', target: 1 }).ok, false);
  assert.equal(draftFromJson({ query: 'x', target: 'abc' }).ok, false);
  assert.equal(draftFromJson({ query: 'x', target: 1, stores: [1] }).ok, false);
  assert.equal(draftFromJson(null).ok, false);
});

test('patchFromJson (Configurar): só campos permitidos e válidos', () => {
  const r = patchFromJson({ target: '280', margin: 10, onlyDeals: false, active: false, stores: ['amazon'], chat_id: 1 }, ctx);
  assert.deepEqual(r, { ok: true, patch: { target_price: 280, margin_pct: 10, only_deals: false, active: false, stores: ['amazon'] } });
  assert.deepEqual(patchFromJson({ stores: null }, ctx), { ok: true, patch: { stores: null } });
  assert.equal(patchFromJson({}, ctx).ok, false);
  assert.equal(patchFromJson({ active: 'sim' }, ctx).ok, false);
  assert.equal(patchFromJson({ stores: ['xpto'] }, ctx).ok, false);
});
