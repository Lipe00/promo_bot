import { BUILTIN_IDS, STORE_META, isBuiltinId } from './config.ts';
import { formatBRL, priceCeiling } from './price.ts';
import type { AlertLevel, AlertReason } from './alerts.ts';
import type { FreightMode, RawOffer, StoreResult, StoreStatusKind, StoreStatusRow, Watch } from './types.ts';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** "27/11 às 23:59", no horário de Brasília. */
export function formatDateTimeBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')} às ${get('hour')}:${get('minute')}`;
}

/** Nome de uma loja pelo id (embutida) ou pelo nome guardado. */
export function storeName(id: string, fallback?: string | null): string {
  if (fallback) return fallback;
  return isBuiltinId(id) ? STORE_META[id].name : id;
}

/** Linha de frete do alerta. */
export function freightLine(offer: RawOffer, cep: string | null): string {
  if (typeof offer.shippingPrice === 'number') {
    const where = cep ? ` para ${escapeHtml(cep)}` : '';
    return offer.shippingPrice === 0 ? `🚚 Frete${where}: grátis` : `🚚 Frete${where}: ${formatBRL(offer.shippingPrice)}`;
  }
  if (offer.freightNote) return `🚚 ${escapeHtml(offer.freightNote)}`;
  if (cep) return `🚚 Frete: confira na página da loja com o CEP ${escapeHtml(cep)}`;
  return '🚚 Frete: confira na página da loja (cadastre o CEP com /cep)';
}

/** Descrição curta de uma busca (termo ou link de categoria). */
export function watchLabel(w: Watch): string {
  if (w.category_url) {
    try {
      const u = new URL(w.category_url);
      return u.hostname.replace(/^www\./, '') + u.pathname;
    } catch {
      return w.category_url;
    }
  }
  return w.query;
}

export interface AlertMessageInput {
  watch: Watch;
  storeName: string;
  offer: RawOffer;
  /** Preço comparado com o alvo (pode incluir frete). Padrão: o menor entre cartão e Pix. */
  compared?: number;
  level: AlertLevel;
  reason: AlertReason;
  cep: string | null;
  freightMode?: FreightMode;
}

export function buildAlertMessage(p: AlertMessageInput): string {
  const { watch, offer } = p;
  const ceiling = priceCeiling(watch.target_price, watch.margin_pct);
  const head = p.level === 'abaixo_do_alvo' ? '🔥 Achei abaixo do seu preço' : '👀 Achei dentro da sua margem';

  const lines: string[] = [`<b>${head}</b>`, `<b>${escapeHtml(offer.title)}</b>`, `🏪 ${escapeHtml(p.storeName)}`];

  let priceLine = `💰 ${formatBRL(offer.price)}`;
  if (offer.cashPrice && offer.cashPrice < offer.price) {
    priceLine += ` · à vista/Pix ${formatBRL(offer.cashPrice)}`;
  }
  lines.push(priceLine);
  if (offer.priceFrom) lines.push('⚠️ preço "a partir de": o anúncio tem variações; confira se é a que você quer');
  if (offer.regularPrice && offer.regularPrice > offer.price) {
    lines.push(`🏷️ de ${formatBRL(offer.regularPrice)}`);
  }
  lines.push(freightLine(offer, p.cep));
  if (p.freightMode === 'total' && typeof offer.shippingPrice === 'number' && offer.shippingPrice > 0 && p.compared) {
    lines.push(`🧾 Total com frete: ${formatBRL(p.compared)}`);
  }
  lines.push(`🎯 alvo ${formatBRL(watch.target_price)} (+${watch.margin_pct}% = até ${formatBRL(ceiling)})`);
  if (p.reason === 'preco_caiu') lines.push('📉 caiu desde o último aviso');
  if (p.reason === 'lembrete') lines.push('🔁 lembrete: continua nessa faixa');

  if (offer.endsAt) lines.push(`⏰ Promoção até ${formatDateTimeBR(offer.endsAt)}`);

  lines.push(`🔗 <a href="${escapeAttr(offer.url)}">Abrir na loja</a>`);
  lines.push(`<i>Busca #${watch.id}: ${escapeHtml(watchLabel(watch))}</i>`);
  return lines.join('\n');
}

export interface DigestItem {
  storeName: string;
  offer: RawOffer;
  compared: number;
}

