# Hibana — DR-Integrity Closeout: Dead-Man's Switch, Time Travel, Key Custody, Error Log, dist Wiring

> **Status:** IMPLEMENTED (this document is both the analysis and the record).
> **Session:** 2026-09-11/12, post-commit `2ddc1eb` (Plan B + perf pass, v0.2.0).
> **Author:** Principal Full-Stack Engineer.
> **Scope:** the five approved gap-closers from the SWOT review — every weakness the owner
> flagged maps to a workstream below. Plan B and the GitHub backup channel are LIVE and
> untouched; everything here is additive.

| Approved gap (user's words) | Workstream |
|---|---|
| "No dead-man's switch … if the cron ever silently dies … `/api/health` stays green" | §1 |
| "Snapshot-only recovery: worst-case 6-hour RPO and destructive by design … a better, free, unused tool" | §2 (D1 Time Travel) |
| "Key custody is the system's true single point of failure" / "Bus factor = 1 … only key custody mitigates people risk" | §3 |
| "Zero error observability … only visible in a live `wrangler tail` session" | §4 |
| "HTML → /dist/ wiring" (the deferred biggest perf lever) | §5 |

---

## Part 1 — Dead-man's switch (healthchecks.io)

### 1.1 The problem, precisely

Every alert Hibana owns travels **through the Worker itself**: backup failure → Resend email +
Telegram bot message. External uptime monitors hitting `/api/health` only prove that *fetch*
works — not that the **scheduled trigger fires**. If the cron dies silently (Cloudflare
scheduled-trigger outage, a deploy that drops `[triggers]` from `wrangler.toml`, an env
mis-wire), the app looks perfectly healthy while no backup has run for days. Data loss = the
gap since the last snapshot, undetected.

The fix is the standard dead-man's-switch pattern: on every successful backup tick, the cron
pings an external URL owned by a third party that **alerts when the pings STOP**. The
watchdog must be outside Cloudflare entirely, or it shares the failure domain it guards.

### 1.2 Choice: healthchecks.io

| Option | Verdict | Reasoning |
|---|---|---|
| **healthchecks.io (free tier)** | **CHOSEN** | Purpose-built dead-man's switch: a URL that alerts on silence, plus explicit `/fail` pings. Free tier = 20 checks, unlimited pings, email alerts; Telegram/webhook integrations available. Zero client library — one `fetch`. The alert path (their infra → email) shares no provider with ours (Cloudflare/Resend/Telegram/GitHub). |
| Cronitor / UptimeRobot heartbeat monitors | Rejected | Same pattern, but heartbeat is a paid-tier feature on UptimeRobot and Cronitor's free tier is a trial-class product. healthchecks.io is the open standard here. |
| Self-hosted healthchecks (OSS image) | Rejected | A watchdog that runs where the watched system runs is not a watchdog. Opposite of the failure-domain requirement. |
| A second Cloudflare Worker + cron watching the first | Rejected | Same account, same cron infrastructure, same deploy pipeline — correlates with exactly the failure class we're guarding (a deploy or account event that kills crons). |
| GitHub Actions scheduled workflow checking the repo | Rejected (documented) | Clever (the repo is already the backup target), but GH scheduled workflows are known to be delayed/dropped under load and don't alert on their own death. It also can't do the `/fail` signal. Could be a *supplement* later, not the switch. |

### 1.3 Design (implemented)

- **Secret:** `HEALTHCHECK_PING_URL` (wrangler secret, prod only) — the check's ping URL
  (`https://hc-ping.com/<uuid>`). Treated as a secret per rule 5: the UUID lets anyone
  reset the timer or mark the check failed. `.secrets.env` line documented in runbook §1.
- **Config:** `Config.healthcheckUrl?: string` ← `env.HEALTHCHECK_PING_URL`
  (`src/types.ts`, `src/index.ts`). Unset = feature fully off (the default until the owner
  creates the check — the code no-ops, nothing breaks).
- **Service:** `src/services/healthcheck.ts` — `pingHealthcheck(url, ok)`:
  - `GET <url>` on success, `GET <url>/fail` on failure (healthchecks.io's documented
    explicit-fail signal, which triggers an immediate alert rather than waiting out the
    grace period).
  - 10-second timeout (`AbortSignal.timeout`), **never throws** — a watchdog ping that
    could take down the backup chain would be worse than no watchdog. Result is logged
    (`healthcheck_ping` / `healthcheck_ping_failed`) so `wrangler tail` can see it.
  - Portable: plain `fetch` — identical on Workers and Node.
- **Wiring (src/index.ts, the scheduled handler):** runs only on backup ticks
  (`backupTick`), only when `cfg.isProd && cfg.healthcheckUrl`:
  - `scheduledBackup` now **returns its outcome** instead of swallowing it into its own
    try/catch (it still never throws — the alerting inside it is unchanged; the return
    value is new information, not a new failure path).
  - Backup **pushed** → success ping. Backup **failed or skipped** (e.g. `GITHUB_TOKEN`
    missing in prod — a config state as dangerous as a failure) → `/fail` ping.
  - **Manual backups (`POST /api/admin/backup`) never ping.** A heartbeat must only beat
    for the automated path it guards — a manually-triggered backup resetting the timer
    would mask a dead cron. Deliberate, documented.
  - Plan B (Telegram) result does not feed the ping: it is a separate failure domain with
    its own alerting (§1.5 of the previous design doc). The switch watches *the cron is
    alive and the primary channel is pushing*.
- **Check configuration (runbook §5):** period 6 hours (backup cadence is 4×/day), grace
  6 hours → alert after **2 missed ticks (12 h)**. Alert channels: email (default) +
  optional Telegram integration.
- **What the switch covers / does not (honest scope):** cron-dead, deploy-dropped-triggers,
  backup-erroring, token-expired → covered (silence or `/fail`). Plan B Telegram failures
  → NOT covered by this check (separate alerting, and Plan B failure with a healthy GitHub
  channel is not a dead-man event). Dev worker never pings (prod-only gate — a dev tick
  resetting the prod timer would be another masking bug, the same reasoning Plan B used).

### 1.4 E2E verification (performed this session)

See §6 — the ping path was verified live by pointing the secret at a request-capture
endpoint and waiting for a real cron tick, then handing the check over to the owner.

---

## Part 2 — D1 Time Travel: the third restore channel

### 2.1 What it is (verified facts, wrangler 4.7)

- `wrangler d1 time-travel info <db> [--timestamp <unix|RFC3339>] --json` → returns a
  **bookmark** for that point in time (verified live against `pm-app-prod` this session:
  `{"bookmark":"000005fd-…"}`).
- `wrangler d1 time-travel restore <db> --bookmark <id> | --timestamp <t>` → restores the
  database **in place** to that point. Timestamps are accepted **within the last 30 days**.
- It is powered by D1's continuous undo log — it works even if no snapshot was ever taken,
  needs no app code, and costs nothing.

### 2.2 Where it sits in the DR tree (runbook §2c, implemented)

| Failure class | First choice | Why |
|---|---|---|
| **Bad migration / logical corruption / accidental mass delete (D1 alive)** | **Time Travel** | Minute-granularity RPO (vs 6 h worst-case snapshots), in-place, no file handling, no encryption dance, works pre-snapshot. |
| D1 destroyed / unavailable (account or regional catastrophe) | GitHub snapshot → Plan B Telegram | Time Travel lives inside D1's account — by definition unavailable here. |
| Corruption noticed >30 days later, or history needed | Snapshots (15-day live window; older = whatever the owner archived) | Time Travel's window is 30 days, snapshots are the deep archive. |

Two operator facts that shape the ritual:

1. **Restore is destructive and in-place** (current state is overwritten) → the pre-step
   for ANY risky change is a **bookmark** (an instant, named restore point).
2. The 30-day window is a rolling log — it also silently covers "noticed corruption 20
   days ago", which the 15-day snapshot window does not.

### 2.3 The pre-migration ritual (implemented)

`npm run bookmark:prod` (`scripts/pre-migrate-bookmark.mjs`):
- Creates a bookmark on `pm-app-prod` via `time-travel info --json` (read-only, instant).
- Appends one line to `dr-bookmarks.md` (repo-root operational log): UTC timestamp,
  bookmark ID, current schema_version (from D1 REST API), and the reason
  (`--reason "apply 0045"`). The IDs are not secrets; the file is the operator's memory
  when a migration goes wrong 10 minutes later.
- Wired into the runbook §4 deploy checklist as a mandatory step before
  `wrangler d1 migrations apply` — and dogfooded this session: migration 0045 itself was
  bookmarked first.

---

## Part 3 — Key custody (runbook §1, implemented)

The blunt fact, now stated in the runbook: **every encrypted backup on both channels is
only as alive as the offline copy of `BACKUP_ENCRYPTION_KEY`.** Cloudflare death + key loss
= all backups are random bytes forever. Rotation is impossible without re-encrypting
everything (documented since C3) — so *custody*, not rotation, is the mitigation.

The checklist added to runbook §1 ("encryption-key liveness"):

1. **Two independent offline locations** (e.g. printed in the safe + password manager on a
   device that is not the laptop the repo lives on). Not on any cloud that shares a fate
   with Cloudflare/GitHub. Not in `.secrets.env` alone (that file is machine-local).
2. **Quarterly drill:** `BACKUP_ENCRYPTION_KEY=<offline copy> npm run drill` (and
   `drill:planb`) — proves the copy decrypts the *current* backup format. A key that has
   never decrypted anything is a hope, not a key. (This also regression-tests the exact
   bug class fixed in 2026-09-11: shape-detection drift between writer and reader.)
3. **Lost-key recovery path** (now documented, was previously implicit nowhere): if the key
   is lost while the Worker still runs, immediately (a) export data through the app's own
   export API, (b) set a NEW `BACKUP_ENCRYPTION_KEY` secret — fresh backups from then on
   are readable again; old ones are forfeit. If the Worker is gone too, the data is gone.
   That asymmetry is why the checklist exists.
4. Bus-factor note: the checklist is the *people-risk* mitigation — the runbook + this
   checklist are written so a successor with repo access and the key can operate recovery
   without the original author.

**One-time owner action (not executable by the agent by design):** run the drill against
the offline copy. The agent never sees the key (rule: never print, never embed).

---

## Part 4 — Error observability: `error_log` (migration 0045)

### 4.1 Options

| Option | Verdict | Reasoning |
|---|---|---|
| Sentry Workers SDK | Rejected | New account + DSN secret + a runtime dependency for a solo-user app; the alert path for "Sentry is broken" becomes… Sentry. Also a dep to keep current. |
| CF Workers Logs / Logpush | Deferred (documented in §5 as manual) | Zero-code and genuinely good, but requires dashboard visits, is CF-only (Node path invisible), and retention views rot. |
| **D1 `error_log` table + owner-only admin viewer** | **CHOSEN** | Zero new accounts/secrets/deps; queryable history with 7-day retention; portable to Node; visible in the admin console the owner already has. Honest limit: if D1 itself is down, errors can't be recorded — console fallback stays `wrangler tail` (documented). |

### 4.2 Design (implemented)

- **Migration 0045** — `error_log` operational table (same class as `email_log`: no
  user-ownership, UUID PK, UTC `created_at`): `id, created_at, req_id, user_id (nullable
  context), path, status, code, message, stack` + `idx_error_log_created`,
  `idx_error_log_status`. **Not** in `SNAPSHOT_TABLES` (rule-8 spirit: backups carry user
  data, not operational logs — matches `email_log`/`planb_backups` precedent).
- **Recorder:** `src/services/errorlog.ts` — `recordError()` INSERT wrapped in its own
  try/catch: error-logging must never break error-*response*. Called from `app.onError`:
  - unhandled throws → always recorded (status 500, message + stack).
  - `ApiError` → recorded with its status/code (validation 400s and auth 401s included —
    measured volume at solo scale is tiny, and 401/400 *patterns* are a security signal,
    not noise; raw JSON 403s that bypass `onError` — CSRF middleware, owner gates — are
    visible via tail, documented in §5).
- **Viewer:** `GET /api/admin/errors` — behind the existing owner gate, Zod-validated
  query (`limit` 1–100 default 50, optional `status` filter) per rule 10; returns recent
  rows + 7-day counts by status. Panel added to `admin.html` (same htmx pattern as the
  users/emails/backup panels).
- **Retention:** `scheduledPurge` (daily 03:17 tick) now also deletes `error_log` rows
  older than 7 days — same transaction, no new cron, no new endpoint.

### 4.3 Tests

`src/tests/errorlog.test.ts`: an added `/boom` route that throws → 500 → row recorded with
stack + reqId; an ApiError route → row with code, no stack; 400-class from malformed Zod
input → recorded (by design, asserted); DB-write failure during logging → response still
correct (recorder swallows); purge deletes >7d rows and keeps fresh ones.

---

## Part 5 — HTML → `/dist/` content-hashed wiring

### 5.1 The half-built pipeline (measured this session)

`scripts/build.mjs` has bundled + hashed 17 JS entries + `app.css` into `public/dist/` with
a `manifest.json` since the perf session — **but zero HTML files reference `dist/`**
(grepped: 0 hits; the "serve-time manifest-consuming script" the build comments mention was
never written). Every page loads `/js/app.js?v=159` — versioned-URL discipline instead of
content addressing. Three JS files referenced by pages were never even entry points
(`whiteboard.js`, `tour.js`, `emoji-data.js`), and `task-controls.css` is unbundled.

The blocker was always: *HTML is static, hashes are per-build, and `public/dist/` is
gitignored* — committed HTML can't reference files that don't exist in a fresh clone.

### 5.2 The design (implemented): canonical-HTML + deploy-time wiring

**Committed HTML keeps the human-editable `?v=` URLs (canonical form).** Fresh clones,
`wrangler dev`, CI, and the zip all keep working exactly as today — they serve `/js/*.js`
sources. The `?v=` discipline and `check-cache-bust.mjs` stay fully in force.

**At deploy time only (`build.mjs --prod`, which both deploy scripts already run):**

1. Bundle ALL 20 JS entries (adds `whiteboard`, `tour`, `emoji-data`) + both CSS files
   (`app.css`, `task-controls.css`) → `dist/<name>.<8-hex-hash>.{js,css}` + manifest.
2. **In-bundle reference rewrite:** each bundle's quoted literals (e.g. `'/js/queue.js'`
   in app.js, `'/js/emoji-data.js?v=1'` in emoji-picker.js) are rewritten to the matching
   `/dist/<name>.<hash>.js` URL — the *dynamic* injection graph becomes immutable too.
   (nav.js needs nothing: soft-navigation reads the target page's own wired `<script src>`
   attributes — it inherits the hashes for free.)
