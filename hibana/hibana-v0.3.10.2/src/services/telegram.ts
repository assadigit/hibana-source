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

// ─── Plan B backup channel (docs/perf-and-data-safety.md §1) ────────────────────
// sendDocument with a hand-rolled multipart body. FormData/Blob would also work on
// both runtimes, but a manual body is trivially unit-testable (tests read the boundary
// parts), identical on Workers + Node, and avoids BodyInit typing friction between
// workers-types and DOM lib. Documents are the ONE payload that can be multi-MB, so
// this gets its own (longer) timeout instead of the 25s message timeout.

const TG_DOC_TIMEOUT_MS = 60_000

/**
 * Send a binary document (file) to a chat.
 * @param filename  visible name in the chat (e.g. hibana-backup-<ISO>.bin)
 * @param bytes     the file body
 * @param caption   plain-text caption under the file (no parse mode — keeps it verbatim)
 * @param silent    true = disable_notification (Plan B sends must not buzz the owner 4×/day)
 */
export function sendTelegramDocument(
  token: string,
  chatId: string | number,
  filename: string,
  bytes: Uint8Array,
  caption?: string,
  silent = true,
): Promise<Response> {
  const boundary = 'hibana-' + crypto.randomUUID().replaceAll('-', '')
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="disable_notification"\r\n\r\n${silent ? 'true' : 'false'}\r\n` +
    (caption
      ? `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`
      : '') +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  // One contiguous body: concat head + bytes + tail (the blob is ~100 KB today; even
  // at the 50 MB cap a single concat is fine inside a Worker request).
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)
  return fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: body as unknown as BodyInit, // BodyInit accepts ArrayBufferView on both runtimes
    signal: AbortSignal.timeout(TG_DOC_TIMEOUT_MS),
  })
}

/** Retention helper for Plan B: delete one of the bot's own messages (private chats allow this without a time limit). */
export function deleteTelegramMessage(token: string, chatId: string | number, messageId: number): Promise<Response> {
  return tgFetch(`https://api.telegram.org/bot${token}/deleteMessage`, { chat_id: chatId, message_id: messageId })
}

/** Pin a message in a private chat (used to keep the newest Plan B document at the top of the chat). */
export function pinTelegramMessage(token: string, chatId: string | number, messageId: number, silent = true): Promise<Response> {
  return tgFetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
    chat_id: chatId,
    message_id: messageId,
    disable_notification: silent,
  })
}

/** Remove every pinned message in a chat (called before pinning the newest Plan B document). */
export function unpinAllTelegramMessages(token: string, chatId: string | number): Promise<Response> {
  return tgFetch(`https://api.telegram.org/bot${token}/unpinAllChatMessages`, { chat_id: chatId })
}
