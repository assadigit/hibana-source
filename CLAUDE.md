# Hibana — Project & Idea Manager: Agent Rules (canonical)

Consolidated from `instruction.md` + `spark.md` + decisions locked during the build session.
Full feature detail: `pm-app-spec.md`. Reasoning: `vision.md`. Deployment: `DEPLOY.md`.

## What this is
Personal project/idea tracker for Ali (solo UI/UX designer; doesn't read or patch code himself).
Two jobs only: **never lose an idea; never lose your place**. If a feature serves neither,
confirm it was asked for before building.

## Stack
- Frontend: static HTML served by the app itself (Cloudflare Worker assets binding today;
  any static host or the Node server elsewhere). htmx + Alpine.js + Fabric.js (Canvas only).
  No build step, no React.
- Backend: Hono (TypeScript). One app codebase that runs on Cloudflare Workers **or** plain
  Node — portability is a hard requirement (user's words: "deployment must be easily changeable").
- DB: SQLite. Cloudflare D1 in production (`pm-app-dev` / `pm-app-prod` wrangler envs);
  `better-sqlite3` locally and for non-Cloudflare deploys. Same SQL, same numbered migrations,
  behind one `Db` interface (`src/db/`).
- File storage: private GitHub repo (hibana-safe) via the Contents API. D1 stores only paths.
- Email: Resend (free tier, no card; Brevo was the spec default but the owner couldn't sign up).

## Non-negotiable rules
1. Every user-owned table has `user_id`; every query filters on it (`projects`, `tags`,
   `canvas_elements`, `telegram_captures`). Never write a query against them without a `user_id` filter.
2. IDs are UUIDs. Client-generated for anything created offline (Canvas, Spark quick-add);
   server accepts it as canonical. Server-generated otherwise (e.g. Telegram captures).
3. All timestamps stored in UTC. Convert to calendar (Gregorian/Shamsi via `jalaali-js`)
   and timezone only when rendering — never in storage or query filters.
4. Schema changes only through numbered SQL files in `migrations/` (`wrangler d1 migrations`
   on CF, `scripts/migrate-node.ts` locally). Never ad-hoc `ALTER TABLE`.
5. Every credential is a secret: `wrangler secret put` on CF, env vars elsewhere. Never
   hardcoded, never committed.
6. Password hashing: PBKDF2 via Web Crypto (`crypto.subtle`, 100,000+ iterations, SHA-256).
   Never `bcrypt`/`argon2` — native bindings don't run on Workers.
7. Reading a file back from the GitHub assets repo over 1MB requires
   `Accept: application/vnd.github.v3.raw` — omit it and big files come back empty, silently.
8. The backup export excludes `users.password_hash` and the entire `sessions` table.
9. Index `user_id`, `status`, `project_id` on every table that has them, from the first migration.
10. Validate all API input with Zod at the route level, consistently, on every endpoint.
11. Telegram webhook validates Telegram's secret-token header.

## Architecture decisions (locked — do not silently revert)
- **Single origin**: one Hono app serves static assets + JSON API + htmx HTML fragments.
  Routes branch on the `HX-Request` header. No CORS, same-site cookie.
- **Portability**: DB access only through `src/db/` `Db` interface (D1 + better-sqlite3
  adapters). Search (FTS5, SQLite-only) stays isolated in its own module. Worker entry
  (`src/index.ts`) and Node entry (`src/server.ts`) are thin shells over `createApp()`.
- **Deletes**: soft delete (`deleted_at`) + 7-day purge by cron; UI uses undo-toast.
  Hard delete only for Spark/Pending after the purge window.
- **Offline sync**: Canvas + Spark quick-add only; IndexedDB queue; last-write-wins on
  `updated_at`; unsynced-changes badge while the queue is non-empty.
- **Auth**: login by email *or* username; `sessions` stores the SHA-256 hash of the token;
  httpOnly `SameSite=Lax` cookie, 30-day rolling expiry. Super-admin bootstrap:
  `npm run seed:admin` (username `admin-<random>`, generated strong password).
- **Backups are first-class**: JSON snapshot export (excludes credentials, carries
  `schema_version`) committed to the GitHub assets repo on a cron; restore via
  `scripts/restore.mjs` (no restore UI in v1 — manual is fine).
- **Rate limiting** on login, password reset, and the Telegram webhook (Cloudflare free-tier rules).

## UI conventions
One toast/banner component for all errors and confirmations. Destructive actions use an
undo-toast, not a blocking confirm dialog. Every list/board screen needs a defined empty
state and loading state. Use CSS logical properties (RTL mirroring comes in Phase 3).

## Testing — required before any phase is marked done
`npm test` (vitest, runs locally, no Cloudflare account needed):
- User isolation: user A's queries can never return user B's rows.
- Offline sync: a queued offline change lands once reconnected — no duplication or loss.
- Progress formulas: hurdles-based (personal) and task-time-based (client) against known inputs.
- Auth: password hash/verify round-trip, session expiry.

## Build order
Phase 0 (walking skeleton) → 1 (personal core) → 2 (Canvas) → 3 (polish + locale) →
4 (client module) → 5 (integrations/mobile). "Done when" criteria: `pm-app-spec.md` §12.
