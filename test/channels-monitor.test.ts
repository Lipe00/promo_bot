import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { addPublicChannel, accountChannelFromJson } from '../src/lib/channels/admin.ts';
import { MAX_COUPON_ALERTS_PER_RUN, matchPost, runChannels } from '../src/lib/channels/monitor.ts';
import { parsePost } from '../src/lib/channels/parse.ts';
import type { ChannelReader } from '../src/lib/channels/reader.ts';
import { linksFromTgMessage, makeUserbotReader } from '../src/lib/channels/userbot.ts';
import type { UserbotApi } from '../src/lib/channels/userbot.ts';
import type { RawPost, TgChannel, Watch } from '../src/lib/types.ts';
import { memoryDb, watch } from './helpers.ts';

const NOW = new Date('2026-11-24T15:00:00Z');
let msgId = 100;

function post(text: string, links: string[] = [], at = NOW): RawPost {
  msgId += 1;
  return { messageId: msgId, postedAt: at.toISOString(), text, links, postUrl: `https://t.me/canal/${msgId}` };
}

/** Leitor falso: devolve a fila de posts uma vez. */
function queueReader(queue: RawPost[][], title = 'Canal Teste'): ChannelReader & { calls: number } {
  const r = {
    calls: 0,
    async read(ch: TgChannel) {
      r.calls += 1;
      const posts = queue.shift() ?? [];
      const latest = posts.at(-1)?.messageId ?? ch.last_message_id ?? 1;
      return { title, posts: ch.last_message_id === null ? [] : posts, latestId: latest };
    },
  };
  return r;
}

async function setup(opts: { watches?: Watch[]; stores?: string[] } = {}) {
  const mem = memoryDb({ watches: opts.watches ?? [watch({ id: 1, query: 'force one kabuto', target_price: 300, margin_pct: 15 })], settings: { coupon_stores: opts.stores } });
  const ch = await mem.db.addChannel(99, { source: 'publico', username: 'canal', tg_id: null, access_hash: null, peer_type: 'channel', title: 'Canal Teste', last_message_id: 1 });
  const sent: string[] = [];
  return { ...mem, ch, sent, notify: async (_c: number, h: string) => void sent.push(h) };
}

test('primeiro acesso a um canal: só marca onde parou e não avisa nada', async () => {
  const { db, state, ch, sent, notify } = await setup();
  ch.last_message_id = null;
  const reader = queueReader([[post('Headset Force One Kabuto R$ 250 Cupom: KABU10', ['https://meli.la/x'])]]);
  const r = await runChannels({ db, readers: { publico: reader, conta: null }, notify, now: () => NOW });
  assert.equal(r.read, 1);
  assert.equal(sent.length, 0);
  assert.equal(state.posts.length, 0);
  assert.ok(state.channels[0]!.last_message_id! > 0);
});

