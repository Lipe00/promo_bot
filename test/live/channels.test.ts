// Leitura REAL de um canal público do Telegram (precisa de internet). Fora do `npm test`.
//   LIVE_CHANNEL=promobit npm run test:live
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePost, storeLabel } from '../../src/lib/channels/parse.ts';
import { makePreviewReader } from '../../src/lib/channels/preview.ts';
import { makeFetchHtml } from '../../src/lib/http.ts';
import type { TgChannel } from '../../src/lib/types.ts';

const NAME = process.env.LIVE_CHANNEL ?? 'promobit';

test(`ao vivo: canal público @${NAME}`, { timeout: 60_000 }, async () => {
  const reader = makePreviewReader({ fetchHtml: makeFetchHtml() });
  const base: TgChannel = {
    id: 1, chat_id: 1, source: 'publico', username: NAME, tg_id: null, access_hash: null, peer_type: 'channel',
    title: '', enabled: true, last_message_id: null, last_checked_at: null, last_error: null,
  };
  const first = await reader.read(base);
  assert.equal(first.error, undefined, first.error);
  assert.ok(first.latestId);
  // Lê as ~20 últimas como se a última lida fosse bem anterior.
  const res = await reader.read({ ...base, last_message_id: first.latestId! - 20 });
  assert.equal(res.error, undefined, res.error);
  const posts = res.posts.map(parsePost);
  assert.ok(posts.length > 0);
  const lines = [`\n## ${res.title} — ${posts.length} posts lidos`];
  for (const p of posts.slice(-12)) {
    const c = p.coupons.map((x) => x.code + (x.discount ? ` (${x.discount})` : '')).join(', ');
    lines.push(`- ${p.title.slice(0, 60)} | ${p.price ?? 'sem preço'} | ${storeLabel(p.store)}${c ? ` | 🎟️ ${c}` : ''}`);
  }
  const coupons = posts.flatMap((p) => p.coupons.map((c) => `${storeLabel(p.store)}: ${c.code}`));
  lines.push(`Cupons distintos: ${[...new Set(coupons)].join(' · ') || 'nenhum'}`);
  console.log(lines.join('\n'));
});
