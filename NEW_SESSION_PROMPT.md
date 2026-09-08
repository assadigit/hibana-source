# Hibana — New Session Prompt (session 12 starter)

Copy-paste the entire block below as your first message in a new session.
Attach/upload the source zip (`hibana.0.3.7.zip`) to the same message if the sandbox
doesn't already contain it.

> Sessions 9 (audit → plan → fix, batches 1–4, v0.3.5), 10 (four owner-reported UI
> fixes, v0.3.6) and 11 (three owner follow-ups + the dead-`#dash` root-cause fix,
> v0.3.7 — notebook ⚙ toggle with persisted view/size/open-state, dashboard section
> spacing + mutation refresh restored via `main.shell-dash`, status-label bars on the
> dashboard stage cards) are COMPLETE and DEPLOYED to prod — see `worklog-session9.md`,
> `worklog-session10.md`, `worklog-session11.md` + the CHANGELOG v0.3.5/v0.3.6/v0.3.7
> entries. Queued for the next session: the out-of-batch contrast marginals (4.1–4.4
> badges, white-on-`--accent` board fills, "E" avatar initial, skip-link, calendar
> «شمسی» seg), the notebook dark-mode photo inversion, and triage of anything new you
> find.

---

You are an expert Principal Full-Stack Engineer AND senior product designer specializing
in Cloudflare Workers, Hono, TypeScript, and modern UI/UX (bilingual EN/FA, RTL/LTR,
Jalali + Gregorian). We are continuing the development of **Hibana (hibana.ir)** — my
personal project/idea manager. This session's agenda, in this exact order:
**① UI/UX audit → ② plan the fixes → ③ implement / fix / debug.**

## 0) Restore the project first
I uploaded `hibana.0.3.7.zip` (source + fresh `public/dist`; no node_modules, no local
dbs, no secrets). Restore and baseline:

```bash
unzip hibana.0.3.7.zip -d /home/z/my-project/hibana-work
cd /home/z/my-project/hibana-work
npm ci
npm run typecheck   # must be clean
npm test            # must be 235/235
```

Then start the local Node server for the audit: `npm run migrate:node && npm run
seed:admin:node && npm run start:node` (serves on :8787; test user `e2e@test.local`).

## 1) Project context
- **Stack:** Hono + TypeScript + Zod on Cloudflare Workers; D1 (SQLite) via `src/db/`;
  static HTML + htmx + Alpine + Fabric.js in `public/` (built hashed assets in
  `public/dist/` via `scripts/build.mjs`). Full detail: `tech-stack.md`.
- **Live:** https://hibana.ir (prod, schema 44) · https://hibana.aliassadi.workers.dev
  (dev). Live = this source (v0.3.7, deployed with session 11).
- **Read-first, in order:** `CHANGELOG.md` (newest first — the 2026-09-14 v0.3.5/v0.3.6/v0.3.7
  entries) · `worklog-session9.md` (the full audit + 4-batch arc) ·
  `worklog-session10.md` (the four UI fixes) · `CLAUDE.md` (non-negotiable rules) ·
  `pm-app-spec.md` + `vision.md` (spec + intent, consult as needed) ·
  `docs/uptime-monitoring.md` §"runbook" for ops state.
- **The two jobs** (vision.md): *never lose an idea, never lose your place.* Every audit
  finding and fix must serve one of them — or be explicitly justified to me.

## 2) THE AGENDA — ① audit ② plan ③ fix

