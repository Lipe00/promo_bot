import { BUILTIN_IDS, DEFAULTS, STORE_META, hostAllowed } from './config.ts';
import { buildStatusMessage, escapeHtml, watchLabel } from './format.ts';
import { normalizeText, searchTerms } from './matching.ts';
import { formatBRL, parsePriceBRL, priceCeiling } from './price.ts';
import { parseFreightMode } from './shipping.ts';
import { checkTemplate } from './stores/generic.ts';
import { buildAdapters, viaLabel } from './stores/index.ts';
import type { BuiltinStoreId, CommandDb, StoreAdapter, Watch } from './types.ts';

export interface CommandResult {
  reply: string;
  /** Trabalho demorado que a rota executa depois de responder. */
  action?: { type: 'check' } | { type: 'test'; query: string } | { type: 'test-source'; sourceId: number; query: string };
}

export interface CommandCtx {
  db: CommandDb;
  chatId: number;
  /** Lojas embutidas (para /lojas e para validar links de categoria). */
  builtins?: StoreAdapter[];
  /** Variáveis de ambiente, para mostrar quais lojas usam API. */
  secrets?: Record<string, string | undefined>;
}

export type AddParse =
  | { ok: true; query: string; target: number; margin: number | null; stores: string[] | null }
  | { ok: false; error: string };

