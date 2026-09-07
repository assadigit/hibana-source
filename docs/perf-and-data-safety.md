# Hibana — Performance & Data-Safety Design (Pillar 1 + Pillar 2)

> **Status:** IMPLEMENTED (this document is both the analysis and the record).
> **Session:** 2026-09-10/11, post-commit `421f313` (Telegram inline-keyboard redesign).
> **Author:** Principal Full-Stack Engineer.
> **Scope:** (1) user-perceived performance — repeat-visit latency, caching, TTFB;
> (2) a second, independent disaster-recovery channel ("Plan B") so that destruction of
> Cloudflare D1 (corruption, account compromise, ransomware, accidental DROP) means
> **zero data loss**.

---

## Part 1 — Data safety: Plan B (Telegram)

### 1.1 The problem

The current backup system is good but is **one channel**:

```
D1 (prod) ──4×/day cron──> buildSnapshot() ──AES-256-GCM──> GitHub private repo (hibana-safe)
                          03:17 / 09:17 / 15:17 / 21:17 UTC   retention 120 files (~15 days)
```

If Cloudflare D1 is destroyed AND the GitHub channel is unavailable (token revoked, repo
deleted, account compromised — or simply the same operator fat-finger on both), the data
is gone. The goal: a second channel on a **completely separate provider**, reusing
infrastructure Hibana already runs.

### 1.2 Options considered (ranked)

| # | Channel | Verdict | Reasoning |
|---|---------|---------|-----------|
| 1 | **Telegram (the existing bot)** | **CHOSEN** | Zero new accounts, zero new secrets (bot token + BACKUP_ENCRYPTION_KEY already exist as wrangler secrets). Telegram = a fourth independent provider (Cloudflare + GitHub + Resend + Telegram), geographically distributed DCs, indefinite message retention by default, and the user suggested it. Bot API `sendDocument` allows 50 MB per file (2 GB via a local Bot API server) — our encrypted snapshot is ~100 KB, 500× under the limit. Opt-in per owner, delivered straight to the owner's linked chat. |
| 2 | Backblaze B2 / S3-compatible object storage | Deferred (documented) | Technically excellent (cheap, durable, versioned) but requires a NEW account, NEW credentials (rule 5: new secret surface), and adds a third integration to maintain. Correlated-failure profile is fine, but the cost now is real and the Telegram channel covers the "second provider" requirement. Revisit only if Telegram becomes unsuitable (e.g. snapshot grows past 50 MB, or Telegram is blocked for the user). |
| 3 | Second GitHub repo in a second org/account | Rejected | Same SaaS provider class as the primary channel — a GitHub account-compromise or ToS/billing event can kill both. Partially correlated failure = weak Plan B. |
| 4 | Email-to-self (Resend attachment) | Rejected | Fragile: deliverability (spam filters silently eat large automated attachments), attachment size limits, no clean programmatic re-download path. Resend is also already a dependency (correlated failure with the existing alerting, though not with GitHub). |
| 5 | WebDAV/Nextcloud endpoint | Rejected | New infrastructure to run and keep alive — the opposite of "reuse the bot." Bus-factor 1 project; adding a self-hosted box to keep patched is a liability, not a safety net. |
| 6 | R2 (Cloudflare) | Rejected as a *Plan B* specifically | Same account/billing provider as D1 itself — account compromise or billing failure correlates. Fine as a *performance* store, wrong as a *disaster* channel. |

### 1.3 Chosen design (implemented)

**"Telegram-as-Plan-B": on the same 4×-daily backup tick, the worker also pushes the
same AES-GCM-encrypted snapshot as a Telegram document to the chat of every owner who
opted in.**

Hard requirements from the session brief, and how each is met:

- **(a) Reuse `buildSnapshot` + AES-GCM — no new format.** `pushBackupToTelegram()`
  (src/services/backup-planb.ts) calls the *exact* `buildSnapshot()` used by the GitHub
  channel, encrypts with the *same* `BACKUP_ENCRYPTION_KEY` worker secret, and produces
  the *same* `HIBENC1` blob (magic + 0x00 + IV + ciphertext+tag, base64). The Telegram
  file is byte-compatible with what `scripts/restore.mjs` already decrypts. No parallel
  format, no second key.