3. **HTML rewrite in place:** every `src="/js/<name>.js(?v=N)?"` / `href="/css/<name>.css(?v=N)?"`
   whose name is in the manifest → the hashed `/dist/` URL. Vendor, fonts, icons, partials
   untouched. Original (canonical) HTML files are backed up to `.build-backup/`
   (gitignored, outside `public/` so it never deploys).
4. **`node scripts/check-dist-wiring.mjs`** runs between build and `wrangler deploy`
   (both deploy scripts now chain it): every `/dist/` ref in HTML matches the manifest;
   every manifest JS/CSS is referenced (allowlist for dynamically-injected entries); no
   dist file orphans on disk; no unwired `/js|css` entry refs remain. Fail → deploy aborts
   before any upload. Also run in CI in wired mode (build → check → restore) so the
   deploy artifact shape is regression-tested on every push.
5. **After `wrangler deploy` returns**, `build.mjs --restore-html` restores the canonical
   HTML from `.build-backup/` (never `git checkout` — must not eat uncommitted operator
   edits; restore-from-backup is exact and git-free).

Deterministic hashes (esbuild, fixed flags) → unchanged content ⇒ unchanged wired HTML ⇒
no SW churn across no-op deploys.

### 5.3 Service worker (v227 → v228)

- **Precache becomes manifest-driven:** `install` fetches `/dist/manifest.json` (served
  `no-cache`) and precaches its entries in addition to the static shell (pages, partials,
  icons, vendor, fonts — the unhashed set, unchanged). Manifest fetch failure → install
  proceeds with the static shell alone (best-effort, logged).
