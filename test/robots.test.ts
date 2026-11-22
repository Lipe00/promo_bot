import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { checkRobots, clearRobotsCache, isPathAllowed, parseRobots } from '../src/lib/robots.ts';

const SAMPLE = `
# exemplo
User-agent: *
Disallow: /checkout
Disallow: /busca?
Disallow: /*.json$
Allow: /busca?q=liberado

User-agent: promo-bot
Disallow: /privado

Sitemap: https://loja.example/sitemap.xml
`;

test('parseRobots escolhe o grupo do nosso robô quando existe', () => {
  const rules = parseRobots(SAMPLE, 'promo-bot');
  assert.deepEqual(rules.disallow, ['/privado']);
  assert.equal(isPathAllowed(rules, '/busca?q=x'), true);
  assert.equal(isPathAllowed(rules, '/privado/a'), false);
});

test('parseRobots cai no grupo * e aplica curinga, âncora e regra mais longa', () => {
  const rules = parseRobots(SAMPLE, 'outro-robo');
  assert.equal(isPathAllowed(rules, '/checkout/pagamento'), false);
  assert.equal(isPathAllowed(rules, '/busca?q=kabuto'), false);
  assert.equal(isPathAllowed(rules, '/busca?q=liberado'), true); // Allow mais longo vence
  assert.equal(isPathAllowed(rules, '/dados/x.json'), false);
  assert.equal(isPathAllowed(rules, '/dados/x.json.bak'), true); // "$" ancora o fim
  assert.equal(isPathAllowed(rules, '/produto/123'), true);
});

test('grupos com vários User-agent seguidos compartilham as regras', () => {
  const rules = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x\n', 'b');
  assert.equal(isPathAllowed(rules, '/x/y'), false);
});

test('Disallow vazio não proíbe nada', () => {
  const rules = parseRobots('User-agent: *\nDisallow:\n', 'promo-bot');
  assert.equal(isPathAllowed(rules, '/qualquer'), true);
});

function fakeFetch(status: number, body = ''): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

const opts = { agent: 'promo-bot', userAgent: 'test' };

beforeEach(() => clearRobotsCache());

test('checkRobots libera quando o robots.txt permite', async () => {
  const r = await checkRobots('https://loja.example/produto/1', {
    ...opts,
    fetchFn: fakeFetch(200, 'User-agent: *\nDisallow: /admin\n'),
  });
  assert.equal(r.allowed, true);
});

test('checkRobots bloqueia quando o robots.txt proíbe', async () => {
  const r = await checkRobots('https://loja.example/search?q=x', {
    ...opts,
    fetchFn: fakeFetch(200, 'User-agent: *\nDisallow: /search\n'),
  });
  assert.equal(r.allowed, false);
  assert.match(r.reason ?? '', /robots/);
});

test('checkRobots: 404 = sem regras; 500 e erro de rede = não abre', async () => {
  assert.equal((await checkRobots('https://a.example/x', { ...opts, fetchFn: fakeFetch(404) })).allowed, true);
  clearRobotsCache();
  assert.equal((await checkRobots('https://b.example/x', { ...opts, fetchFn: fakeFetch(503) })).allowed, false);
  clearRobotsCache();
  const boom = (async () => {
    throw new Error('rede');
  }) as unknown as typeof fetch;
  assert.equal((await checkRobots('https://c.example/x', { ...opts, fetchFn: boom })).allowed, false);
});

test('checkRobots guarda em cache por origem', async () => {
  let calls = 0;
  const counting = (async () => {
    calls += 1;
    return new Response('User-agent: *\nDisallow:\n', { status: 200 });
  }) as unknown as typeof fetch;
  await checkRobots('https://d.example/a', { ...opts, fetchFn: counting });
  await checkRobots('https://d.example/b', { ...opts, fetchFn: counting });
  assert.equal(calls, 1);
});
