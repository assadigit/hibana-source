# Hibana — Roadmap: what remains

Prioritized. Rules/architecture live in `CLAUDE.md`; full spec in `pm-app-spec.md`.
Ask before building anything that doesn't serve the two jobs (never lose an idea / never lose your place).

## 2026-08-25 — Telegram bot power + note attachment + login captcha drop — SHIPPED
- [x] **Telegram account linking open to all users** (`f9245b9`): Settings → Telegram now
      works for any signed-in account (was owner-only). Status badge, t.me bot link,
      step-by-step `/start <code>` instructions, Unlink button; codes expire after 1h,
      one active code per account.
- [x] **Bot commands** (`3890bb2`): `/note <text>` (Quick Note), `/list` → items one per
      message → `/done` (checklist on the dashboard; `/cancel` aborts; 2h session TTL,
      50-item cap), `/idea <text>` (explicit idea), `/help` + bare `/start` (linked/
      unlinked-aware), unknown commands → help pointer. Migration 0016.
- [x] **Quick notes attach to Ideas/projects** (`e245117`): paperclip on every notebook
      card → project picker → chip; project page shows “Related notes (n)”. Migration
      0017 (`quick_notes.project_id`, no FK cascade by design).
- [x] **Login CAPTCHA removed** (`e43d5c7`): Turnstile stays on signup only; login was
      already token-free server-side (rate limiter is the guard). SW `v73`.
- [x] **Self-test loop** (`data/selftest-loop.mjs`, gitignored): 30/30 PASS on prod —
      login → link-code → real-webhook `/note`/`/list`/`/idea`/`/cancel` round (synthetic
      chat, account unlinked + artifacts cleaned after) → attachment round. Re-run:
      `HIBANA_EMAIL=… HIBANA_PASSWORD=… node data/selftest-loop.mjs`.
- [ ] **Heads-up (pre-existing, untouched)**: the Notebook's dark-mode ink filter
      (`--nb-ink` invert on `#nb-board`) inverts placed PHOTOS too — propose excluding
      photos if tackled.
- [ ] **Heads-up (this session)**: one vitest run showed a single non-reproducible
      failure (149/150); three subsequent runs 150/150. Unrelated to code changes
      (frontend-only edit) — watch for recurrence.

## Sadhana quadrant board — SHIPPED (2026-08-25)
- [x] **Sadhana board** (`250441d`, migrations 0018): `/sadhana.html` + nav — standalone
      2×2 quadrant board (renamable, §5.19), tasks with tags / fuzzy+exact deadlines
      (+overdue ⚠) / recurrence / notes / progress / pin, update journal (§5.9), undo-able
      soft delete + restore API, drag move + reorder, tag filter chips, focus (zen) view
      (§5.10), Archive + recurring completion log (§5.15), Monday Asia/Tehran sweep +
      Telegram deadline reminders via cron (§7). Spec §8 Q1+Q2 resolved by decision
      (recurring tasks excluded from the sweep; new tasks sort position→newest-first).
- [x] **Live self-test loop** (`data/sadhana-selftest.mjs`, gitignored): ~60 checks across
      every route — board JSON/fragments/counters, quick-add (JSON + HX), dialog create
      (tags/fuzzy/note/recurring), validation 400s, edit title/note/progress/pin/overdue,
      journal CRUD, reorder (stray-id safe), move + counters, complete/uncomplete, recurring
      completion log, focus, rename set/blank/61-char/reset, delete→restore→404s, cleanup.
      Awaits fresh credentials (the password Ali gave earlier rotated mid-session).
- [ ] **Deferred by design**: emoji picker was upgraded to a categorized searchable picker
      (2026-08-25); admin back-office N/A (solo app).
