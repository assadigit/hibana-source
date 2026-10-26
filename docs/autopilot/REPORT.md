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

---

## Phase 1 — manual follow-up for Ali (the single permitted one)

**The full git-history secret scan (672 commits, every blob) found exactly one real secret ever committed: the healthchecks.io PING KEY** (it appeared in a deleted worklog file and old Changelogs copies). It is NOT live at HEAD, and the repo already mitigated it in September (the check's URL slug was randomized, so the leaked key alone cannot construct a valid ping URL — the repo's own assessment is "false alarms only, now blocked"). You deliberately kept it at the September rotation round.

**If you want it fully voided anyway:** regenerate the ping key in the healthchecks.io dashboard, then run `wrangler secret put HEALTHCHECK_PING_URL` (against the prod Worker) and update the `HIBANA_UPTIME_PING_URL` repo secret. Nothing else needs rotation — zero other secrets exist anywhere in the repo's history.

---

## Phase 1 — Security and data isolation (COMPLETE, 2026-10-26)

**The full security audit is done, every real issue found is fixed with a test proving it, and both the live sites are verified.**

### What this phase did

Four parallel read-only security audits covered everything the plan asked for: who-can-whose-data (every route and every SQL statement), login/session/password-reset/invite mechanics, input validation and output escaping, file uploads, the Telegram/email/health-check/AI integrations, error messages and logs, plus a full scan of all 672 commits of history for leaked secrets. Every finding was then re-verified by hand before anything was changed — two auditor claims turned out to be wrong and were dropped (one "unclamped parameter" was already clamped; one "file corruption" was a display artifact).

### What was actually wrong (and is now fixed)

- **One real cross-user write hole** (the only one found across ~511 routes): the shared whiteboard's "sync" could overwrite or erase ANOTHER user's sticky note if the attacker knew its internal id. Fixed + proven on both runtimes (including a live test against the real Cloudflare database engine).
- **A "javascript:" link trick**: saving a link whose address was a script could run that script when clicked. The form now only accepts real http(s) addresses.
- **Two error leaks to strangers**: the password-reset and sign-up endpoints could return the email provider's internal error text to anyone. Now they return a plain generic message.
- **A slow-drain timing tell**: guessing whether an account exists by measuring login response speed. Now both "no such account" and "wrong password" take the same time.
- **A race on invite codes**: two simultaneous signups could squeeze through one single-use code. The burn is now atomic (first wins, second refused).
- **Uploads now sniff file contents**: a file claiming to be a PNG must actually BE a PNG (by its bytes), in every storage tier. Fake/mislabeled uploads are refused.
- **The email sender got a timeout** (a stuck connection could hang a signup), the AI-button's error toast now escapes its text (a latent hole, closed early), reminder logs no longer echo user-written titles, and the invite-by-email sender is rate-limited.
- **Supply chain**: all 13 CI action references are now pinned to exact immutable versions, and package.json now demands Node 24+ explicitly.

### The milestone proof (all live)

- The cross-user isolation suite passes on **both** runtimes: 706/706 local tests (up from 685 — 21 new), plus a dedicated Workers-runtime suite that logs in as two users and attacks every surface.
- Security headers (CSP, nosniff, referrer, frame protection, HSTS) are **verified live on both dev and production, on both serving layers** — this check is now a permanent part of the deploy gate (24 checks, all passing on both environments).
- The screenshot storage round-trip passed 9/9 on both environments.
- **Zero open critical or high security findings** — the audit ledger shows every critical/high item fixed; what remains open is deliberately deferred with reasons (see docs/autopilot/DEBT.md).

### The one thing only you can do (optional)

The full history scan found exactly one real secret ever committed (the healthchecks.io ping key, in files deleted long ago). It was already neutralized in September by randomizing the check's URL — the leaked key alone can't ping anything. If you want it fully voided anyway, the 3-step rotation is at the top of this file's Phase 1 section.

### The CI verdict on the shipped commit

The `ci` job on main is **GREEN** — the one-command verify gate ran in CI with the newly SHA-pinned actions and all 706 tests passed there too. The e2e suite came in 447/448: the single failure is the **same pre-existing flake documented in Phase 0** (the s207 kanban-frame geometry assertion, failing with the same random offset signature in the CI runner while passing 5/5 locally on this identical tree; no Phase 1 change touches that code). Per the no-looping rule it stays with the planned flake-hunt round. Because CI is red on that flake, the auto-CD chain stayed silent — the manual Ship Gate deploys above are the live truth (both environments deployed and verified this session).

### Not verified / accepted risks (honest list)

- The Content-Security-Policy still allows inline scripts (the no-build frontend requires it — documented tradeoff; the escaping discipline + automated escape gate is the real barrier, and it passes on all 213 sinks).
- The pre-existing e2e flake (AP-2) and the two deliberately deferred items (timeout budgets for the storage chain, purging unlinked Telegram captures) carry to later phases, each with a written reason and removal path.

## Phase 2 — Bug hunt and fixes (COMPLETE, 2026-10-26)

**What got better (plain language):**

- **Your ideas and canvas edits can no longer silently vanish.** Three separate data-loss bugs in the offline system are fixed: retry counters that never persisted (items stuck "unsynced" forever), a batching bug where ONE bad element or a too-big queue silently discarded EVERY queued edit and then showed "Saved", and the canvas page losing your last seconds of typing when you closed the tab mid-edit.
- **The app was broken for anyone in Iran after midnight without you knowing.** Reminders for deadlines fired *after* the deadline (the "2 hours before" window was computed against the wrong clock), weekday recurrence armed the wrong day for Persian users, the payments form returned an error on EVERY submission, and "every ۳۰ days" repetition never repeated when typed with Persian digits. All fixed and pinned by tests.
- **The Reports page told the wrong story.** Monthly/weekly activity bars counted only events on one exact day of each period — a busy month could show almost nothing. Numbers now cover the full weeks and months.
- **Big accounts no longer crash on Cloudflare.** D1 (the Workers database) has a hidden limit of 100 values per query; long-offline canvas syncs, big tag renames, and large idea shelves silently crossed it. Every such query is now automatically split into safe chunks — proven live on the Workers runtime.
- **Archived tasks became permanent bricks.** Deleting a sprint or category that an archived task referenced made that task unrestorable (a 500 error, forever). Fixed forward, and old stuck rows are rescued too.
- **Honesty fixes:** restoring an already-purged project now says "not found" instead of pretending it worked; parked/archived items no longer leak into the search and the side panel; dragging projects to reorder no longer fakes "recently updated"; Telegram commands can't match the wrong project when a title contains % or _.
- **The flaky test in CI is fixed** — the board-width check now waits for the layout to settle instead of sampling at a random moment.

**How it was verified:** 5 read-only audit agents hunted across static analysis, runtime parity, dates/i18n, state rules, and the canvas/integrations. Every claimed bug was re-verified by the lead with a *failing test first* (two auditor claims were disproven in the process and dropped). Suite grew 706 → 744 tests; every fix has a regression test. Both runtimes green (Node + Workers smoke, including two new live Cloudflare canaries); deployed to dev and production with full remote smoke (24/24 each) and screenshot-pipeline checks (9/9 each).

**What was NOT verified / carried forward:** the Telegram webhook can still record a duplicate capture if Telegram retries a timed-out message (needs a small database migration — deferred with a written removal path); the pre-existing CSP tradeoff stands by design.
