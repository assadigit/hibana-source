// src/lib/errors.ts — structured API errors (Phase 0).
//
// Why this exists: every route today answers errors as `c.json({ error: 'string' }, 4xx)`
// with ad-hoc, un-typed code strings. The frontend can't branch on error types reliably
// and new endpoints invent new spellings. This module introduces:
//
//   - An `ErrorCode` registry (the single source of truth for error codes).
//   - An `ApiError` class carrying a code + http status + optional detail.
//   - A tiny `apiError()` helper to keep call sites terse.
//
// Wiring (src/app.ts onError handler): an unhandled `ApiError` is serialized as
// `{ error: code, message? }` at its status; any other unhandled throw still falls back
// to the existing `{ error: 'internal_error' }` 500 — so existing routes keep their exact
// response shape and this layer is opt-in for new code. No behavior change for callers
// that don't throw ApiError.

import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Centralized error code registry. Adding a new code = adding a line here, so codes
 *  are greppable and the frontend can type-check against this union. */
export const ErrorCode = {
  // 400 — bad input
  invalid_input: 'invalid_input',
  empty_update: 'empty_update',
  too_many: 'too_many',
  // 401 — auth
  unauthorized: 'unauthorized',
  // 403 — forbidden
  forbidden: 'forbidden',
  csrf_failed: 'csrf_failed',
  // 404 — not found
  not_found: 'not_found',
  // 409 — conflict
  duplicate: 'duplicate',
  // 410 — gone
  archived: 'archived',
  // 429 — rate limited
  rate_limited: 'rate_limited',
  // 500 — server
  internal_error: 'internal_error',
  unavailable: 'unavailable',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

const STATUS_BY_CODE: Record<ErrorCodeValue, ContentfulStatusCode> = {
  invalid_input: 400,
  empty_update: 400,
  too_many: 400,
  unauthorized: 401,
  forbidden: 403,
  csrf_failed: 403,
  not_found: 404,
  duplicate: 409,
  archived: 410,
  rate_limited: 429,
  internal_error: 500,
  unavailable: 503,
}

/** A throwable, typed API error. Routes that want a structured response shape throw
 *  one of these; `app.onError` serializes it. Callers that don't, keep the old shape. */
export class ApiError extends Error {
  readonly code: ErrorCodeValue
  readonly status: ContentfulStatusCode
  readonly detail?: string
  constructor(code: ErrorCodeValue, detail?: string, status?: ContentfulStatusCode) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status ?? STATUS_BY_CODE[code]
    this.detail = detail
  }
}

/** Terse constructor for routes: `throw apiError(ErrorCode.not_found)` */
export const apiError = (code: ErrorCodeValue, detail?: string, status?: ContentfulStatusCode): ApiError =>
  new ApiError(code, detail, status)

/** The fallback shape for any unhandled, non-ApiError throw — matches the legacy
 *  `{ error: 'internal_error' }` 500 so existing behavior is preserved exactly. */
export const internalErrorResponse = { error: ErrorCode.internal_error } as const

/** Serialize an ApiError for the JSON body. Shape: `{ error: code }` plus `message`
 *  only when a detail is present, so existing clients that read `.error` keep working. */
export function errorBody(err: ApiError): Record<string, unknown> {
  return err.detail ? { error: err.code, message: err.detail } : { error: err.code }
}