- [x] **Sadhana spec gaps closed (2026-08-25, all nine from the audit)**: 30-min reminder
      cron (`*/30 * * * *` — daily-only jobs gated to the 03:17 trigger) so the 2h-before
      deadline reminder actually fires; grid order Q1\|Q3 / Q2\|Q4 (spec §3); focus add form
      with tags + deadline + focus-flag route (`focusZone`); focus reorder + backdrop/Esc
      close; recurrence config UI (weekday tick buttons — Persian Sat-first — + N + day-of-
      month panels, edit form + dialog); progress visible label + click-active-resets;
      deadline picker component (Quick pick / Pick date tabs, Jalali + fa digits, Clear,
      ✕-clear in edit form) with server-rendered `📅 date 🕐time` (no more data-date
      clobbering); categorized searchable emoji picker (8 sets, keyword search); /status +
      /pause + /resume bot commands (telegram_paused column, migration 0019; /start re-
      link resumes; client + Sadhana reminder legs honor it); overdue shake + ↓ more badge +
      swap-in quick-add + per-card ⚙️-dialog. Bonus fixes found by the live selftest: empty
      PATCH now 400 (was silently clearing recurrence via defaults); boolean coercion of
      form `false`/`0` strings. Live-verified: `data/sadhana-selftest.mjs` 85/85 +
      `data/selftest-loop.mjs` 30/30 on prod (member account credentials refreshed).

- [x] Registration form (`public/signup.html`), Turnstile CAPTCHA (signup + login),
      6-digit email-code confirmation (`/api/auth/verify`, `/verify/resend`), login blocked
      until verified, reset unchanged (email + Telegram already live). Migration 0015,
      126 vitest, typecheck clean, smoke PASS. Details: CHANGELOG 2026-08-24.
- [x] **CAPTCHA keys — WIRED (commit `b2aef3e`)**; **signup flow now works (commit
      `0d0d488`)**: root cause of the day's failures was a malformed `--/>` comment in
      the signup page eating the body class (→ auth guard bounced to login) + broken
      edge-cache variants at the old URLs. Pages moved to `/signup` + `/confirm` (301s
      from the old); verified live end-to-end. The widget still withholds tokens from our
      headless browser by design — the FINAL check is a real-browser signup (Ali); see
      NEW_SESSION.
- [ ] Registration is TEMPORARILY open (`OPEN_REGISTRATION = "true"` in wrangler.toml
      both envs). When Ali closes it: delete those two lines + redeploy — invite codes
      (owner Settings screen) become required again automatically.

## Roast plan — COMPLETE (all phases shipped; never lose an idea / never lose your place stay the guardrails)
- [x] P1 contrast/monochrome CTA · P2 type/hierarchy · P3 Manrope self-hosted ·
      P4 mobile topbar + fa-safe badges · P5 audit polish · P6 empty/loading states,
      data-driven report bars, board loading pills, zoom hit areas, touch-drag
      fallback (long-press → synthetic DnD), Telegram reminder channel.
      See CHANGELOG 2026-08-24 (P5 + P6 entries).
- [x] **P7 dashboard audit (21 items)** — quick-capture family (`.qa-btn`), FAB
      labels + Ctrl+N shortcut, sign-out demoted into the profile menu, language
      rows with active check, tag-colored chips on dashboard rows, activity
      view-all link, icon-in-colored-circle system, brand-amber nav/link states,
      notebook composer label; fixed hard-load active-nav marking. See CHANGELOG
      2026-08-24 (P7 entry). Remaining on the topic (one-line offers, no build
      needed): amber CTA fills are intentionally still monochrome (Q1.C).
- [x] **Spec §15 rate limiting — DONE in-app** (migration 0014, `src/services/
      ratelimit.ts`): login + password reset 30 req/60s/IP, Telegram webhook
      300 req/60s/IP (limiter before the secret check), 429 past the limit, stale
      buckets purged by the daily cron. Live-verified on the dev worker. The
      Cloudflare edge rules (`scripts/rate-limit.mjs --apply`) remain OPTIONAL
      hardening if a Zone>WAF token ever appears.
- [x] HTTPS is already enforced in-app (301 redirect on `x-forwarded-proto: http`,
      app.ts) — the Cloudflare “Always Use HTTPS” dashboard toggle remains purely
      optional edge hardening (user-held, 30 seconds if Ali wants it).
- [ ] **Heads-up, pre-existing**: the Notebook's dark-mode ink filter (`--nb-ink`
      invert) inverts placed PHOTOS too — propose excluding photos if tackled.
      (2026-08-24: the invert now carries `brightness(0.9)` for softer whites,
      which also mildly dims photos.)
