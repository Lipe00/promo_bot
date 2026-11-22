import { DEFAULTS } from './config.ts';
import { checkRobots } from './robots.ts';
import type { FetchInit, FetchOutcome } from './types.ts';

/** Nome do robô no robots.txt. */
export const BOT_TOKEN = 'promo-bot';

export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 promo-bot/0.1';

const CHALLENGE_PATTERNS: RegExp[] = [
  /captcha/i,
  /digite os caracteres/i,
  /enter the characters you see/i,
  /robot check/i,
  /are you a robot/i,
  /access denied/i,
  /acesso negado/i,
  /just a moment\.\.\./i,
  /unusual traffic/i,
  /verifica(ç|c)(ã|a)o de seguran(ç|c)a/i,
  // Mercado Livre: tela de "tráfego suspeito" / verificação de conta (HTTP 200, sem produtos).
  /suspicious-traffic/i,
  /account-verification/i,
];

/**
 * Decide se a resposta é um bloqueio (captcha, 403/429...) ou um erro comum.
 * Páginas de resultado de verdade são grandes; telas de captcha costumam ser pequenas.
 */
export function detectBlock(
  status: number,
  body: string,
): { kind: 'blocked' | 'error'; message: string } | null {
  if (status === 403 || status === 429) {
    return { kind: 'blocked', message: `HTTP ${status}: a loja bloqueou o acesso automático` };
  }
  if (status === 503 && body.length < 60_000) {
    return { kind: 'blocked', message: 'HTTP 503: provável bloqueio ou captcha' };
  }
  if (status >= 500) return { kind: 'error', message: `HTTP ${status}: erro na loja` };
  if (status >= 400) return { kind: 'error', message: `HTTP ${status}: página não encontrada` };
  if (body.length < 40_000 && CHALLENGE_PATTERNS.some((re) => re.test(body))) {
    return { kind: 'blocked', message: 'a loja mostrou uma tela de verificação (captcha)' };
  }
  return null;
}

const lastHit = new Map<string, number>();

async function politePause(host: string, gapMs: number): Promise<void> {
  const wait = (lastHit.get(host) ?? 0) + gapMs - Date.now();
  // Reserva o horário antes de esperar, para chamadas em paralelo ao mesmo site entrarem em fila.
  lastHit.set(host, Math.max(Date.now(), (lastHit.get(host) ?? 0) + gapMs));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Abre uma página de loja com educação: respeita robots.txt, espera entre requisições ao mesmo site,
 * tem tempo limite e NÃO tenta contornar bloqueio (sem proxy, sem captcha, sem insistir).
 * Com `api: true` (APIs oficiais), pula robots.txt e a detecção de captcha.
 */
export function makeFetchHtml(opts: { gapMs?: number; timeoutMs?: number; fetchFn?: typeof fetch } = {}) {
  const gapMs = opts.gapMs ?? DEFAULTS.requestGapMs;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.requestTimeoutMs;
  const doFetch = opts.fetchFn ?? fetch;

  return async function fetchHtml(url: string, init: FetchInit = {}): Promise<FetchOutcome> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return { kind: 'error', message: 'URL de busca inválida' };
    }

    if (!init.api) {
      const robots = await checkRobots(url, { agent: BOT_TOKEN, userAgent: USER_AGENT, fetchFn: doFetch });
      if (!robots.allowed) return { kind: 'robots', message: robots.reason ?? 'bloqueado pelo robots.txt' };
    }

    await politePause(host, init.api ? Math.min(gapMs, 300) : gapMs);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: init.method ?? 'GET',
        body: init.body,
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: init.accept === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',
          'accept-language': 'pt-BR,pt;q=0.9',
          ...(init.headers ?? {}),
        },
      });
      const html = (await res.text()).slice(0, 3_000_000);
      if (init.api) {
        if (res.status >= 500) return { kind: 'error', message: `HTTP ${res.status}: erro na API` };
        return { kind: 'ok', html, finalUrl: res.url || url, status: res.status };
      }
      const problem = detectBlock(res.status, html);
      if (problem) return { kind: problem.kind, message: problem.message };
      return { kind: 'ok', html, finalUrl: res.url || url, status: res.status };
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'AbortError';
      return {
        kind: 'error',
        message: timedOut ? `tempo esgotado (${timeoutMs / 1000}s)` : 'falha de rede ao abrir a loja',
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Lê JSON de uma resposta já baixada; null se não for JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
