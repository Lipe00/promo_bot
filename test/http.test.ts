import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostAllowed } from '../src/lib/config.ts';
import { detectBlock } from '../src/lib/http.ts';

const BIG = 'x'.repeat(100_000);

test('detectBlock: 403/429 e 503 pequeno são bloqueio', () => {
  assert.equal(detectBlock(403, '')?.kind, 'blocked');
  assert.equal(detectBlock(429, BIG)?.kind, 'blocked');
  assert.equal(detectBlock(503, 'oops')?.kind, 'blocked');
  assert.equal(detectBlock(503, BIG)?.kind, 'error');
});

test('detectBlock: erros comuns', () => {
  assert.equal(detectBlock(500, '')?.kind, 'error');
  assert.equal(detectBlock(404, '')?.kind, 'error');
});

test('detectBlock: captcha em página pequena, mas não em página grande com script de captcha', () => {
  assert.equal(detectBlock(200, '<html>Digite os caracteres que você vê abaixo</html>')?.kind, 'blocked');
  assert.equal(detectBlock(200, '<html>Are you a robot?</html>')?.kind, 'blocked');
  assert.equal(detectBlock(200, BIG + ' recaptcha '), null);
  assert.equal(detectBlock(200, '<html>resultado normal</html>'), null);
});

test('hostAllowed só aceita https e o domínio (ou subdomínio) da lista', () => {
  const d = ['kabum.com.br'];
  assert.equal(hostAllowed('https://www.kabum.com.br/produto/1', d), true);
  assert.equal(hostAllowed('https://kabum.com.br/x', d), true);
  assert.equal(hostAllowed('http://www.kabum.com.br/x', d), false);
  assert.equal(hostAllowed('https://kabum.com.br.evil.example/x', d), false);
  assert.equal(hostAllowed('https://evilkabum.com.br/x', d), false);
  assert.equal(hostAllowed('not a url', d), false);
});
