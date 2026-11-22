/**
 * Abre a busca real de cada loja e mostra o que o leitor extraiu.
 * Uso: node --experimental-strip-types scripts/calibrate.ts "termo" [pasta-para-salvar-html] [loja,loja]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFetchHtml } from '../src/lib/http.ts';
import { STORE_ADAPTERS } from '../src/lib/stores/index.ts';
import type { AdapterEnv, FetchOutcome } from '../src/lib/types.ts';

const term = process.argv[2] ?? 'headset force one kabuto';
const dumpDir = process.argv[3];
const only = process.argv[4]?.split(',');

const base = makeFetchHtml();
let n = 0;
const env: AdapterEnv = {
  async fetchHtml(url: string, init?: Parameters<AdapterEnv['fetchHtml']>[1]): Promise<FetchOutcome> {
    const out = await base(url, init);
    if (dumpDir) {
      mkdirSync(dumpDir, { recursive: true });
      const host = new URL(url).hostname.replace(/^www\./, '');
      const file = join(dumpDir, `${String(++n).padStart(2, '0')}-${host}.${out.kind === 'ok' ? 'html' : 'txt'}`);
      writeFileSync(file, out.kind === 'ok' ? out.html : `${out.kind}: ${out.message}`);
    }
    return out;
  },
};

for (const adapter of STORE_ADAPTERS) {
  if (only && !only.includes(adapter.id)) continue;
  const t0 = Date.now();
  const res = await adapter.search(term, env);
  console.log(`\n## ${adapter.name} [${res.status}] ${res.message} (${Date.now() - t0}ms)`);
  for (const o of res.offers.slice(0, 4)) {
    console.log(`  - R$ ${o.price}${o.cashPrice ? ` (vista ${o.cashPrice})` : ''} | ${o.title.slice(0, 80)}`);
    console.log(`    ${o.url}${o.endsAt ? ` | até ${o.endsAt}` : ''}${o.shippingPrice != null ? ` | frete ${o.shippingPrice}` : ''}`);
  }
}
