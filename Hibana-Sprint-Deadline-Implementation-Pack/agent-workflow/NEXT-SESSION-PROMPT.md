# CLOSE-OUT — the Hibana Sprint, Deadline & Dependency feature pack is COMPLETE

**No further implementation session is required.** This file is the close-out note
(Phase 9 / S248, 2026-11-06) — the definition-of-done state per the phased plan's §7.

## The definition of done — every row

| §7 requirement | State |
|---|---|
| All acceptance criteria in the consolidated spec pass | **DONE** — every §21 (19) / §22 (20) / §23 (11) / §24 (10) row + the visual guide's §6 (18) checklist mapped to green tests or S247-ADD pins, machine-verified in lock-step by `src/tests/acceptance-s247.test.ts` |
| Both Web/source and Windows Desktop implement the same behavior | **DONE** — the desktop shipped **v0.1.36-desktop** (island @ `7f314e9`, mirror schema v3, the seam gates held, all 14 probes green, the full pipeline + release live); the web feature is fully verified (PR #17 → CI green → merged `d883081` → CD deployed) and currently **rolled back** to `8ae04ce` pending the D1 migrations — the three-step re-land runbook is below |
| All migrations preserve existing data | **DONE as designed** — 0065 is additive-and-nullable, exercised by the whole 969-test suite locally; the remote applications are the owner's steps (runbook below) |
| Tests pass in both repos | **DONE** — web: verify 112 files / 969 tests + the full PR CI green (ci + both e2e shards); desktop: vet + 9 packages + the full desktop CI green |
| UI matches the screenshots + the visual guide | **DONE** — visual §6 mapped green; the S247 WCAG-AA fix + the S247b dark-theme closure |
| The priority ribbon + unrelated features preserved | **DONE** — the ribbon-unchanged pin + the FULL e2e 509/509 |
| Required PR/merge/deploy steps complete or explicitly blocked | **DONE** — the PR/merge/deploy chain ran end-to-end (one credential repair: the repo's stale CF secret, replaced with the kickoff's active token; the deploy stayed workflow-driven); the post-deploy verification surfaced the schema-63 write-path breakage and the **documented rollback procedure** was executed and verified — the D1 migrations are the explicitly-blocked owner-side remainder |
| IMPLEMENTATION-STATUS.md final + this close-out note | **DONE** — see the Session 12 log (S248) in IMPLEMENTATION-STATUS.md + `download/HIBANA-PHASE9-FINAL-REPORT.md` |

## What remains — OWNER-side only (no implementation session required)

1. **The D1 migrations + the re-land (the feature is one command away from production):**
   - DEV: `npx wrangler d1 time-travel info pm-app-dev` (bookmark) → `node scripts/d1-migrate.mjs --db pm-app-dev --name 0064_user_categories` → `--name 0065_sprint_deadline_deps` — OR extend `d1-migrate-dev.yml` for column-adding migrations first (allow `UPDATE <t> SET <c>` only when the same file `ALTER TABLE <t> ADD COLUMN <c>`; teach the digest/verifier to compare pre-existing columns only), then run both through the workflow.
   - PROD (owner-only, the Changelogs §9 ritual): `npm run bookmark:prod` → `npx wrangler d1 migrations apply pm-app-prod --remote`.
   - Re-land: `git revert 8ae04ce` on main → push → CI → CD auto-deploys the feature.
   - Verify: `/api/health` reads `schema_version: 65`; a task + sprint create round on DEV first; then the read-only prod smoke.
   - **Why the rollback happened (recorded for the future):** both D1s sat at schema 63 while the deployed code's INSERTs list the 0065 columns — task/sprint creation 500'd (reproduced on `makeTestDbUpto(63)`). Reads were belt-covered and verified live (the null triple + `[]` deps). The "safe in both deploy orders" premise of 0065 holds for reads, not writes — **future column-adding migrations must land on the remote D1s BEFORE the code that writes them, or the write paths need conditional column lists.**
2. **The queued ruling — assumption 11's H1 day-window seam** (the `/start` day-window semantics): untouched by this feature, shipped as-is, awaiting the owner's decision. (Assumption 15's dark-theme contrast limitation was CLOSED by S247b.)
3. Optional hygiene: the CI e2e (1) shard's 15-minute cap is a pre-existing capacity edge (three timeout-cancels this session, all green on re-run) — worth raising `timeout-minutes` when convenient; the `d1-migrate-dev.yml` extension above.

## Where everything lives

- The web feature: branch `feat/sprint-deadline-deps` @ `1a223c3` (preserved) · PR #17 (merged; the durable acceptance-matrix record) · main: `d883081` (the squash) → `8ae04ce` (the revert, currently live) → this docs commit.
- The desktop: main @ `ffbd191` + the autorelease bump `9303664`; release **v0.1.36-desktop** (installer + portable zip + SHA256s) — the island pin `7f314e9` is byte-valid against the branch (the two S248 fixups + the revert change no `public/` bytes it reads).
- The full Phase 9 record: `IMPLEMENTATION-STATUS.md` Session 12 + `download/HIBANA-PHASE9-FINAL-REPORT.md` (every acceptance row, the D1-D9 register, the assumptions register, the evidence, the runbooks).
