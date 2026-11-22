// Reduz páginas reais salvas pelo calibrate.ts a fixtures pequenas para os testes.
// Uso: node scripts/make-fixtures.mjs <pasta-com-html-real> test/fixtures
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

const [src, dst] = process.argv.slice(2);
mkdirSync(dst, { recursive: true });
const find = (part) => readdirSync(src).find((f) => f.includes(part));

// KaBuM: __NEXT_DATA__ real, só os primeiros produtos e sem descrições longas.
{
  const html = readFileSync(join(src, find('kabum')), 'utf8');
  const data = JSON.parse(html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const cs = data.props.pageProps.data.catalogServer;
  const keep = cs.data.slice(0, 4).map(({ description, photos, images, tagDescription, warranty, ...p }) => p);
  const slim = { props: { pageProps: { data: { catalogServer: { meta: { totalItemsCount: keep.length }, data: keep } } } } };
  writeFileSync(
    join(dst, 'kabum-busca.html'),
    `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(slim)}</script></body></html>`,
  );
}

// AliExpress: objeto itemList real, primeiros itens.
{
  const html = readFileSync(join(src, find('ali')), 'utf8');
  const at = html.indexOf('"itemList":');
  let i = html.indexOf('{', at);
  let depth = 0;
  let inStr = false;
  const start = i;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  const list = JSON.parse(html.slice(start, i + 1));
  list.content = list.content.slice(0, 4).map(({ trace, moreAction, image, ...rest }) => rest);
  writeFileSync(
    join(dst, 'aliexpress-busca.html'),
    `<!doctype html><html><body><script>window._dida_config_ = {"pageName":"search","data":{"root":{"fields":{"mods":{"itemList":${JSON.stringify(list.content ? list : list)}}}}}};</script></body></html>`,
  );
}

// Amazon: três cartões reais de resultado.
{
  const $ = cheerio.load(readFileSync(join(src, find('amazon')), 'utf8'));
  const cards = $('div[data-component-type="s-search-result"]').slice(0, 3);
  cards.find('script, style, img, svg').remove();
  const body = cards.toArray().map((el) => $.html(el)).join('\n');
  writeFileSync(join(dst, 'amazon-busca.html'), `<!doctype html><html><body>${body}</body></html>`);
}

// Mercado Livre: começo da tela real de "tráfego suspeito".
{
  const html = readFileSync(join(src, find('mercadolivre')), 'utf8');
  writeFileSync(join(dst, 'mercadolivre-bloqueio.html'), html.slice(0, 4000));
}
console.log('fixtures geradas em', dst, readdirSync(dst));
