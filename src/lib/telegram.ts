import { splitMessage } from './format.ts';

/** TELEGRAM_API_BASE existe só para os testes locais (servidor falso no Docker). */
function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
}

/** Chama um método da Bot API. O token vai na URL, então nunca registre a URL nem o erro completo. */
export async function telegramCall(token: string, method: string, payload: unknown): Promise<unknown> {
  const res = await fetch(`${apiBase()}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Telegram ${method} respondeu ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Envia texto em HTML (quebrando em várias mensagens se passar do limite). */
export async function sendTelegram(
  token: string,
  chatId: number,
  html: string,
  opts: { preview?: boolean } = {},
): Promise<void> {
  for (const part of splitMessage(html)) {
    await telegramCall(token, 'sendMessage', {
      chat_id: chatId,
      text: part,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: !opts.preview },
    });
  }
}
