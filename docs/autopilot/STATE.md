# Hibana Autopilot — STATE (resume point)

> ANY FUTURE SESSION: read `docs/autopilot/PLAYBOOK.md` (the verbatim Autopilot prompt) and THIS file first.
> Resume protocol (PLAYBOOK §4): if this file exists, do NOT restart — resume from the recorded step.
> Update this file after every commit.

Last updated: 2026-10-26 — Phase 1 IN PROGRESS (step 2 of ~6: auth/input fixes shipped)

## Current phase

- Phase: **1 — Security and data isolation — IN PROGRESS** (step 1 of ~6: isolation fixes shipped). Phase 0 COMPLETE (tag `autopilot-phase-0-done` @ 08b17bb).
- Next action: continue Phase 1 — input/auth fixes (link URL scheme, invite burn atomicity, login timing, invites/email limiter), upload content-sniffing, integration/logging fixes (Resend timeout, reset/register err.message leaks, magic-wand toast escape), supply-chain (engines, action SHA pinning), then the full cross-user isolation suite on both runtimes + live header verification, then the Ship Gate + tag `autopilot-phase-1-done`.

## Session log

- **2026-10-26 (Phase 1, step 2 — auth/input fixes):** Fixed with red-then-green regression tests (src/tests/auth-input-fixes.test.ts, 7 tests): link URLs now http(s)-only at the Zod boundary (javascript:/data: URI scheme stored-XSS-by-click vector closed, matching the markdown renderer's rule); invite-code single-use is now an ATOMIC burn-first conditional UPDATE (SEC-5 pattern — the check-then-act SELECT let two concurrent registrations double-spend one code; used_by lands post-insert due to its users FK); unknown-account login now burns equal PBKDF2 work (burnDummyVerify — the timing enumeration oracle is closed); the invite-email sender got a dedicated 5/60s rate bucket (was the one unmetered Resend call); register + reset/request no longer return provider error internals to anonymous callers (SC-9; register's `detail` field was a leak both auditors missed — found during lead verification). Discovered during testing: node:sqlite adapter cannot host two OPEN transactions concurrently (pre-existing, Node-runtime-only; D1 unaffected) — recorded in AUDIT as a Phase 2 candidate. ICS months claim from the audit was disproven (already clamped 1–24 in loadIcsEvents).
- **2026-10-26 (Phase 1, step 1 — isolation fixes):** Four read-only audit subagents (P1-a isolation, P1-b auth/IO, P1-c uploads/webhooks/logging, P1-d secrets-history/supply-chain) completed over main @ a7126fd; every claim independently re-verified against the code (playbook §2) before acting. Confirmed + fixed with red-then-green regression tests (src/tests/isolation-fixes.test.ts, 4 tests): canvas sync ON CONFLICT arm now scoped `WHERE canvas_elements.user_id = ?` (was the one SC-5 write-scoping hole — a foreign element id could overwrite/tombstone another user's element); screenshot-delete `cover_shot_id` clear now user-scoped (drift rows survive); project-logo byte route Cache-Control flipped public→private (authed per-user bytes). One auditor claim disproven during verification: ICS `months` was already clamped 1–24 inside loadIcsEvents (no fix needed). Adjacent suites (sync/board/screenshots/screenshot-problems/media-gallery, 29 tests) green.
- **2026-10-26 (Phase 0 COMPLETE):** Ship Gate executed end to end: local verify green → merge ff to main (08b17bb) + push → deploy dev (5a10a90c) → remote smoke dev 14/14 + shotcheck dev 9/9 → rollback drill (rollback to a80798a3 → health OK → redeploy c3a4e0b8 → health OK) → deploy prod (43b49d5a) → remote smoke prod 14/14 + shotcheck prod 9/9 → zone cache purged → tag `autopilot-phase-0-done` pushed. CI on main was still in_progress at tag time (verify is its first quality step; release workflow already green) — final CI verdict recorded in REPORT.md.
- **2026-10-26 (Phase 0, runbook):** docs/autopilot/RUNBOOK.md added — Ship Gate checklist, D1 backup commands (wrangler d1 export → gitignored backups/), the app's own backup/restore system, wrangler rollback procedure + redeploy-last-good-tag alternative, post-rollback smoke; .gitignore now covers backups/.
- **2026-10-26 (Phase 0, remote smoke):** scripts/smoke-remote.mjs added (npm run smoke:remote -- --target dev|prod) — the Ship Gate remote suite: health, login page + i18n wiring, throwaway probe user seeded/purged via wrangler d1 execute (row-count parity asserted), real authenticated reads, write→read-back→hard-delete throwaway, EN/FA dictionaries, hashed /dist asset loads.
- **2026-10-26 (Phase 0, characterization tests):** 39 new tests in 5 files — logout route + cookie attribute contract (had ZERO tests), hard-delete status matrix ×6, project edit round-trip + status history, Jalali oracles/leap/Nowruz/200-year sweep/client-server parity, offline-queue unit harness (evaluates the REAL public/js/queue.js against a faithful fake IndexedDB — discovered AP-1). Suite: 685/685.
- **2026-10-26 (Phase 0, verify + CI):** `npm run verify` created (typecheck + eslint 0-warnings + vitest + build + portability, ~76 s green) and `npm run lint`; ci.yml now runs verify as its single quality entry point (the four replaced steps are exactly what verify runs, same order). M1/M2 from the pre-flight audit closed.
- **2026-10-26 (Phase 0, portability gate):** scripts/check-portability.mjs added (npm run check:portability) — fails on Node-only/Workers-only imports outside the 4 adapter layers; negative-tested (injected violation caught, exit 1).
- **2026-10-26 (Phase 0 work):** baseline ladder recorded (typecheck 0 errors · eslint 0 warnings · build 85 entries · vitest 685/685 · smoke ALL PASS · workers-smoke ALL PASS · all repo gates PASS · npm audit 0). Full inventory + baseline numbers + finding AP-1 written to AUDIT.md.
- **2026-10-26 (session start):** Autopilot prompt persisted byte-verbatim as `docs/autopilot/PLAYBOOK.md` (SHA-256 `9e87e415…692b67`). State files initialized. A read-only pre-flight verification of the repo against the prompt's project facts was performed and recorded in `AUDIT.md` ("Pre-flight verification"). **No code, config, or behavior was changed** — this bootstrap is docs-only.

## Last green commit (code)

- `main @ 08b17bb` — Phase 0 merged (6 commits: inventory+baseline docs, portability gate, verify+CI wiring, 39 characterization tests, smoke-remote, RUNBOOK). `npm run verify` green; remote smoke dev 14/14 + prod 14/14; shotcheck dev 9/9 + prod 9/9; rollback drill on dev passed.
- Repo package version: `0.4.1.36` (unchanged — Phase 0 added tooling/tests/docs, no product code).

## Deployed versions

- dev (hibana.aliassadi.workers.dev + dev D1 `pm-app-dev`): running `08b17bb` (Worker version c3a4e0b8 after the rollback drill + redeploy; schema 63; storage kv).
- prod (hibana.ir + prod D1 `pm-app-prod`): running `08b17bb` (Worker version 43b49d5a; schema 63; storage kv; zone cache purged post-deploy).
- Both verified live this session: remote smoke 14/14 each, shotcheck 9/9 each.

## Blockers

- None. GitHub credentials verified working this session (clone + push both OK).

## Resume commands (exact)

1. `git clone https://github.com/assadigit/hibana-source.git && cd hibana-source`
2. Read `docs/autopilot/PLAYBOOK.md` and `docs/autopilot/STATE.md`
3. `git status && git log -5`
4. Continue with PHASE 0 (PLAYBOOK.md §5); ship through the Ship Gate (§3); never violate §7 hard stops.