test('post que bate com a busca e está no teto: avisa uma vez, com preço, cupom e links', async () => {
  const { db, state, sent, notify } = await setup();
  const p = post('➡️ Headset Gamer Force One Kabuto 7.1\n✅ R$ 259,90\n🏷 Cupom: KABUTO10\n🛒 https://meli.la/abc', ['https://meli.la/abc']);
  const reader = queueReader([[p], [p]]);
  const r = await runChannels({ db, readers: { publico: reader, conta: null }, notify, now: () => NOW });
  assert.equal(r.matches, 1);
  const alert = sent.find((s) => s.includes('Visto no canal'))!;
  assert.match(alert, /Headset Gamer Force One Kabuto 7\.1/);
  assert.match(alert, /R\$ 259,90/);
  assert.match(alert, /Cupom <code>KABUTO10<\/code>/);
  assert.match(alert, /href="https:\/\/meli\.la\/abc"/);
  assert.match(alert, /Ver post no canal/);
  assert.match(alert, /Busca #1/);
  assert.equal(state.matches[0]?.notified_at, NOW.toISOString());

  // Mesmo post de novo (ex.: rodada repetida): nada novo.
  const before = sent.length;
  await runChannels({ db, readers: { publico: reader, conta: null }, notify, now: () => NOW });
  assert.equal(sent.filter((s) => s.includes('Visto no canal')).length, 1);
  assert.ok(sent.length >= before);
});

test('teto, piso, sem preço e "apenas promoções"', () => {
  const w = watch({ id: 1, query: 'kabuto', target_price: 300, margin_pct: 10 });
  const p = (t: string) => parsePost(post(t));
  assert.equal(matchPost(p('Headset Kabuto R$ 320'), w).ok, true); // dentro de 330
  assert.equal(matchPost(p('Headset Kabuto R$ 350'), w).ok, false); // acima do teto
  assert.equal(matchPost(p('Almofada Kabuto R$ 39'), w).ok, false); // abaixo de 40% do alvo
  assert.deepEqual(matchPost(p('Headset Kabuto chegou!'), w), { ok: true, price: null }); // sem preço: avisa
  assert.equal(matchPost(p('Mouse Gamer R$ 100'), w).ok, false);
  const promo = { ...w, only_deals: true };
  assert.equal(matchPost(p('Headset Kabuto R$ 320'), promo).ok, false);
  assert.equal(matchPost(p('Headset Kabuto R$ 320\nCupom: KAB10'), promo).ok, true);
  assert.equal(matchPost(p('Headset Kabuto\nDe R$ 400 por R$ 320'), promo).ok, true);
  assert.equal(matchPost(p('Headset Force 1 Kabuto R$ 300'), watch({ query: 'force one kabuto' })).ok, true);
  assert.equal(matchPost(p('Headset Kabuto R$ 300'), { ...w, category_url: 'https://www.kabum.com.br/x' }).ok, false);
});

test('cupons: avisa na hora, um por um, só lojas marcadas, sem repetir; 7 dias depois avisa de novo', async () => {
  const { db, state, sent, notify } = await setup({ stores: ['mercadolivre', 'amazon'] });
  const day = 24 * 3600 * 1000;
  const reader = queueReader([
    [
      post('Monitor X\n✅ R$ 873\n🏷 Cupom: DESCONTOSMELI\n🛒 https://meli.la/1', ['https://meli.la/1']),
      post('Outro monitor\n✅ R$ 900\n🏷 Cupom: DESCONTOSMELI\n🛒 https://meli.la/2', ['https://meli.la/2']),
      post('Fone\n✅ R$ 50\n🎟️ Cupom: SHOPEE20\nhttps://s.shopee.com.br/z', ['https://s.shopee.com.br/z']),
    ],
    [post('Monitor Y\nCupom: DESCONTOSMELI\nhttps://meli.la/3', ['https://meli.la/3'])],
    [post('Monitor Z\nCupom: DESCONTOSMELI\nhttps://meli.la/4', ['https://meli.la/4'])],
  ]);
  const run = (now: Date) => runChannels({ db, readers: { publico: reader, conta: null }, notify, now: () => now });

  await run(NOW);
  const couponMsgs = () => sent.filter((s) => s.includes('🎟️ Cupom') && !s.includes('Visto no canal'));
  assert.equal(couponMsgs().length, 1); // DESCONTOSMELI uma vez; Shopee não está marcada
  assert.match(couponMsgs()[0]!, /Cupom Mercado Livre: <code>DESCONTOSMELI<\/code>/);
  assert.equal(state.coupons.length, 2); // o da Shopee fica salvo para o site
  assert.ok(state.coupons.find((c) => c.code === 'SHOPEE20')?.notified_at === null);

  await run(new Date(NOW.getTime() + 2 * day)); // reaparece 2 dias depois: não avisa
  assert.equal(couponMsgs().length, 1);
  await run(new Date(NOW.getTime() + 10 * day)); // sumiu por mais de 7 dias e voltou: avisa
  assert.equal(couponMsgs().length, 2);
});

test(`no máximo ${MAX_COUPON_ALERTS_PER_RUN} avisos de cupom por rodada; o resto vira um resumo`, async () => {
  const { db, sent, notify } = await setup();
  const many = Array.from({ length: 14 }, (_, i) => post(`Item ${i}\nCupom: CODIGO${i}A\nhttps://meli.la/${i}`, [`https://meli.la/${i}`]));
  await runChannels({ db, readers: { publico: queueReader([many]), conta: null }, notify, now: () => NOW });
  assert.equal(sent.filter((s) => s.startsWith('<b>🎟️ Cupom')).length, MAX_COUPON_ALERTS_PER_RUN);
  assert.ok(sent.some((s) => s.includes('+4 cupom(ns) novo(s)')));
});

test('loja escondida em encurtador: só segue o link quando o post interessa', async () => {
  const { db, state, notify } = await setup();
  const resolved: string[] = [];
  const resolveLink = async (u: string) => {
    resolved.push(u);
    return { store: 'amazon', finalUrl: 'https://www.amazon.com.br/dp/X' };
  };
  const reader = queueReader([
    [post('Notícia qualquer\nhttps://bit.ly/a', ['https://bit.ly/a']), post('Teclado\nCupom: TECLA15\nhttps://bit.ly/b', ['https://bit.ly/b'])],
  ]);
  await runChannels({ db, readers: { publico: reader, conta: null }, notify, now: () => NOW, resolveLink });
  assert.deepEqual(resolved, ['https://bit.ly/b']);
  assert.equal(state.coupons[0]?.store, 'amazon');
});

test('posts com mais de 48h são apagados; os cupons continuam com o próprio resumo', async () => {
  const { db, state, notify } = await setup();
  const old = new Date(NOW.getTime() - 50 * 3600 * 1000);
  const reader = queueReader([[post('Velho\nCupom: VELHO10\nhttps://meli.la/v', ['https://meli.la/v'], old), post('Novo\nR$ 10', [], NOW)]]);
  await runChannels({ db, readers: { publico: reader, conta: null }, notify, now: () => NOW });
  assert.deepEqual(state.posts.map((p) => p.title), ['Novo']);
  const c = state.coupons.find((x) => x.code === 'VELHO10')!;
  assert.match(c.description, /Velho/);
  assert.equal(c.channel_title, 'Canal Teste');
});

test('erros de leitura ficam no canal; canal da conta sem userbot avisa o motivo', async () => {
  const { db, state, notify } = await setup();
  await db.addChannel(99, { source: 'conta', username: null, tg_id: 555, access_hash: '1', peer_type: 'channel', title: 'Privado', last_message_id: 5 });
  const broken: ChannelReader = { read: async () => ({ error: 'HTTP 403', posts: [], latestId: null }) };
  const r = await runChannels({ db, readers: { publico: broken, conta: null }, notify, now: () => NOW });
  assert.equal(r.errors.length, 2);
  assert.equal(state.channels.find((c) => c.title === 'Canal Teste')?.last_error, 'HTTP 403');
  assert.match(state.channels.find((c) => c.title === 'Privado')?.last_error ?? '', /conta do Telegram não conectada/);
});

test('userbot (cliente falso): primeiro acesso, novas mensagens em ordem, link de post privado e FLOOD_WAIT', async () => {
  const calls: { minId: number | null; limit: number }[] = [];
  let fail = false;
  const api: UserbotApi = {
    dialogs: async () => [],
    messages: async (_peer, opts) => {
      calls.push(opts);
      if (fail) throw Object.assign(new Error('A wait of 30 seconds is required'), { seconds: 30, errorMessage: 'FLOOD' });
      return [
        { id: 12, date: 1795600000, text: 'B', links: [] },
        { id: 11, date: 1795599000, text: 'A', links: ['https://meli.la/a'] },
      ];
    },
    close: async () => {},
  };
  const reader = makeUserbotReader(api);
  const ch: TgChannel = { id: 1, chat_id: 1, source: 'conta', username: null, tg_id: 1285219059, access_hash: '123', peer_type: 'channel', title: 'Priv', enabled: true, last_message_id: null, last_checked_at: null, last_error: null };

  const first = await reader.read(ch);
  assert.deepEqual(first, { posts: [], latestId: 12 });
  assert.deepEqual(calls[0], { minId: null, limit: 1 });

  const next = await reader.read({ ...ch, last_message_id: 10 });
  assert.deepEqual(next.posts.map((p) => p.messageId), [11, 12]);
  assert.equal(next.posts[0]?.postUrl, 'https://t.me/c/1285219059/11');
  assert.deepEqual(calls[1], { minId: 10, limit: 50 });

  fail = true;
  assert.match((await reader.read({ ...ch, last_message_id: 10 })).error ?? '', /esperar 30s \(FLOOD_WAIT\)/);
  assert.match((await reader.read({ ...ch, tg_id: null })).error ?? '', /sem id/);
});

test('links de mensagens do Telegram: texto com link escondido, URL no texto, botões e prévia', () => {
  const links = linksFromTgMessage({
    message: 'Oferta aqui meli.la/xyz e mais',
    entities: [
      { className: 'MessageEntityTextUrl', offset: 0, length: 6, url: 'https://amzn.to/abc' },
      { className: 'MessageEntityUrl', offset: 12, length: 11 },
    ],
    replyMarkup: { rows: [{ buttons: [{ url: 'https://s.shopee.com.br/q' }, { text: 'sem link' }] }] },
    media: { webpage: { url: 'https://www.kabum.com.br/produto/1' } },
  });
  assert.deepEqual(links, ['https://amzn.to/abc', 'https://meli.la/xyz', 'https://s.shopee.com.br/q', 'https://www.kabum.com.br/produto/1']);
});

test('cadastro de canal público confere na hora e já marca a última mensagem lida', async () => {
  const page = readFileSync(new URL('./fixtures/tg-canal-publico.html', import.meta.url), 'utf8');
  const { db } = memoryDb();
  const env = { fetchHtml: async (u: string) => ({ kind: 'ok' as const, html: page, finalUrl: u }) };
  const r = await addPublicChannel(db, 7, 't.me/promobit', env);
  assert.ok(r.ok);
  assert.equal(r.channel.title, 'OFERTAS PC GAMER PEÇAS HARDWARE');
  assert.ok((r.channel.last_message_id ?? 0) > 30000);
  assert.equal((await addPublicChannel(db, 7, '@promobit', env)).ok, false); // duplicado
  assert.equal((await addPublicChannel(db, 7, 'https://t.me/+convite', env)).ok, false);
  const down = await addPublicChannel(db, 7, '@outro_canal', { fetchHtml: async () => ({ kind: 'error' as const, message: 'falha de rede' }) });
  assert.ok(!down.ok && /falha de rede/.test(down.error));

  assert.ok(accountChannelFromJson({ tgId: 123, accessHash: '-456', peerType: 'channel', title: 'X' }).ok);
  assert.equal(accountChannelFromJson({ tgId: 123, accessHash: 'abc', peerType: 'channel' }).ok, false);
  assert.equal(accountChannelFromJson({ tgId: 123, peerType: 'channel' }).ok, false);
  assert.ok(accountChannelFromJson({ tgId: 123, peerType: 'chat' }).ok);
});
