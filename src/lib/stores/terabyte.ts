import { absoluteUrl } from '../jsonld.ts';
import { parsePriceBRL } from '../price.ts';
import type { RawOffer } from '../types.ts';
import { makeHtmlStore, textOf } from './pipeline.ts';

// ⚠️ Seletores escritos de memória; não testados contra a página real.
// A Terabyte mostra o preço à vista como principal.
export const terabyte = makeHtmlStore({
  id: 'terabyte',
  searchUrl: (terms) => `https://www.terabyteshop.com.br/busca?str=${encodeURIComponent(terms)}`,
  fromDom: ($, base) => {
    const out: RawOffer[] = [];
    $('.product-item').each((_i, el) => {
      const card = $(el);
      const link = card.find('a.product-item__name').first();
      const title = (link.attr('title') ?? '').trim() || textOf(link);
      const url = absoluteUrl(link.attr('href'), base);
      const price = parsePriceBRL(textOf(card.find('.product-item__new-price').first()));
      if (!title || !url || price === null) return;
      out.push({
        title,
        url,
        price,
        cashPrice: price,
        regularPrice: parsePriceBRL(textOf(card.find('.product-item__old-price').first())),
      });
    });
    return out;
  },
});
