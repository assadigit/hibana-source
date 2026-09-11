// Structured logging (P3.1 / F-M12).
//
// Emits JSON lines: { ts, level, event, reqId?, ...fields }. Workers `console.log` of a
// serializable object renders structured in `wrangler tail --format json`; the Node path
// writes the same line to stdout. Every log carries the request id (set by the reqId
// middleware in app.ts) so a failed backup, a 500, and a rate-limit hit in the same
// request are correlatable in the tail.
//
// Deliberately tiny: no transports, no levels above info/warn/error, no async. The goal
// is observability for a single-owner app, not a logging framework.

type LogLevel = 'info' | 'warn' | 'error'

interface LogFields {
  [k: string]: unknown
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    // reqId is pulled from the module-level currentReqId (set per-request by app.ts
    // middleware). Falls back to undefined when logging outside a request (cron jobs).
    reqId: currentReqId,
    ...fields,
  }
  // console.log/warn/error so the severity carries in both `wrangler tail` and Node stdout.
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(JSON.stringify(line))
}

/** Per-request id (AsyncLocalStorage would be ideal, but Workers doesn't expose it; the
 *  reqId middleware in app.ts sets this on c.var and we read it back via withReqId). */
let currentReqId: string | undefined

/** Scoped logger used inside a request: pass the reqId (from c.get('reqId')) once. */
export function withReqId<T>(reqId: string | undefined, fn: () => T): T {
  const prev = currentReqId
  currentReqId = reqId
  try {
    return fn()
  } finally {
    currentReqId = prev
  }
}

export const log = {
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
}
