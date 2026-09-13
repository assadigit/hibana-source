import type { Ai, D1Database, Fetcher, KVNamespace } from '@cloudflare/workers-types'
import type { Db } from './db/types'

// S36: re-export Db so tests (and future consumers) can import the interface from the
// same place they get Config/Env — types.ts is the project's public type surface.
export type { Db }

// Worker bindings (wrangler.toml). Secrets arrive as plain env properties at runtime —
// they are never in the codebase (rule 5).
export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  // Workers AI binding (idea §1 — Magic Button). Added via `[ai]` in wrangler.toml; absent
  // on the Node self-host path, where the feature degrades to a friendly 503 notice.
  AI: Ai
  /** S38: Workers KV binding for screenshot storage (free 1 GB, no card — the
   *  no-card pick since R2's tier is payment-gated). Declared in wrangler.toml for
   *  both envs. Values are written WITHOUT expirationTtl → they never expire; only
   *  DELETE /api/screenshots/:id removes them. See services/kv.ts. */
  HIBANA_SHOTS?: KVNamespace
  ENVIRONMENT: string // 'dev' | 'prod' — set per wrangler environment
  GITHUB_TOKEN?: string
  GITHUB_OWNER?: string
  GITHUB_REPO?: string
  /** S35 (user request 2026-09, "a free cloud storage we connect by API"): Cloudflare R2 —
   *  10 GB-month free, 1M Class A + 10M Class B ops/month, ZERO egress — the natural
   *  pick for a Workers app (same account, wrangler secrets). When set it takes over
   *  screenshot storage from the GitHub Contents API; unset = GitHub as before. Any
   *  S3-compatible endpoint also works via R2_ENDPOINT (B2, Wasabi, MinIO…).
   *  S36: R2 is card-gated (payment method required to enable), so the no-card pick
   *  is Backblaze B2 — 10 GB free, S3 API. R2_REGION overrides the SigV4 scope region
   *  (auto-derived from the endpoint host otherwise: R2→auto, B2→its region, else
   *  us-east-1). */
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_ENDPOINT?: string
  R2_REGION?: string
  BREVO_KEY?: string // legacy — superseded by Resend
  RESEND_KEY?: string
  OWNER_EMAIL?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_SECRET?: string
  CAPTCHA_SECRET_KEY?: string // math human-check HMAC secret (replaced Turnstile, 2026-08-30 (e))
  TURNSTILE_SECRET_KEY?: string // legacy — kept as the captcha secret's fallback
  OPEN_REGISTRATION?: string // 'true' = open signup (temporarily); unset/false = invite-only
  BACKUP_ENCRYPTION_KEY?: string // base64 (32 bytes) AES-GCM key for at-rest backup encryption (C3 fix)
  /** Dead-man's switch (dr-integrity session): healthchecks.io ping URL. Prod secret; unset = off. */
  HEALTHCHECK_PING_URL?: string
  /** Mirror origins for the CSRF origin gate (docs/edge-mirror.md) — comma/space separated
   *  full origins, e.g. "https://fast.hibana.ir". Set only when a CDN front (ArvanCloud) is
   *  actually delegated; empty/unset = the gate trusts only the request's own origin. */
  MIRROR_ORIGIN?: string
}

// Everything createApp() needs, in runtime-agnostic form — this is what makes the
// Worker entry and the Node entry both thin shells.
export interface Config {
  db: Db
  isProd: boolean
  github: { owner: string; repo: string; token?: string }
  /** S38: Cloudflare Workers KV screenshot storage — takes precedence over r2 (free,
   *  no card, zero signup — it rides the account the Worker already deploys to).
   *  Binding mode on the Worker, REST mode on the Node self-host path; unset = the
   *  r2/GitHub chain decides. Storage precedence overall: kv → r2 (B2/R2/S3) → GitHub. */
  kv?: import('./services/kv').KvShotsConfig
  /** S35: S3-compatible object storage (Cloudflare R2 by default — see Env.R2_*).
   *  When set, screenshot bytes go here instead of the GitHub Contents API; the
   *  media route reads through the same adapter. Runtime-agnostic: plain fetch +
   *  Web Crypto SigV4, works on Workers and Node. */
  r2?: {
    endpoint: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
  }
  emailKey?: string
  ownerEmail?: string
  telegramToken?: string
  telegramSecret?: string
  captchaSecretKey?: string // math human-check HMAC secret (entries fall back to the legacy Turnstile secret)
  /** Default false — invite-only stays the safe mode; open signup is a deliberate toggle. */
  openRegistration?: boolean
  /** Base64-encoded 32-byte AES-GCM key. When set, backups are encrypted at rest (C3). */
  backupEncryptionKey?: string
  /** Dead-man's switch: healthchecks.io ping URL (prod-only, opt-in). Cron pings on backup-tick
   * success and /fail on failure — an external watchdog that alerts when the pings STOP
   * (catches a silently dead cron, which /api/health can never show). Unset = feature off. */
  healthcheckUrl?: string
  /** Extra origins the CSRF gate treats as "self" — for CDN-fronted mirrors whose host the
   *  proxy rewrites at origin-pull time (docs/edge-mirror.md). Exact string match
   *  ("https://host[:port]"), no trailing slashes. Unset = mirrors not trusted. */
  mirrorOrigins?: string[]
  /** Workers AI runner (idea §1 — Magic Button). A structural slice of the Cloudflare `Ai`
   *  binding (`env.AI.run(model, inputs)`). Wired by the Worker entry; left undefined on
   *  the Node self-host path, where /api/ai/text degrades to a 503 “Workers-only” notice. */
  ai?: import('./services/ai').AiRunner
  assets?: (url: URL, req?: Request) => Promise<Response>
}

