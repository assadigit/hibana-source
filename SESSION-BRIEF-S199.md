# SESSION BRIEF — S199 (the fix-and-implement round for the S198 SWOT audit)

> **STATUS: S199 EXECUTED 2026-10-11 — released as v0.4.1.24 (push 1cc4779, CI 38122442476
> GREEN, CD 38123258804 GREEN, live-verify ALL GREEN).** Batches 1-4 complete + Batch 5
> partial (calendar spec, auth-page e2e, favicon rule). Banked for S200: UX-3/4/5/6,
> PERF-8. The full record: Changelogs §1 row 199 + worklog.md's S199 section. S200 is next.

**You are the next agent.** Read, in order: `Agents.md` (canonical rules) → `SWOT-AUDIT-S198.md`
(the audit — every finding has an ID; THIS brief references those IDs) → `Changelogs.md` §1 →
repo `worklog.md` tail → this file. The repo is your working tree: clone
`https://github.com/assadigit/hibana-source`, `bun install`, work, commit+push when done
(CI runs the ladder, CD auto-deploys). Remote `main` is source of truth.

**Doctrine reminders (violating any of these voids the session):** SAFE-for-ideas (no
reminders/nags/gamification — REJECTED always wins); rule 4 (schema changes need Ali's WRITTEN
approval — §6 of the audit lists the asks; do NOT ship them unprompted); PBKDF2 stays 100k;
CSP unsafe-inline stays for now (the hardening path is SEC-1's lint, not a CSP rewrite); no new
third-party origins; English with Ali in chat; FA+EN in app copy; commit format
`<area>: <change> — <one-line why>`.

**The ladder (run in this order before ANY push; all must be green):**
typecheck → vitest (expect 623+) → eslint (0 errors) → build → cache-bust check →
i18n parity (1570/1570) → bundle-size → FULL e2e on the local QA server → smoke.
Asset changes bump `?v=` refs + `sw.js` VERSION + `package.json` patch. Pure-code changes
(CI/scripts/docs/typings) need NO cache-bust.

**QA server (throwaway DB, port 3017):**
```
DB_PATH=/tmp/hibana-e2e.db PORT=3017 NODE_ENV=development RATE_LIMIT_DISABLE=1 OPEN_REGISTRATION=true GITHUB_OWNER=x GITHUB_REPO=y GITHUB_TOKEN=x OWNER_EMAIL=test@test.local TELEGRAM_BOT_TOKEN=x TELEGRAM_SECRET=x HIBANA_SHOTS_DIR=/tmp/hibana-e2e-shots nohup node --import tsx src/server.ts > /tmp/hibana-qa-server.log 2>&1 &
```
Kill it with `fuser -k 3017/tcp` ONLY (bare `pkill` kills the Playwright webServer — S192).
Guided-tour overlays intercept clicks: set `localStorage hibana-tour-done=1` BEFORE driving pages.
Playwright lessons: pass REAL functions to `locator.evaluate` (string block-bodies return
undefined); use `expect.poll` for any post-hover/post-render measurement; hasTouch contexts are
the only working pointer:coarse emulation (assert `matchMedia('(pointer: coarse)')` first).

---

## S199 — "Debt Zero + Trust Gates" (Track C + security hardening; no schema, no asset-redesign)

Goal: the warning baseline dies, the advertised gates become real, the five small security
fixes land, the repo root is folded. Ship as v0.4.1.24 if any user-facing asset changes
(otherwise docs/CI-only → no version bump).

**Batch 1 — the debt kill (HLTH-1/2/3/22 + PERF-2/HLTH-11):**
1. Delete the ~126 unused imports + ~25 dead locals (eslint JSON drives the list; the 3 `any`s
   stay). `_`-prefix the ~13 genuinely-unused params. Target: **0 warnings**.
2. Delete devboard-helpers.ts's dead block (lines 29–89 + 10 dead imports) — live copies in
   devboard.ts already verified.
3. sw.js VERSION comment: trim to the last 3 release notes + a `git show` pointer (~200 chars).
   sw.js is revalidated per page load — this is a real bytes win.
4. CI eslint step → `npx eslint src/ --max-warnings 0`; tsconfig gains `noUnusedLocals` +
   `noUnusedParameters`. Drift becomes structurally impossible.

**Batch 2 — the repo fold (HLTH-9/10/12/13/15):**
5. `scripts/rotate/rotate.mjs` — ONE generic entry (`--session NNN --version V --body f --row f`)
   replacing all 14 root rotate-s*.mjs (parse/relabel the 4-block §1 chain, insert new block +
   row; content files under `scripts/rotate/content/`). Delete the root scripts. Fold
   `make-zip.mjs` into `scripts/`. Paths from `import.meta.url`, output dir from
   `HIBANA_UPLOAD_DIR` (default /home/z/upload).
6. `package.json`: declare `"packageManager"`; keep ONE lockfile (bun is the CI installer —
   make bun.lock canonical and drop package-lock.json; keep the CI audit step working via
   `npm audit --package-lock-only` generated on the fly, or switch CI to npm — pick one tool,
   document the choice in Agents.md).
7. `git rm hibana.db` (0-byte placeholder). Tidy .gitignore (sort; drop the `-- -s`/`-s` curl
   accident lines; add `hibana.db`).

**Batch 3 — trust the gates (UX-1/2/10 + SEC-1):**
8. e2e/a11y.spec.ts: snapshot today's violation counts as a baseline, assert `<= baseline`,
   COLLECT the contrast-fn offenders into the report. CI's "a11y" line becomes truthful.
9. lighthouserc.json: promote performance to `error` (pin at current measured level — run once
   locally to get the number) — or add an LHCI bytes budget as the hard gate.
10. ci.yml: remove the workers-smoke `continue-on-error` (the CF secrets already exist for CD;
    if flaky, advisory on PRs / required on main).
11. NEW lint gate: fail any `innerHTML =`/`insertAdjacentHTML(` template in public/js whose
    template contains `${` NOT wrapped in `esc(`/`escHtml(` (mechanical AST or regex pass in
    scripts/; the 8 per-file esc helpers exist). This is SEC-1's counter — the single highest
    value security line in the audit.

**Batch 4 — five small security fixes (SEC-5/2/3/4/9 + SEC-11/17):**
12. Reset single-use → atomic `UPDATE … WHERE token_hash = ? AND used_at IS NULL` + rowcount
    check (reset.ts:75-89).
13. Per-account auth counter `auth:user:<login>` (same rate_limits table, no schema change)
    alongside the per-IP rule (ratelimit.ts).
14. TRUST_PROXY on the Node entry: peer address when unset/unfalse; last-untrusted XFF hop when
    true (ratelimit.ts:95 — reads `@hono/node-server`'s address).
15. Link origin: prefer cfg.appUrl/APP_URL for ALL emailed links (reset.ts:54,
    registration.ts:293, dev.ts:140) — falls back to request origin only when unset.
16. Upload magic bytes: PNG/JPEG/WebP signature check before pushFile (settings.ts:217,
    projects/index.ts:893). + one-line user_id re-scope on core.ts:345 + devboard.ts:291.
17. Agents.md: fix the OPEN_REGISTRATION line (invite-only today), the 4 stale numbers, the
    server.ts:15-16 stale refs (§ HLTH-26). Numbers-live-in-§1 discipline.

**Batch 5 — cheap UX/coverage wins (if the session has room; cut in this order):**
18. UX-4: aria-labels on the 15 title-only buttons (keys already exist). UX-5: re-add the
    skip-link on shell pages. UX-3: introduce `--accent-ink` for text-in-accent (keep --accent
    for icons) + pin in identity-palette. UX-6: ring fixes for q-pen/cal-note-x fine-world.
19. HLTH-16: one /api/calendar unit spec. HLTH-18: one signup/confirm/reset page e2e spec.
20. PERF-8/10: Login.jpg → WebP (asset change → cache-bust + sw bump + package bump);
    favicon `/*.ico` 1-day rule.

**CUT LINE:** if the session runs long, ship Batches 1–4 (the debt + gates + security core),
push, and bank the rest. Batches 1–4 alone justify v0.4.1.24 if any asset changed — else no bump.

**Release ritual (if assets changed):** bump package.json patch + sw.js VERSION → tag
`v0.4.1.24` → zip via the (new) generic script → push → watch CI (expect ~15–19 min) → CD
auto-deploys → run a `qa/s199-live-verify.mjs` byte-probe (copy s197-live-verify.mjs pattern) →
verify `https://hibana.ir/api/health` → NEVER send manual/masking pings to healthchecks (the
checks' anti-masking design; natural ticks only) → append the worklog three-section handover
(status / completed+verification / open risks+next).

---

## S200 — "Speed + Diet" (banks after S199; PERF-1/3/4/6/7/11/12/13 + UX-7/8/9 + HLTH-5/6/19)

- CI sharding: 2-job matrix (`--shard 1/2|2/2`), parametrized PORT/DB_PATH, `actions/cache`
  for `~/.cache/ms-playwright`; `paths-ignore` for docs-only pushes. (PERF-1/UX-8/UX-9)
- Fix explain-hotpaths STAGES + re-pin perf-baseline (PERF-3/19); re-key the bundle-size
  per-file guard on logical names (PERF-4); add a precache-size CI assert (PERF-5).
- The diet: dead-CSS removal (HLTH-5/6 — ~43 rules total; visual pass first) aimed at the REAL
  top files (i18n-fa, project-page.js, app.js, quicknotes/sadhana-board/layout CSS); optional
  per-page CSS manifest in build.mjs (UX-7).
- N+1/batching: /api/clients grouped queries, tag-merge batched FTS, timeline flattened
  Promise.all (PERF-11/12/13).
- waitForTimeout → expect.poll conversion batch (HLTH-19), starting with the short 300–500 ms
  waits in sprint-ux/sprint-doc/upload-progress.

## S201 — "Majors + Approvals" (owner-visible decisions; UX-13 + PERF-16/9 + UX-12/11 + HLTH-24/27)

- ASK ALI (rule 4): the 4 rule-9 indexes (PERF-16); legacy font-format deletion (PERF-9);
  zod-4 + node-server-2 scheduling (one round each, full ladder between); `__Host-` cookie
  prefix (SEC-10 — one-time logout).
- Run + RECORD the restore drill (`npm run drill` + `drill:planb`) in Changelogs §4 (UX-12).
- error_log daily monitor → healthchecks /fail past threshold (UX-11 — reuse the cron pattern).
- project-page.js split into render/actions/media modules (HLTH-24 — ride-along only).
- Worklog rotation mode for the rotate tool + Changelogs row-wrap (HLTH-27).

---

## Standing cautions (from 197 sessions of scar tissue)

- Never bare `pkill` (S192). Kill by port only.
- Never commit secrets; `git status` + secret-scan before EVERY commit (the 8 credential values
  must be ABSENT — run the scan like S195/S197 did).
- Never re-upload credentials-carrying zips into chat.
- Single-quoted test titles break on English apostrophes; block-body string arrows in
  `locator.evaluate` return undefined — pass REAL functions.
- The SW old-shell cycle: after a deploy, hard-refresh once; the new sw takes over on the next
  reload — don't "fix" what is the documented cycle.
- Docs-only pushes still ride the full CI ladder + CD re-deploy (the normal chain — S197's
  docs push did exactly this; UX-9's paths-ignore is the future optimization, not a hack).
- The dependabot PR 75f79fe failing CI is dep-bump noise, not the release chain.
