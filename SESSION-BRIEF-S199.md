# SESSION BRIEF — S199 (the fix-and-implement round for the S198 SWOT audit)

> **S205 "THE KANBAN ENTRY-POINT ROUND" EXECUTED 2026-10-18 — released as v0.4.1.29 (push
> 45baa88, CI 39093783469 ALL GREEN, CD 39094519965 GREEN after the expired CLOUDFLARE_API_TOKEN
> secret was replaced + the failed run re-run).** The Hibana-Kanban-Polish-and-Go-Desktop-Readiness
> Spec executed: **https://projects.hibana.ir/kanban is LIVE** (the zone-level Workers route attach;
> 14/14 live-verify probes GREEN incl. the owner-account browser round-trip) — the auth-gated
> /kanban route with the login-preserving ?next= bounce, the searchable IN-PLACE project switcher
> in the board title (last-used default resolution, empty state, keyboard + RTL), the rail/mobile/
> go-to chrome with the compact-rail short-viewport fix (46px floor), measured perf (qa/s205-kanban-
> perf.mjs: switch −23% vs hard-nav), and the six desktop-readiness docs in docs/project-kanban/
> (the Go port PLANNED, not started — Wails leading, M0 API additions listed first). Full record:
> Changelogs §1 row 205 + worklog.md's S205 section.

