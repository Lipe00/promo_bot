import { DEFAULTS } from './config.ts';
import { priceCeiling } from './price.ts';

export type AlertLevel = 'abaixo_do_alvo' | 'dentro_da_margem';
export type AlertReason = 'novo' | 'preco_caiu' | 'lembrete';

export type AlertDecision =
  | { send: true; level: AlertLevel; reason: AlertReason }
  | { send: false; reason: string; resetAlertState: boolean };

export interface AlertInput {
  /** Preço comparado (o menor entre normal e à vista/Pix). */
  price: number;
  target: number;
  marginPct: number;
  /** Fim da promoção, se a loja informou. */
  endsAt: string | null;
  /** Estado do último alerta dessa mesma oferta, ou null se nunca foi avisada. */
  prev: { last_alerted_price: number | null; last_alerted_at: string | null } | null;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function decideAlert(i: AlertInput): AlertDecision {
  const ceiling = priceCeiling(i.target, i.marginPct);

  // Saiu da faixa: zera o estado, assim ela é avisada de novo quando voltar.
  if (i.price > ceiling) return { send: false, reason: 'acima da margem', resetAlertState: true };

  if (i.endsAt !== null) {
    const end = Date.parse(i.endsAt);
    if (!Number.isNaN(end) && end <= i.now.getTime()) {
      return { send: false, reason: 'promoção encerrada', resetAlertState: true };
    }
  }

  const level: AlertLevel = i.price <= i.target ? 'abaixo_do_alvo' : 'dentro_da_margem';
  const prev = i.prev;

  if (!prev || prev.last_alerted_price === null || prev.last_alerted_at === null) {
    return { send: true, level, reason: 'novo' };
  }

  if (i.price <= prev.last_alerted_price * (1 - DEFAULTS.realertDropPct / 100)) {
    return { send: true, level, reason: 'preco_caiu' };
  }

  const lastAlert = Date.parse(prev.last_alerted_at);
  if (!Number.isNaN(lastAlert) && i.now.getTime() - lastAlert >= DEFAULTS.reminderDays * DAY_MS) {
    return { send: true, level, reason: 'lembrete' };
  }

  return { send: false, reason: 'já avisado', resetAlertState: false };
}