- [x] **Bugfix (2026-08-24): deleted canvas objects stayed deleted** — the delete
      render's viewport refetch resurrected items before the queued tombstone
      flushed. Closed with client-LWW + deleted guards + immediate delete flush
      (both boards); probe `data/delete-fix.mjs`. See CHANGELOG.

## P0 — finish the live rollout
- [x] **Deliberate prod rollout — DONE.** Applied migration `0009_boards.sql` to the prod D1
      (`pm-app-prod`, `--env prod`) and ran `npm run deploy:prod`. `https://hibana.ir` is now at
      HEAD: Notebook/whiteboard, Canvas upgrade, nav links, duplicate-title warning, Settings
      rounding, FAB/card/header fixes. Verified live (pages 200; board-aware `/api/canvas/full`
      returns on the migrated prod DB).
- [x] **Canvas + Notebook interactivity — root cause fixed** (dev + prod): the CDN "5.3.0"
      Fabric is actually a mislabeled 5.1.0 build where `new fabric.Canvas('#id')` is a silent
      no-op (nothing draws/types). Fabric is now self-hosted (`public/vendor/fabric.min.js`,
      real 5.3.0) and both pages construct with the DOM element. SW bump `v6 → v7`. Verified
      headless: pen stroke persists on both boards. If a client still shows the dead UI, one
      hard refresh clears the stale shell.
- [x] **Custom domain `hibana.ir` — LIVE.** Zone active; prod deployed; custom domain attached
      via the API/dashboard (`scripts/custom-domain.mjs`). Verified `https://hibana.ir` serves the
      app + login works; prod Telegram webhook re-pointed to `https://hibana.ir/api/telegram/webhook`.
- [x] **Login loop fixed** — HTTPS-redirect middleware deployed; `/public/app.html` (Phase-0 skeleton)
      deleted (it was served at `/app` bypassing the worker → Dashboard never rendered + an auth
      bypass). `/app` is now the worker-guarded Dashboard (unauth → 401). Theme toggle fixed;
      Notion-style redesign shipped; SW cache bumped to v2.
- [ ] **User-held action**: enable Cloudflare **“Always Use HTTPS”** (zone `hibana.ir` → SSL/TLS →
      Edge Certificates). `scripts/always-https.mjs` can flip it via the API, but the wrangler OAuth
      token lacks Zone>Settings:Edit scope (403 on the settings endpoint), so it stays a dashboard
      toggle. Until then the user must use `https://`. Then do a final **branded-URL browser smoke**
      on `https://hibana.ir`.
- [ ] **Rotate the GitHub fine-grained token** (it was pasted in chat). Scope: `Contents: Read+Write`
      on `assadigit/hibana-safe`. Current token verified working (backup list/pull in the drill).
      Flow: mint the new token in GitHub → edit `.secrets.env` `GITHUB_TOKEN=...` →
      `npm run secrets:set` (+ `:prod`) → re-run `npm run drill` to confirm backups still work.
