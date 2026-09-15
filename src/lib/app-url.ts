// The app's canonical public origin for deep links built OUTSIDE a request context —
// cron emails (client reminders), Telegram pushes (Sadhana deadlines, backup alerts),
// and the ICS calendar feed. Request-scoped paths must NOT use this: they derive the
// origin from the actual request (`requestOrigin` in lib/http.ts), which already makes
// them domain-agnostic.
//
// S49-b6 (2026-09-16): the deep-link domain must not be hardcoded — "domain might
// change". Single source of truth: the APP_URL env var (wrangler.toml [env.prod.vars]
// on the Worker; process env on the Node self-host), threaded as `cfg.appUrl`. The
// default preserves the pre-S49-b6 behavior byte-for-byte, so nothing changes until
// the owner sets APP_URL. When the domain changes, also see the domain-migration note
// in Changelogs.md §6 (Resend sender + ICS UIDs have their own follow-ups).

/** Canonical app origin for no-request contexts. Default = the prod domain (S49-b6).
 *  Normalizes the override: trims, strips trailing slashes, and prefixes https:// when
 *  the scheme is missing — a malformed APP_URL must never crash the ICS route's
 *  `new URL(appUrl)` or silently emit scheme-less links. */
export function appUrlOf(cfg: { appUrl?: string }): string {
  const raw = cfg.appUrl?.trim()
  if (!raw) return 'https://hibana.ir'
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}
