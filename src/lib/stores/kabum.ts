import { absoluteUrl, walkObjects } from '../jsonld.ts';
import { firstPrice, parsePriceBRL } from '../price.ts';
import type { RawOffer } from '../types.ts';
import { makeHtmlStore, textOf } from './pipeline.ts';

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** KaBuM manda datas de oferta em segundos desde 1970. */
function unixToIso(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/**
 * Lê o catálogo que vem em __NEXT_DATA__ (busca e páginas de categoria).
 * Conferido na página real em 22/11/2026:
 *   price = cartão; priceWithDiscount = Pix; oldPrice = "de";
 *   offer = oferta relâmpago { price, priceWithDiscount, endsAt (segundos) }; flags.isFreeShipping.
 */
export function kabumFromJson(root: unknown, base: string): RawOffer[] {
  const out: RawOffer[] = [];
  walkObjects(root, (o) => {
    const name = typeof o.name === 'string' ? o.name : null;
    const code = typeof o.code === 'number' || typeof o.code === 'string' ? String(o.code) : null;
    if (!name || !code || !('price' in o)) return;
    if (o.available === false) return;
    const friendly = typeof o.friendlyName === 'string' ? `/${o.friendlyName}` : '';
    const url = absoluteUrl(`/produto/${code}${friendly}`, base);
    if (!url) return;

    let price = firstPrice(o.price, o.priceWithDiscount);
    let cash = firstPrice(o.priceWithDiscount);
    let regular = firstPrice(o.oldPrice);
    let endsAt: string | null = null;

    const offer = asRecord(o.offer);
    const offerPrice = firstPrice(offer?.price, offer?.priceWithDiscount);
    const offerEnd = unixToIso(offer?.endsAt);
    if (offer && offerPrice !== null) {
      // Oferta já encerrada não é descartada aqui: o alerts.ts recusa promoção vencida.
      regular = price ?? regular;
      price = offerPrice;
      cash = firstPrice(offer.priceWithDiscount) ?? cash;
      endsAt = offerEnd;
    }
    if (price === null) return;
    if (cash !== null && cash >= price) cash = null;
    if (regular !== null && regular <= price) regular = null;

    const flags = asRecord(o.flags);
    out.push({
      title: name,
      url,
      price,
      cashPrice: cash,
      regularPrice: regular,
      endsAt,
      itemId: code,
      freightNote: flags?.isFreeShipping === true ? 'frete grátis informado pela KaBuM (pode variar com o CEP)' : null,
    });
  });
  return out;
}

export const kabum = makeHtmlStore({
  id: 'kabum',
  searchUrl: (terms) => `https://www.kabum.com.br/busca/${encodeURIComponent(terms.trim().replace(/\s+/g, '-'))}`,
  fromJson: kabumFromJson,
  // Reserva, caso o __NEXT_DATA__ suma. Seletores não conferidos na página real.
  fromDom: ($, base) => {
    const out: RawOffer[] = [];
    $('article.productCard').each((_i, el) => {
      const card = $(el);
      const title = textOf(card.find('.nameCard').first());
      const url = absoluteUrl(card.find('a.productLink').first().attr('href'), base);
      const price = parsePriceBRL(textOf(card.find('.priceCard').first()));
      if (!title || !url || price === null) return;
      out.push({ title, url, price, regularPrice: parsePriceBRL(textOf(card.find('.oldPriceCard').first())) });
    });
    return out;
  },
});