export function parseMargin(input: string | undefined): number | null {
  if (input === undefined) return null;
  const s = input.trim().replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** "12345678" ou "12345-678" → "12345-678". */
export function parseCep(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : null;
}

const STORE_ALIASES: Record<string, BuiltinStoreId> = {
  ml: 'mercadolivre',
  meli: 'mercadolivre',
  mercadolivre: 'mercadolivre',
  mercadolibre: 'mercadolivre',
  amazon: 'amazon',
  amz: 'amazon',
  shopee: 'shopee',
  aliexpress: 'aliexpress',
  ali: 'aliexpress',
  kabum: 'kabum',
};

/** "Mercado Livre", "ml", "KaBuM!" → id da loja embutida. */
export function resolveStore(input: string): BuiltinStoreId | null {
  const key = normalizeText(input).replace(/\s+/g, '');
  return STORE_ALIASES[key] ?? null;
}

/** "kabum, amazon" → ['kabum','amazon']; "todas" → null. */
export function parseStoreList(input: string | undefined): { ok: true; stores: string[] | null } | { ok: false; error: string } {
  const s = (input ?? '').trim();
  if (!s || /^(todas|todos|all|\*)$/i.test(s)) return { ok: true, stores: null };
  const out: string[] = [];
  for (const part of s.split(/[,;]+/)) {
    if (!part.trim()) continue;
    const custom = part.trim().match(/^#?(\d{1,9})$/);
    if (custom) {
      out.push(`custom:${custom[1]}`);
      continue;
    }
    const id = resolveStore(part);
    if (!id) return { ok: false, error: `Não conheço a loja "${part.trim()}". Veja /lojas.` };
    out.push(id);
  }
  return { ok: true, stores: out.length > 0 ? [...new Set(out)] : null };
}

/**
 * Aceita dois formatos:
 *   /add force one kabuto | 300 | 15 | kabum,amazon
 *   /add force one kabuto 300 15%
 */
export function parseAddArgs(args: string): AddParse {
  const raw = args.trim();
  if (!raw) return { ok: false, error: 'Faltou o produto e o preço.' };

  let query: string;
  let priceText: string | undefined;
  let marginText: string | undefined;
  let storesText: string | undefined;

  if (raw.includes('|')) {
    const parts = raw.split('|').map((p) => p.trim());
    query = parts[0] ?? '';
    priceText = parts[1];
    marginText = parts[2];
    storesText = parts[3];
  } else {
    const tokens = raw.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? '';
    if (tokens.length >= 3 && /^\d+([.,]\d+)?%$/.test(last)) marginText = tokens.pop();
    priceText = tokens.pop();
    if (/^R\$$/i.test(tokens[tokens.length - 1] ?? '')) tokens.pop();
    query = tokens.join(' ');
  }

  if (query.length < 2 || query.length > 300) {
    return { ok: false, error: 'O nome do produto precisa ter entre 2 e 120 caracteres.' };
  }
  if (!/^https?:\/\//i.test(query) && query.length > 120) {
    return { ok: false, error: 'O nome do produto precisa ter entre 2 e 120 caracteres.' };
  }
  const target = parsePriceBRL(priceText);
  if (target === null) return { ok: false, error: 'Não entendi o preço alvo.' };

  let margin: number | null = null;
  if (marginText !== undefined && marginText !== '') {
    margin = parseMargin(marginText);
    if (margin === null) {
      // Em /categoria o 3º campo pode ser a lista de lojas.
      const looksNumeric = /^[\d.,%\s]+$/.test(marginText);
      const asStores = looksNumeric ? null : parseStoreList(marginText);
      if (storesText === undefined && asStores?.ok && asStores.stores) {
        return { ok: true, query, target, margin: null, stores: asStores.stores };
      }
      return { ok: false, error: 'A margem precisa ser um número entre 0 e 100.' };
    }
  }
  const stores = parseStoreList(storesText);
  if (!stores.ok) return { ok: false, error: stores.error };
  return { ok: true, query, target, margin, stores: stores.stores };
}

const HELP = [
  '<b>Promo Bot</b>',
  'Eu procuro seus produtos nas lojas e aviso aqui quando o preço entra na faixa.',
  '',
  '<b>Produto</b> (todas as palavras no título, um aviso por oferta)',
  '/add termo | preço | margem% | lojas',
  '   ex.: <code>/add force one kabuto | 300 | 15</code>',
  '   margem é opcional (padrão ' + DEFAULTS.marginPct + '%); lojas é opcional (ex.: <code>kabum,amazon</code>)',
  '   dica: <code>kabuto -almofada</code> exclui títulos com "almofada"',
  '',
  '<b>Categoria</b> (teto de preço, resumo com os mais baratos)',
  '<code>/categoria placa de video rtx 4060 | 2000</code>',
  '<code>/categoria https://www.kabum.com.br/hardware/placa-de-video-vga | 2000</code>',
  '',
  '<b>Gerenciar</b>',
  '/lista · /preco id valor · /margem id % · /pausar id · /ativar id · /remover id',
  '',
  '<b>Lojas e fontes</b>',
  '/lojas — lojas e como cada uma é lida',
  '/lojas off amazon · /lojas on amazon',
  '/fonte add Nome | https://loja.com.br/busca?q={q}',
  '/fonte remover id',
  '',
  '<b>Outros</b>',
  '/cep 00000-000 — guarda seu CEP (frete)',
  '/frete total|produto — comparar com ou sem frete',
  '/checar — roda a checagem agora',
  '/testar termo — mostra o que cada loja devolveu',
  '/status — saúde de cada loja',
].join('\n');

function describeWatch(w: Watch): string {
  const icon = w.active ? '✅' : '⏸️';
  const ceiling = priceCeiling(w.target_price, w.margin_pct);
  const stores = w.stores && w.stores.length > 0 ? ` · lojas: ${w.stores.join(', ')}` : '';
  if (w.kind === 'categoria') {
    return `#${w.id} ${icon} 📦 <b>${escapeHtml(watchLabel(w))}</b> — até ${formatBRL(ceiling)}${escapeHtml(stores)}`;
  }
  return `#${w.id} ${icon} <b>${escapeHtml(w.query)}</b> — alvo ${formatBRL(w.target_price)} (+${w.margin_pct}% = até ${formatBRL(ceiling)})${escapeHtml(stores)}`;
}

function parseId(s: string | undefined): number | null {
  return s !== undefined && /^\d{1,9}$/.test(s) ? Number(s) : null;
}

export async function handleCommand(text: string, ctx: CommandCtx): Promise<CommandResult> {
  const m = text.trim().match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return { reply: 'Não entendi. Use /ajuda pra ver os comandos.' };

  const cmd = (m[1] ?? '').toLowerCase();
  const args = (m[2] ?? '').trim();
  const { db, chatId } = ctx;
  const notFound = (id: number) => ({ reply: `Não achei a busca #${id}.` });

  switch (cmd) {
    case 'start':
    case 'ajuda':
    case 'help':
      return { reply: HELP };

    case 'add':
    case 'adicionar':
    case 'novo': {
      const parsed = parseAddArgs(args);
      if (!parsed.ok) {
        return { reply: `${parsed.error}\nExemplo: <code>/add force one kabuto | 300 | 15</code>` };
      }
      if (/^https?:\/\//i.test(parsed.query)) {
        return { reply: 'Para link de categoria use /categoria. Ex.: <code>/categoria https://... | 2000</code>' };
      }
      if (!searchTerms(parsed.query)) return { reply: 'Escreva pelo menos uma palavra sem “-”.' };
      const margin = parsed.margin ?? DEFAULTS.marginPct;
      const w = await db.addWatch(chatId, {
        query: parsed.query,
        target_price: parsed.target,
        margin_pct: margin,
        kind: 'produto',
        category_url: null,
        stores: parsed.stores,
      });
      return {
        reply:
          `✅ Busca #${w.id} criada: <b>${escapeHtml(w.query)}</b>\n` +
          `Alvo ${formatBRL(w.target_price)}, margem ${w.margin_pct}% (aceito até ${formatBRL(priceCeiling(w.target_price, w.margin_pct))}).\n` +
          (parsed.stores ? `Lojas: ${escapeHtml(parsed.stores.join(', '))}.\n` : '') +
          'Uso /checar pra rodar agora; senão ela entra na próxima rodada automática.',
      };
    }

    case 'categoria':
    case 'cat': {
      const parsed = parseAddArgs(args);
      if (!parsed.ok) {
        return {
          reply:
            `${parsed.error}\nExemplos:\n<code>/categoria placa de video rtx 4060 | 2000</code>\n` +
            '<code>/categoria https://www.kabum.com.br/hardware/placa-de-video-vga | 2000</code>',
        };
      }
      const margin = parsed.margin ?? DEFAULTS.categoryMarginPct;
      let categoryUrl: string | null = null;
      if (/^https?:\/\//i.test(parsed.query)) {
        const url = parsed.query.trim();
        const sources = await db.listSources(chatId);
        const adapters = buildAdapters(ctx.builtins ?? [], sources);
        const knownDomains = adapters.length > 0 ? adapters : null;
        const allowed = knownDomains
          ? knownDomains.some((a) => a.listing && hostAllowed(url, a.domains))
          : BUILTIN_IDS.some((id) => hostAllowed(url, STORE_META[id].domains));
        if (!allowed) {
          return { reply: 'Esse link não é de uma loja cadastrada (veja /lojas). Só aceito https:// de lojas conhecidas.' };
        }
        categoryUrl = url;
      } else if (!searchTerms(parsed.query)) {
        return { reply: 'Escreva pelo menos uma palavra sem “-”.' };
      }
      const w = await db.addWatch(chatId, {
        query: parsed.query,
        target_price: parsed.target,
        margin_pct: margin,
        kind: 'categoria',
        category_url: categoryUrl,
        stores: categoryUrl ? null : parsed.stores,
      });
      return {
        reply:
          `📦 Categoria #${w.id} criada: <b>${escapeHtml(watchLabel(w))}</b>\n` +
          `Aviso o que estiver até ${formatBRL(priceCeiling(w.target_price, w.margin_pct))}, num resumo com os mais baratos.\n` +
          'Uso /checar pra rodar agora.',
      };
    }

    case 'lista':
    case 'list': {
      const all = await db.listWatches(chatId);
      if (all.length === 0) {
        return { reply: 'Nenhuma busca ainda. Exemplo: <code>/add force one kabuto | 300 | 15</code>' };
      }
      return { reply: ['<b>Suas buscas</b>', ...all.map(describeWatch)].join('\n') };
    }

    case 'remover':
    case 'remove':
    case 'apagar': {
      const id = parseId(args);
      if (id === null) return { reply: 'Use: /remover id (o número que aparece em /lista).' };
      return (await db.deleteWatch(chatId, id)) ? { reply: `🗑️ Busca #${id} removida.` } : notFound(id);
    }

    case 'pausar':
    case 'ativar': {
      const id = parseId(args);
      if (id === null) return { reply: `Use: /${cmd} id` };
      const w = await db.updateWatch(chatId, id, { active: cmd === 'ativar' });
      return w ? { reply: `${cmd === 'ativar' ? '▶️ Ativada' : '⏸️ Pausada'}:\n${describeWatch(w)}` } : notFound(id);
    }

    case 'preco': {
      const [idText, priceText] = args.split(/\s+/);
      const id = parseId(idText);
      const price = parsePriceBRL(priceText);
      if (id === null || price === null) return { reply: 'Use: /preco id valor (ex.: /preco 1 280)' };
      const w = await db.updateWatch(chatId, id, { target_price: price });
      return w ? { reply: `Atualizado:\n${describeWatch(w)}` } : notFound(id);
    }

    case 'margem': {
      const [idText, marginText] = args.split(/\s+/);
      const id = parseId(idText);
      const margin = parseMargin(marginText);
      if (id === null || margin === null) return { reply: 'Use: /margem id % (ex.: /margem 1 10)' };
      const w = await db.updateWatch(chatId, id, { margin_pct: margin });
      return w ? { reply: `Atualizado:\n${describeWatch(w)}` } : notFound(id);
    }

    case 'cep': {
      if (!args) {
        const cep = await db.getCep(chatId);
        return { reply: cep ? `Seu CEP guardado: <code>${cep}</code>` : 'Nenhum CEP guardado. Use: /cep 00000-000' };
      }
      const cep = parseCep(args);
      if (!cep) return { reply: 'CEP inválido. Use 8 dígitos, ex.: /cep 16010-000' };
      await db.setCep(chatId, cep);
      return {
        reply:
          `📍 CEP guardado: <code>${cep}</code>.\n` +
          'Calculo o frete para esse CEP onde a loja permite (Mercado Livre com a API ligada). ' +
          'Nas outras, repito o que a página informa (ex.: frete grátis) e o alerta pede para conferir na loja.',
      };
    }

    case 'frete': {
      if (!args) {
        const s = await db.getSettings(chatId);
        return {
          reply:
            `Modo atual: <b>${s.freight_mode}</b>.\n` +
            '/frete total — compara preço + frete com o alvo (quando o frete é conhecido)\n' +
            '/frete produto — compara só o preço do produto',
        };
      }
      const mode = parseFreightMode(args);
      if (!mode) return { reply: 'Use: /frete total ou /frete produto' };
      await db.setFreightMode(chatId, mode);
      return {
        reply: mode === 'total' ? '🚚 Ok: comparo preço + frete (quando eu souber o frete).' : '🚚 Ok: comparo só o preço do produto.',
      };
    }

    case 'checar':
    case 'check':
      return { reply: '🔎 Checando agora. Aviso quando terminar (pode levar um minuto).', action: { type: 'check' } };

    case 'testar':
    case 'test': {
      if (!args) return { reply: 'Use: /testar termo (ex.: /testar force one kabuto)' };
      return { reply: `🧪 Testando cada loja com “${escapeHtml(args)}”…`, action: { type: 'test', query: args } };
    }

    case 'status':
      return { reply: buildStatusMessage(await db.getStoreStatus()) };

    case 'lojas':
    case 'stores':
    case 'fontes': {
      const [sub, ...rest] = args.split(/\s+/);
      const op = (sub ?? '').toLowerCase();
      if (op === 'on' || op === 'off' || op === 'ligar' || op === 'desligar') {
        const id = resolveStore(rest.join(' '));
        if (!id) return { reply: `Use: /lojas ${op} nome (ex.: /lojas ${op} amazon). Lojas: ${BUILTIN_IDS.join(', ')}` };
        const enabled = op === 'on' || op === 'ligar';
        await db.setBuiltinEnabled(chatId, id, STORE_META[id].name, enabled);
        return { reply: `${enabled ? '▶️ Ligada' : '⏸️ Desligada'}: ${STORE_META[id].name}` };
      }
      const sources = await db.listSources(chatId);
      const disabled = new Set(sources.filter((s) => s.kind === 'builtin' && !s.enabled).map((s) => s.store_id));
      const builtins = ctx.builtins ?? [];
      const lines = ['<b>Lojas</b>'];
      for (const id of BUILTIN_IDS) {
        const adapter = builtins.find((a) => a.id === id);
        const how = adapter ? ` — ${viaLabel(adapter, ctx.secrets)}` : '';
        lines.push(`${disabled.has(id) ? '⏸️' : '✅'} ${STORE_META[id].name}${escapeHtml(how)}`);
      }
      const custom = sources.filter((s) => s.kind === 'custom');
      if (custom.length > 0) {
        lines.push('', '<b>Fontes cadastradas</b>');
        for (const s of custom) lines.push(`#${s.id} ${s.enabled ? '✅' : '⏸️'} ${escapeHtml(s.name)} — ${escapeHtml(s.domains.join(', '))}`);
      }
      lines.push('', '/lojas off nome · /lojas on nome · /fonte add Nome | https://loja/busca?q={q}');
      return { reply: lines.join('\n') };
    }

    case 'fonte': {
      const [sub, ...rest] = args.split(/\s+/);
      const op = (sub ?? '').toLowerCase();
      const restText = rest.join(' ');
      if (op === 'add' || op === 'nova' || op === 'adicionar') {
        const parts = restText.split('|').map((p) => p.trim());
        const [name, template, testTerm] = parts;
        if (!name || !template) {
          return { reply: 'Use: /fonte add Nome | https://loja.com.br/busca?q={q} | termo para testar (opcional)' };
        }
        if (name.length > 40) return { reply: 'Nome muito longo (máx. 40).' };
        const check = checkTemplate(template);
        if (!check.ok) return { reply: check.error };
        const existing = await db.listSources(chatId);
        if (existing.filter((s) => s.kind === 'custom').length >= 20) return { reply: 'Limite de 20 fontes.' };
        const src = await db.addCustomSource(chatId, { name, search_url: template.trim(), domains: [check.domain] });
        return {
          reply: `➕ Fonte #${src.id} cadastrada: <b>${escapeHtml(src.name)}</b> (${escapeHtml(check.domain)}). Testando…`,
          action: { type: 'test-source', sourceId: src.id, query: testTerm || 'ssd' },
        };
      }
      if (op === 'remover' || op === 'apagar' || op === 'remove') {
        const id = parseId(restText.trim());
        if (id === null) return { reply: 'Use: /fonte remover id (veja /lojas)' };
        return (await db.deleteSource(chatId, id)) ? { reply: `🗑️ Fonte #${id} removida.` } : { reply: `Não achei a fonte #${id}.` };
      }
      return { reply: 'Use: /fonte add Nome | https://loja.com.br/busca?q={q}  ou  /fonte remover id' };
    }

    default:
      return { reply: 'Comando desconhecido. Use /ajuda.' };
  }
}
