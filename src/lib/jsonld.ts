import { parsePriceBRL } from './price.ts';
import type { RawOffer } from './types.ts';

/** Blocos <script type="application/ld+json"> já convertidos em objetos. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse((m[1] ?? '').trim()));
    } catch {
      // bloco inválido: ignora
    }
  }
  return out;
}

/** Dados embutidos pelo Next.js (<script id="__NEXT_DATA__">), se existirem. */
export function extractNextData(html: string): unknown {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1] ?? '');
  } catch {
    return null;
  }
}

/** Percorre um JSON inteiro chamando `visit` em cada objeto. Também abre strings que contêm JSON. */
export function walkObjects(
  root: unknown,
  visit: (o: Record<string, unknown>) => void,
  maxDepth = 14,
): void {
  const seen = new Set<unknown>();
  const go = (node: unknown, depth: number): void => {
    if (node === null || depth > maxDepth) return;
    if (typeof node === 'string') {
      const t = node.trim();
      if (t.length > 40 && (t.startsWith('{') || t.startsWith('['))) {
        try {
          go(JSON.parse(t), depth + 1);
        } catch {
          // não era JSON
        }
      }
      return;
    }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) go(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    visit(obj);
    for (const v of Object.values(obj)) go(v, depth + 1);
  };
  go(root, 0);
}

function asArray(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function absoluteUrl(href: unknown, base: string): string | null {
  if (typeof href !== 'string' || !href.trim()) return null;
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return null;
  }
}

/** Remove query e hash: os parâmetros de rastreio mudam a cada visita e quebrariam a deduplicação. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

/** "2026-11-27" vira o fim desse dia no horário de Brasília; datas com hora são respeitadas. */
export function parseEndDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59-03:00`) : Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function freeShippingNote(details: unknown): string | null {
  for (const d of asArray(details)) {
    if (!isRecord(d)) continue;
    const rate = d.shippingRate;
    const value = isRecord(rate) ? rate.value : undefined;
    if (value === 0 || value === '0' || value === '0.00') {
      return 'frete grátis informado pela loja (pode variar com o CEP)';
    }
  }
  return null;
}

/** Lê produtos com preço de dados estruturados (schema.org Product/Offer). */
export function offersFromJsonLd(blocks: unknown[], baseUrl: string): RawOffer[] {
  const found: RawOffer[] = [];

  for (const block of blocks) {
    walkObjects(block, (o) => {
      if (!asArray(o['@type']).includes('Product')) return;
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      if (!name) return;

      for (const offer of asArray(o.offers)) {
        if (!isRecord(offer)) continue;
        const availability = String(offer.availability ?? '');
        if (/OutOfStock|SoldOut|Discontinued/i.test(availability)) continue;
        const price = parsePriceBRL(offer.price ?? offer.lowPrice);
        const url = absoluteUrl(offer.url ?? o.url, baseUrl);
        if (price === null || url === null) continue;
        found.push({
          title: name,
          url,
          price,
          endsAt: parseEndDate(offer.priceValidUntil),
          freightNote: freeShippingNote(offer.shippingDetails),
        });
      }
    });
  }
  return found;
}
