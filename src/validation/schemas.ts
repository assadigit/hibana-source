import { z } from 'zod'
import { STATUS_ORDER } from '../types'

// Rule 10: every endpoint validates through these — one module, no ad-hoc checks anywhere.

// The status list is the 7-stage taxonomy from types.ts (STATUS_ORDER); the alias keeps
// the schema declarations below reading like the original status list.
const PROJECT_STATUS = STATUS_ORDER
// Statuses pre-0035 rows may still carry — normalized to the new stage on input, so
// old clients (and legacy bookmark URLs) keep working with no client release.
const LEGACY_STATUS: Record<string, string> = {
  pending: 'unreviewed',
  building: 'doing',
  working: 'operational',
  archived: 'halted',
}
const statusInput = z.preprocess(
  (v: unknown) => (typeof v === 'string' && v in LEGACY_STATUS ? LEGACY_STATUS[v] : v),
  z.enum(PROJECT_STATUS),
)

export const PROJECT_TYPE = ['personal', 'client'] as const

export const uuidSchema = z.string().uuid()

export const createProjectSchema = z.object({
  id: z.string().uuid().optional(), // rule 2 — client-generated for offline-created records
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  type: z.enum(PROJECT_TYPE).optional().default('personal'),
  status: statusInput.optional().default('spark'),
  tags: z
    .array(z.object({ name: z.string().min(1).max(50), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }))
    .max(10)
    .optional(),
  client_name: z.string().max(200).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reminders_enabled: z.union([z.literal(0), z.literal(1)]).optional().default(0),
  // Session 28 (user request: "go to a folder and create the idea there"): a spark may
  // be born INSIDE a folder — the Ideas-page quick-add passes the open folder so the
  // capture lands where the user stands. Only meaningful while status stays 'spark'
  // (the route drops it otherwise); ownership is re-validated in the route.
  folder_id: z.string().uuid().nullable().optional(),
})

export const updateProjectSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: statusInput.optional(),
    sort_order: z.number().int().min(0).optional(),
    latest_note: z.string().max(5000).optional(),
    // S30 (2026-09-12, user request "remove the whole thing"): progress_percent and
    // progress_note are GONE — the manual override UI (slider/milestones/note) was
    // removed and 0051 returned every project to the computed Auto number. Old clients
    // that still PATCH these fields get them silently stripped here (zod drops unknown
    // keys), never a SQL error.
    archived_state: z.enum(['online', 'offline']).nullable().optional(),
    client_name: z.string().max(200).nullable().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    reminders_enabled: z.union([z.literal(0), z.literal(1)]).optional(),
    // batch (s) 2026-09-08 — idea folders: a spark may live in one named folder
    // (NULL = «All»). Ownership is re-validated in the route (FK alone can't scope users).
    folder_id: z.string().uuid().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'empty update' })

export const reorderSchema = z.object({
  status: statusInput,
  ids: z.array(z.string().uuid()).min(1),
})

export const createHurdleSchema = z.object({
  id: z.string().uuid().optional(),
  // Multiline batches are legal (the composer works like the Quick Notebook — each line
  // becomes its own hurdle, sliced to 500 chars in the route).
  text: z.string().min(1).max(5000),
})

export const updateHurdleSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  status: z.enum(['open', 'solved']).optional(),
  sort_order: z.number().int().min(0).optional(),
})

export const hurdleReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
})

export const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export const mergeTagsSchema = z.object({ fromId: z.string().uuid(), toId: z.string().uuid() })

export const createLinkSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(100).optional().default('Link'),
  url: z.string().url().max(2000),
})

export const updateLinkSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  url: z.string().url().max(2000).optional(),
})

// Screenshot uploads arrive as base64 JSON (the client reads the File first).
export const uploadScreenshotSchema = z.object({
  id: z.string().uuid().optional(),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().regex(/^image\/(png|jpeg|webp|gif)$/),
  dataBase64: z.string().min(1).max(5_000_000), // P1.1 (F-H1): 5 MB base64 (~3.7 MB binary) — ample for a screenshot. Was 140 MB which EXCEEDED GitHub's 100 MB cap and would OOM the Worker.
  caption: z.string().max(1000).optional().default(''),
})

export const registerSchema = z.object({
  // Temporarily OPEN signup (Ali's decision 2026-08-24); inviteCode becomes required again
  // when CFG openRegistration flips back to false.
  inviteCode: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200),
  username: z.string().regex(/^[a-z0-9_-]{3,40}$/),
  // Min 8 chars, any characters — numbers-only passwords are allowed by design
  // (Ali's decision 2026-08-30 (f): reliability over forced complexity; the math
  // human-check + register rate limit + email verification stay the real bot walls).
  password: z.string().min(8).max(200),
  // Math human-check (2026-08-30 (e)): `captcha` is the user's answer, `captcha_token`
  // is the HMAC-signed challenge from GET /api/auth/captcha. Empty strings are treated
  // as absent so the route can answer with a precise message instead of a blunt
  // invalid_input.
  captcha: z.preprocess((v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).max(200).optional()),
  captcha_token: z.preprocess((v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).max(400).optional()),
})

