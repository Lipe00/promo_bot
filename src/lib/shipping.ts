import { effectivePrice, round2 } from './price.ts';
import type { FreightMode, RawOffer } from './types.ts';

/**
 * Preço usado para comparar com o alvo:
 *   - o menor entre cartão e à vista/Pix;
 *   - mais o frete para o CEP, quando o modo é "total" e o frete é conhecido.
 * Frete desconhecido não soma nada (o alerta avisa para conferir na loja).
 */
export function comparedPrice(offer: RawOffer, mode: FreightMode): number {
  const base = effectivePrice(offer);
  if (mode === 'total' && typeof offer.shippingPrice === 'number' && offer.shippingPrice > 0) {
    return round2(base + offer.shippingPrice);
  }
  return base;
}

export function parseFreightMode(input: string): FreightMode | null {
  const s = input.trim().toLowerCase();
  if (['total', 'com', 'com frete', 'somar', 'sim'].includes(s)) return 'total';
  if (['produto', 'sem', 'sem frete', 'nao', 'não'].includes(s)) return 'produto';
  return null;
}
