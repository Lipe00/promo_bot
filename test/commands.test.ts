import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleCommand, parseAddArgs, parseCep, parseMargin, parseStoreList, resolveStore } from '../src/lib/commands.ts';
import { STORE_ADAPTERS } from '../src/lib/stores/index.ts';
import { memoryDb } from './helpers.ts';

function setup(chatId = 7) {
  const { db, state } = memoryDb();
  return { db, state, ctx: { db, chatId, builtins: STORE_ADAPTERS, secrets: {} } };
}

test('parseAddArgs: formato com barras e formato corrido', () => {
  assert.deepEqual(parseAddArgs('FORCE ONE KABUTO | 300 | 15'), {
    ok: true,
    query: 'FORCE ONE KABUTO',
    target: 300,
    margin: 15,
    stores: null,
  });
  assert.deepEqual(parseAddArgs('force one kabuto 300'), { ok: true, query: 'force one kabuto', target: 300, margin: null, stores: null });
  assert.deepEqual(parseAddArgs('force one kabuto R$ 299,90 10%'), {
    ok: true,
    query: 'force one kabuto',
    target: 299.9,
    margin: 10,
    stores: null,
  });
  assert.deepEqual(parseAddArgs('kabuto -almofada | 1.299,90'), {
    ok: true,
    query: 'kabuto -almofada',
    target: 1299.9,
    margin: null,
    stores: null,
  });
});

test('parseAddArgs: 4º campo limita as lojas; em categoria o 3º pode ser a lista', () => {
  const r = parseAddArgs('kabuto | 300 | 10 | KaBuM, mercado livre, ali');
  assert.ok(r.ok);
  assert.deepEqual(r.stores, ['kabum', 'mercadolivre', 'aliexpress']);
  const c = parseAddArgs('rtx 4060 | 2000 | kabum,amazon');
  assert.ok(c.ok);
  assert.equal(c.margin, null);
  assert.deepEqual(c.stores, ['kabum', 'amazon']);
  assert.equal(parseAddArgs('kabuto | 300 | 10 | lojaquenaoexiste').ok, false);
});

test('parseAddArgs: erros', () => {
  assert.equal(parseAddArgs('').ok, false);
  assert.equal(parseAddArgs('kabuto').ok, false);
  assert.equal(parseAddArgs('| 300').ok, false);
  assert.equal(parseAddArgs('kabuto | abc').ok, false);
  assert.equal(parseAddArgs('kabuto | 300 | 150').ok, false);
});

test('parseMargin, parseCep, resolveStore, parseStoreList', () => {
  assert.equal(parseMargin('15%'), 15);
  assert.equal(parseMargin('12,5'), 12.5);
  assert.equal(parseMargin('101'), null);
  assert.equal(parseMargin(''), null);
  assert.equal(parseCep('16010000'), '16010-000');
  assert.equal(parseCep('16010-000'), '16010-000');
  assert.equal(parseCep('1601'), null);
  assert.equal(resolveStore('Mercado Livre'), 'mercadolivre');
  assert.equal(resolveStore('KaBuM!'), 'kabum');
  assert.equal(resolveStore('ml'), 'mercadolivre');
  assert.equal(resolveStore('xpto'), null);
  assert.deepEqual(parseStoreList('todas'), { ok: true, stores: null });
  assert.deepEqual(parseStoreList('kabum, #12'), { ok: true, stores: ['kabum', 'custom:12'] });
});

