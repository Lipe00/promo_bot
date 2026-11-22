import { parsePriceBRL } from '../price.ts';
import type { RawOffer } from '../types.ts';
import { FREE_SHIPPING_HINT, hasFreeShippingText, makeHtmlStore, textOf } from './pipeline.ts';

// ⚠️ Seletores escritos de memória; não testados contra a página real.
// A Amazon costuma responder com captcha para robôs: nesse caso o /status mostra "bloqueou".
// Não há como contornar isso aqui (nem deve). A API oficial (PA-API) exige conta de Associados
// já aprovada com vendas qualificadas.
export const amazon = makeHtmlStore({
  id: 'amazon',
  searchUrl: (terms) => `https://www.amazon.com.br/s?k=${encodeURIComponent(terms).replace(/%20/g, '+')}`,
  fromDom: ($) => {
    const out: RawOffer[] = [];
    $('div[data-component-type="s-search-result"]').each((_i, el) => {
      const card = $(el);
      const asin = card.attr('data-asin');
      const title = textOf(card.find('h2').first());
      if (!asin || !title) return;
      const price = parsePriceBRL(textOf(card.find('.a-price:not(.a-text-price) .a-offscreen').first()));
      if (price === null) return;
      out.push({
        title,
        url: `https://www.amazon.com.br/dp/${asin}`,
        price,
        regularPrice: parsePriceBRL(textOf(card.find('.a-price.a-text-price .a-offscreen').first())),
        freightNote: hasFreeShippingText(textOf(card)) ? FREE_SHIPPING_HINT : null,
      });
    });
    return out;
  },
});