> **STATUS: S199 EXECUTED 2026-10-11 — released as v0.4.1.24 (push 1cc4779, CI 38122442476
> GREEN, CD 38123258804 GREEN, live-verify ALL GREEN).** Batches 1-4 complete + Batch 5
> partial (calendar spec, auth-page e2e, favicon rule). Banked for S200: UX-3/4/5/6,
> PERF-8. The full record: Changelogs §1 row 199 + worklog.md's S199 section.
>
> **S200 "Speed + Diet" ALSO EXECUTED 2026-10-11 — released as v0.4.1.25 (push 9970919,
> CI 38161304761 GREEN — the FIRST run of the sharded structure: fast lane 2.6 min +
> e2e shards 6.5/6.8 min in PARALLEL, ~9.5 min wall vs the old 15-19 — CD 38161773669
> GREEN, qa/s200-live-verify.mjs ALL GREEN).** All six S200 batches landed: the CI
> sharding + browser cache + docs-only paths-ignore; the perf tooling repair (explain-
> hotpaths/perf-seed revived on current schemas, perf-baseline re-pinned, bundle-size
> per-file guard re-keyed on logical names, NEW precache-size gate 2,138KB/2,300KB);
> the N+1s (clients grouped, tag-merge batched, timeline flattened); the flake batch;
> the dead-CSS diet (honestly corrected to 15 rule families — the audit's ~35-43
> couldn't see JS-constructed class names); the banked UX batch (--accent-ink + the
> contrast-fn false-positive fix → a11y baseline contrast 0/0, aria-labels, the
> skip-link on 24 pages, the fine-world 24px rule + q-pen/cal-note-x rings,
> Login.jpg → WebP). **S201 "Majors + Approvals" ALSO EXECUTED 2026-10-11 — as a
> docs/ops round (no version bump; commit on main, CI green, CD redeployed the same
> bits):** the four rule-4 asks PREPARED and presented to Ali (Changelogs §6's PENDING
> OWNER APPROVAL block — the 4 rule-9 indexes, the 1.75 MB legacy-font deletion with the
> font-face.css honest correction, zod-4/node-server-2 scheduling, the __Host- cookie
> prefix; NOTHING ships without his written YES); the FIRST-EVER restore drills run +
> recorded (§4's new Drill log — drill PASS, drill:planb PARTIAL PASS, two latent drill
> bugs found dead: the pre-0060 seed vocabulary + the planb D1 `.results.results`
> parser); UX-11 closed (healthchecks check "Hibana errors" + .github/workflows/errors.yml
> daily monitor: 5xx>5 or total>20 in 24h → /fail); HLTH-27 shipped (rotate.mjs --worklog
> + prose caps row 2k/body 8k — worklog 2,871→305 lines, archive born, zero loss);
> HLTH-24 banked with the §6 NO-GO reconciled (incremental extraction only). The next
> session: execute the approved asks on Ali's written YES, else the S200 banked list
> (the 86-spec e2e DB-constant sweep, opportunistic --accent-ink, UX-17 mobile preset).**
>
> **S202 "The Approved Asks" + S203 "The Owner-Accepted Round" ALSO EXECUTED 2026-10-11
> — released as v0.4.1.26 (push 2821bef) then v0.4.1.27 (push db0bae9, CI 38176576229
> ALL GREEN, CD 38176995829 GREEN, qa/s203-live-verify.mjs ALL GREEN).** The S201 rule-4
> asks are now FULLY RESOLVED (Changelogs §6): S202 shipped the vazir font diet + zod 4 +
> the e2e DB-constant sweep and resolved PERF-16 honestly with NO migration (EQP-proven
> PK coverage, machine-enforced); S203 shipped on Ali's "go to next step I accept" —
> **SEC-10 __Host-hibana_session LIVE** (attributes centralized, Secure unconditional,
> every user re-logs-in once), **@hono/node-server 2.1.4** (the scheduled second
> dep-major; env.incoming probe-proven intact), and the **bebas font diet** (sw v436).
> The brief's own batches are all closed; what remains is the banked leftovers list in
> §1 (opportunistic --accent-ink, UX-17 mobile preset, the owner-machine drills,
> dependabot minors, HLTH-24's incremental extraction). The full records: Changelogs §1
> rows 202+203 + worklog.md's S202/S203 sections.**
>
> **S204 "The Dependabot Round + The Accent-Ink Sweep + The Mobile Lane" ALSO EXECUTED
> 2026-10-11 — released as v0.4.1.28 (push 3891c25, CI 38183808774 ALL JOBS GREEN —
> the v7 actions' + the mobile Lighthouse lane's first run, CD 38184241827 GREEN,
> qa/s204-live-verify.mjs ALL GREEN 27/27).** The banked leftovers menu is now FULLY
> executed: the CI-plumbing dependency round (hono 4.13.13 · playwright+@playwright/test
> 1.64.0 synced · workers-types 5.20261011.1 · @types/node 26.6.4 with one documented
> double-cast · eslint 10.12 · tsx 4.23.15 · typescript 6.0.3 — TS 7.0.2 TRIED +
> HONESTLY WALLED: typescript-eslint hard-errors on TS 7.0, issue #10940 ·
> typescript-eslint 8.71.1 · vitest 5.0.3 · wrangler 4.148 · actions/checkout v7 ×5 +
> upload-artifact v7 ×2; PRs #1/#6/#13/#14 closed as superseded) + the accent-ink sweep
> (19 accent-as-text sites across 5 sheets, every remaining color:var(--accent) verified
> icon/border/decorative and kept; sw v437) + UX-17 (the mobile Lighthouse lane with
> HONEST floors: cold 89-90, the SW-active returning-user variant 46-49 — Lantern's SW
> pessimism, floor 0.45 catches collapse). What remains is OWNER-SIDE or doctrine-
> deferred ONLY: the owner-machine drill runs + key-custody drill (§4 — owner-held
> keys, an agent CANNOT run them), HLTH-24's incremental project-page.js extraction
> (only when next touched for real work), TS 7 (when typescript-eslint ships support).
> The full record: Changelogs §1 row 204 + worklog.md's S204 section.**

**You are the next agent.** Read, in order: `Agents.md` (canonical rules) → `SWOT-AUDIT-S198.md`
(the audit — every finding has an ID; THIS brief references those IDs) → `Changelogs.md` §1 →
repo `worklog.md` tail → this file. The repo is your working tree: clone
`https://github.com/assadigit/hibana-source`, `bun install`, work, commit+push when done
(CI runs the ladder, CD auto-deploys). Remote `main` is source of truth.

> **S202 "The Approved Asks" EXECUTED 2026-10-11 — released as v0.4.1.26 (push 2821bef,
> CI 38169968432 all-jobs-green, CD 38170407608 GREEN, qa/s202-live-verify.mjs ALL
> GREEN).** The owner's written YES executed per item: PERF-16 resolved HONESTLY with
> NO migration (the audit's 4th table was dropped by 0048 — the CREATE INDEX would
> have failed on apply; the other 3 access paths are PK-covered, EQP-proven — rule 9
> now machine-enforced by src/tests/index-coverage.test.ts ×3; schema stays 63);
> PERF-9 shipped (21 legacy vazir files + the never-referenced Vazir-Variable.woff2
> deleted, ~1.79MB off deploys; font-face.css woff2-only; sw v435); UX-13 part 1
> shipped (zod 3.24→4.6.6, one signature fix — v4's RFC-strict .uuid() caught the e2e
> specs' non-RFC UUID fixtures; the app itself is crypto.randomUUID() everywhere,
> zero product impact); item 5 = the banked 86-spec e2e DB-constant sweep (LOCAL
> PARALLEL SHARDS NOW REAL — the full 417 ran as two parallel shards; the sweep also
> fixed the s199 reset spec's hardcoded Origin:3017). SEC-10 (__Host-) was NOT in the
> owner's reply — still pending, nothing shipped. The full record: Changelogs §1 row
> 202 + worklog.md's S202 section. NEXT: S203 = @hono/node-server 1→2 (the scheduled
> second dep-major round), + on the owner's YES: SEC-10 and/or the bebas-note
> legacy-font follow-up; else the S200 banked tail (opportunistic --accent-ink, UX-17
> mobile preset).**

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
