// Parser de posts e leitor de canais públicos contra uma página REAL de canal (t.me/s/promobit,
// capturada em 24/11/2026 e reduzida com scripts/make-tg-fixture.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { couponsOf, isSafePublicUrl, offerLinks, parsePost, pricesOf, resolveStoreLink, storeFromUrl, titleOf } from '../src/lib/channels/parse.ts';
import { makePreviewReader, normalizeChannelUsername, parsePreviewPage } from '../src/lib/channels/preview.ts';
import type { AdapterEnv, FetchOutcome, TgChannel } from '../src/lib/types.ts';

const page = readFileSync(new URL('./fixtures/tg-canal-publico.html', import.meta.url), 'utf8');

test('página pública real: 12 mensagens, título, nome canônico, links reais e datas', () => {
  const p = parsePreviewPage(page);
  assert.equal(p.title, 'OFERTAS PC GAMER PEÇAS HARDWARE');
  assert.equal(p.username, 'ofertasdecomputador'); // @promobit aponta para este canal
  assert.equal(p.posts.length, 12);
  const ids = p.posts.map((x) => x.messageId);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  const tcl = p.posts.find((x) => x.text.includes('Tcl 25'))!;
  assert.ok(tcl.links.includes('https://meli.la/1y1PuUj'));
  assert.match(tcl.postUrl!, /^https:\/\/t\.me\/ofertasdecomputador\/\d+$/);
  assert.match(tcl.postedAt, /^2026-11-24T/);
  assert.match(tcl.text, /\n/); // <br> vira quebra de linha
});

test('posts reais interpretados: título, preço, cupom, loja e link da oferta (rodapé ignorado)', () => {
  const posts = parsePreviewPage(page).posts.map(parsePost);
  const tcl = posts.find((x) => x.title.startsWith('Monitor Gamer Tcl'))!;
  assert.equal(tcl.price, 873);
  assert.deepEqual(tcl.coupons, [{ code: 'DESCONTOSMELI', discount: null }]);
  assert.equal(tcl.store, 'mercadolivre');
  assert.equal(tcl.offerUrl, 'https://meli.la/1y1PuUj');
  assert.ok(!tcl.title.startsWith('➡'));

  const cooler = posts.find((x) => x.title.startsWith('Air Cooler'))!;
  assert.equal(cooler.price, 126);
  assert.equal(cooler.store, 'amazon'); // link.amazon
  assert.deepEqual(cooler.coupons, []);

  const pc = posts.find((x) => x.title.includes('PC Gamer KaBuM'))!;
  assert.equal(pc.price, 1389);
  assert.equal(pc.coupons[0]?.code, 'X1PCAMD500');
  assert.equal(pc.store, 'kabum'); // pela palavra no título; o link é um encurtador (ofertou.ai)

  // Nenhum post usa o link de divulgação do canal como oferta.
  assert.ok(posts.every((x) => !x.offerUrl?.includes('nerdofertas.com')));
  const codes = new Set(posts.flatMap((x) => x.coupons.map((c) => c.code)));
  assert.deepEqual([...codes].sort(), ['1124MAISME', 'DESCONTOSMELI', 'TODO2411SITE', 'X1PCAMD500']);
});

test('preços: de/por, parcelas, frete, desconto do cupom e mínimo não viram o preço', () => {
  assert.deepEqual(pricesOf('Headset X\nDe R$ 499,90 por R$ 299,90'), { price: 299.9, regularPrice: 499.9 });
  assert.equal(pricesOf('Mouse\n10x de R$ 15,90\n✅ R$ 159').price, 159);
  assert.equal(pricesOf('Cupom de R$ 50 OFF acima de R$ 300\nSSD 1TB R$ 349').price, 349);
  assert.equal(pricesOf('Frete grátis! frete R$ 9,90 · Teclado R$ 199,00').price, 199);
  assert.equal(pricesOf('Sem preço aqui').price, null);
});

test('cupons: formatos comuns, desconto e mínimo; palavras comuns não viram código', () => {
  assert.deepEqual(couponsOf('🎟️ CUPOM: SHOPEE50\nR$ 50 OFF acima de R$ 300'), [{ code: 'SHOPEE50', discount: 'R$ 50 OFF acima de R$ 300' }]);
  assert.deepEqual(couponsOf('Use o cupom MELI10 e ganhe 10% OFF'), [{ code: 'MELI10', discount: '10% OFF' }]);
  assert.deepEqual(couponsOf('código promocional: PRIME25'), [{ code: 'PRIME25', discount: null }]);
  assert.deepEqual(couponsOf('Cupom aplicado automaticamente no carrinho'), []);
  assert.deepEqual(couponsOf('cupom: desconto no app'), []);
  assert.deepEqual(couponsOf('Cupom: 12345'), []); // só números
  assert.equal(couponsOf('Cupom: ABC1\nCupom: ABC1').length, 1);
});