/** Resumo de uma categoria: os mais baratos numa mensagem só. */
export function buildCategoryDigest(p: {
  watch: Watch;
  items: DigestItem[];
  more: number;
  cep: string | null;
  freightMode?: FreightMode;
}): string {
  const { watch } = p;
  const ceiling = priceCeiling(watch.target_price, watch.margin_pct);
  const lines = [
    `<b>📦 ${escapeHtml(watchLabel(watch))}</b>`,
    `${p.items.length + p.more} item(ns) até ${formatBRL(ceiling)}. Os mais baratos:`,
    '',
  ];
  p.items.forEach((it, i) => {
    const o = it.offer;
    let price = formatBRL(it.compared);
    if (p.freightMode === 'total' && typeof o.shippingPrice === 'number' && o.shippingPrice > 0) price += ' c/ frete';
    else if (o.cashPrice && o.cashPrice < o.price) price += ' no Pix';
    if (o.priceFrom) price = `a partir de ${price}`;
    const extra: string[] = [];
    if (typeof o.shippingPrice === 'number') extra.push(o.shippingPrice === 0 ? 'frete grátis' : `frete ${formatBRL(o.shippingPrice)}`);
    else if (o.freightNote) extra.push('frete grátis indicado');
    if (o.endsAt) extra.push(`⏰ até ${formatDateTimeBR(o.endsAt)}`);
    lines.push(`${i + 1}. <b>${price}</b> · ${escapeHtml(it.storeName)}`);
    lines.push(`   <a href="${escapeAttr(o.url)}">${escapeHtml(shorten(o.title, 90))}</a>`);
    if (extra.length > 0) lines.push(`   ${extra.join(' · ')}`);
  });
  if (p.more > 0) lines.push('', `+${p.more} outro(s) na faixa.`);
  if (!p.cep) lines.push('', '<i>Cadastre o CEP com /cep para eu tentar calcular o frete.</i>');
  lines.push(`<i>Busca #${watch.id}</i>`);
  return lines.join('\n');
}

const STATUS_ICON: Record<StoreStatusKind, string> = {
  ok: '✅',
  empty: '⚠️',
  blocked: '⛔',
  robots: '🚫',
  unsupported: '➖',
  error: '❌',
};

export function statusIcon(kind: StoreStatusKind): string {
  return STATUS_ICON[kind];
}

export function buildStatusMessage(rows: StoreStatusRow[]): string {
  if (rows.length === 0) return 'Ainda não rodei nenhuma checagem. Use /checar.';
  const byStore = new Map(rows.map((r) => [r.store, r]));
  // Lojas embutidas + fontes cadastradas. Linhas de lojas que saíram do bot (ex.: magalu) ficam de fora.
  const ids = [...BUILTIN_IDS, ...rows.map((r) => r.store).filter((id) => id.startsWith('custom:'))];
  const lines = ['<b>Saúde das lojas (última checagem)</b>'];
  for (const id of ids) {
    const r = byStore.get(id);
    const name = storeName(id, r?.name);
    if (!r) {
      lines.push(`• ${escapeHtml(name)}: sem dados`);
      continue;
    }
    lines.push(
      `${statusIcon(r.status)} <b>${escapeHtml(name)}</b>: ${escapeHtml(r.message)} <i>(${formatDateTimeBR(r.checked_at)})</i>`,
    );
  }
  lines.push('', '✅ leu · ⚠️ abriu mas sem produtos · ⛔ bloqueou · 🚫 robots.txt proíbe · ➖ não suportada · ❌ erro');
  return lines.join('\n');
}

function shorten(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Resultado do /testar: o que cada loja devolveu para um termo, sem salvar nada. */
export function buildTestMessage(query: string, results: { id: string; name?: string; result: StoreResult }[]): string {
  const lines = [`<b>Teste: ${escapeHtml(query)}</b>`];
  for (const { id, name, result } of results) {
    lines.push(`${statusIcon(result.status)} <b>${escapeHtml(storeName(id, name))}</b>: ${escapeHtml(result.message)}`);
    const cheapest = [...result.offers].sort((a, b) => a.price - b.price);
    for (const o of cheapest.slice(0, 2)) {
      lines.push(`   · ${escapeHtml(shorten(o.title, 70))} — ${formatBRL(o.price)}`);
    }
  }
  return lines.join('\n');
}

export function buildSummaryMessage(summary: {
  watches: number;
  checked?: number;
  alerts: number;
  stores: Record<string, { name?: string; status: StoreStatusKind; items: number; message: string }>;
}): string {
  const checked = summary.checked ?? summary.watches;
  const head =
    checked < summary.watches
      ? `<b>Checagem concluída</b>: ${checked} de ${summary.watches} busca(s) (o resto entra na próxima rodada), ${summary.alerts} alerta(s).`
      : `<b>Checagem concluída</b>: ${summary.watches} busca(s), ${summary.alerts} alerta(s) enviado(s).`;
  const lines = [head];
  for (const [id, s] of Object.entries(summary.stores)) {
    lines.push(`${statusIcon(s.status)} ${escapeHtml(storeName(id, s.name))}: ${escapeHtml(s.message)}`);
  }
  return lines.join('\n');
}

/** O Telegram limita cada mensagem a 4096 caracteres; quebra por linha. */
export function splitMessage(text: string, max = 4000): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > max) {
      chunks.push(current);
      current = '';
    }
    current = current ? current + '\n' + line : line;
  }
  if (current) chunks.push(current);
  return chunks;
}
