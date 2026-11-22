export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Lê um preço em vários formatos: "R$ 1.299,90", "1299.90", "279", 279.9.
 * Pega o PRIMEIRO número do texto; passe o elemento certo (não o card inteiro).
 */
export function parsePriceBRL(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 && input < 10_000_000 ? round2(input) : null;
  }
  if (typeof input !== 'string') return null;

  const match = input.match(/\d[\d.,]*/);
  if (!match) return null;
  const s = match[0].replace(/[.,]+$/, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;

  if (lastComma !== -1 && lastDot !== -1) {
    // Vale o separador que aparece por último: "1.299,90" (pt-BR) ou "1,299.90" (en).
    normalized =
      lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const many = (s.match(/,/g) ?? []).length > 1;
    const digitsAfter = s.length - lastComma - 1;
    normalized = many || digitsAfter === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot !== -1) {
    const many = (s.match(/\./g) ?? []).length > 1;
    const digitsAfter = s.length - lastDot - 1;
    normalized = many || digitsAfter === 3 ? s.replace(/\./g, '') : s;
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? round2(n) : null;
}

/** Primeiro valor que virar preço válido. */
export function firstPrice(...values: unknown[]): number | null {
  for (const v of values) {
    const p = parsePriceBRL(v);
    if (p !== null) return p;
  }
  return null;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(n: number): string {
  return brl.format(n).replace(/ /g, ' ');
}

/** Preço máximo aceito: alvo + margem. */
export function priceCeiling(target: number, marginPct: number): number {
  return round2(target * (1 + marginPct / 100));
}

/** Compara pelo menor entre o preço normal e o à vista/Pix. */
export function effectivePrice(offer: { price: number; cashPrice?: number | null }): number {
  return offer.cashPrice && offer.cashPrice > 0 ? Math.min(offer.price, offer.cashPrice) : offer.price;
}
