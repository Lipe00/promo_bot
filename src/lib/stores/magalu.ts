import { absoluteUrl, parseEndDate, walkObjects } from '../jsonld.ts';
import { firstPrice, parsePriceBRL } from '../price.ts';
import type { RawOffer } from '../types.ts';
import { FREE_SHIPPING_HINT, hasFreeShippingText, makeHtmlStore, moneyIn, textOf } from './pipeline.ts';

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// ⚠️ Estrutura de dados e seletores escritos de memória; não testados contra a página real.
export const magalu = makeHtmlStore({
  id: 'magalu',
  searchUrl: (terms) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(terms)}/`,
  fromJson: (root, base) => {
    const out: RawOffer[] = [];
    walkObjects(root, (o) => {
      const price = asRecord(o.price);
      const title = typeof o.title === 'string' ? o.title : null;
      const url = absoluteUrl(o.url ?? o.path, base);
      const best = firstPrice(price?.bestPrice, price?.price, o.bestPrice);
      if (!title || !url || best === null) return;
      out.push({
        title,
        url,
        price: best,
        regularPrice: firstPrice(price?.price) !== best ? firstPrice(price?.price) : null,
        endsAt: parseEndDate(o.promotionEndDate ?? o.endDate),
      });
    });
    return out;
  },
  fromDom: ($, base) => {
    const out: RawOffer[] = [];
    $('[data-testid="product-card-container"]').each((_i, el) => {
      const card = $(el);
      const title = textOf(card.find('[data-testid="product-title"]').first());
      const href = card.is('a') ? card.attr('href') : card.find('a').first().attr('href');
      const url = absoluteUrl(href, base);
      const price =
        parsePriceBRL(textOf(card.find('[data-testid="price-value"]').first())) ?? moneyIn(textOf(card))[0] ?? null;
      if (!title || !url || price === null) return;
      out.push({
        title,
        url,
        price,
        regularPrice: parsePriceBRL(textOf(card.find('[data-testid="price-original"]').first())),
        freightNote: hasFreeShippingText(textOf(card)) ? FREE_SHIPPING_HINT : null,
      });
    });
    return out;
  },
});