- **(b) Opt-in per user.** New column `users.telegram_backup` (migration `0044`), toggled
  from the bot's own ⚙️ Settings keyboard (🗄 Backup button — bilingual). The whole-DB
  snapshot is **owner-scoped by design**: a non-owner member can never receive the
  blob (the toggle is hidden for members and the callback refuses to act for them),
  because the snapshot contains every user's rows — encrypted, but there is no reason
  to hand members a copy they can never decrypt. The owner is the disaster-recovery
  principal; that is whose chat matters.
- **(c) Same 4×-daily cron.** `src/index.ts` runs `scheduledPlanBBackup(cfg)` immediately
  after `scheduledBackup(cfg)` on every backup tick (`utcMin % 30 !== 0`, i.e. the
  03:17/09:17/15:17/21:17 slots). It is a **separate failure domain**: its own
  try/catch, its own alerting. If the GitHub push fails (rate limit, token expiry), the
  Telegram push still runs — that day the Plan B copy is the only copy, which is exactly
  when you want it. Plan B is **prod-only** (`cfg.isProd`): a dev-worker snapshot in the
  owner's chat would be a restore hazard (stale data), and the dev worker's job is
  GitHub-only. Plan B is **encryption-mandatory**: with no `BACKUP_ENCRYPTION_KEY` set
  the push refuses to run (never plaintext to Telegram).
- **(d) Restore drill.** `npm run drill:planb` (scripts/restore-drill-planb.mjs): reads
  the newest `planb_backups` row from prod D1 (Cloudflare REST API), downloads the
  document via Bot API `getFile`, verifies sha256 + HIBENC1 magic, decrypts, checks
  rule 8 (no `password_hash`, no `sessions`), then round-trips the snapshot through the
  real `restore.mjs` into a scratch SQLite DB and compares row counts. Prints counts and
  PASS/FAIL only — never secrets or snapshot contents.
- **(e) Key handling.** `BACKUP_ENCRYPTION_KEY` stays a worker secret + offline copy.
  It is NOT rotated (rotation would orphan every existing backup — runbook §1). The new
  code path never logs it and never embeds it anywhere.

**What lands in the chat (the disaster artifact):**

```
file:    hibana-backup-2026-09-10T15-17-00-123Z.bin   (the HIBENC1 blob, base64)
caption: 🗄 Hibana backup (Plan B)
         schema 20260910 · 15:17 UTC · 12,345 rows · sha256 <64-hex>
         AES-256-GCM — restore: docs/runbook.md §2b
pinned:  yes (newest backup is pinned; older pin removed)
sound:   silent (disable_notification — 4×/day must not buzz the owner)
```

The sha256 in the caption is deliberate: it makes the **manual** restore path
D1-independent — the operator can download the .bin in any Telegram client, verify the
hash locally (`sha256sum`), and feed it to `restore.mjs` without needing the
`planb_backups` log or any Cloudflare access.

**Message log (D1 table `planb_backups`, migration 0044):** one row per sent document —
`user_id`, `chat_id`, `message_id`, `file_id`, `file_size`, `sha256`, `schema_version`,
`sent_at` (rule 1: user-scoped; rule 3: UTC). Powers the automated drill + retention.
When D1 itself is destroyed this log dies with it — by design the *documents* are the
recovery artifact, and the caption carries the hash so the log is not needed.

**Retention:** keep newest **60** documents per opted-in owner (~15 days at 4/day —
matches the GitHub channel's 15-day window), deleted via Bot API `deleteMessage`
(bots can delete their own messages in private chats without time limit) + log-row
cleanup. Best-effort: a failed delete just leaves an older document in place (safe
direction). If D1 is destroyed, retention stops and the chat simply accumulates —
harmless (100 KB × 4/day ≈ 146 MB/year) and arguably desirable in a disaster.

**Rate limits:** 1 send per opted-in owner per tick (currently = 1 document 4×/day).
Telegram's documented bot limits (~30 msgs/sec, 20 msgs/min to the same chat in
groups) are nowhere near relevant. The 50 MB Bot API cap: our snapshot is ~100 KB;
chunking is **deferred** — if a future multi-user snapshot ever crosses ~45 MB, either
stand up a local Bot API server (2 GB) or chunk with a manifest; noted here so the
limit is a known constraint, not a surprise.

