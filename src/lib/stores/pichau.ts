import { absoluteUrl, parseEndDate, walkObjects } from '../jsonld.ts';
import { firstPrice } from '../price.ts';
import type { RawOffer } from '../types.ts';
import { makeHtmlStore, moneyIn, textOf } from './pipeline.ts';

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// ⚠️ Estrutura de dados e seletores escritos de memória; não testados contra a página real.
// A Pichau mostra um preço à vista no Pix (com desconto) e outro no cartão; os dois são lidos quando existem.
export const pichau = makeHtmlStore({
  id: 'pichau',
  searchUrl: (terms) => `https://www.pichau.com.br/search?q=${encodeURIComponent(terms)}`,
  fromJson: (root, base) => {
    const out: RawOffer[] = [];
    walkObjects(root, (o) => {
      const name = typeof o.name === 'string' ? o.name : null;
      const urlKey = typeof o.url_key === 'string' ? o.url_key : null;
      if (!name || !urlKey) return;
      const range = asRecord(asRecord(o.price_range)?.minimum_price);
      const custom = asRecord(o.pichau_prices);
      const price = firstPrice(asRecord(range?.final_price)?.value, custom?.final_price, custom?.base_price);
      const url = absoluteUrl(`/${urlKey}`, base);
      if (price === null || !url) return;
      out.push({
        title: name,
        url,
        price,
        cashPrice: firstPrice(custom?.avista),
        regularPrice: firstPrice(asRecord(range?.regular_price)?.value),
        endsAt: parseEndDate(o.special_to_date),
      });
    });
    return out;
  },
  fromDom: ($, base) => {
    const out: RawOffer[] = [];
    $('a[data-cy="list-product"]').each((_i, el) => {
      const card = $(el);
      const title = textOf(card.find('h2').first());
      const url = absoluteUrl(card.attr('href'), base);
      const prices = moneyIn(textOf(card));
      if (!title || !url || prices.length === 0) return;
      // Sem seletor confiável: o menor valor do cartão costuma ser o preço à vista.
      const cash = Math.min(...prices);
      out.push({ title, url, price: prices[0] ?? cash, cashPrice: cash });
    });
    return out;
  },
});
