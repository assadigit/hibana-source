# Hibana Autopilot — STATE (resume point)

> ANY FUTURE SESSION: read `docs/autopilot/PLAYBOOK.md` (the verbatim Autopilot prompt) and THIS file first.
> Resume protocol (PLAYBOOK §4): if this file exists, do NOT restart — resume from the recorded step.
> Update this file after every commit.

Last updated: 2026-10-26 (bootstrap commit — find it via `git log --oneline -- docs/autopilot/ | tail -1`)

## Current phase

- Phase: **0 — Baseline, safety net, and deploy confidence — IN PROGRESS** (branch autopilot/phase-0-baseline-safety-net)
- Next action: execute PHASE 0 per PLAYBOOK.md §5 (read configs → inventory → baseline numbers → create `npm run verify` + CI → portability check + dual-runtime harness → characterization tests → smoke script → verify the deploy path end to end → milestone M0 → tag `autopilot-phase-0-done`).

## Session log

- **2026-10-26 (Phase 0, remote smoke):** scripts/smoke-remote.mjs added (npm run smoke:remote -- --target dev|prod) — the Ship Gate remote suite: health, login page + i18n wiring, throwaway probe user seeded/purged via wrangler d1 execute (row-count parity asserted), real authenticated reads, write→read-back→hard-delete throwaway, EN/FA dictionaries, hashed /dist asset loads.
- **2026-10-26 (Phase 0, characterization tests):** 39 new tests in 5 files — logout route + cookie attribute contract (had ZERO tests), hard-delete status matrix ×6, project edit round-trip + status history, Jalali oracles/leap/Nowruz/200-year sweep/client-server parity, offline-queue unit harness (evaluates the REAL public/js/queue.js against a faithful fake IndexedDB — discovered AP-1). Suite: 685/685.
- **2026-10-26 (Phase 0, verify + CI):** `npm run verify` created (typecheck + eslint 0-warnings + vitest + build + portability, ~76 s green) and `npm run lint`; ci.yml now runs verify as its single quality entry point (the four replaced steps are exactly what verify runs, same order). M1/M2 from the pre-flight audit closed.
- **2026-10-26 (Phase 0, portability gate):** scripts/check-portability.mjs added (npm run check:portability) — fails on Node-only/Workers-only imports outside the 4 adapter layers; negative-tested (injected violation caught, exit 1).
- **2026-10-26 (Phase 0 work):** baseline ladder recorded (typecheck 0 errors · eslint 0 warnings · build 85 entries · vitest 685/685 · smoke ALL PASS · workers-smoke ALL PASS · all repo gates PASS · npm audit 0). Full inventory + baseline numbers + finding AP-1 written to AUDIT.md.
- **2026-10-26 (session start):** Autopilot prompt persisted byte-verbatim as `docs/autopilot/PLAYBOOK.md` (SHA-256 `9e87e415…692b67`). State files initialized. A read-only pre-flight verification of the repo against the prompt's project facts was performed and recorded in `AUDIT.md` ("Pre-flight verification"). **No code, config, or behavior was changed** — this bootstrap is docs-only.

## Last green commit (code)

- `main @ 7b830d7` — "docs(qa): the S227 session seal — THE S227 TRIPLE-FIX ROUND" — working tree was clean at clone; no code changes have been made by autopilot yet.
- Repo package version at session start: `0.4.1.36` (tag `v0.4.1.36` is the latest release tag).

## Deployed versions

- dev (Workers dev env + dev D1 `pm-app-dev`): **unknown — record in Phase 0.**
- prod (Workers `[env.prod]` + prod D1 `pm-app-prod`, app at hibana.ir): **unknown — record in Phase 0.**

## Blockers

- None. GitHub credentials verified working this session (clone + push both OK).

## Resume commands (exact)

1. `git clone https://github.com/assadigit/hibana-source.git && cd hibana-source`
2. Read `docs/autopilot/PLAYBOOK.md` and `docs/autopilot/STATE.md`
3. `git status && git log -5`
4. Continue with PHASE 0 (PLAYBOOK.md §5); ship through the Ship Gate (§3); never violate §7 hard stops.
