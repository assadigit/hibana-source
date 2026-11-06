# Next Session Prompt — Phase 9: Integration, Merge, Deployment + Handoff (the Desktop Round, the Web PR→Merge→Auto-Deploy, the D1 Migration, and the Final Report Against Every Acceptance Checklist)

Continue Hibana Sprint, Deadline & Dependency implementation — **the FINAL phase**.

**This session is S248** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 =
S240 @ `81f2c05`, Phase 2 = S241 @ `da652d2`, Phase 3 = S242 @ `a1e7d2d`, Phase 4 =
S243 @ `b770258` + the S243b reconciliation @ `3ae6ae9`, Phase 5 = S244 @ `7a6bd4a`,
Phase 6 = S245 @ `f1ca773`, Phase 7 = S246 @ `a820253`, Phase 8 = **S247 @ `e49f2e5` + the S247b
reconciliation @ `7f314e9`** — all final deliveries verified, all gates green; the Phase 8 round was the
FULL-SPEC ACCEPTANCE SWEEP: the traceable release matrix
`src/tests/acceptance-s247.test.ts` (every spec §21 (19 rows) / §22 (20) / §23 (11) /
§24 (10) row + the visual guide's §6 checklist mapped to an existing green test or a
pin added that round — machine-verified in lock-step, row-counts pinned), the e2e arms
(`s247-acceptance.spec.ts`: the bare pre-feature card on BOTH board surfaces, the
embedded-board threshold boundary sides, the EN/FA same-instant dueDayLabel agreement,
the one-pass FA localization sweep; `s247-a11y.spec.ts`: keyboard reachability + aria
labeling + AA contrast + color independence on every Phases 3-7 dialog), the ONE real
defect the sweep surfaced — the deadline/dep state text under WCAG AA — FIXED in
devboard.css (the amber/green pair darkened to 5.34/5.96:1) + the S247b reconciliation @ `7f314e9` (the dark-theme state family lifted in claude-dark-theme.css — assumption 15's limitation closed; claude v32 rides the same v459 SHELL step); the ladder sits at
sw.js v459, devboard.css v45), and the FULL e2e suite **509/509 across 101 spec
files**). If ANOTHER session appears mid-work: reconcile per the never-overwrite
rule — adopt the verified push, never force-push, never stack a conflicting twin.

## Kickoff credentials (pasted by the user — never persist, never commit, never log)

GitHub classic token (push-only): pasted in the kickoff message. Use it ONLY in one-shot
push URLs (`git push https://<TOKEN>@github.com/assadigit/<repo>.git <branch>` — once for
hibana-source, once for hibana-desktop). The Cloudflare token, the Telegram bot token,
the healthcheck.io keys, the Workers AI keys and the test account become IN SCOPE **only
for the explicitly listed deploy/verification steps below** (the web auto-deploy is
workflow-driven — you should NOT need wrangler or the CF token unless the CD workflow
fails and an owner-approved manual fallback is required; NEVER improvise a manual prod
deploy or a manual D1 migration). Never write any credential to disk, .git/config,
files, commit bodies, or logs.

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md` (off `origin/main` of
   hibana-source, or the re-pasted pack — prefer the repo copy)
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md`
   (§21/§22/§23/§24 are the acceptance checklists the FINAL REPORT is written against;
   §18 web/desktop consistency; §19 data integrity; §20 repository-first rules)
3. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md`
   (§5 Phase 9 scope + §6 cross-platform sequencing + §7 definition of done)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`
   (the architecture map incl. the DESKTOP section, the D1–D9 register — **D9 is THIS
   round's core**, assumptions 1–15 — assumption 2 (deps are SOFT), 13 (the ride-along),
   14 (S246's decisions), 15 (S247's matrix doctrine + the contrast fix; its dark-theme
   limitation was CLOSED same-session by the S247b reconciliation @ `7f314e9`) are BINDING; assumption 11's H1 day-window seam stays QUEUED — if the
   owner has not ruled, ship as-is and restate it in the final report)
