# Hibana Autopilot — REPORT (plain-language, one section per finished phase)

> Written for Ali: short, jargon-free, honest — what changed, what was run, what is risky, what was NOT verified (PLAYBOOK §2, CM-2/CM-6).

## Session start (2026-10-26) — no phase finished yet

- **Your full Autopilot instruction prompt is now stored in the repo itself**, at `docs/autopilot/PLAYBOOK.md`, copied word-for-word (byte-identical). Any future session — or any new assistant — can find it there and resume exactly where things left off, so it can never be lost or forgotten.
- **A read-only check of the repo against the prompt was run.** The important claims all match reality: the tech stack (Hono serving both Cloudflare and Node), the single database design with its 63 numbered migrations, the build pipeline, the screenshot storage chain, the four integrations (email, healthchecks, Telegram, the AI "Magic Button"), and the English/Persian bilingual support.
- **A few small differences were found and written down** in `docs/autopilot/AUDIT.md` — the biggest one: the promised single `npm run verify` command does not exist yet (today the checks are separate scripts). Creating it is literally the first job of Phase 0, so the plan already covers it.
- **Nothing was changed in the product itself.** No code, no configuration, no behavior — this session only added the autopilot's own memory files.
- **Next step:** Phase 0 — measure today's baseline, build the safety net (the one-command check + automated tests for the critical user journeys), and prove the deploy/rollback path.

_(One section per finished phase will be appended below, ending with the final report required by PLAYBOOK §8.)_

---

## Phase 0 — Baseline, safety net, and deploy confidence (COMPLETE, 2026-10-26)

**Your app's "before any surgery" checkup is done, and every safety net the plan asked for is now in place and proven live.**

### What got better

- **One command now runs every quality check.** Before: the checks existed but only as separate scripts you'd have to know about. Now `npm run verify` runs all of them (types, code style, the full 685-test suite, the production build, and a brand-new portability check) in about 76 seconds. The CI server runs exactly the same command, so what passes on my machine is what passes in the cloud.
- **A new guard protects the "runs on both Cloudflare AND plain Node" promise.** A checker now scans every source file and fails the build if anyone ever imports a Node-only or Cloudflare-only facility outside the four adapter files where it belongs. I tested that the guard actually catches violations (injected a fake violation — it caught it).
- **39 new "characterization" tests** pin down the exact current behavior of the most safety-critical paths that had little or no test coverage: the logout button, the full session-cookie security contract, the hard-delete rules for every project status, project editing, the Persian calendar (both the server and the browser copies — they never cross-checked before), and the offline idea queue. These are the tripwires that make every later refactor safe.
- **A remote "ship gate" smoke suite.** After deploying, one command now proves the live site end to end against the real URL: health, login page, real authenticated reads, a throwaway record created/read/deleted (clearly named, always cleaned up), both English and Persian content, and every cached asset loading. It passed 14/14 on dev AND 14/14 on production.
- **A runbook** (docs/autopilot/RUNBOOK.md) now documents the backup, restore, deploy, and rollback procedures in one place.
- **Baseline recorded.** Full inventory of the codebase and today's numbers (685/685 tests green, zero lint warnings, zero known vulnerabilities, all quality gates passing) are written into docs/autopilot/AUDIT.md — so any future change can be measured against today.

### One real bug found (not yet fixed — that's Phase 2's job)

While writing the offline-queue tests I found that the "drop after 5 failed syncs" fix **doesn't actually work in a real browser**: the retry counter is bumped on a copy and never saved back, so the safety valve can never trigger. Impact is limited (there's a manual "clear queue" escape hatch, and items aren't lost — the opposite: they can stay stuck in the "N unsynced" state during persistent server errors). Recorded as finding **AP-1** in AUDIT.md with a test that pins the current broken behavior; Phase 2 will fix it test-first.

### Proof (what I ran and the results)

- `npm run verify` — all green (types 0 errors, lint 0 warnings, **685/685 tests**, build OK, portability PASS).
- Deployed **dev** (hibana.aliassadi.workers.dev) → remote smoke **14/14 PASS** → live storage round-trip **9/9 PASS**.
- **Rollback drill on dev**: rolled the code back to the previous version → site stayed healthy → redeployed the new version → healthy again. The emergency exit is proven.
- Deployed **prod** (hibana.ir) → remote smoke **14/14 PASS** → live storage round-trip **9/9 PASS** → cache purged.
- Milestone tag `autopilot-phase-0-done` pushed; commit `08b17bb` (+ state docs `7f99601`).
- GitHub CI was still running when this section was written (it takes ~10-20 min with browser tests); the verdict is recorded below in the "CI verdict" line.

### What was NOT verified / risks

- **CI's final green verdict** — pending at writing time; the verify step inside it had already passed in identical form locally. If CI reports a failure, it will be investigated before Phase 1 merges anything.
- **Playwright e2e + Lighthouse ran only inside GitHub CI** (not locally this session) — they are part of the CI verdict above.
- **The owner's real account was never touched** — all live checks used throwaway probe users, created and removed with row-count parity asserted (5 → 6 → 5 users on both databases).
- The `hibana-desktop` Windows app (a separate repo) is out of this repo's scope entirely.

### CI verdict (final)

- **The `ci` job — which contains the new `npm run verify` step (types, lint, 685 tests, build, portability) plus every repo quality gate and both Lighthouse lanes — PASSED.** Twice. That is the Phase 0 milestone requirement, met in CI.
- **The e2e lane: 447 of 448 browser tests passed.** The ONE failure is a known flaky layout test (the s207 kanban-frame geometry check) that the repo's history already documents as runner-side nondeterminism: it measured the same edge at 4 different random offsets (31, 3, 57, 31 pixels) across two runs — a real layout bug would give one consistent number. Proof it is not this phase's code: **the same test file passes 5/5 on this exact code in a local browser**, and this phase changed zero product files (only tests, tooling, and docs were added).
- Because of that single flake, GitHub marks the whole CI run red — which also means the auto-deploy pipeline (which requires an all-green run) did not fire for this push. **That changes nothing on the live sites**: I deployed dev and prod manually through the full Ship Gate during this phase and verified both with the complete live smoke suites. The flake is recorded as finding AP-2; the fix belongs to a planned "flake hunt" round, and I deliberately did not weaken or skip the flaky test to force a green mark.
- Because the whole CI run is marked red by one flaky test, the auto-deploy lane (CD) correctly stayed silent for this push — the manual Ship Gate deploys above are the live truth for this commit.
