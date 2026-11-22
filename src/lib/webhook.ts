import { testStores } from './checker.ts';
import type { CheckSummary } from './checker.ts';
import { handleCommand } from './commands.ts';
import { buildSummaryMessage, buildTestMessage, escapeHtml } from './format.ts';
import { searchTerms } from './matching.ts';
import { makeGenericStore } from './stores/generic.ts';
import type { AdapterEnv, CommandDb, StoreAdapter } from './types.ts';

interface TelegramMessage {
  text?: string;
  chat?: { id?: number };
}
export interface TelegramUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface WebhookDeps {
  /** Chat dono do bot (TELEGRAM_ALLOWED_CHAT_ID). Vazio = modo de configuração. */
  allowedChatId: string | undefined;
  send(chatId: number, html: string): Promise<void>;
  /** Só é chamado depois de conferir o dono, para não exigir banco no modo de configuração. */
  getDb(): CommandDb;
  builtins: StoreAdapter[];
  env: AdapterEnv;
  adaptersFor(chatId: number): Promise<StoreAdapter[]>;
  runCheck(chatId: number): Promise<CheckSummary | { skipped: string }>;
  /** Agenda trabalho para depois da resposta HTTP (after() do Next). */
  defer(task: () => Promise<void>): void;
  log?: (msg: string) => void;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'erro desconhecido';
}

/**
 * Trata um update do Telegram. Mensagens editadas são ignoradas:
 * editar um "/add" não pode criar uma busca repetida.
 */
export async function handleUpdate(update: TelegramUpdate | null, deps: WebhookDeps): Promise<void> {
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;
  if (typeof chatId !== 'number' || typeof text !== 'string') return;
  const log = deps.log ?? ((m: string) => console.error(m));

  try {
    const allowed = deps.allowedChatId?.trim();
    if (!allowed) {
      await deps.send(
        chatId,
        `Seu chat id é <code>${chatId}</code>.\nCadastre como <code>TELEGRAM_ALLOWED_CHAT_ID</code> na Vercel e faça um novo deploy. Até lá eu não respondo mais nada.`,
      );
      return;
    }
    // Qualquer outra pessoa que achar o bot é ignorada em silêncio.
    if (String(chatId) !== allowed) return;

    const db = deps.getDb();
    const result = await handleCommand(text, { db, chatId, builtins: deps.builtins, secrets: deps.env.secrets });
    await deps.send(chatId, result.reply);

    const action = result.action;
    if (!action) return;
    deps.defer(async () => {
      try {
        if (action.type === 'check') {
          const summary = await deps.runCheck(chatId);
          await deps.send(chatId, 'skipped' in summary ? `⏳ ${summary.skipped}` : buildSummaryMessage(summary));
        } else if (action.type === 'test') {
          const terms = searchTerms(action.query);
          if (!terms) {
            await deps.send(chatId, 'Escreva pelo menos uma palavra sem “-” para testar.');
            return;
          }
          const cep = await db.getCep(chatId);
          const results = await testStores(await deps.adaptersFor(chatId), deps.env, terms, { cep });
          await deps.send(chatId, buildTestMessage(action.query, results));
        } else if (action.type === 'test-source') {
          const src = (await db.listSources(chatId)).find((s) => s.id === action.sourceId);
          if (!src) return;
          const [res] = await testStores([makeGenericStore(src)], deps.env, searchTerms(action.query) || action.query);
          const tip =
            res && res.result.status === 'ok'
              ? '\nEla já entra nas próximas buscas.'
              : '\nSe não funcionar, remova com /fonte remover ' + src.id + ' (a loja precisa publicar dados JSON-LD).';
          await deps.send(
            chatId,
            (res ? buildTestMessage(`${escapeHtml(src.name)} · ${action.query}`, [res]) : 'Teste sem resultado.') + tip,
          );
        }
      } catch (e) {
        log(`ação ${action.type} falhou: ${errorText(e)}`);
        await deps.send(chatId, '❌ Algo deu errado nessa ação. Veja os logs na Vercel.').catch(() => {});
      }
    });
  } catch (e) {
    log(`webhook falhou: ${errorText(e)}`);
    await deps.send(chatId, '❌ Algo deu errado aqui. Veja os logs na Vercel.').catch(() => {});
  }
}