test('fluxo de comandos: add, lista, preco, margem, pausar, remover', async () => {
  const { ctx, state } = setup();

  const added = await handleCommand('/add force one kabuto | 300 | 15', ctx);
  assert.match(added.reply, /Busca #1 criada/);
  assert.match(added.reply, /R\$ 345,00/);
  assert.equal(state.watches[0]?.kind, 'produto');

  assert.match((await handleCommand('/lista', ctx)).reply, /#1 ✅ <b>force one kabuto<\/b>/);

  await handleCommand('/preco 1 280', ctx);
  await handleCommand('/margem 1 10', ctx);
  assert.equal(state.watches[0]?.target_price, 280);
  assert.equal(state.watches[0]?.margin_pct, 10);

  assert.match((await handleCommand('/pausar 1', ctx)).reply, /Pausada/);
  assert.equal(state.watches[0]?.active, false);
  assert.match((await handleCommand('/ativar 1', ctx)).reply, /Ativada/);

  assert.match((await handleCommand('/remover 1', ctx)).reply, /removida/);
  assert.match((await handleCommand('/remover 1', ctx)).reply, /Não achei/);
});

test('margem padrão de 15% quando não informada; /add com link sugere /categoria', async () => {
  const { ctx, state } = setup(1);
  await handleCommand('/add@MeuBot headset teste 200', ctx);
  assert.equal(state.watches[0]?.margin_pct, 15);
  assert.match((await handleCommand('/add https://www.kabum.com.br/x | 100', ctx)).reply, /\/categoria/);
});

test('/categoria por termo: teto sem margem, lojas opcionais', async () => {
  const { ctx, state } = setup();
  const r = await handleCommand('/categoria placa de video rtx 4060 | 2000 | kabum,amazon', ctx);
  assert.match(r.reply, /Categoria #1 criada/);
  assert.match(r.reply, /R\$ 2\.000,00/);
  const w = state.watches[0]!;
  assert.equal(w.kind, 'categoria');
  assert.equal(w.margin_pct, 0);
  assert.equal(w.category_url, null);
  assert.deepEqual(w.stores, ['kabum', 'amazon']);
  assert.match((await handleCommand('/lista', ctx)).reply, /📦 <b>placa de video rtx 4060<\/b> — até R\$ 2\.000,00/);
});

test('/categoria por link: só aceita loja cadastrada', async () => {
  const { ctx, state } = setup();
  const ok = await handleCommand('/categoria https://www.kabum.com.br/hardware/placa-de-video-vga | 2000', ctx);
  assert.match(ok.reply, /kabum\.com\.br\/hardware\/placa-de-video-vga/);
  assert.equal(state.watches[0]?.category_url, 'https://www.kabum.com.br/hardware/placa-de-video-vga');

  const bad = await handleCommand('/categoria https://evil.example/ofertas | 2000', ctx);
  assert.match(bad.reply, /não é de uma loja cadastrada/);
  const http = await handleCommand('/categoria http://www.kabum.com.br/x | 2000', ctx);
  assert.match(http.reply, /não é de uma loja cadastrada/);
  assert.equal(state.watches.length, 1);
});

test('/lojas: lista, desliga e liga; mostra quem usa API', async () => {
  const { ctx, db } = setup();
  const list = await handleCommand('/lojas', { ...ctx, secrets: { ML_CLIENT_ID: 'a', ML_CLIENT_SECRET: 'b' } });
  assert.match(list.reply, /Mercado Livre — API oficial/);
  assert.match(list.reply, /Shopee — sem chave/);
  assert.match(list.reply, /KaBuM! — página da loja/);

  assert.match((await handleCommand('/lojas off amazon', ctx)).reply, /Desligada: Amazon/);
  assert.equal((await db.listSources(7)).find((s) => s.store_id === 'amazon')?.enabled, false);
  assert.match((await handleCommand('/lojas', ctx)).reply, /⏸️ Amazon/);
  assert.match((await handleCommand('/lojas on amazon', ctx)).reply, /Ligada: Amazon/);
  assert.equal((await db.listSources(7)).find((s) => s.store_id === 'amazon')?.enabled, true);
  assert.match((await handleCommand('/lojas off xpto', ctx)).reply, /Use: \/lojas off nome/);
});

test('/fonte add valida o link e pede um teste; /fonte remover', async () => {
  const { ctx, state } = setup();
  assert.match((await handleCommand('/fonte add Loja | https://loja.com.br/busca', ctx)).reply, /\{q\}/);
  assert.match((await handleCommand('/fonte add Loja | http://loja.com.br/b?q={q}', ctx)).reply, /https/);
  assert.match((await handleCommand('/fonte add Loja | https://127.0.0.1/b?q={q}', ctx)).reply, /local/);

  const r = await handleCommand('/fonte add Loja X | https://www.lojax.com.br/busca?q={q} | monitor', ctx);
  assert.match(r.reply, /Fonte #\d+ cadastrada: <b>Loja X<\/b> \(lojax\.com\.br\)/);
  const src = state.sources[0]!;
  assert.deepEqual(src.domains, ['lojax.com.br']);
  assert.deepEqual(r.action, { type: 'test-source', sourceId: src.id, query: 'monitor' });
  assert.match((await handleCommand('/lojas', ctx)).reply, /Fontes cadastradas[\s\S]*Loja X/);

  assert.match((await handleCommand(`/fonte remover ${src.id}`, ctx)).reply, /removida/);
  assert.equal(state.sources.length, 0);
});

test('/frete muda o modo de comparação', async () => {
  const { ctx, db } = setup();
  assert.match((await handleCommand('/frete', ctx)).reply, /Modo atual: <b>total<\/b>/);
  assert.match((await handleCommand('/frete produto', ctx)).reply, /só o preço/);
  assert.equal((await db.getSettings(7)).freight_mode, 'produto');
  assert.match((await handleCommand('/frete xyz', ctx)).reply, /Use/);
});

test('uma conta não mexe nas buscas de outra', async () => {
  const { db } = memoryDb();
  await handleCommand('/add kabuto | 300', { db, chatId: 1 });
  assert.match((await handleCommand('/remover 1', { db, chatId: 2 })).reply, /Não achei/);
  assert.equal((await db.listWatches(1)).length, 1);
});

test('cep, checar, testar e comandos desconhecidos', async () => {
  const { ctx, db } = setup(1);
  assert.match((await handleCommand('/cep', ctx)).reply, /Nenhum CEP/);
  assert.match((await handleCommand('/cep 16010000', ctx)).reply, /16010-000/);
  assert.equal(await db.getCep(1), '16010-000');
  assert.match((await handleCommand('/cep 123', ctx)).reply, /inválido/);

  assert.deepEqual((await handleCommand('/checar', ctx)).action, { type: 'check' });
  assert.deepEqual((await handleCommand('/testar force one', ctx)).action, { type: 'test', query: 'force one' });
  assert.equal((await handleCommand('/testar', ctx)).action, undefined);

  assert.match((await handleCommand('/xyz', ctx)).reply, /desconhecido/);
  assert.match((await handleCommand('oi', ctx)).reply, /\/ajuda/);
  assert.match((await handleCommand('/lojas', ctx)).reply, /KaBuM!/);
  assert.match((await handleCommand('/ajuda', ctx)).reply, /\/categoria/);
});

test('texto do usuário é escapado nas respostas', async () => {
  const { ctx } = setup(1);
  const r = await handleCommand('/add <b>x</b> | 100', ctx);
  assert.doesNotMatch(r.reply, /<b>x<\/b>/);
  assert.match(r.reply, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('/promo liga e desliga "apenas promoções"; /lista mostra o selo', async () => {
  const { ctx, state } = setup();
  await handleCommand('/add kabuto | 300', ctx);
  assert.match((await handleCommand('/promo 1', ctx)).reply, /só aviso ofertas com preço de\/por/);
  assert.equal(state.watches[0]?.only_deals, true);
  assert.match((await handleCommand('/lista', ctx)).reply, /🏷️ só promoções/);
  assert.match((await handleCommand('/promo 1', ctx)).reply, /qualquer oferta/);
  assert.equal(state.watches[0]?.only_deals, false);
  assert.match((await handleCommand('/promo 99', ctx)).reply, /Não achei/);
});

test('/canais, /canal add (vira ação), /canal remover e /cupons', async () => {
  const { ctx, db } = setup();
  assert.match((await handleCommand('/canais', ctx)).reply, /Nenhum canal/);
  assert.deepEqual((await handleCommand('/canal add @promobit', ctx)).action, { type: 'add-channel', input: '@promobit' });
  const ch = await db.addChannel(7, { source: 'publico', username: 'promobit', tg_id: null, access_hash: null, peer_type: 'channel', title: 'Ofertas PC' });
  assert.match((await handleCommand('/canais', ctx)).reply, new RegExp(`#${ch.id} ⏳?.*Ofertas PC|#${ch.id} ✅ Ofertas PC`));
  assert.match((await handleCommand(`/canal remover ${ch.id}`, ctx)).reply, /removido/);
  assert.match((await handleCommand('/canal', ctx)).reply, /Use: \/canal add/);
  assert.match((await handleCommand('/cupons', ctx)).reply, /Nenhum cupom/);
  await db.upsertCoupon({ chat_id: 7, store: 'mercadolivre', code: 'MELI10', description: 'x', discount: '10% OFF', channel_title: 'c', offer_url: null, post_url: null, seen_at: '2026-11-24T00:00:00Z' });
  assert.match((await handleCommand('/cupons', ctx)).reply, /<code>MELI10<\/code> · Mercado Livre · 10% OFF/);
});
