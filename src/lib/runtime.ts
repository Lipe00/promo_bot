import { runChecks } from './checker.ts';
import type { CheckDeps, CheckSummary } from './checker.ts';
import { createDb } from './db.ts';
import type { Db } from './db.ts';
import { makeFetchHtml } from './http.ts';
import { STORE_ADAPTERS, buildAdapters } from './stores/index.ts';
import { sendTelegram } from './telegram.ts';
import type { StoreAdapter } from './types.ts';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

/** Chaves de API lidas das variáveis de ambiente (nunca do banco nem do Telegram). */
export function apiSecrets(): Record<string, string | undefined> {
  const e = process.env;
  return {
    ML_CLIENT_ID: e.ML_CLIENT_ID,
    ML_CLIENT_SECRET: e.ML_CLIENT_SECRET,
    SHOPEE_AFFILIATE_APP_ID: e.SHOPEE_AFFILIATE_APP_ID,
    SHOPEE_AFFILIATE_SECRET: e.SHOPEE_AFFILIATE_SECRET,
    ALI_APP_KEY: e.ALI_APP_KEY,
    ALI_APP_SECRET: e.ALI_APP_SECRET,
    ALI_TRACKING_ID: e.ALI_TRACKING_ID,
  };
}

export interface Runtime {
  db: Db;
  token: string;
  deps: CheckDeps;
  /** Lojas de um chat (embutidas ligadas + fontes cadastradas). */
  adaptersFor(chatId: number): Promise<StoreAdapter[]>;
}

let cached: Runtime | null = null;

/** Monta banco, Telegram e lojas uma vez por instância da função. */
export function getRuntime(): Runtime {
  if (cached) return cached;
  // Aceita a URL copiada com "/rest/v1/" no fim (o supabase-js quer só a base).
  const supabaseUrl = requireEnv('SUPABASE_URL').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const db = createDb(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const budget = Number(process.env.CHECK_BUDGET_MS);
  cached = {
    db,
    token,
    deps: {
      db,
      adapters: STORE_ADAPTERS,
      env: { fetchHtml: makeFetchHtml(), secrets: apiSecrets() },
      notify: (chatId, html) => sendTelegram(token, chatId, html, { preview: true }),
      ...(Number.isFinite(budget) && budget > 0 ? { budgetMs: budget } : {}),
    },
    adaptersFor: async (chatId) => buildAdapters(STORE_ADAPTERS, await db.listSources(chatId)),
  };
  return cached;
}

const LOCK_NAME = 'check';
const LOCK_TTL_SECONDS = 120;

/** Roda a checagem com trava, para duas execuções não se atropelarem. */
export async function runLocked(chatId?: number): Promise<CheckSummary | { skipped: string }> {
  const rt = getRuntime();
  if (!(await rt.db.tryLock(LOCK_NAME, LOCK_TTL_SECONDS))) {
    return { skipped: 'Já existe uma checagem em andamento. Tente de novo em alguns minutos.' };
  }
  try {
    return await runChecks(rt.deps, chatId === undefined ? {} : { chatId });
  } finally {
    await rt.db.unlock(LOCK_NAME).catch(() => {});
  }
}
