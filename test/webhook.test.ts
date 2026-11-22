import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleUpdate } from '../src/lib/webhook.ts';
import type { WebhookDeps } from '../src/lib/webhook.ts';
import type { StoreAdapter } from '../src/lib/types.ts';
import { memoryDb } from './helpers.ts';

function makeDeps(allowed: string | undefined, adapters: StoreAdapter[] = []) {
  const { db, state } = memoryDb();
  const sent: { chatId: number; html: string }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  let dbUsed = false;
  const deps: WebhookDeps = {
    allowedChatId: allowed,
    send: async (chatId, html) => {
      sent.push({ chatId, html });
    },
    getDb: () => {
      dbUsed = true;
      return db;
    },
    builtins: adapters,
    env: { fetchHtml: async () => ({ kind: 'error', message: 'x' }) },
    adaptersFor: async () => adapters,
    runCheck: async () => ({ watches: 1, checked: 1, alerts: 0, notifyErrors: 0, stores: {} }),
    defer: (t) => {
      tasks.push(t);
    },
    log: () => {},
  };
  return { deps, sent, tasks, state, wasDbUsed: () => dbUsed };
}

const msg = (chatId: number, text: string) => ({ message: { chat: { id: chatId }, text } });

test('modo de configuração: responde o chat id e não toca no banco', async () => {
  const t = makeDeps(undefined);
  await handleUpdate(msg(555, '/start'), t.deps);
  assert.match(t.sent[0]!.html, /Seu chat id é <code>555<\/code>/);
  assert.equal(t.wasDbUsed(), false);
});

test('chat de outra pessoa é ignorado em silêncio', async () => {
  const t = makeDeps('111');
  await handleUpdate(msg(222, '/add kabuto | 300'), t.deps);
  assert.equal(t.sent.length, 0);
  assert.equal(t.state.watches.length, 0);
});

test('mensagem editada é ignorada (editar /add não duplica a busca)', async () => {
  const t = makeDeps('111');
  await handleUpdate({ edited_message: { chat: { id: 111 }, text: '/add kabuto | 300' } }, t.deps);
  assert.equal(t.sent.length, 0);
  assert.equal(t.state.watches.length, 0);
});

test('comando do dono: responde e agenda a checagem depois da resposta', async () => {
  const t = makeDeps('111');
  await handleUpdate(msg(111, '/add kabuto | 300'), t.deps);
  assert.equal(t.state.watches.length, 1);
  await handleUpdate(msg(111, '/checar'), t.deps);
  assert.equal(t.tasks.length, 1);
  await t.tasks[0]!();
  assert.match(t.sent.at(-1)!.html, /Checagem concluída/);
});

test('/testar usa as lojas do chat; /fonte add testa a fonte nova', async () => {
  const fake: StoreAdapter = {
    id: 'kabum',
    name: 'KaBuM!',
    domains: ['kabum.com.br'],
    search: async () => ({
      status: 'ok',
      message: '1 itens',
      offers: [{ title: 'SSD 1TB', url: 'https://www.kabum.com.br/p/1', price: 399 }],
    }),
  };
  const t = makeDeps('111', [fake]);
  await handleUpdate(msg(111, '/testar ssd'), t.deps);
  await t.tasks.shift()!();
  assert.match(t.sent.at(-1)!.html, /KaBuM!<\/b>: 1 itens[\s\S]*SSD 1TB — R\$ 399,00/);

  const product = { '@type': 'Product', name: 'SSD X', offers: { price: '350', url: 'https://www.lojax.com.br/p/1' } };
  t.deps.env = {
    fetchHtml: async (url) => ({
      kind: 'ok',
      finalUrl: url,
      html: `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    }),
  };
  await handleUpdate(msg(111, '/fonte add Loja X | https://www.lojax.com.br/busca?q={q}'), t.deps);
  await t.tasks.shift()!();
  assert.match(t.sent.at(-1)!.html, /Loja X<\/b>: 1 itens[\s\S]*já entra nas próximas buscas/);
});

test('erro inesperado vira mensagem amigável', async () => {
  const t = makeDeps('111');
  t.deps.getDb = () => {
    throw new Error('banco fora');
  };
  await handleUpdate(msg(111, '/lista'), t.deps);
  assert.match(t.sent[0]!.html, /Algo deu errado/);
});