5. `docs/project-kanban/API-AND-SYNC-CONTRACT.md` §12 on the feature branch — the
   COMPLETE contract the desktop round consumes (S247 pinned it mirrors the code:
   `src/tests/acceptance-s247.test.ts` — the contract-doc-mirrors-code pin)
6. `src/tests/acceptance-s247.test.ts` (the release matrix — the final report cites it)
7. this file

Where these docs live: the pack's `agent-workflow/*.md` docs are committed on
**`origin/main`** of hibana-source (docs-only commits, `**.md` pushes are CI-skipped so
they cannot deploy). The feature branch `feat/sprint-deadline-deps` does NOT carry the
pack — read it off main. If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone BOTH repos (public — no token for clone). Web: `assadigit/hibana-source`;
   Desktop: `assadigit/hibana-desktop` (**`main` @ `9d53e64`, v0.1.35, island pin
   `04218ca` = web v0.4.1.43 — comes OUT of READ-ONLY this round**). `git status &&
   git log --oneline -5 && git branch --show-current` in each; confirm no other agent
   is mid-work in EITHER repo; preserve unrelated/uncommitted changes; reconcile —
   never overwrite concurrent work.
2. Web feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must
   be **`7f314e9`** (or its descendant — the S247b reconciliation on top of e49f2e5), clean tree. **NEVER commit non-docs code to
   `main`** — pushes to main auto-deploy to production hibana.ir via the CI→CD chain
   (`ci.yml` → `cd.yml` workflow_run-gated: CI green on main → build `--wire-html` →
   deploy dev → live probe → deploy prod). Branch pushes run CI only and can NEVER
   deploy.
3. Baseline the WEB branch BEFORE any edit (record exact commands + results):
   `bun install` (bun 1.3.14, node ≥ 24), then `bun run verify` (tsc → eslint-0 →
   vitest → prod build → portability → fn-shape → boundaries). Expected: **112 files /
   969 tests green** + `bun run check-i18n-parity` (1678=1678) + `bun run
   check-cache-bust` (devboard.css v45 consistent). Fresh sandbox e2e note:
   `bunx playwright install chromium-headless-shell` (the pinned build wants
   chromium_headless_shell-1248).
4. Baseline the DESKTOP repo: read its README + `desktop.yml` CI + the island layout
   FIRST (the architecture map's desktop section: Go + Wails v2 + WebView2 +
   modernc.org/sqlite; the island = machine-generated checksum-pinned snapshot via
   `scripts/sync-island.mjs`; `frontend/dist/web-ref.json` pins the web ref; NEVER
   hand-edit the island). If the sandbox has Go, run its gates (`go vet` + `go test
   ./internal/...`); if not, record that and rely on the desktop CI run after push.

## Current phase: Phase 9 — Integration, merge, deployment, handoff (BOTH repos)

**Order of operations (the two tracks are coupled through the island re-pin — do the
desktop code BEFORE the web merge so the island regenerates from the FINAL web ref):**

### Track A — the desktop round (hibana-desktop, `main`)

1. **Mirror schema v3** (the Go/SQLite mirror of migration 0065): add `dev_task_deps`
   (blocker/blocked FKs + the `CHECK blocker<>blocked` + both indexes), the sprints
   columns (`status`, `emoji`, `due_at`, `due_origin_at`, `updated_at`), the tasks
   columns (`due_at`, `due_origin_at`), and the archives snapshot column
   (`sprint_name_snapshot`) — semantics IDENTICAL to migration `0065_sprint_deadline_deps.sql`
   (read it first; the backfill rules matter: ended→completed / draft→planned / open→
   active, the one-active partial unique index, the two-open normalization). The mirror
   is offline-local; the sync loop full-replaces from the payload (D8: no deltas
   needed).
2. **Consume the contract, do NOT fork it** (spec §18): the mirror stores the payload's
   additive fields verbatim — `task_deps`, the per-task `effective_due_at` /
   `effective_due_source` / `effective_due_origin_at` triple (server-computed — the
   desktop ships ZERO deadline-resolution logic), the sprints' new columns. The origin
   rules, thresholds, and precedence live server-side only.
