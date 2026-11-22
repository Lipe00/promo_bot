// Busca REAL nas lojas (precisa de internet). Fora do `npm test` de propósito.
//   npm run test:live                       (termo padrão)
//   LIVE_TERM="rtx 4060" npm run test:live
// Com chaves no ambiente (ML_CLIENT_ID, SHOPEE_AFFILIATE_APP_ID, ALI_APP_KEY...), usa as APIs oficiais.
//
// O teste falha quando uma loja que deveria funcionar "abre mas não acha produtos" (layout mudou)
// ou dá erro. Bloqueio, robots.txt e falta de chave são reportados, não reprovam: são situações
// que o bot trata e mostra no /status.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFetchHtml } from '../../src/lib/http.ts';
import { matchesQuery } from '../../src/lib/matching.ts';
import { STORE_ADAPTERS, hasApiKeys } from '../../src/lib/stores/index.ts';
import type { StoreResult } from '../../src/lib/types.ts';

const TERM = process.env.LIVE_TERM ?? 'headset force one';
const secrets = {
  ML_CLIENT_ID: process.env.ML_CLIENT_ID,
  ML_CLIENT_SECRET: process.env.ML_CLIENT_SECRET,
  SHOPEE_AFFILIATE_APP_ID: process.env.SHOPEE_AFFILIATE_APP_ID,
  SHOPEE_AFFILIATE_SECRET: process.env.SHOPEE_AFFILIATE_SECRET,
  ALI_APP_KEY: process.env.ALI_APP_KEY,
  ALI_APP_SECRET: process.env.ALI_APP_SECRET,
  ALI_TRACKING_ID: process.env.ALI_TRACKING_ID,
};
const env = { fetchHtml: makeFetchHtml(), secrets };

/** Situações aceitas por loja, sem chave de API. */
const ACCEPTED_WITHOUT_KEYS: Record<string, StoreResult['status'][]> = {
  mercadolivre: ['ok', 'blocked'], // sem token a API dá 403 e o site mostra "tráfego suspeito"
  shopee: ['unsupported'], // só com a API de afiliados
  aliexpress: ['ok'], // página de busca com JSON embutido
  kabum: ['ok'],
  amazon: ['ok', 'blocked'], // costuma bloquear IP de datacenter
};

const report: string[] = [];

function show(id: string, name: string, res: StoreResult, ms: number) {
  report.push(`\n## ${name} [${res.status}] ${res.message} (${ms}ms)`);
  const cheapest = res.offers.filter((o) => matchesQuery(o.title, TERM)).sort((a, b) => a.price - b.price);
  for (const o of (cheapest.length > 0 ? cheapest : res.offers).slice(0, 3)) {
    const extra = [o.cashPrice ? `Pix R$ ${o.cashPrice}` : '', o.endsAt ? `até ${o.endsAt}` : '', o.freightNote ?? '']
      .filter(Boolean)
      .join(' · ');
    report.push(`  - R$ ${o.price} | ${o.title.slice(0, 90)}${extra ? ` | ${extra}` : ''}`);
    report.push(`    ${o.url}`);
  }
  void id;
}

for (const id of ['mercadolivre', 'shopee', 'aliexpress', 'kabum', 'amazon']) {
  test(`ao vivo: ${id} com "${TERM}"`, { timeout: 60_000 }, async () => {
    const adapter = STORE_ADAPTERS.find((a) => a.id === id)!;
    const t0 = Date.now();
    const res = await adapter.search(TERM, env, { cep: process.env.LIVE_CEP ?? null });
    show(id, adapter.name, res, Date.now() - t0);
    const withKeys = hasApiKeys(id, secrets);
    const accepted = withKeys ? ['ok', 'empty'] : (ACCEPTED_WITHOUT_KEYS[id] ?? ['ok']);
    assert.ok(accepted.includes(res.status), `${adapter.name}: status "${res.status}" (${res.message}); esperado ${accepted.join('/')}`);
    if (res.status === 'ok') {
      assert.ok(res.offers.length > 0);
      for (const o of res.offers) {
        assert.ok(o.price > 0 && o.price < 1_000_000, `preço estranho: ${o.price}`);
        assert.ok(adapter.domains.some((d) => new URL(o.url).hostname.endsWith(d)), `link fora da loja: ${o.url}`);
      }
    }
  });
}

test('relatório', () => {
  console.log(report.join('\n'));
});
