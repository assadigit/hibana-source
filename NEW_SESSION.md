> ⚠️ HISTORICAL (session 7, pre-hotfix): this debrief predates the 2026-08-31 → 09-01
> hotfix window (~50–60 fixes now live as dev v240 / prod v266). Its "URGENT deploy"
> already landed during that window. The authoritative current-state doc is
> `RECOVERED.md` — read that first.

# Hibana — Hand-off / Session Debrief (updated 2026-09-05, end of session 7)

Personal project/idea manager for Ali (solo UI/UX designer — agents build and maintain it;
he never reads code). Two jobs only: **never lose an idea, never lose your place**.

## ⚠️ THE ONE URGENT THING — 2 features are code-complete but NOT yet deployed

Tasks 23 (Sprint board v2 — video-editor timeline) and 24 (Calendar v2 — exact-day jumps,
Jalali⇄Gregorian switch, drag-to-plan legend; project stage editing) are **committed locally
(`49bd6d9`, `ddb3aa4`) and fully verified (189/189 tests, typecheck, browser E2E)** but the
session ran without Cloudflare credentials. Production still runs the Task-22 batch
(sw `hibana-v176`). **First action of the next session after restore = deploy**, then probe
both pages live. Exact commands (fill in the token Ali provides — never persist it in a file):

```bash
cd /home/z/my-project/hibana-work
export CLOUDFLARE_API_TOKEN=<ali-provides> CLOUDFLARE_ACCOUNT_ID=6ff25b582afd399d647e91a8db859676

# 1) Migration 0030 (dev_tasks.start_at/end_at) — REQUIRED before the workers deploy
npx wrangler d1 migrations apply pm-app-dev  --remote
npx wrangler d1 migrations apply pm-app-prod --remote

# 2) Deploy both workers (ddb3aa4 contains Task 23 + Task 24)
npx wrangler deploy            # dev  (hibana.aliassadi.workers.dev)
npx wrangler deploy --env prod # prod (hibana.ir)

# 3) Probe
curl -s https://hibana.ir/api/health          # schema_version must read 30
# then browser-check /sprint.html (zoom ladder, trim handles, boundary rails) and
# /calendar.html (exact-day jumps, شمسی|میلادی pill, legend drag) — see CHANGELOG 2026-09-04/05
```

If the token is not available yet, everything else below still applies — just don't touch
`sprint.html` / `devboard.ts` / `calendar.html` semantics before that deploy lands, so the
deploy stays a clean fast-forward of what was E2E-verified.

## Read this first, in order (keep it to the essentials)
1. `CLAUDE.md` — non-negotiable rules (isolation, UUIDs, UTC, migrations, secrets, PBKDF2,
   Zod, Telegram secret-token). Highest priority.
2. This file — current state + what's next.
3. `CHANGELOG.md` — everything that exists, newest first (now current through Task 24).
4. `ROADMAP.md` — prioritized remainder; start NEW feature work only from there.
5. `pm-app-spec.md` / `vision.md` / `DEPLOY.md` / `tech-stack.md` only when a step needs detail.
6. `worklog-session7.md` (shipped in this zip) — the raw per-task agent worklog for the whole
   2026-08-28 → 2026-09-05 arc, including every bug's root cause. Read selectively.

## Current state (at packaging time)
- **Local HEAD `ddb3aa4`** (Task 24) — clean tree, 189/189 vitest, typecheck clean, smoke green.
  Includes: audit hardening phases, Sadhana replica + app-wide design system, mobile/i18n pass,
  dev-task kanban + sprint roadmap (migration 0029), self-healing board + inline quick-add,
  14-point polish, wireframe project cards, batch-22 refinement wave, sprint board v2
  (migration 0030, pending remote), calendar v2.
- **Live on hibana.ir**: everything through the batch-22 refinement wave (dev `38b8265c`,
  prod `36d0598e`, sw `hibana-v176`, remote D1 schema **29**). Not live yet: Tasks 23 + 24.