- [x] **Resend email send-path verified (inbox check pending)**: `scripts/test-email.mjs`
      (+ `--prod`) logged into BOTH live workers and got 200 from `/api/dev/test-email` on each; a
      fresh test email also sent directly via `scripts/check-emails.mjs --send`. The stored Resend key
      is sending-only (can't query delivery), so Ali must confirm a test email landed in
      `aliassadi.plus@gmail.com`.
- [x] **Restore drill — DONE**: `npm run drill` (new) proves restore-in end-to-end against a real
      prod snapshot + a synthetic round-trip through the real `buildSnapshot()` export.
      Fixes landed in `scripts/restore.mjs`: it was broken under plain Node (TS syntax in a `.mjs`),
      serialized SQL values with JSON quoting (broken INSERTs), and tried to wipe/reinsert `users`
      despite `password_hash` being NOT NULL + excluded by rule 8. It now skips `users`/`sessions`
      (auth is seeded, never restored) and `npm run restore` is a real script.

## P1 — small UX gaps that are spec-documented or natural next polish
- [x] **Settings → Change password / Account** screen (spec §5.8 Account). `PATCH /api/auth/password`
      (verify old via PBKDF2, set new, kill all OTHER sessions in one transaction — current device
      stays logged in) + Settings UI (Account card). 5 new vitest cases (44 total). Deployed to
      DEV + PROD (verified live).
- [x] **Drag-reorder UI**: in-status drag reorder for Cards/List, in-column reorder for Kanban,
      and hurdle drag-reorder on the project page — native HTML5 DnD, delegated so htmx swaps need
      no re-binding. `POST /api/projects/:id/hurdles/reorder` added; `src/tests/reorder.test.ts`
      (5 cases, 49 total). Deployed to DEV + PROD and verified live.
- [x] **Duplicate-title soft warning in the UI**: `/api/projects/duplicate-check` is wired into the
      quick-add Spark modal and the client-project dialog — 350ms-debounced, muted, non-blocking.
      Client-side only (no schema change); `qa.duplicate` i18n key (EN + FA). Deployed to DEV,
      verified live; prod deploy pending go-ahead.
- [x] **Telegram secondary password reset (spec §9)** — the linked-chat bot accepts `/reset` and
      replies with a one-time hashed token + app deep link (same `password_resets` machinery as the
      email path, shared via `src/services/reset.ts`). Unlinked chats get a “link first” reply, no
      token. Deployed DEV + PROD, verified live (+3 vitest).
- [x] **Telegram: verify full flow (link code → text an idea → confirmation + deep link)** — done in
      the Phase-5 gate (user-confirmed). Remaining decision: should reminders also send to Telegram?
- [x] **Rate limiting script/tooling (spec §15)** — `scripts/rate-limit.mjs` ready (zone ruleset for
      login/reset/webhook). *Not applied*: the wrangler OAuth token lacks Zone>WAF/ruleset scope (401)
      and there's no CF API token on this box. Manual dashboard path: Security → WAF → Rate limiting
      rules → Create rule (2 rules: `/api/auth/login`+`/api/auth/reset/*` at 30 req/60s/IP blocking
      300s; `/api/telegram/webhook` at 300 req/60s/IP blocking 60s) — or drop a scoped API token in
      and run `node scripts/rate-limit.mjs --apply`.
- [x] **Scheduled D1 backup cron confirmed running** — both workers show schedule `17 3 * * *`;
      GitHub `backups/` has nightly snapshot files at 03:17 on 08-20 and 08-21 (38 KB → 118 KB as real
      data landed). Re-check anytime: `node data/verify-backups.mjs`.
- [x] **Kanban status-change on drop + in-column reorder** (shipped with drag-reorder).

## P2 — completeness / hardening
- [x] **Full Farsi (fa) copy + RTL on server fragments** (spec §14). Server-side `tr()` in
      `src/lib/i18n.ts` translates every htmx fragment by the user's `language_pref` (English stays
      the default); `public/js/i18n.js` dict completed (144 keys) for static chrome/JS strings;
      nav + all static pages wired with `data-i18n`. **Vazir font** now loads for Farsi (was
      Verified with an in-process Farsi-user render (chrome Farsi, data untouched).
      Deployed to DEV + PROD (verified live). Public pages (login/reset) stay
      English pre-auth; stored history-note text stays English by design (it's data).
- [x] **PWA**: PNG 192/512 icons added (`public/icon-192.png`/`icon-512.png`, rasterized from
      `icon.svg` via headless Chrome; manifest + SW precache updated, SW cache `hibana-v16`).
      Remaining: installability test once on the custom domain (user-held).
- [x] **Backup retention — DONE**: after every backup push (daily cron + manual admin
      backup) `enforceRetention` prunes `backups/snapshot-*.json` to the newest 60 — dev + prod
      both write into the same repo, so 60 ≈ a month of both (+6 vitest cases in
      `src/tests/backup.test.ts`, 71 total). Best-effort by design — a failed prune can't fail
      the backup itself; the fresh snapshot is never deleted.
- [x] **Obsidian zip import** — `/api/import/obsidian` accepts a `.zip` of the whole vault
      (recursive, skips `.obsidian/`/`.trash`/hidden/non-md, `fflate` — Worker-safe); re-imports
      are idempotent (per-user title dedupe) and corrupt archives → 400 `invalid_zip`.
      Flat `.md` uploads unchanged. +4 vitest (85 → 89).
- [x] **Telegram reminder delivery decision** — client-work reminders (§6.3) push to the
      bot too (shipped 2026-08-24): reminders land in the linked Telegram chat as well as
      email.
- [x] **Monitoring — health endpoint DONE**: public `GET /api/health` (no auth, `Cache-Control:
      no-store`) reports app + DB liveness and the applied schema version per runtime
      (`_migrations` on Node, `d1_migrations` on D1); 503 on DB unreachable. Registered on the
      root app like the webhook (outside coreRoutes' auth wildcard). 4 vitest cases in
      `src/tests/health.test.ts` (79 total) + a smoke step; test helper now applies migrations
      via the real `applyMigrations` runner (so tests track `_migrations` faithfully).
      Remaining (user-held): review Worker logs/tail in a real session.
- [x] **CSRF hardening** — done: `createApp` rejects any state-changing request whose `Origin`
      (fallback `Referer`) is not the app's own origin, 403 before auth — covering the
      form-encoded htmx surface on top of SameSite=Lax. GET reads exempt; server-to-server callers
      with neither header allowed (incl. the rule-11 webhook). +6 vitest (100 total), live-verified
      on dev + prod.
- [x] **Node/self-host path** — the first real smoke run (`npm run start:node`) found and
      fixed a blocking bug: static assets were 401'd by coreRoutes' auth wildcard before the
      asset fallback could serve them (Cloudflare's assets binding serves files before the
      Worker, so this only bit the Node path). An assets-first middleware in `createApp`
      mirrors the CF model; pages, /vendor libs, manifest and icons all verified serving 200
      over HTTP on the Node server. **Full VPS-style fresh-checkout smoke DONE this session**: a
      checked-out tree with no node_modules/data/git → `npm ci` → `.secrets.env` →
      `npm run migrate:node` → `seed:admin:node` → real `start:node` server → **61/61 HTTP walk**
      on 127.0.0.1:8787 (every page + assets, health, auth boundary, 16 authed endpoints,
      full mutation round-trip). `migrate:node` now creates `data/` on a fresh checkout (server.ts
      already did; the script now mirrors it). Reusable walk: `data/walk.sh`.
- [x] **Self-host remaining CDNs (htmx, Alpine, jalaali-js)** like Fabric (`public/vendor/`):
      zero runtime CDN dependency, works offline, no version drift (the Fabric cdnjs mislabel
      this session is the cautionary tale). SW cache bumped `v15 → v16`. The **Vazir font is
      self-hosted too** (`public/vendor/vazir/`, same files `font-face.css` references) — the
      app now has **zero runtime CDN references**; the `fa` CSS rule covers the whole tree so
      no element can fall back to Arial.

## Known issues / test gaps
- The editor's TS language server can miss freshly installed modules (stale); `npm run typecheck`
  is authoritative.
- `/api/auth/me` logs a benign 401 for the login-page auth probe (by design).
- On Cloudflare static-assets, `*.html` redirect to extensionless (`/login.html` → `/login`);
  app code is written to work either way; `/app` previously showed a stale edge cache —
  verify once more after the dashboard landing change.
- Frontend-only fixes (queue, modal, theme) aren't covered by the vitest suite (no jsdom) —
  verified manually via `scripts/browser-check.mjs`; consider adding a jsdom or Playwright test
  for the queue/flush path. Since 2026-08-24 a headless-Chrome live sweep exists: `data/live-check.mjs`
  (every public page on prod — console errors, exceptions, failed loads, SW active; 41 checks) plus
  `data/reports-check.mjs` (authed reports page against the Node server). It caught the
  reports.html summary crash AND the regression in its first fix before Ali saw it.
- New drawing gestures (Notebook pens/eraser/text; Canvas text/eraser/undo) rely on Fabric and
  aren't covered by the vitest suite — but they were **verified end-to-end via a headless-Chrome/CDP
  probe** (draw → queue → `/api/canvas/sync` → persists on both `board`s) after the Fabric fix.
  A repeat manual browser pass is still recommended.
