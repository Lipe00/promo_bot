// Modo "real" local: o Telegram não alcança localhost por webhook, então este script
// busca as mensagens com getUpdates e repassa cada uma para a rota /api/telegram do app.
// Ele apaga o webhook do bot ao iniciar. Para voltar à Vercel, abra /api/telegram/setup de novo.
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const app = process.env.APP_URL ?? 'http://app-real:3000';
if (!token || !secret) {
  console.error('Faltam TELEGRAM_BOT_TOKEN e/ou TELEGRAM_WEBHOOK_SECRET no .env.local');
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

const me = await api('getMe');
console.log(me.ok ? `bot: @${me.result.username}` : `getMe falhou: ${me.description}`);
const del = await api('deleteWebhook', { drop_pending_updates: false });
console.log('deleteWebhook:', del.ok ? 'ok' : del.description);

let offset = 0;
for (;;) {
  try {
    const res = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    if (!res.ok) {
      console.error('getUpdates falhou:', res.description);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const update of res.result) {
      offset = update.update_id + 1;
      const chat = update.message?.chat?.id;
      console.log(`update ${update.update_id} do chat ${chat}: ${(update.message?.text ?? '').slice(0, 60)}`);
      const r = await fetch(`${app}/api/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
        body: JSON.stringify(update),
      });
      if (!r.ok) console.error('app respondeu', r.status);
    }
  } catch (e) {
    console.error('erro no poller:', e instanceof Error ? e.message : e);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