**Bot token rotation:** `@BotFather /revoke` issues a new token for the *same bot
identity* — previously sent documents remain downloadable via `getFile` with the new
token (file_ids are bot-scoped, not token-scoped), and remain visible in the chat UI
regardless. Rotating the token does **not** lose Plan B history. Deleting/recreating the
bot (a *new* bot) would orphan old file_ids for API access — the chat documents would
still be manually downloadable. Documented in runbook §1.

### 1.4 Why a separate snapshot build (not sharing the GitHub one)

The Plan B push builds its own snapshot (28 SELECTs, ~ms) instead of reusing the bytes
the GitHub path pushed: (1) the two channels must be independently triggerable and
independently retryable; (2) each gets a fresh IV — each channel stores its own
self-contained encrypted copy; (3) no coupling means a refactor of
`backupToGitHub()` can never break Plan B. Cost is negligible on a 4×/day cron.

### 1.5 What Plan B deliberately is NOT

- Not a per-user export (`buildUserSnapshot` exists for that, rule 8-scoped). Plan B is
  the whole-DB disaster artifact, same as the GitHub channel.
- Not visible in the admin console UI in v1 — the manual trigger is
  `POST /api/admin/backup/planb` (owner-only, Zod-validated per rule 10) and the cron.
  A console button is a nice-to-have for a later session (noted in CHANGELOG).
- Not a substitute for the GitHub channel. The GitHub channel keeps 120 snapshots +
  retention management + is the primary restore source. Plan B is the *independent*
  copy that survives a GitHub-side catastrophe.

### 1.6 Bug found + fixed during end-to-end verification (2026-09-11)

Triggering the Plan B push against prod surfaced a **latent break in the PRIMARY
restore path**: the GitHub Contents API decodes the base64 PUT payload before storing,
so the repo file is the raw-binary HIBENC1 blob — while `restore.mjs`'s auto-detection
only recognized the base64-TEXT shape. The runbook's documented download path
(`curl <download_url> -o snapshot.json`) therefore produced a file that crashed
`JSON.parse`. **Every encrypted GitHub backup since C3 (2026-09-10) was unrestorable
via the documented path** (the operator would have had to know to re-encode the file
to base64 first — nowhere documented). The primary drill (`npm run drill`) had the
same defect in Part A.

Fix: `scripts/lib-backup.mjs` now detects all THREE file shapes (raw-binary HIBENC1,
base64-text HIBENC1, legacy plaintext JSON) and shares one decrypt implementation
across `restore.mjs`, `restore-safe.mjs`, `restore-drill.mjs`, `restore-drill-planb.mjs`.
Pinned by `src/tests/backup-formats.test.ts` (5 tests: both shapes round-trip through
the real `encryptBackup`, garbage never misdetected, wrong key length rejected).
Verified live: the actual prod GitHub backup (binary) went from `JSON.parse` crash →
"encrypted — set BACKUP_ENCRYPTION_KEY" (correct detection); the Telegram document
(base64 text) was already correct.

