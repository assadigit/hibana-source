// Outbound Telegram Bot API — the one sender for bot replies (integrations.ts
// webhook) and the client-reminder cron (reminders.ts). Only the Worker runtime can
// reach api.telegram.org, so tests stub fetch(); Node/local runs just skip (no token).

export function sendTelegramMessage(token: string, chatId: string | number, text: string, parseMode?: 'HTML' | 'Markdown'): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
  })
}