test('loja pelo link, links de rodapé e título', () => {
  assert.equal(storeFromUrl('https://s.shopee.com.br/abc'), 'shopee');
  assert.equal(storeFromUrl('https://amzn.to/xyz'), 'amazon');
  assert.equal(storeFromUrl('https://s.click.aliexpress.com/e/_x'), 'aliexpress');
  assert.equal(storeFromUrl('https://bit.ly/x'), null);
  const text = 'Produto\n🛒 https://meli.la/a\nEntre no grupo: https://chat.whatsapp.com/xyz\nhttps://t.me/canal';
  assert.deepEqual(offerLinks(text, ['https://meli.la/a', 'https://chat.whatsapp.com/xyz', 'https://t.me/canal']), ['https://meli.la/a']);
  assert.equal(titleOf('🔥🔥 ➡️  Headset Kabuto RGB\n✅ R$ 1'), 'Headset Kabuto RGB');
});

test('encurtador desconhecido: segue redirecionamentos só para endereços públicos', async () => {
  const hops: Record<string, string> = { 'https://bit.ly/x': 'https://tidd.ly/y', 'https://tidd.ly/y': 'https://www.amazon.com.br/dp/B1' };
  const fakeFetch = (async (url: string) =>
    new Response(null, { status: hops[url] ? 302 : 200, headers: hops[url] ? { location: hops[url] } : {} })) as typeof fetch;
  assert.deepEqual(await resolveStoreLink('https://bit.ly/x', fakeFetch), { store: 'amazon', finalUrl: 'https://www.amazon.com.br/dp/B1' });
  assert.equal(isSafePublicUrl('http://127.0.0.1/admin'), false);
  assert.equal(isSafePublicUrl('http://localhost:3000'), false);
  assert.equal(isSafePublicUrl('https://exemplo.com:8443/x'), false);
  assert.equal(isSafePublicUrl('https://bit.ly/x'), true);
  let called = false;
  await resolveStoreLink('http://10.0.0.1/x', (async () => {
    called = true;
    return new Response(null);
  }) as typeof fetch);
  assert.equal(called, false);
});

test('nome do canal: @, link, t.me/s/ e inválidos', () => {
  assert.equal(normalizeChannelUsername('@promobit'), 'promobit');
  assert.equal(normalizeChannelUsername('https://t.me/s/promobit?before=10'), 'promobit');
  assert.equal(normalizeChannelUsername('t.me/promobit'), 'promobit');
  assert.equal(normalizeChannelUsername('https://t.me/+AbCdEf123'), null); // convite privado
  assert.equal(normalizeChannelUsername('ab'), null);
});

function channel(p: Partial<TgChannel> = {}): TgChannel {
  return {
    id: 1, chat_id: 1, source: 'publico', username: 'promobit', tg_id: null, access_hash: null, peer_type: 'channel',
    title: '', enabled: true, last_message_id: null, last_checked_at: null, last_error: null, ...p,
  };
}

test('leitor público: primeiro acesso só marca onde parou; depois devolve só as novas, paginando para trás', async () => {
  const ids = parsePreviewPage(page).posts.map((p) => p.messageId);
  const requested: string[] = [];
  const env: AdapterEnv = {
    fetchHtml: async (url): Promise<FetchOutcome> => {
      requested.push(url);
      // A segunda página (?before=) não tem nada mais antigo que interesse.
      return { kind: 'ok', html: url.includes('before=') ? '<html></html>' : page, finalUrl: url };
    },
  };
  const reader = makePreviewReader(env);

  const first = await reader.read(channel());
  assert.equal(first.latestId, Math.max(...ids));
  assert.deepEqual(first.posts, []);
  assert.equal(first.title, 'OFERTAS PC GAMER PEÇAS HARDWARE');
  assert.deepEqual(requested, ['https://t.me/s/promobit']);

  const next = await reader.read(channel({ last_message_id: ids[8]! }));
  assert.deepEqual(next.posts.map((p) => p.messageId), ids.slice(9));

  requested.length = 0;
  await reader.read(channel({ last_message_id: ids[0]! - 50 })); // muito atrás: busca páginas anteriores
  assert.ok(requested.some((u) => u.includes(`before=${ids[0]}`)));

  const priv = await reader.read(channel({ username: null }));
  assert.match(priv.error ?? '', /privado/);
  const gone = await makePreviewReader({ fetchHtml: async (u) => ({ kind: 'ok', html: '<html>nada</html>', finalUrl: u }) }).read(channel());
  assert.match(gone.error ?? '', /não encontrado/);
});