- **Asset versions at HEAD** (bump discipline — see below): `app.css` **v163** (all 20 pages),
  `app.js` **v146**, `i18n.js` **v14** (15 pages), `devboard.js` **v5**, `canvas.js` **v6**,
  `task-controls.css` **v3**, SW cache `hibana-v178` (SHELL list aligned with these).
  Migrations: **29 files** (0001–0030; no 0007 ever existed — numbering gap is original).
- Remote D1s: dev `pm-app-dev` (`80e02ce2-ca0a-4ccc-beda-8b6cb9c3a984`), prod `pm-app-prod`
  (`d842fcb5-44f6-4bbd-a772-3699ccadb496`). Account `6ff25b582afd399d647e91a8db859676`.

## Restore / run (fresh sandbox)
```bash
unzip <this-zip> -d /home/z/my-project/hibana-work   # or wherever; keep inner layout intact
cd /home/z/my-project/hibana-work
npm ci                          # node_modules is NOT in the zip by design
npm run typecheck               # must be clean
npm test                        # 189/189
npm run migrate:node            # local sqlite → schema 30 (data/hibana.db, gitignored)
npm run seed:admin:node         # local admin seed (see scripts/seed-admin.mjs)
npm run start:node              # local server on :8787 for browser E2E
```
Cloudflare deploys need `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the env — ask Ali
(the `cfut_…` token he pastes in chat works for Workers + D1; never write it to any file).

## Working conventions that kept this project healthy (keep following them)
- **Cache discipline** — every CSS/JS change bumps `?v=` on EVERY referencing page AND the SW
  (`public/sw.js`: cache name `hibana-vN` **and** the SHELL asset list versions). Stale SHELL
  versions have twice shipped "silent no-op" bugs. Check current numbers above before bumping.
- **i18n** — EN + FA ship together; verify key-count parity programmatically.
- **Verification ladder** — `npm run typecheck` → `npm test` → `node --check` on touched JS →
  browser E2E on the local node server (agent-browser/CDP; test user `e2e@test.local`, PBKDF2
  reset via a small `.mjs` script) → deploy dev, probe, deploy prod, probe, purge probe users.
- **D1 writes only via script files** — `wrangler d1 execute <db> --remote --file=x.mjs`…
  actually `--file` takes SQL; generate SQL from a real `.mjs`. NEVER inline `node -e` inside
  double-quoted bash (`${…}` gets mangled). Plant/purge probe users around prod E2E.
- **Migrations** — new numbered file in `migrations/`, header comment style like 0029/0030;
  applied automatically by tests (`scripts/migrate-node.ts` runner); remote apply is a separate
  explicit step (see the deploy block above).
- **Schema changes need Ali's explicit approval** (this session's 0028–0030 all had it).

## Known open items / next candidates
1. **Deploy Tasks 23+24** (the urgent block above) — then have Ali try sprint + calendar on his
   phone (stale SW on his device is the usual "I don't see it" cause — v178 handles it).
2. `project.html` **#shots gallery** doesn't auto-refresh after upload (needs a GET screenshots
   fragment endpoint or a tab-preserving refresh UX) — documented in Task 24, deliberately
   left alone.
3. Notebook dark-mode ink filter inverts placed **photos** (pre-existing; propose excluding
   photos if tackled).
4. User-held (no API scope): rotate the GitHub fine-grained token → `.secrets.env` →
   `npm run secrets:set` (+`:prod`) → `npm run drill`; Cloudflare "Always Use HTTPS" toggle
   (app already 301s http→https); PWA installability re-check.
5. ROADMAP.md remainder — pick from there after the deploy lands.
- Local dev DB carries test user `e2e_test` (+4 quadrant tasks) for verification convenience.

## Probe leftovers policy
Prod E2E always plants a probe user (e.g. `probe22@test.local`) and **purges it afterwards**
(`DELETE` cascade verified). Last known prod check left **0 probe rows**. Keep it that way.