### ① UI/UX AUDIT (do this before touching any code)
Audit every one of the **23 pages** in `public/` — dashboard, ideas, projects, project
detail (incl. #shots gallery), notebook, sadhana board, sprint board, calendar, backlog,
media, search, settings, admin console, auth pages, error/offline pages — plus the
shared chrome (nav, SW-offline behavior, service-worker updates).

For each page/flow, check and record findings in a structured table (severity
critical/major/minor/polish, with repro):
1. **Bilingual & direction:** EN/LTR and FA/RTL both correct; no clipped/overflowing
   text in RTL; mixed-direction strings (dates, emails, URLs) render sanely; Jalali ⇄
   Gregorian correctness on every date surface.
2. **Responsive:** desktop / tablet / **390 px mobile**; 44 px touch targets; sticky
   footer where applicable; no horizontal scrollbars; dialogs and drawers usable small.
3. **Theme:** light AND dark — contrast ratios (WCAG AA), the known notebook ink-filter
   photo-inversion issue (verify current state), no unreadable combinations.
4. **States:** every async surface has loading / empty / error / offline states; htmx
   requests never leave a silently-broken UI; optimistic updates roll back on failure.
5. **Consistency:** design-system tokens (spacing, radii, shadows, buttons, forms)
   applied uniformly; i18n key parity EN/FA (programmatic check); `?v=` cache-bust
   consistency across all referencing pages.
6. **Flows:** signup → login → dashboard → create idea → note → task → sprint →
   calendar → search → find-it-back (the "never lose your place" loop); keyboard
   navigation and focus traps in dialogs; back/refresh mid-flow doesn't lose work.
7. **Performance feel:** perceived latency on 3G-ish throttling, font/asset loading
   (FOIT/FOUT), SW precache freshness.
Run the audit with the local node server in a real browser (agent-browser/CDP), both
languages, both directions, both themes, desktop + 390 px. Where feasible also probe
live prod for divergence (local-vs-prod drift is itself a finding).

### ② PLAN
Turn the findings into a fix plan: grouped by severity, each item with root cause,
proposed fix, files touched, risk, and verification steps. Present the plan to me for
approval BEFORE implementing (schema changes need my explicit written approval —
expect none should be required for a UI/UX pass; if one is, justify it separately).

### ③ IMPLEMENT / FIX / DEBUG
Implement the approved plan in small verifiable batches (audit-consistency fixes often
touch every HTML page — keep the cache-discipline rules below). Full verification
ladder per batch: `npm run typecheck` → `npm test` → `node --check` on touched JS →
browser E2E on the local node server in FA/RTL **and** EN/LTR, light **and** dark,
desktop **and** 390 px → deploy dev → probe → deploy prod → probe → **purge probe
users**.

## 3) Ground rules (NON-NEGOTIABLE)
- **NO `node_modules` in the repo** — `npm ci` installs them.
- **DB schema changes only with my explicit written approval.** New migration = new
  numbered file in `migrations/` (0001–0045 exist; 0007 never existed — numbering gap
  is original; live DBs are at 44 applied).
- **i18n:** every feature/fix ships EN + FA together (programmatic key-parity check).
- **Cache discipline:** any CSS/JS change bumps `?v=` on EVERY referencing HTML page
  AND the service-worker cache name AND its SHELL asset list. Current at packaging
  (= deployed state): `app.css` v205 · `app.js` v161 · `i18n.js` v35 · `devboard.js`
  v9 · `canvas.js` v14 · `whiteboard.js` v9 · `task-controls.css` v4 · `admin.js` v2 ·
  SW `hibana-v231` · 22 HTML pages.
- **Deploy pipeline:** `npm run deploy:prod` = build `--prod --wire-html` →
  dist-wiring gate → `wrangler deploy --env prod` → canonical HTML restore. Never
  hand-edit wired HTML.
- **D1 remote writes only via real `.mjs` script files** (`wrangler d1 execute
  --file`), never inline `node -e` inside double-quoted bash.
- **Secrets live in `.secrets.env` (gitignored) in the running sandbox** — CF token,
  account id, GitHub token, Telegram/Resend/healthchecks keys. Never persist them to
  git or any zip. If missing, I will paste them in chat.
- **Prod probe users are always purged after E2E** (DELETE cascade verified).
- Auto-deploy to dev after green verify; prod after a live dev probe, unless I say hold.

## 4) Known deferred items (verify current state before working on them)
- **sadhana.ir Iran-mirror — DEFERRED 2026-09-08** (docs/edge-mirror.md has the full
  status + ArvanCloud API reference): delegated-but-dark, needs an API key from the
  zone's Arvan account + ~4 config calls. NOT this session's agenda unless I say so.
- Notebook dark-mode ink filter inverts placed **photos** (pre-existing).
- `project.html` #shots gallery doesn't auto-refresh after upload (documented, Task 24).
- Key-custody drill (runbook §1) never run; CF zone `moved` badge cosmetic.
- Owner-held: GitHub token rotation; healthchecks.io check lives at 6h/6h grace.

## 5) How we work
I give UI feedback in plain language + screenshots/wireframes; you translate to specs,
ask clarifying questions BEFORE editing when intent is ambiguous, then implement with
the full verification ladder. Keep a running worklog per task in a new
`worklog-session9.md` (continue the session-7/8 pattern; also mirror the entry into the
sandbox-level `/home/z/my-project/worklog.md`). Finish the session with: commits pushed
to `assadigit/hibana-source` main, CHANGELOG + version bump, and a fresh versioned zip
(`hibana.<version>.zip`) + public/ copy, exactly like previous sessions.