3. **The island re-pin** from the post-Phase-8 web ref: run `scripts/sync-island.mjs`
   against hibana-source `feat/sprint-deadline-deps` @ `7f314e9` (or its final
   descendant after Track B's PR merge — re-pin AFTER the merge if the web ref moves
   again). This pulls devboard.js v36, board-page.js v33, project-page.js v84,
   sprint-page.js v27, devboard.css v45, due-control.js v1 + the i18n carriers into
   `frontend/dist` and repoints `web-ref.json`.
4. **The seam gates** (D9): after the re-pin, the island's `devboard.js` still carries
   EXACTLY 7 `hibanaFetch(` + 2 `hibanaXHR(` and `board-page.js` exactly 4
   `hibanaFetch(` with 0 bare `fetch(` — the S242-S246 web discipline kept ZERO new
   fetch sites (pinned in `sprint-ui-s242/243/244/245/246.test.ts` and re-verified
   inside S247's 969), so the counts should HOLD; if the regenerated island needs a
   method/path allow-list update for the NEW endpoints (POST `/api/devtasks/:id/deps`,
   DELETE `/api/devtasks/:id/deps/:blockerId`, POST `/api/sprints/:id/pause|resume`,
   PATCH `/api/sprints/:id`, POST `/api/projects/:id/sprints`), extend the SEAM_PATCHES
   through the recorded process — never hand-patch.
5. **The version ladder lockstep**: bump the desktop version (v0.1.35 → v0.1.36 or the
   repo's ladder convention — read desktop.yml + main.go first) + the `WEB_REF` in
   desktop.yml; the web package stays 0.4.1.43 unless the merge round bumps it (if the
   repo convention bumps the web patch on feature merges, do it in the PR — never
   directly on main).
6. **Desktop CI probe #14**: the desktop CI (`desktop.yml`) runs island checksum →
   pinned-ref gate → go vet + go test → wails build (exe + NSIS installer) → portable
   zip + SHA256 → autorelease `vX.Y.Z-desktop`. Verify the FULL pipeline green on the
   pushed commit; the probe #14 live check (the post-build smoke) must pass against
   the dev deployment.
7. Commit + push `main` on hibana-desktop (one-shot token URL). Desktop pushes to main
   build + autorelease per its own policy — that IS its deployment path (no CD chain to
   prod web).

### Track B — the web PR → merge → auto-deploy (hibana-source)

1. Open the PR `feat/sprint-deadline-deps` → `main` (the branch @ `7f314e9` (e49f2e5 + the S247b dark-theme reconciliation) or its
   desktop-round descendant if Track A required web-side tweaks — keep them minimal and
   cited). PR body: the acceptance-matrix summary (every §21/§22/§23/§24 row + visual
   §6 → test citations, the S247-ADD pins), the gate results (verify 112f/969t, i18n
   1678=1678, cache-bust, the FULL e2e 509/509), the D1–D9 register state, and the
   assumptions register (1–15).
2. Wait for the branch CI to be green (the PR's checks), then merge using the repo's
   policy (squash/merge per the repo's history convention — read the recent main
   history first; do NOT rebase-rewrite the verified branch).
3. **The merge to main AUTO-DEPLOYS to production hibana.ir** via CI→CD (workflow_run
   gated): dev deploy → live probe → prod deploy. VERIFY (never assume): the CD run's
   SHA matches the merge SHA; the deployed revision (the live site's version endpoint /
   footer) matches; the health probe green (the repo's own probe + healthcheck.io's
   `https://hc-ping.com/fzlazarfuosqezmicvcgha/hibana` if the owner wired it); a smoke
   pass over the live site (login, a board load, a sprint create/finish round on the
   DEV environment FIRST if reachable — never run destructive smoke on prod data).
4. **The D1 migration**: the prod D1 database must run migration 0065 (+ any pending
   earlier migrations). Run the DEV database first via the repo's
   `.github/workflows/d1-migrate-dev.yml` workflow_dispatch (that is its purpose) and
   verify the dev site still serves boards. **For PROD: confirm the existing process
   FIRST (the repo's docs/README/owner's instruction — there may be a prod-migrate
   workflow or an owner-run manual step). NEVER improvise a manual prod D1 migration;
   if no prod process exists, STOP and report — the migration is additive-and-
   nullable so the deploy is safe either way until the owner runs it.**
5. The final report (the definition of done, §7): every §21/§22/§23/§24 row + visual
   §6 row marked Done / Not Done / Blocked with its citation (the S247 matrix is the
   source), the D1–D9 register's final state, the assumptions register (1–15 + the
   queued owner decisions: assumption 11's H1 day-window seam — the dark-theme contrast
   family from assumption 15 was CLOSED by S247b), the desktop verification evidence, the deploy evidence
   (SHAs, health, smoke), and the Phase 9 re-pin inventory: **ZERO new fetch sites
   across Phases 3-8** (the s242-s246 pins + the island's held 7+2/4 counts), the
   FN-ALLOWLIST deltas across the feature (the S240 re-pins, the S241 board GET, the
   S246 loadDetail row), the sw.js ladder end-state (v459; devboard.js v36, board-page
   v33, project-page v84, sprint-page v27, devboard.css v45, due-control v1, i18n-en
   v110 + i18n.js v163 with the i18n-fa v104 injector).

## Gate ladder (fix everything until green)

WEB: `bun run verify` (tsc → eslint-0 → vitest **112 files / 969 tests** → prod build →
portability → fn-shape → boundaries) + `check-i18n-parity` (1678=1678) +
`check-cache-bust`. e2e: the FULL suite (509 across 101 spec files — fresh sandbox:
`bunx playwright install chromium-headless-shell` first; ~25 min, chunk if the command
timeout bites) at minimum the sprint/board family + the s247 specs before the merge.
DESKTOP: its own CI (island checksum + pinned-ref + go vet + go test + wails build +
probe #14) green on the pushed main.

## Commit, push, deploy rules

Desktop: one or two coherent commits on `main` (its ladder policy), message style
`feat(sync): S248 <lowercase one-liner> — mirror schema v3 + island re-pin` — push via
one-shot token URL. Web: the PR + merge ONLY (never a direct non-md push to main —
that is the deploy). Docs: the pack close-out commit (agent-workflow/*.md ONLY) rides
main AFTER the merge, CI-skipped as always. If the CD chain fails on the merge: do NOT
force anything — diagnose from the run log, fix on the branch if it is a code defect,
or report if it is an environment/credential blocker. No unrelated refactors, no new
runtime deps, ZERO new fetch sites.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md`
   (Phase 9 checklist + the final session log with both repos' commit SHAs + the PR/merge
   SHA + the CD run's SHA + health/smoke evidence + the desktop pipeline run + the D1
   migration state + the final-report summary) and REPLACE this file's content with the
   CLOSE-OUT note: the definition-of-done state (§7) — every acceptance row marked,
   both repos verified, migrations safe, the queued owner decisions restated (assumption
   11; the dark-theme contrast family was closed by S247b), and the explicit statement that no further
   implementation session is required (or exactly what remains, if anything is blocked).
2. Push the web feature branch if it moved (one-shot token), the desktop main push
   (one-shot token), and the docs-only commit to hibana-source main (agent-workflow/*.md
   ONLY).
3. Factual report: files changed in BOTH repos, the PR/merge/deploy SHAs + verification
   evidence (health + smoke + the CD run), the desktop pipeline + probe results, the D1
   migration state (dev run + the prod process confirmed or the owner-step flagged),
   exact test/gate results, the final acceptance-report state (Done/Not Done/Blocked per
   checklist), the Phase 9 re-pin inventory, blockers, defaults/assumptions taken, and
   the handoff location of every artifact.
