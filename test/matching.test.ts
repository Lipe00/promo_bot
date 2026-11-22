import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesQuery, normalizeText, parseQuery, queryKey, searchTerms } from '../src/lib/matching.ts';

test('normalizeText tira acento, caixa e pontuação', () => {
  assert.equal(normalizeText('Headset Gamer Força-One 7.1!'), 'headset gamer forca one 7 1');
});

test('parseQuery separa palavras incluídas e excluídas', () => {
  assert.deepEqual(parseQuery('force one kabuto -almofada'), {
    include: ['force', '1', 'kabuto'],
    exclude: ['almofada'],
    typed: ['force', 'one', 'kabuto'],
  });
  assert.deepEqual(parseQuery('a - b'), { include: ['a', 'b'], exclude: [], typed: ['a', 'b'] });
});

test('queryKey ignora ordem e exclusões; searchTerms só devolve o que vai pra loja', () => {
  assert.equal(queryKey('Kabuto force ONE'), queryKey('force one kabuto -almofada'));
  assert.equal(searchTerms('force one kabuto -almofada'), 'force one kabuto');
});

test('matchesQuery exige todas as palavras', () => {
  const q = 'FORCE ONE KABUTO';
  assert.equal(matchesQuery('Headset Gamer Force One Kabuto RGB 7.1 Wireless', q), true);
  assert.equal(matchesQuery('Headset Gamer Force One Supersonic', q), false);
  assert.equal(matchesQuery('Headset Kabuto', q), false);
});

test('matchesQuery respeita exclusões', () => {
  const q = 'force one kabuto -almofada -espuma';
  assert.equal(matchesQuery('Almofada de reposição para Force One Kabuto', q), false);
  assert.equal(matchesQuery('Force One Kabuto Headset', q), true);
});

test('palavras curtas são exatas e longas aceitam início de palavra', () => {
  assert.equal(matchesQuery('Fone Onekey Kabuto Force', 'force one kabuto'), false); // "one" ≠ "onekey"
  assert.equal(matchesQuery('Headsets Force One Kabutos', 'force one kabuto'), true); // plural passa
});

test('busca vazia nunca casa', () => {
  assert.equal(matchesQuery('qualquer coisa', ''), false);
  assert.equal(matchesQuery('qualquer coisa', '-abc'), false);
});

test('número por extenso casa com dígito (e vice-versa)', () => {
  assert.equal(matchesQuery('Tênis Nike Air Force 1 Kabuto', 'force one kabuto'), true);
  assert.equal(matchesQuery('Headset Force One Kabuto', 'force 1 kabuto'), true);
  assert.equal(matchesQuery('Kit com dois controles', 'kit 2 controles'), true);
  assert.equal(queryKey('force one kabuto'), queryKey('kabuto force 1'));
  // A loja recebe o que o usuário digitou, não o dígito.
  assert.equal(searchTerms('force one kabuto'), 'force one kabuto');
});

test('passesExclusions só olha as exclusões', async () => {
  const { passesExclusions } = await import('../src/lib/matching.ts');
  assert.equal(passesExclusions('Placa de Vídeo RTX 4060', 'https://x -usada'), true);
  assert.equal(passesExclusions('Placa de Vídeo RTX 4060 usada', 'qualquer -usada'), false);
});
