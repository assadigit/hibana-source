# CLOSE-OUT — FINAL STATE: the Hibana Sprint, Deadline & Dependency feature is LIVE ON PRODUCTION

**No further implementation session is required — the feature is shipped end-to-end.**
This is the close-out note (Phase 9 / S248 + the S249 re-land round, 2026-11-06) — the
definition-of-done state per the phased plan's §7.

## The definition of done — every row

| §7 requirement | State |
|---|---|
| All acceptance criteria in the consolidated spec pass | **DONE** — every §21 (19) / §22 (20) / §23 (11) / §24 (10) row + the visual guide's §6 (18) checklist mapped to green tests or S247-ADD pins, machine-verified in lock-step by `src/tests/acceptance-s247.test.ts` |
| Both Web/source and Windows Desktop implement the same behavior | **DONE — both LIVE**: the web feature is deployed to production hibana.ir (main @ `dc5d0d6`, the S249 owner-approved re-land); the desktop shipped **v0.1.36-desktop** (island @ `7f314e9`, byte-valid against the live main — verified by empty `public/` diff) |
| All migrations preserve existing data | **DONE — LIVE-VERIFIED**: 0065 applied to BOTH D1s (schema 63→**64**; Time Travel bookmarks taken first; **56 prod tasks / 147 archives / 0 sprints preserved exactly — zero rows lost**; both sites healthy throughout the migrate-then-land order) |
| Tests pass in both repos | **DONE** — web: verify 112 files / 969 tests + CI green on the re-land `dc5d0d6` (first try) + CD fully green per-step; desktop: vet + 9 packages + the full desktop CI green |
| UI matches the screenshots + the visual guide | **DONE** — visual §6 mapped green; the S247 WCAG-AA fix + the S247b dark-theme closure |
| The priority ribbon + unrelated features preserved | **DONE** — the ribbon-unchanged pin + the FULL e2e 509/509 |
| Required PR/merge/deploy steps complete or explicitly blocked | **DONE — COMPLETE**: PR #17 → merge `d883081` → the documented rollback `8ae04ce` (the schema-63 write breakage) → **the S249 owner-authorized round: the D1s migrated (bookmarks `0000114b…` dev / `00001f01…` prod) → the re-land `dc5d0d6` → CI green → CD deployed dev+prod green → live smoke: prod read (the 7-key payload) + dev write (task 201 / sprint 201 / dep 201 — the exact paths that 500'd) — the feature is LIVE** |
| IMPLEMENTATION-STATUS.md final + this close-out note | **DONE** — Sessions 12-14 logs + `HIBANA-PHASE9-FINAL-REPORT.md` (in this pack) |

## What remains — OWNER-side only (nothing is blocked)

1. **Nothing functional.** The feature is live and verified. Optional monitoring note: the
   healthchecks.io "Hibana errors" check is red for ~1 more day — its 24h window still
   contains the S248 broken-deploy window's 25 error rows (16:30–18:00 UTC); it
   **self-heals** on its own as they age out (the owner may acknowledge the alert if it
   pages). "Hibana uptime" (the independent prober) is green throughout.
2. **The queued ruling — assumption 11's H1 day-window seam** (the `/start` day-window
   semantics): untouched by this feature, shipped as-is, awaiting the owner's decision.
   (Assumption 15's dark-theme contrast limitation was closed by S247b.)
3. Optional hygiene: raise the CI e2e (1) shard's 15-minute cap when convenient (the suite
   has outgrown S200's sizing); build the d1-migrate-dev.yml column-adding-migration
   extension BEFORE the next column-adding migration (0065 was applied through the local
   ritual — bookmarks + the repo's own d1-migrate.mjs — exactly as the runbook's dev path
   prescribed).

## The deploy history (for the record)

- PR #17 (`feat/sprint-deadline-deps` @ `1a223c3` → squash `d883081`) — the first deploy
  hit the un-migrated D1s (schema 63: the new INSERTs' 0065 columns broke task/sprint
  creation) → the documented rollback `8ae04ce` (prod restored same hour).
- The S249 round (owner-authorized): pre-flight queries showed **0064 was already applied**
  (2026-09-30 — only 0065 was pending; the end state is schema 64, not the runbook's
  assumed 65) → bookmarks → 0065 applied to dev + prod (zero data loss, both sites healthy
  throughout) → the re-land `dc5d0d6` (the revert-of-revert, byte-identical to the verified
  branch) → CI green first try → **CD green per-step** (build → dev deploy → probe → prod
  deploy → probe → purge → restore) → live smoke green.
- The desktop: v0.1.36-desktop (island @ `7f314e9`) — no re-pin needed (verified: `public/`
  unchanged between the pin and the live main).

## Where everything lives

- The web feature: **LIVE on hibana.ir** (main @ `dc5d0d6`) · branch `feat/sprint-deadline-deps` @ `1a223c3` (preserved) · PR #17 (merged; the durable acceptance-matrix record) · main history: `d883081` (the squash) → `8ae04ce` (the rollback) → `dc5d0d6` (the re-land) → the docs commits.
- The desktop: main @ `ffbd191` + `9303664`; release **v0.1.36-desktop** (installer + portable zip + SHA256s).
- The full record: `IMPLEMENTATION-STATUS.md` Sessions 1-14 + `HIBANA-PHASE9-FINAL-REPORT.md` (this pack folder) — every acceptance row, the D1-D9 register (all closed), the assumptions register (11 queued), the evidence, the rollback + re-land story, the re-pin inventory.
