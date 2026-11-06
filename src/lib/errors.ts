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

import type { Context, Env } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Centralized error code registry. Adding a new code = adding a line here, so codes
 *  are greppable and the frontend can type-check against this union. */
export const ErrorCode = {
  // 400 — bad input
  invalid_input: 'invalid_input',
  empty_update: 'empty_update',
  too_many: 'too_many',
  already_started: 'already_started',
  already_verified: 'already_verified',
  captcha_failed: 'captcha_failed',
  confirm_mismatch: 'confirm_mismatch',
  cycle: 'cycle',
  invalid_code: 'invalid_code',
  invalid_current_password: 'invalid_current_password',
  invalid_image: 'invalid_image',
  invalid_name: 'invalid_name',
  invalid_or_expired_token: 'invalid_or_expired_token',
  invalid_pair: 'invalid_pair',
  invalid_status: 'invalid_status',
  invalid_until: 'invalid_until',
  invalid_zip: 'invalid_zip',
  mime_mismatch: 'mime_mismatch',
  no_markdown_files: 'no_markdown_files',
  offset_out_of_range: 'offset_out_of_range',
  parent_not_found: 'parent_not_found',
  project_not_found: 'project_not_found',
  // 401 — auth
  unauthorized: 'unauthorized',
  invalid_credentials: 'invalid_credentials',
  // 403 — forbidden
  forbidden: 'forbidden',
  csrf_failed: 'csrf_failed',
  banned: 'banned',
  cannot_change_own_role: 'cannot_change_own_role',
  email_unverified: 'email_unverified',
  invalid_invite: 'invalid_invite',
  last_owner: 'last_owner',
  owner_protected: 'owner_protected',
  // 404 — not found
  not_found: 'not_found',
  folder_not_found: 'folder_not_found',
  shot_not_found: 'shot_not_found',
  task_not_found: 'task_not_found',
  // 409 — conflict
  duplicate: 'duplicate',
  already_archived: 'already_archived',
  draft_exists: 'draft_exists',
  duplicate_tag: 'duplicate_tag',
  email_taken: 'email_taken',
  id_conflict: 'id_conflict',
  tag_in_use: 'tag_in_use',
  username_taken: 'username_taken',
  // 410 — gone
  archived: 'archived',
  // 413 — payload too large
  file_too_large: 'file_too_large',
  too_large: 'too_large',
  // 429 — rate limited
  rate_limited: 'rate_limited',
  quota_exhausted: 'quota_exhausted',
  resend_cooldown: 'resend_cooldown',
  // 500 — server
  internal_error: 'internal_error',
  backup_encryption_key_not_set: 'backup_encryption_key_not_set',
  // 502/503 — upstream not available
  email_failed: 'email_failed',
  email_not_configured: 'email_not_configured',
  github_not_configured: 'github_not_configured',
  telegram_not_configured: 'telegram_not_configured',
  captcha_unconfigured: 'captcha_unconfigured',
  unavailable: 'unavailable',
} as const

type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

const STATUS_BY_CODE: Record<ErrorCodeValue, ContentfulStatusCode> = {
  invalid_input: 400,
  empty_update: 400,
  too_many: 400,
  already_started: 400,
  already_verified: 400,
  captcha_failed: 400,
  confirm_mismatch: 400,
  cycle: 400,
  invalid_code: 400,
  invalid_current_password: 400,
  invalid_image: 400,
  invalid_name: 400,
  invalid_or_expired_token: 400,
  invalid_pair: 400,
  invalid_status: 400,
  invalid_until: 400,
  invalid_zip: 400,
  mime_mismatch: 400,
  no_markdown_files: 400,
  offset_out_of_range: 400,
  parent_not_found: 400,
  project_not_found: 400,
  unauthorized: 401,
  invalid_credentials: 401,
  forbidden: 403,
  csrf_failed: 403,
  banned: 403,
  cannot_change_own_role: 403,
  email_unverified: 403,
  invalid_invite: 403,
  last_owner: 403,
  owner_protected: 403,
  not_found: 404,
  folder_not_found: 404,
  shot_not_found: 404,
  task_not_found: 404,
  duplicate: 409,
  already_archived: 409,
  draft_exists: 409,
  duplicate_tag: 409,
  email_taken: 409,
  id_conflict: 409,
  tag_in_use: 409,
  username_taken: 409,
  archived: 410,
  file_too_large: 413,
  too_large: 413,
  rate_limited: 429,
  quota_exhausted: 429,
  resend_cooldown: 429,
  internal_error: 500,
  backup_encryption_key_not_set: 500,
  email_failed: 502,
  email_not_configured: 503,
  github_not_configured: 503,
  telegram_not_configured: 503,
  captcha_unconfigured: 503,
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


/** Terse return-style helper for the dominant ad-hoc shape: `return errJson(c, ErrorCode.not_found)`
 * produces EXACTLY the legacy `c.json({ error: 'not_found' }, 404)` bytes (status defaults to
 * STATUS_BY_CODE; pass an explicit status only where a site's current status deliberately
 * disagrees with the map — those divergences are AUDIT-logged, not silently "fixed").
 * Call sites carrying extra body fields keep `c.json({ error: ErrorCode.x, ...fields }, s)`. */
export function errJson<E extends Env = Env>(c: Context<E>, code: ErrorCodeValue, status?: ContentfulStatusCode): Response {
  return c.json({ error: code }, status ?? STATUS_BY_CODE[code])
}

/** The fallback shape for any unhandled, non-ApiError throw — matches the legacy
 *  `{ error: 'internal_error' }` 500 so existing behavior is preserved exactly. */
export const internalErrorResponse = { error: ErrorCode.internal_error } as const

/** Serialize an ApiError for the JSON body. Shape: `{ error: code }` plus `message`
 *  only when a detail is present, so existing clients that read `.error` keep working. */
export function errorBody(err: ApiError): Record<string, unknown> {
  return err.detail ? { error: err.code, message: err.detail } : { error: err.code }
}
