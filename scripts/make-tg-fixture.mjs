// Reduz uma página real de canal público (t.me/s/<canal>) a uma fixture pequena para os testes.
// Uso: node scripts/make-tg-fixture.mjs <entrada.html> <saida.html> [quantas-mensagens]
import { readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';

const [src, dst, n = '10'] = process.argv.slice(2);
const $ = cheerio.load(readFileSync(src, 'utf8'));
const title = $('.tgme_channel_info_header_title').first().text().trim();
const wraps = $('.tgme_widget_message_wrap').slice(0, Number(n));
wraps.find('svg, img, .tgme_widget_message_user, .tgme_widget_message_photo_wrap, .tgme_widget_message_bubble_tail').remove();
wraps.find('[style]').removeAttr('style');
const body = wraps
  .toArray()
  .map((el) => $.html(el))
  .join('\n');
writeFileSync(
  dst,
  `<!doctype html><html><body><div class="tgme_channel_info_header_title"><span dir="auto">${title}</span></div>\n<section class="tgme_channel_history">${body}</section></body></html>`,
);
console.log(`fixture: ${wraps.length} mensagens de "${title}" → ${dst}`);