- **Fetch classes:** `/dist/*.js|css` joins the cache-first class (they are
  content-addressed + served `immutable` — strictly safer than `?v=` URLs). `?v=` class-1
  handling is kept (dev-mode HTML + in-code injections still use it). Vendor/fonts/images
  stay SWR. Navigations stay network-first. API stays network-only.
- **Version discipline simplifies (documented in sw.js header):** SW version bumps are now
  needed only when `sw.js` *logic* changes — asset changes flow through new hashed URLs +
  fresh manifest (precached on the next install/activate cycle, fetched from network on
  first request regardless). The old "bump on every public/ change" rule existed because
  SHELL precache was hardcoded to `?v=` URLs; that coupling is gone. Vendor/page files
  still refresh via SWR/network-first exactly as before.

### 5.4 What this buys (and what it deliberately does not)

- Buys: every app JS/CSS response becomes `immutable, max-age=31536000` (previously 1 h +
  SW revalidate); the byte the browser caches is provably current (content-addressed) —
  the stale-pin failure class (the 2026-08-26 lesson) becomes structurally impossible for
  app assets; HTML is `no-store` so wiring changes land on next load with zero
  coordination.
- Does not change: vendor/font SWR behavior, navigation policy, API policy, offline
  queue. `emoji-data.js` (~52 KB) stays a separate lazily-injected file (now hashed).
