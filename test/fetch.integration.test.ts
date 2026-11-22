// Sobe um servidor HTTP local (127.0.0.1) e confere o comportamento real do fetch educado:
// robots.txt, bloqueio, erro, timeout e intervalo entre requisições. Não acessa a internet.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { makeFetchHtml } from '../src/lib/http.ts';
import { clearRobotsCache } from '../src/lib/robots.ts';

const BIG_PAGE = '<html>' + 'produto '.repeat(10_000) + '</html>';
const hits: Record<string, number> = {};
let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    hits[path] = (hits[path] ?? 0) + 1;
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /proibido\n');
    } else if (path === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(BIG_PAGE);
    } else if (path === '/captcha') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>Digite os caracteres que você vê abaixo</html>');
    } else if (path === '/negado') {
      res.writeHead(403);
      res.end('no');
    } else if (path === '/quebrado') {
      res.writeHead(500);
      res.end('erro');
    } else if (path === '/lento') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('tarde demais');
      }, 600);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(BIG_PAGE);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  clearRobotsCache();
  for (const k of Object.keys(hits)) delete hits[k];
});

test('abre página permitida e devolve o HTML', async () => {
  const fetchHtml = makeFetchHtml({ gapMs: 0, timeoutMs: 2000 });
  const out = await fetchHtml(`${base}/ok`);
  assert.equal(out.kind, 'ok');
  if (out.kind === 'ok') {
    assert.equal(out.finalUrl, `${base}/ok`);
    assert.match(out.html, /produto/);
  }
});

test('página proibida no robots.txt nunca é requisitada', async () => {
  const fetchHtml = makeFetchHtml({ gapMs: 0, timeoutMs: 2000 });
  const out = await fetchHtml(`${base}/proibido/busca`);
  assert.equal(out.kind, 'robots');
  assert.equal(hits['/proibido/busca'], undefined);
  assert.equal(hits['/robots.txt'], 1);
});

test('403 e captcha viram "blocked"; 500 vira "error"', async () => {
  const fetchHtml = makeFetchHtml({ gapMs: 0, timeoutMs: 2000 });
  assert.equal((await fetchHtml(`${base}/negado`)).kind, 'blocked');
  assert.equal((await fetchHtml(`${base}/captcha`)).kind, 'blocked');
  assert.equal((await fetchHtml(`${base}/quebrado`)).kind, 'error');
});

test('timeout vira erro com mensagem clara', async () => {
  const fetchHtml = makeFetchHtml({ gapMs: 0, timeoutMs: 150 });
  const out = await fetchHtml(`${base}/lento`);
  assert.equal(out.kind, 'error');
  if (out.kind === 'error') assert.match(out.message, /tempo esgotado/);
});

test('espera o intervalo mínimo entre requisições ao mesmo site', async () => {
  const fetchHtml = makeFetchHtml({ gapMs: 300, timeoutMs: 2000 });
  await fetchHtml(`${base}/a`);
  const started = Date.now();
  await fetchHtml(`${base}/b`);
  assert.ok(Date.now() - started >= 250, 'esperou perto de 300 ms');
});

test('robots.txt só é baixado uma vez por loja', async () => {
  const fetchHtml = makeFetchHtml({ gapMs: 0, timeoutMs: 2000 });
  await fetchHtml(`${base}/x`);
  await fetchHtml(`${base}/y`);
  assert.equal(hits['/robots.txt'], 1);
});