export interface UserRow {
  id: string
  username: string | null
  email: string
  password_hash: string
  role: 'owner' | 'member'
  telegram_chat_id: string | null
  telegram_paused: 0 | 1
  /** Plan B (0044): owner-only opt-in for the Telegram backup channel (docs/perf-and-data-safety.md §1). */
  telegram_backup: 0 | 1
  language_pref: 'en' | 'fa'
  calendar_pref: 'gregorian' | 'shamsi'
  timezone: string
  avatar_path: string | null
  email_verified_at: string | null
  banned_until: string | null // 'forever' or an ISO expiry — NULL = active (batch e)
  ban_reason: string | null
  last_seen_at: string | null // presence stamp (requireAuth, 5-min window)
  dash_show_header: 0 | 1
  dash_show_projects: 0 | 1
  dash_show_todo: 0 | 1
  dash_show_notebook: 0 | 1
  dash_show_activity: 0 | 1
  dash_order: string
  sadhana_quadrant_order: string
  created_at: string
}

// The 7-stage taxonomy (status CHECK rebuild, 0035): spark intake + five pipeline
// stages + one terminal stage. LEGACY_STATUS (validation/schemas) maps the pre-0035
// values onto this order on input, so old clients and legacy rows keep working.
export const PROJECT_STAGES = ['unreviewed', 'investigating', 'awaiting', 'doing', 'halted', 'operational'] as const
export const STATUS_ORDER = ['spark', ...PROJECT_STAGES] as const

export type ProjectStatus = 'spark' | 'unreviewed' | 'investigating' | 'awaiting' | 'doing' | 'halted' | 'operational'

export interface ProjectRow {
  id: string
  user_id: string
  title: string
  description: string
  type: 'personal' | 'client'
  status: ProjectStatus
  sort_order: number
  latest_note: string
  progress_percent: number | null
  archived_state: 'online' | 'offline' | null
  client_name: string | null
  due_date: string | null
  reminders_enabled: 0 | 1
  created_at: string
  updated_at: string
  deleted_at: string | null
  folder_id: string | null // batch (s) — spark folders (NULL = «All», see SparkFolderRow)
  logo_path: string | null // 0047 — project logo (GitHub assets repo path; NULL = no logo)
}

// --- Spark folders (0036, batch s — idea shelves) --------------------------------
export interface SparkFolderRow {
  id: string
  user_id: string
  name: string
  sort_order: number
  created_at: string
}

export interface HurdleRow {
  id: string
  project_id: string
  text: string
  status: 'open' | 'solved'
  sort_order: number
  created_at: string
  solved_at: string | null
}

export interface TagRow {
  id: string
  user_id: string
  name: string
  color: string
  usage_count: number
  created_at: string
}

// --- Dev-board + sprints (0029, user design 2026-08-29) ------------------------
export type DevTaskStatus = 'idea' | 'planned' | 'in_progress' | 'done'
export type DevTaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface TaskCategory {
  id: string
  project_id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface DevTaskRow {
  id: string
  project_id: string
  title: string
  status: DevTaskStatus
  priority: DevTaskPriority
  category_id: string | null
  sprint_id: string | null
  sort_order: number
  created_at: string
  done_at: string | null
  start_at: string | null // 0030: manual clip start override (NULL = automatic created_at)
  end_at: string | null // 0030: manual clip end override (NULL = automatic done_at|today)
}

export interface SprintRow {
  id: string
  project_id: string
  name: string
  started_at: string
  ended_at: string | null
  created_at: string
  is_draft: 0 | 1 // draft sprint (never started) — the create flow parks it here until /start
  version: string | null // 0052: the sprint's version-number label ("12.1") — free text
  description: string | null // 0052: the sprint's rich doc (markdown + fenced code) — the full-screen editor's subject
}

// --- Backlog docs (0033 — برنامه آتی «upcoming plan» tab) -----------------------
export interface BacklogDocRow {
  id: string
  project_id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

export interface LinkRow {
  id: string
  project_id: string
  label: string
  url: string
  created_at: string
}

export interface ScreenshotRow {
  id: string
  project_id: string
  github_path: string
  mime_type: string
  caption: string
  created_at: string
  /** 0053 (S35): 0 = an OPEN UI/UX problem, 1 = fixed. */
  resolved: number
}

export interface ChangelogRow {
  id: string
  project_id: string
  github_path: string
  filename: string
  content_text: string
  uploaded_at: string
}

export interface InviteRow {
  id: string
  code: string
  created_by: string
  created_at: string
  used_at: string | null
  used_by: string | null
}

export interface TaskRow {
  id: string
  project_id: string
  title: string
  done: 0 | 1
  due_date: string | null
  created_at: string
  completed_at: string | null
}

export interface PaymentRow {
  id: string
  project_id: string
  label: string
  amount: number
  currency: string
  status: 'pending' | 'paid'
  paid_at: string | null
}
// --- Plan B backup channel (0044, docs/perf-and-data-safety.md §1) ----------------
/** One row per Plan B document sent to an owner's Telegram chat (drill + retention log). */
export interface PlanBBackupRow {
  id: string
  user_id: string
  chat_id: string
  message_id: number
  file_id: string
  file_size: number
  sha256: string
  schema_version: number
  sent_at: string
}