- Honest residual: two files live in both worlds — the unhashed `/js/<name>.js` sources
  (still served, still used by dev/`?v=` HTML) and their hashed dist twins. Accepted: the
  alternative (deleting sources / build-gated dev) breaks the fresh-clone property, which
  is a locked portability requirement. `wrangler dev` against canonical HTML simply never
  touches `/dist/`.

---

## Part 6 — End-to-end verification performed this session (actual results)

1. **Gates:** typecheck clean; full suite **224/224** (203 → 224: +10 healthcheck, +5
   errorlog, +6 dist-wiring); smoke ALL PASS; check-cache-bust PASS (admin.js v2,
   i18n.js v32); wired-chain check PASS ×2 (idempotency + canonical-backup invariant).
2. **Deploy:** dev migrated (0045) + deployed (13 ms startup); prod bookmarked
   (`bookmark:prod` → `000005ff-…`, schema 43, recorded in dr-bookmarks.md) BEFORE
   migration — the ritual dogfooded; 0045 applied to prod; prod deployed (15 ms startup,
   triggers verified intact: `17 3,9,15,21 * * *` + `*/30 * * * *`).
3. **Live checks (prod, hibana.ir):** `/api/health` → schema 44 ✓; `/` no-store ✓;
   login/dashboard HTML serves `/dist/app.<hash>.js|.css` refs ✓; the hashed JS →
   `cache-control: public, max-age=31536000, immutable` ✓ (the headline header, live);
   `/dist/manifest.json` no-cache ✓; `sw.js` v228 + manifest-driven precache ✓.