Incidental detail recorded for future archaeology: the GitHub channel's plaintext is
pretty-printed (`JSON.stringify(…, null, 2)` — 604,894-byte blob for the current DB)
while the Plan B document is compact (`JSON.stringify(…) — 482,292-byte blob). Same
JSON content, both valid; Plan B keeps documents smaller in the chat.

---

## Part 2 — Performance (Pillar 1)

### 2.1 Where the time actually goes (findings)

1. **The `public/dist/` content-hashing pipeline exists but is NOT wired to HTML.**
   `scripts/build.mjs` bundles + hashes (`app.6b1fa9da.js`) and writes
   `dist/manifest.json`, but every HTML page still references `/js/app.js?v=159` —
   the pre-hashing URLs. `grep -rn "dist/" public/*.html` → zero hits. So
   "public/dist/* is content-hashed → cache forever" from the session brief is only
   *half-true*: hashed files exist, but nothing loads them. Wiring HTML → dist is the
   single biggest future lever (immutable caching, no ?v= discipline needed); it is
   **deferred** (touches ~25 HTML files + the SW SHELL + check-cache-bust, and this
   codebase has a documented stale-cache regression history — see sw.js header). What
   shipped instead: `_headers` rules that make `/dist/*.js|css` **immutable** and
   stop the build from copying *unhashed* vendor files into `dist/` (they were dead
   weight AND an immutable-cache trap: `/dist/htmx.min.js` has no hash).
2. **The service worker is network-first for ALL same-origin assets.** Every repeat
   visit re-fetches every JS/CSS/font/image through the SW (the cache is only an
   offline fallback). This is the repeat-visit latency bug. Fixed (see 2.2).
3. **D1 hot-path queries are already fully indexed.** Measured with the new
   `npm run perf:explain` (EXPLAIN QUERY PLAN + timing, busy-solo synthetic scale:
   500 projects / 5k notes / 2k tasks / 10k journal rows / 40k canvas elements —
   25–100× current real usage):

   | Query | Plan | Time @ 25–100× scale |
   |---|---|---|
   | dashboard: projects by status | SEARCH idx_projects_user_status | 0.21 ms |
   | dashboard: recent 10 | SEARCH idx_projects_user_updated | 0.07 ms |
   | dashboard: stage boxes (48) | SEARCH idx_projects_user_updated | 0.14 ms |
   | dashboard: solved this week | SEARCH idx_hurdles_project + subplan | 0.78 ms |
   | dashboard: notes widget (20) | SEARCH idx_quick_notes_sort | 0.11 ms |
   | dashboard: todo board (all open) | SEARCH idx_sadhana_board (+sort) | 4.91 ms |
   | dashboard: todo journal feed | SEARCH idx_sadhana_quad + idx_sadhana_updates (+sort 10k) | 15.10 ms |
   | bot: quadrant page (8) | SEARCH idx_sadhana_board | 0.34 ms |
   | project page: hurdles | SEARCH idx_hurdles_project | 0.04 ms |
   | calendar: pins by due date | SEARCH idx_projects_user_id | 0.10 ms |
   | canvas: viewport bbox | SEARCH idx_canvas_y | 29.07 ms @ 40k elements |
   | backup: whole snapshot | SCAN (cron-only) | 121 ms |

   **Verdict: no index additions.** Rule 9's original composite indexes + 0042 cover
   every predicate at orders of magnitude beyond current scale. The only two
   double-digit-ms queries are a cron-only scan and a 40k-row canvas bbox that is
   ~0.3 ms at the real 377-element scale. Thresholds where an index WOULD pay off
   (documented so a future session can re-run `npm run perf:explain` and act):
   `sadhana_updates` > ~100k rows → index on `(created_at)`; canvas elements >
   ~50k → partial index on the bbox columns per board. D1's ~10–40 ms network RTT
   dwarfs all of these — query-shape is not the bottleneck, which is why the real
   wins below are all client/edge-side.
4. **`/js` + `/css` HTTP cache policy is 1h+SWR, vendor 1d+SWR, HTML no-store** —
   reasonable for the ?v= URL scheme. `/dist/*` had **no rule at all** (CF default
   max-age=0-ish revalidation) — fixed. The root `/` had no explicit HTML rule —
   fixed (no-store, same as *.html).
5. **Worker cold start:** `src/index.ts` stays a thin shell (createApp + cron
   dispatch). The one new import (backup-planb service) is tree-shaken into the same
   bundle and costs ~1 KB parse. No regression — verified by deploy + probe.

### 2.2 What shipped (Pillar 1)

1. **Service worker: strategy split by URL class** (public/sw.js, `hibana-v226` →
   `hibana-v227`):
   - `/js/*.js?v=N` + `/css/*.css?v=N` (versioned app assets) → **cache-first**.
     Rationale: the full URL (incl. `?v=`) is the cache key, and this codebase's
     discipline (check-cache-bust.mjs in CI + SW SHELL version bumps on every public/
     change — see the changelog's unbroken `vNNN` rotation record) means a cache hit
     is byte-identical to origin. A `req.cache === 'reload'` escape hatch keeps
     hard-refresh authoritative for power users. This is the repeat-visit win: the
     app shell goes from ~15–25 network round-trips to zero.
   - `/vendor/*`, fonts, images, `.webmanifest` → **stale-while-revalidate**: instant
     from cache, refreshed in the background (they change only on deploy, but their
     names are unhashed — so they must stay revalidatable).
   - Navigations: network-first (unchanged — fresh HTML always). API: network-only
     (unchanged). Unversioned same-origin assets: network-first (unchanged — the
     2026-08-26 stale-pin lesson). Cross-origin: pass-through (unchanged, k2 fix).
   - Residual risk documented honestly: a JS change shipped *without* a `?v=` bump
     AND without an SW version bump would pin stale for cache-first URLs. That
     failure class is exactly what check-cache-bust.mjs + the SHELL-alignment
     convention guard, and it predates this change (the SW SHELL already precached
     by versioned URL).
2. **`public/_headers`:** root `/` → no-store (was implicit); `/dist/manifest.json`
   → no-cache (changes every build); `/dist/*.js` + `/dist/*.css` →
   `public, max-age=31536000, immutable` — now safe because build.mjs no longer
   copies unhashed vendor files into `dist/` (every remaining dist file is
   content-hashed). Verified post-deploy with `curl -I`.
3. **`scripts/explain-hotpaths.mjs`** + `npm run perf:explain` — the measurement
   harness above, re-runnable any time the schema or queries change.

### 2.3 Explicitly rejected / deferred (Pillar 1)

- **KV or Durable Objects for hot reads (dashboard feed, sadhana board):** REJECTED.
  Solo-scale D1 queries measure 0.04–4.91 ms; the win would be zero, the cost real
  (cache invalidation on every write, a second consistency model, new bindings =
  portability surface — the Node path has neither KV nor DO). "Do not add
  infrastructure for its own sake."
- **htmx fragment caching (HX-Request responses):** REJECTED. Fragments are
  per-user authenticated HTML (rule 1 data); edge-caching them risks cross-user
  leakage and staleness that the app's undo-toast UX actively fights. The fragments
  are cheap to render (measured above).
- **HTML `s-maxage` edge caching:** REJECTED. Pages are `no-store` by deliberate
  decision (cache-pain history, 2026-08-25 audit) and the authenticated shell must
  never be served stale.
- **Wiring HTML → `/dist/` hashed bundles:** DEFERRED (highest future lever; see
  2.1.1 — needs an HTML rewrite pass + SW SHELL rework; tracked in CHANGELOG).
- **Vazir variable font swap:** previously rejected (P4.13) — unchanged.
- **Preconnect/preload hints:** nothing to do — single origin, CSP blocks external
  origins, fonts self-hosted and already precached by the SW; boot.js already
  paints FA + injects the Vazir stylesheet before first render.
- **Asset budget:** no page ships > 250 KB of JS on the critical path except the
  Canvas pages, which load fabric (~310 KB min+gzip shim) — already deferred to
  only canvas/whiteboard pages. htmx 10 KB, alpine 15 KB gz. No action.

---

## 2.4 Implementation map (both pillars)

```
migrations/0044_planb_telegram_backup.sql     users.telegram_backup + planb_backups + index
src/types.ts                                  UserRow.telegram_backup, PlanBBackupRow
src/services/telegram.ts                      sendTelegramDocument() — multipart, 60s timeout
src/services/backup.ts                        export importAesKey/encryptBackup (reused, unchanged format)
src/services/backup-planb.ts                  pushBackupToTelegram() + retention + pin + silent send
src/routes/admin.ts                           scheduledPlanBBackup() + POST /api/admin/backup/planb
src/index.ts                                  cron wiring (backupTick → plan B, separate failure domain)
src/routes/integrations.ts                    ⚙️ Settings 🗄 Backup toggle (owner-only, bilingual)
scripts/restore-drill-planb.mjs               npm run drill:planb
scripts/lib-backup.mjs (+ .d.mts)            shared backup-file format detection + decrypt (all 3 shapes)
scripts/explain-hotpaths.mjs                  npm run perf:explain
public/sw.js                                  strategy split, hibana-v227
public/_headers                               / no-store · /dist/* immutable · manifest no-cache
scripts/build.mjs                             stop copying unhashed vendor into dist/
package.json                                  drill:planb, perf:explain scripts
src/tests/planb.test.ts                       toggle + push + retention + rule-8 + owner-gate tests
src/tests/backup-formats.test.ts              both file shapes round-trip (the §1.6 fix)
docs/runbook.md                               §2b Plan B restore, decision tree, rotation notes, §2 format note
```
