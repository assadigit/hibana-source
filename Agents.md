# Hibana — Agents.md (canonical agent rules)

Consolidated in v0.3.9.2 from `CLAUDE.md` + `rules.md` + session ground rules + stack facts
(post-v0.3.9.1). Supersedes all prior rule files (deleted — git history retains them verbatim).
History/current state/ops/open items: `Changelogs.md`. Live credentials: `credentials.md`
(gitignored, local-only — never committed, never zipped into chat).

**Agent↔owner language: English, always.** All chat, summaries, and explanations to Ali are
in English — even if his message is Persian. App UI copy stays FA+EN per the i18n rules
below. (Added at Ali's request, 2026-09-13 — never revert. Re-confirmed 2026-09-21.)

**Source of truth: https://github.com/assadigit/hibana-source — PUBLIC since 2026-09-21.**
A fresh agent's FIRST act is to clone it:
`git clone https://github.com/assadigit/hibana-source.git hibana` (then `bun install` /
`npm install`). Work there; commit+push when done — CI runs free on public repos and CD
auto-deploys. `assadigit/hibana-safe` stays PRIVATE (it carries D1 dumps = real user data —
NEVER make it public, never push user data there beyond the established backup paths).

## What this is
Personal project/idea tracker for Ali (solo UI/UX designer; runs Sedanama e-commerce; works
12–16 h self-directed; directs AI coding agents; never reads or patches code himself).
Replaces his whiteboard/Obsidian/Notion. **Two jobs only: never lose an idea; never lose your
place.** If a feature serves neither, confirm it was asked for before building. The app is
"a SAFE for my ideas": once a project has real work in it, it can be archived (halted) but
never destroyed. Rich detail is fine once building; capturing a raw idea must stay as fast as
a whiteboard note.

## Stack (current — corrects stale legacy docs)
- Frontend: static HTML served by the app; htmx + Alpine.js + Fabric.js (canvas/notebook/
  whiteboard only). No React. Build: `scripts/build.mjs` (esbuild) → content-hashed immutable
  `public/dist/` + `manifest.json`; deploy-time HTML wiring (`--wire-html` /
  `--restore-html`, `.build-backup/` canonical-only invariant).
- Backend: Hono (TypeScript), ONE codebase for Cloudflare Workers OR plain Node — portability
  is a hard requirement ("deployment must be easily changeable").
- DB: SQLite. D1 in prod (`pm-app-dev` / `pm-app-prod`); Node target = `node:sqlite`
  (Node 24+; better-sqlite3 is REMOVED). Same numbered migrations behind one `Db` interface
  (`src/db/`).
- Storage: screenshots on **Cloudflare Workers KV** (free 1 GB, no card — `HIBANA_SHOTS`
  binding, `src/services/kv.ts`; written WITHOUT expirationTtl → objects NEVER expire,
  only the app's delete removes them). Storage precedence: explicit objectStore
  (Node-only disk store via `HIBANA_SHOTS_DIR`, `src/services/disk-shots.ts` — local
  dev/e2e) → kv → r2 (B2/R2/S3 via R2_* env, `src/services/r2.ts`) → GitHub repo
  `assadigit/hibana-safe` (Contents API — avatars,
  logos, backups); ONE shared constructor `src/services/shotstore.ts` (also cleans bytes
  on project hard-delete + the purge cron). `npm run shotcheck:local|:dev|:prod` = live
  round-trip proof. S39: the media GALLERY (/gallery.html + GET /api/media) browses every
  picture with a space meter and delete-to-free; shots stick to progress-box items
  (0054 screenshots.task_id → dev_tasks, ON DELETE SET NULL — the pin line shows box +
  item; the task cards carry 📌 badges).
  Email: Resend. Monitoring: healthchecks.io. Telegram: @Hibana_PM_bot.
- Project taxonomy (0060, S93): `spark → planning → queued → developing → awaiting_dev →
  operational` (legacy pre-0060 vocabulary maps on input via `validation/schemas.ts`
  LEGACY_STATUS — old clients/bookmarks survive).

## Non-negotiable rules
1. Every user-owned table has `user_id`; every query filters on it (`projects`, `tags`,
   `canvas_elements`, `telegram_captures`…). Never a query without the `user_id` filter.
2. IDs are UUIDs. Client-generated for offline-creatable things (Canvas, Spark quick-add) —
   server accepts as canonical; server-generated otherwise.
3. All timestamps stored UTC. Calendar (Gregorian/Shamsi via jalaali-js) + TZ conversion only
   at render time — never in storage or query filters.
4. Schema changes ONLY via numbered files in `migrations/` (0001–0060; `0007` gap is
   original). Never ad-hoc `ALTER TABLE`. Never untested migrations against prod.
   Pre-migration bookmark ritual (Changelogs §4 + §9). Schema changes need Ali's explicit
   written approval.
5. Every credential is a secret (`wrangler secret put` / env vars). Never hardcoded, never
   committed, never echoed in chat.
6. Password hashing: PBKDF2 via Web Crypto (`crypto.subtle`, 100,000 iterations since
   2026-09-11). Never bcrypt/argon2 — native bindings don't run on Workers. **Iteration
   count is the Workers platform cap (100k)** — the M2 fix tried 600k per OWASP 2023
   but Workers' `crypto.subtle.deriveBits` throws `NotSupportedError` above 100k. Do
   NOT raise ITERATIONS above 100,000 — it silently breaks every signup + password
   reset on the Workers path. The `needsRehash()` code path is a permanent no-op on
   Workers (100k is already the target). If Hibana ever moves to Node-only, raise it.
7. GitHub assets-repo reads over 1 MB require `Accept: application/vnd.github.v3.raw` —
   omit it and big files come back empty, silently.
8. Backup export excludes `users.password_hash` and the entire `sessions` table.
9. Index `user_id`, `status`, `project_id` on every table that has them, from the first
   migration.
10. Validate all API input with Zod at the route level, on every endpoint.
11. Telegram webhook validates the secret-token header. Unauthenticated calls never create
    data.

## Workflow rules
- **Language: English with Ali. Always.** Regardless of the app's FA UI or the language he
  writes in, the agent's replies are English. FA/EN applies to in-app copy only.
- **Commit after every modification**: push to `assadigit/hibana-source` main; tag (`v0.x.y`)
  when user-facing. Format: `<area>: <change> — <one-line why>`.
- **Never commit secrets.** `credentials.md`, `.secrets.env`, `.dev.vars`, `.admin.secrets`
  are gitignored — but verify with `git status` before EVERY commit that none is staged; if
  staged: `git restore --staged <file>` and re-check. A leaked token in git history is
  permanent.
- **Zip after every phase/milestone**: bump `package.json`, zip the full project
  (per-version name `hibana.<version>.zip`) to the owner's upload/download folders. Include
  `src/ migrations/ public/ scripts/ *.md package.json package-lock.json bun.lock
  tsconfig.json wrangler.toml vitest.config.ts .gitignore .secrets.env.example
  credentials.md` (owner's PC copy is the ONLY credentials-carrying artifact). Exclude
  `node_modules/ .wrangler/ .dev.vars .secrets.env .admin.secrets *.log coverage/ data/
  .git/ cookies.txt *.cookies *.sql.tmp dashboard-check.png`.
- **⚠️ Never re-upload a credentials-carrying zip into chat.** Fresh-sandbox agents get
  credentials from the session prompt, never a re-uploaded zip.
- **Ask vs assume**: ask when ambiguous AND high-stakes (deploy, delete, schema change,
  public commit, irreversible); assume+proceed when reversible/low-risk, labeling the
  assumption explicitly. Never present assumptions as facts.
- **Honesty over agreeability**: if the user is wrong, say so and why. No invented details;
  distinguish fact/assumption/inference; verify numerically when possible.
- Keep a running per-task worklog in the session worklog file + mirror into sandbox
  `/home/z/my-project/worklog.md`.

## Verification ladder (per batch — required before "done")
`npm run typecheck` (authoritative tsc) → `npm test` (506) → `node --check` on touched JS →
browser E2E on the local Node server (FA/RTL **and** EN/LTR, light **and** dark, desktop
**and** 390 px; test user `e2e@test.local`) → deploy dev → live probe → deploy prod → live
probe (console 0 / page errors 0) → **purge probe users** (DELETE cascade verified;
row-count parity: users 4). Auto-deploy dev after green verify; prod after a live dev probe,
unless held.

**E2E server contract (S115/S116 ops notes, canonical here)**: the Playwright webServer
boots its own Node instance from the config env — `DB_PATH`, `HIBANA_SHOTS_DIR` (WITHOUT it
uploads go to GitHub with a stub token → phantom 401 test failures), `PORT 3017`. When
pre-booting a shared server manually (the two-shard race: boot the shared server FIRST,
then run both shards concurrently — shard 1's own spawn EADDRINUSE-dies otherwise), it MUST
carry the same env. Never leave an orphaned server squatting on the QA port across sessions
(wrong-DB symptom: `invalid_credentials` for a user your DB file contains). Canonical-tree
runs are the contract: `npm run build -- --restore-html` before e2e (the wired tree serves
`/dist/*.<hash>.css`, which breaks the S105-1 heal pin by design).

## Cache-bust discipline (load-bearing — stale caches caused ~4 user bug reports)
Any CSS/JS change bumps `?v=` on EVERY referencing HTML page AND the SW cache name + SHELL
list. Since v0.3.0 `/dist/` is content-hashed; SW version bumps only on sw.js logic changes.
If you edit after a bump, re-bump (stale HTTP cache under the same URL). `check-cache-bust`
is a CI gate. Current numbers: Changelogs §1.

## i18n
EN + FA ship together, always. Programmatic key-parity check (1427/1427) via
`scripts/check-i18n-parity.mjs` (CI gate). Persian digit normalization; CSS logical
properties for RTL/LTR.

## D1 discipline
- Remote D1 writes only via real `.mjs` script files (`wrangler d1 execute --file`) — never
  inline `node -e` inside double-quoted bash (`${…}` mangles).
- Live DBs at schema 59 (0060, S93) — never re-apply migrations blindly (Changelogs §6).
- Diagnose against prod data before coding ("board broken" was a soft-deleted project).

## Secrets & credentials
- Read `credentials.md` (gitignored) when you need to deploy, back up, verify, or push. Never
  echo values, never commit, never zip for chat.
- Token rotated → update `credentials.md` AND `/home/z/.hibana-secrets.env` AND Worker
  secrets (`wrangler secret put <NAME> --env prod`).
- Any token pasted in chat → rotate per runbook policy. **`BACKUP_ENCRYPTION_KEY` is the
  exception: NEVER rotate** (orphans all encrypted backups).
- Env vars (Node path): `DB_PATH HIBANA_SHOTS_DIR GITHUB_OWNER GITHUB_REPO GITHUB_TOKEN
  RESEND_KEY OWNER_EMAIL TELEGRAM_BOT_TOKEN TELEGRAM_SECRET CAPTCHA_SECRET_KEY
  (TURNSTILE_SECRET_KEY legacy fallback) NODE_ENV OPEN_REGISTRATION
  BACKUP_ENCRYPTION_KEY MIRROR_ORIGIN PORT TRUST_PROXY`.
- Deploys need `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in env (from
  credentials.md).

## Ops scripts (values never printed — read in-process via scripts/lib.mjs)
`npm run deploy[:prod]` ship · `migrate:node` local SQLite · `restore -- --file <snap>`
(`--d1 pm-app-*` for D1) · `seed:admin[:prod|:node]` · `secrets:set[:prod]` from
`.secrets.env` · `node scripts/test-email.mjs` live send check · `check-emails.mjs --send`
delivery status · `always-https.mjs --on` zone toggle · `zone.mjs` / `custom-domain.mjs` ·
`browser-check.mjs` (`HIBANA_PASS=…`) headless UI check · `bookmark:prod` pre-migration
(writes Changelogs §9).

## Doc map (post-consolidation)
- `Agents.md` (this file) — rules, how to work on Hibana.
- `Changelogs.md` — history, current state, ops runbook, open items, rejected features.
- `README.md` — minimal GitHub landing-page pointer.
- `credentials.md` — live credentials (local-only, gitignored, never committed).
- All other prior .md files are deleted; recover verbatim via `git show <sha>:<file>`.
- `OPEN_REGISTRATION="true"` in wrangler.toml both envs — closing = delete 2 lines +
  redeploy.