export const verifyEmailSchema = z.object({
  email: z.string().email().max(200),
  // P4.8 (F-M20): normalize Persian ۰-۹ → ASCII before the regex (FA keyboard shows
  // inputmode='numeric' → Persian digits). Mirrors captcha.ts:34-40.
  code: z.preprocess(
    (v: unknown) => (typeof v === 'string' ? v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) : v),
    z.string().regex(/^\d{4}$/),
  ),
})

export const resendVerifySchema = z.object({ email: z.string().email().max(200) })

export const resetRequestSchema = z.object({ email: z.string().email().max(200) })

export const resetConfirmSchema = z.object({
  token: z.string().min(1).max(300),
  password: z.string().min(8).max(200),
  // same floor as register (numbers-only OK)
})

export const noteSchema = z.object({ note: z.string().max(5000) }) // min(0): an empty note is valid — the "Clear" button POSTs {note:''} to wipe latest_note (session-19 user report: clear didn't persist)

export const searchSchema = z.object({ q: z.string().min(1).max(200) })

// The filter bar submits empty strings for "All statuses"/"All tags" — it is valid input,
// not an error: empty params mean "no filter" (rule 10: reject bad input, not empty input).
const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

// Same idea for the status filter, plus legacy values: '' → undefined, 'pending' → 'unreviewed', …
const emptyOrLegacyStatus = z.preprocess(
  (v: unknown) => {
    if (typeof v !== 'string') return v
    if (v.trim() === '') return undefined
    return v in LEGACY_STATUS ? LEGACY_STATUS[v] : v
  },
  z.enum(PROJECT_STATUS).optional(),
)

export const listProjectsSchema = z.object({
  status: emptyOrLegacyStatus,
  tag: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  q: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  // batch (s): 'grid' is the projects page's DEFAULT view (2×3 stage boxes, click a box
  // → that status's list) — but the SERVER default stays 'cards': the Ideas shelf and the
  // Archive page call this endpoint with no view param and expect the card fragment.
  // 'folder' narrows the Ideas shelf (uuid = a folder, 'none' = unfiled sparks).
  view: z.preprocess(emptyToUndef, z.enum(['grid', 'cards', 'list', 'sticky', 'kanban']).optional().default('cards')),
  folder: z.preprocess(emptyToUndef, z.union([z.string().uuid(), z.literal('none'), z.literal('all')]).optional()),
  // S35 (user request 2026-09): archived=1 lists ONLY archived_state='offline' rows —
  // the Archive shelf. Absent/0 excludes them everywhere else (they are not deleted,
  // just parked: ideas not being implemented in the foreseeable future, restorable).
  archived: z.preprocess(emptyToUndef, z.enum(['0', '1']).optional()),
  // S45 (owner directive: projects page functionality): a user-facing sort for the
  // list views. 'stage' (absent default) = the historical order — status groups, then
  // sort_order, then recency; 'recent' = updated_at DESC ("never lose your place");
  // 'title' = alphabetical. The kanban view groups by column regardless.
  sort: z.preprocess(emptyToUndef, z.enum(['stage', 'recent', 'title']).optional()),
})

// Spark folders (0036): a named shelf sparks can be filed into.
// S41: `icon` — the folder's emoji (folder cards / chips / kanban headers). Nullable so
// PATCH semantics work: undefined = leave unchanged, null = clear (back to the
// folder-plus glyph), string = set. Emoji-only by regex — the classes cover pictographs,
// flags (regional indicators), skin tones (Emoji_Modifier), subdivision-tag sequences,
// ZWJ joins, and variation selectors; plain text is rejected (rendered via esc() anyway,
// but the contract is "one emoji token", not arbitrary markup).
const EMOJI_TOKEN_RE = /^[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\u200D\uFE0F]{1,8}$/u
export const sparkFolderSchema = z.object({
  name: z.string().trim().min(1).max(50),
  icon: z.string().trim().max(16).regex(EMOJI_TOKEN_RE).nullish(),
})

// Admin console (batch e) — ban presets and the user-management payloads.
const BAN_PRESETS = ['1d', '3d', '7d', '30d', 'forever'] as const

export const BAN_PRESET_MS: Record<string, number | null> = {
  '1d': 24 * 3600 * 1000,
  '3d': 3 * 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
  forever: null,
}

export const banUserSchema = z
  .object({
    preset: z.enum(BAN_PRESETS).optional(),
    until: z.string().datetime().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((o) => o.preset !== undefined || o.until !== undefined, { message: 'missing duration' })
  .refine((o) => o.until === undefined || new Date(o.until).getTime() > Date.now(), { message: 'until must be in the future' })

export const roleUserSchema = z.object({
  role: z.enum(['owner', 'member']),
})

export const removeUserSchema = z.object({
  confirm: z.string().min(1).max(200),
})

export const customEmailSchema = z.object({
  to: z.string().uuid(),
  // user id — resolves the address server-side, never client-supplied
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
})

export const broadcastEmailSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
})
