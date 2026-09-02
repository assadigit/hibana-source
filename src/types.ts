import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import type { Db } from './db/types'

// Worker bindings (wrangler.toml). Secrets arrive as plain env properties at runtime —
// they are never in the codebase (rule 5).
export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  ENVIRONMENT: string // 'dev' | 'prod' — set per wrangler environment
  GITHUB_TOKEN?: string
  GITHUB_OWNER?: string
  GITHUB_REPO?: string
  BREVO_KEY?: string // legacy — superseded by Resend
  RESEND_KEY?: string
  OWNER_EMAIL?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_SECRET?: string
  CAPTCHA_SECRET_KEY?: string // math human-check HMAC secret (replaced Turnstile, 2026-08-30 (e))
  TURNSTILE_SECRET_KEY?: string // legacy — kept as the captcha secret's fallback
  OPEN_REGISTRATION?: string // 'true' = open signup (temporarily); unset/false = invite-only
}

// Everything createApp() needs, in runtime-agnostic form — this is what makes the
// Worker entry and the Node entry both thin shells.
export interface Config {
  db: Db
  isProd: boolean
  github: { owner: string; repo: string; token?: string }
  emailKey?: string
  ownerEmail?: string
  telegramToken?: string
  telegramSecret?: string
  captchaSecretKey?: string // math human-check HMAC secret (entries fall back to the legacy Turnstile secret)
  /** Default false — invite-only stays the safe mode; open signup is a deliberate toggle. */
  openRegistration?: boolean
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