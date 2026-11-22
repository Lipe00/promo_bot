import { hostAllowed } from '../config.ts';
import { absoluteUrl, walkObjects } from '../jsonld.ts';
import { firstPrice } from '../price.ts';
import type { RawOffer, Source, StoreAdapter } from '../types.ts';
import { readPage } from './pipeline.ts';

/**
 * Loja cadastrada pelo usuário (/fonte add Nome | https://loja.com.br/busca?q={q}).
 * Lê produtos de dados estruturados que muitas lojas publicam:
 *   - JSON-LD (schema.org Product/Offer), sempre;
 *   - __NEXT_DATA__ com objetos que tenham nome + preço + link.
 */

export type TemplateCheck = { ok: true; url: URL; domain: string } | { ok: false; error: string };

export function checkTemplate(template: string): TemplateCheck {
  const t = template.trim();
  if (!t.includes('{q}')) return { ok: false, error: 'O link precisa ter {q} no lugar do termo de busca.' };
  let url: URL;
  try {
    url = new URL(t.replace(/\{q\}/g, 'teste'));
  } catch {
    return { ok: false, error: 'Link inválido.' };
  }
  const devHosts = (process.env.PROMO_DEV_HTTP_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && devHosts.includes(url.hostname))) {
    return { ok: false, error: 'Só aceito links https://.' };
  }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname) && !devHosts.includes(url.hostname)) {
    return { ok: false, error: 'Endereço local não é permitido.' };
  }
  const domain = url.hostname.replace(/^www\./, '').toLowerCase();
  return { ok: true, url, domain };
}

export function fillTemplate(template: string, terms: string): string {
  return template.replace(/\{q\}/g, encodeURIComponent(terms));
}

/** Objetos de __NEXT_DATA__ com cara de produto: nome/título, preço e link. */
export function genericFromJson(root: unknown, base: string): RawOffer[] {
  const out: RawOffer[] = [];
  walkObjects(root, (o) => {
    const title = typeof o.name === 'string' ? o.name : typeof o.title === 'string' ? o.title : null;
    if (!title || title.length < 4) return;
    const priceObj = typeof o.price === 'object' && o.price !== null ? (o.price as Record<string, unknown>) : undefined;
    const price = firstPrice(
      typeof o.price === 'object' ? undefined : o.price,
      o.salePrice,
      o.bestPrice,
      priceObj?.value,
      priceObj?.bestPrice,
      priceObj?.price,
    );
    const href = o.url ?? o.link ?? o.href ?? o.permalink ?? (typeof o.slug === 'string' ? `/${o.slug}` : undefined);
    const url = absoluteUrl(href, base);
    if (price === null || !url) return;
    out.push({ title, url, price, regularPrice: firstPrice(o.listPrice, o.oldPrice, priceObj?.listPrice) });
  });
  return out;
}

export function makeGenericStore(source: Source): StoreAdapter {
  const template = source.search_url ?? '';
  const domains = source.domains.length > 0 ? source.domains : [];
  const cfg = {
    fromJson: genericFromJson,
    emptyMessage: 'a página abriu, mas não achei produtos em dados estruturados (JSON-LD); essa loja pode não ser compatível',
  };
  return {
    id: `custom:${source.id}`,
    name: source.name,
    domains,
    via: 'html',
    search: (terms, env) => readPage(fillTemplate(template, terms), env, domains, cfg),
    async listing(url, env) {
      if (!hostAllowed(url, domains)) return { status: 'error', message: `o link não é da ${source.name}`, offers: [] };
      return readPage(url, env, domains, cfg);
    },
  };
}
