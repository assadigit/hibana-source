// Outbound Telegram Bot API — the one sender for bot replies (integrations.ts
// webhook) and the client-reminder cron (reminders.ts). Only the Worker runtime can
// reach api.telegram.org, so tests stub fetch(); Node/local runs just skip (no token).
//
// All sends carry a 25s timeout (AbortSignal.timeout) so a slow Telegram API never blocks
// the webhook handler from returning — Telegram retries undelivered webhooks, but a
// hung Worker request just wastes the invocation budget and stalls the user's tap.

// Inline keyboard markup (callback_data buttons). Buttons carry short op-codes
// (design §8) — all op-codes are ≤ ~41 bytes, well under Telegram's 64-byte
// callback_data cap. The data layer is locale-independent; only `text` is translated.
export type InlineKeyboardButton = { text: string; callback_data: string }
export type ReplyMarkup = { inline_keyboard: InlineKeyboardButton[][] }

const TG_TIMEOUT_MS = 25_000
const tgFetch = (url: string, body: unknown): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TG_TIMEOUT_MS),
  })

export function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string,
  parseMode?: 'HTML' | 'Markdown',
  replyMarkup?: ReplyMarkup,
): Promise<Response> {
  return tgFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

/** Ack a callback tap (clears the spinner on the user's side). Optional short toast text. */
export function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<Response> {
  return tgFetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  })
}

/** Edit the text + keyboard of an existing message (used for in-place screen changes on button taps). */
export function editMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  parseMode?: 'HTML' | 'Markdown',
  replyMarkup?: ReplyMarkup,
): Promise<Response> {
  return tgFetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}