4. **Error-log E2E (owner-scoped, temp-promotion pattern, full cleanup):** viewer 200
   with correct shape; rule-10 (limit=99999 → 400) ✓; member → 403 ✓; the 404 I forced
   was NOT recorded (legacy routes return `c.json(...)` directly — only THROWN errors
   reach onError; honest finding, the recording path is unit-verified against the real
   app.onError + a real SQLite adapter). No synthetic 500 was forced on prod — the app's
   input guards (Zod + jsonBody) make unhandled throws genuinely hard to trigger, which
   is the desired property. Post-test parity: projects 37 / notes 45 / sadhana 96 /
   users 4 / error_log 0 / test account role=member / session row deleted.
5. **Time Travel:** `info` (now) → bookmark ✓; `info --timestamp` → bookmark ✓; bookmark
   + restore command recorded in dr-bookmarks.md. Restore itself deliberately NOT
   exercised on prod (destructive, in-place — the 404-path drill belongs to a dev DB).
6. **Dead-man's switch:** secret set to a capture URL (webhook.site token, no account);
   live cron-tick observation pending 03:17 UTC — result recorded in the worklog. The
   secret is removed after verification (clean off-state) until the owner sets their
   real healthchecks.io URL (runbook §5, ~5 min).
7. Operator follow-ups: create the healthchecks.io check + set
   `HEALTHCHECK_PING_URL` (§5); run the key-custody drill once (§1).

## Part 7 — Implementation map

```
src/services/healthcheck.ts               pingHealthcheck(url, ok) — never throws, 10s timeout
src/routes/admin.ts                       scheduledBackup returns outcome; /errors viewer (owner+Zod)
src/index.ts                              cron wiring: ping after backup tick (prod+url gated)
src/types.ts                              Config.healthcheckUrl, PlanBOutcome/ErrorRow types
migrations/0045_error_log.sql             error_log + 2 indexes
src/app.ts                                app.onError → recordError
src/services/errorlog.ts                  recordError (self-guarded INSERT)
src/routes/admin.ts (purge)               error_log 7-day retention in scheduledPurge
public/admin.html                          ⚠️ Recent errors panel
scripts/build.mjs                          20 JS + 2 CSS entries, in-bundle rewrites, HTML wiring,
                                           --restore-html, .build-backup/
scripts/check-dist-wiring.mjs              deploy-gate validation (new, CI + deploy chains)
scripts/pre-migrate-bookmark.mjs           npm run bookmark:prod (+ bookmark:dev)
dr-bookmarks.md                            operational bookmark log (repo root)
public/sw.js                               hibana-v228: manifest-driven precache + /dist cache-first
public/_headers                            unchanged (immutable rule now actually earned)
package.json                               drill/check/bookmark scripts, deploy chains
src/tests/healthcheck.test.ts             +10
src/tests/errorlog.test.ts                +5
src/tests/dist-wiring.test.ts             +6
docs/runbook.md                            §1 key custody, §2c Time Travel, §4 ritual, §5 monitoring
CHANGELOG.md                               v0.3.0
```
