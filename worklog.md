# Hibana — Session Worklog (durable handover)

> Purpose: the sandbox-local session journal, **committed to git** so a fresh clone
> inherits the handover (S156 was lost to a sandbox reset once — never again).
> Append per session; never overwrite. NEVER put credentials/tokens in this file —
> the owner supplies them per-session; `credentials.md` is gitignored.
> The durable per-release record lives in `Changelogs.md` (§1 = the 4-block chain,
> §2 = the full session index). This file is the working memory between sessions.

---

> **Rotation (HLTH-27):** sessions older than the newest 4 live in
> `worklog-archive.md` (and verbatim in git history) — this file is the ACTIVE
> tail only. Rotate with `node scripts/rotate/rotate.mjs --worklog`.

## Session S261 — the light health-check round on v0.4.1.52 / desktop v0.1.55 (2026-11-09)

**The round:** the owner's post-plan prompt — the audit remediation plan was
COMPLETE at S260 (spec §14; the one follow-up closed), so this session is a
LIGHT health check, no code changes: run the live probe (live-s259-probe.mjs)
on dev+prod expecting 58/58, verify the automated backup lane is fresh (<7 h),
and record anything that drifts (DEBT.md first, never same-session fixes).

**1. GREEN — everything the round's checks could reach:**
- **The automated backup lane is FRESH:** hibana-safe `backups/` holds 120
  snapshots; latest `snapshot-2026-11-09T21-23-21-554Z.json` — **2.42 h old**
  (bar: <7 h); the 6 h cadence intact (03/09/15/21 UTC, dev :17 + prod :23).
- **The probe's (A) carriers, live on BOTH workers:** /api/health ok · db up ·
  schema 66 · sw.js carries hibana-v465 (dev hibana.aliassadi.workers.dev +
  prod hibana.ir, fetched directly this session).
- **The FULL 58-check probe, LOCAL rehearsal on HEAD (cdc1f42b = ea549418 +
  docs-only): 58/58 ALL GREEN** — scratch Node server (PORT 3017, fresh DB,
  migrations auto-applied to 0067, seeded local QA user), the whole journey
  incl. **(B4) PASS** (the S260 tag-chip fix's regression guard) and zero
  page/console errors through the {en,fa}×{light,dark} matrix + 390px legs.
- **Desktop v0.1.55:** the docs-close push (92996ae) rode the autorelease to
  **v0.1.55-desktop** (published 21:52Z; same island bytes as v0.1.54 —
  worklog-only push, the v0.1.53 pattern). `sync-island.mjs --check` OK (58
  files byte-identical, pin ea549418 @ v0.4.1.52); **ALL 14 PROBES GREEN**
  (run in this sandbox against the real island bytes); desktop.yml twins
  ea549418/0.4.1.52 correct.
- **The lanes:** CI + CD + release green on ea549418; desktop + autorelease
  green on 67aacc0 (v0.1.55); Uptime workflow green (20:38Z); the daily Error
  monitor green (13:06Z — the 11-07 failure recovered 11-08, predates S259).

**2. THE HONEST GAP — the two authed live-probe legs did NOT run (55 of the
58 checks need a login):**
- **dev:** the seeded probe user needs a D1 write into pm-app-dev — the
  session's Cloudflare token belongs to the **Currena** account (its worker
  list is currena-api/currena-markets/…; the D1 list on the given account ID
  is empty), not the account holding Hibana's D1s.
- **prod:** the owner's test account (S259_LOGIN/S259_PASS) was not in the
  session block — it lives in credentials.md / the owner's per-session block
  and is never committed.
- Also: the block's second CF token (…e168d256) **fails tokens/verify**
  (invalid or expired) — flagged to the owner for rotation/re-paste.
- Everything short of the authed journey was verified live (carriers above),
  and the exact HEAD bytes passed the full 58/58 locally — so any residual
  risk is confined to deployment-vs-tree drift on the authed surfaces, which
  only the two blocked legs can rule out. The ask (A/B/C) is in the report.

**3. Drift found: NONE.** No DEBT.md rows added (nothing drifted; the rows
stand at 7, the S259-finding row stays CLOSED). No code changes; package
stays 0.4.1.52; the ladder was not re-run (runtime bytes identical to S260's
green ladder — the local probe re-proved the behavior instead).

**4. Ritual notes:** healthcheck ping + Telegram notify SKIPPED (the ping
URL/Telegram token were not in this session's block); no zip (docs-only
round, no version bump). Mirrored to the sandbox worklog per Agents.md.

**Next:** the owner sends (a) the Hibana-account CF token with D1 write (for
the dev seed+purge) and (b) the test account login → a short follow-up runs
the two live legs verbatim (dev: seed → probe → purge; prod: probe with the
test account, language restored, probe project trashed) and appends the
verdict. Nothing else is queued.

## Session S262 — the S261 follow-up: the two authed live legs, re-blocked on the same credentials (2026-11-10)

**The round:** the owner's follow-up prompt — finish S261's blocked halves (the
dev seed→probe→purge leg + the prod test-account leg of
`scripts/live-s259-probe.mjs`, both expecting 58/58), no code changes, any
failure to DEBT.md first, close per §12.4. The credential block the prompt
carried is the SAME Currena-account block S261 had already recorded as
insufficient, so this session re-confirmed the gap EMPIRICALLY (not assumed),
re-proved everything the round's instruments could reach, recorded one NEW
tooling finding (the rotate.mjs chain collision, below), and closed.

**1. The credential re-check, empirical:**
- The block's primary CF token verifies ACTIVE but belongs to the
  Sedanama/Currena account — the ONLY account it can list (the "Sedanama.ir@gmail.com's
  Account" the given account ID resolves to); its workers are currena-api /
  currena-markets / currena-r10-probe / order / rba-probe / sedanamabot /
  webhookset; the D1 database list on that account is EMPTY; a direct D1 REST
  query against pm-app-dev's known UUID → error 7404 (database not found). The
  Hibana D1s (pm-app-dev 80e02ce2-… / pm-app-prod d842fcb5-…) live on a
  different Cloudflare account this token cannot reach → **the dev leg (seed →
  probe → purge → D1-verify 0/0) is BLOCKED** — S261's finding, verbatim.
- The block's second CF token (…e168d256) **still fails tokens/verify**
  (invalid) — flagged to the owner for rotation/re-paste AGAIN.
- The test account (S259_LOGIN/S259_PASS) is NOT in the block and by design
  never committed anywhere (credentials.md is the owner-PC-only gitignored
  copy; backup exports exclude password hashes; the GitHub token sees
  hibana-safe but no credentials live there) → **the prod leg is BLOCKED**.
- No in-rules workaround: writing a probe user into the PROD D1 is prohibited
  ("never run tests against the live database"); dev registration is
  invite-only (OPEN_REGISTRATION unset); and the purge + the 0-users /
  0-orphan-archives verification need D1 write/read regardless of how a user
  could be created.

**2. What WAS verified, in THIS session (the honest reachable set):**
- **Live carriers on BOTH workers, fetched directly:** dev
  (hibana.aliassadi.workers.dev) + prod (hibana.ir) — /api/health ok · db up ·
  schema 66 · sw.js carries hibana-v465.
- **The FULL 58-check probe, LOCAL rehearsal on the exact current HEAD
  (e11bd2b = ea549418 + docs-only — git diff cdc1f42..HEAD touches only
  Changelogs/worklog files): 58/58 ALL GREEN incl. (B4) PASS** (the S260
  tag-chip regression guard). Scratch Node server :3017 under the E2E
  webServer contract env (fresh DB auto-migrated 0001→0067 = schema 66, seeded
  local QA user ali@hibana.local); the whole journey: login through the REAL
  login page → /projects overview + cards → /project.html detail → the kanban
  round (create via the editor → tag → Move-to → done → archive-done + the
  restorable snapshot row) → the sprint round (strategy create → sprint WITH
  strategy → sidebar quick-add ONE POST / ZERO GET → start → task done on the
  dot → finish exact-counts → strategy complete → draft delete through the
  exact-counts modal) → the Phase-3/4/5 contracts (the editor-create's ONE
  lean reload; EDIT/MOVE/DONE zero-refetch repaints; ?lean=1 both surfaces +
  the default contract; the stamp ETag 304-empty / no-cross-304 /
  mutation-moves-stamp round; exactly 4 stylesheet requests on all four pages)
  → the {en,fa}×{light,claude-dark} matrix + the 390px legs — **ZERO page
  errors / ZERO console errors**. (The first local run died only on the
  sandbox lacking chromium-1248 for playwright 1.64 — installed, re-run green;
  a sandbox-env issue, not an app issue.)
- So: any residual risk stays confined to deployment-vs-tree drift on the
  AUTHED surfaces — exactly the slice only the two blocked live legs can rule
  out (S261's framing, unchanged).

**3. THE NEW FINDING (recorded in DEBT.md, NOT fixed — the session's red
line):** `scripts/rotate/rotate.mjs`'s §1-chain drop step pins the block to
remove ONLY by version (`## 1-prev-prev-prev. Current state (v<blocks[3].version>`)
and takes the FIRST match. When the chain's 3rd and 4th blocks share a version
(exactly the docs-only-close shape — S259 v0.4.1.51 sitting over S258
v0.4.1.51 at this close), the bottom-up relabel makes BOTH blocks carry the
`1-prev-prev-prev` label + that version, and the drop deletes the 3rd (the
NEWER block) instead of the 4th — silently losing the newer current-state
block from the active chain (no error; git history keeps the bytes). Verified
by line-level analysis of the live chain BEFORE running the tool; this
close's §1 rotation was therefore done MANUALLY (S258 dropped, S259 kept as
1-prev-prev-prev — chain verified correct after the edit). The fix (anchor on
the LAST match or pin by the pre-relabel session label) is a future session's
one-liner; DEBT.md row added (the 8th).

**4. Drift found: NONE.** No app/runtime drift (the local 58/58 + the live
carriers are green); no code changes (runtime stays v0.4.1.52 @ ea549418;
package untouched); the ladder not re-run (runtime bytes identical to S260's
green ladder — the local probe re-proved behavior instead, the S261 pattern).

**5. Ritual notes:** healthcheck ping + Telegram notify SKIPPED again (the
ping URL / Telegram token are not in the session block); no zip (docs-only
round, no version bump); this worklog rotated to the newest 4 (S259 + S260 +
S261 + S262 — the S258 phase round archived); mirrored to the sandbox worklog
per Agents.md.

**Next:** UNCHANGED from S261 — the owner sends (a) a Hibana-account CF token
with D1 write (for the dev seed+purge) and (b) the test account login
(S259_LOGIN/S259_PASS) → the short follow-up runs both legs verbatim (dev:
seed → probe → purge, 0 users / 0 orphan archives D1-verified; prod: probe
with the test account, language restored, probe project trashed) and appends
the verdict. Also: rotate/re-paste the block's second CF token (still failing
verify), and note the rotate.mjs DEBT row for a future micro-fix session.

## Session S263 — the S261/S262 follow-up: BOTH authed live legs RUN AND GREEN (2026-11-10)

**The round:** the owner's follow-up with the credential gap finally closed —
the block carried a genuine HIBANA-account CF token + the test account login.
Objective verbatim from the prompt: run `scripts/live-s259-probe.mjs` against
dev and prod expecting 58/58 each; dev seed → probe → purge with the 0-users /
0-orphan-archives D1 verification; prod with the test account, language
restored, probe project trashed. No code changes; failures would go to DEBT.md
first. **Verdict: dev 58/58 + prod 58/58 — (B4) PASS both — drift NONE.**

**1. The credential self-check (the prompt's own gate) — PASSED:** the CF
token verifies ACTIVE and sees exactly ONE account, `Aliassadi@live.com's
Account` (6ff25b58…), whose D1 list carries **pm-app-prod (d842fcb5-…) +
pm-app-dev (80e02ce2-…)** — the exact UUIDs S262 recorded as the Hibana D1s
(the Currena block's empty-list/7404 failure mode re-checked and ABSENT). D1
REST read + write both proven live on pm-app-dev this session.

**2. THE DEV LEG — seed → probe → purge → D1-verify, ALL GREEN:**
`live-s259-devseed.mjs seed` (probe-s259-dev@hibana.local, the app's exact
PBKDF2 shape) → **58/58 ALL GREEN incl. (B4) PASS** (the S260 tag-chip
regression guard) — carriers (health ok / schema 66 / sw v465), the whole
login → projects → detail → kanban → sprint journey, the Phase-3/4/5
contracts, the {en,fa}×{light,dark} matrix + 390px legs, zero page/console
errors → `purge` → D1 REST verified: **probe users 0 · orphan archives 0 ·
users back to the 6 baseline** (projects 7, the pre-session count; the purge
cascade removed the probe project whole).

**3. THE PROD LEG — 58/58, with one honest ops incident (operator error,
remediated + verified in-session):** the FIRST run was killed mid-journey at
check 29 by the session's own `| head` output pipe (SIGPIPE) — the finally
block never ran, leaving the account language flipped to `en` + one un-trashed
probe project (b269a3c4…). Remediation, all through the app's REAL API (the
probe's own mechanism — login → PATCH /api/settings → DELETE /api/projects/:id,
no direct D1 writes): language restored to the account's ORIGINAL `fa` (the
S256-supplement record: "the loop ends on 'fa' and prod is the owner's real
account"), orphan project trashed — then the CLEAN re-run completed:
**58/58 ALL GREEN incl. (B4) PASS**, the probe restoring the language to `fa`
and trashing its own project in the finally block. Final state D1-verified:
**lang_now fa · 0 alive probe projects · 0 orphan archives** (5 trashed
S259-regression projects in total — 3 from earlier sessions + this session's
two; trash is the designed flow, the 7-day cron purges).

**4. Drift found: NONE.** No DEBT.md rows added (the 8 stand, incl. row 8);
no code changes (runtime stays v0.4.1.52 @ ea549418; package untouched); the
ladder not re-run (runtime bytes identical to S260's green ladder — the two
live legs re-proved the behavior on the REAL deployed workers, which was
exactly the slice S261/S262 could not reach). The counts stand CURRENT from
S260: vitest 1003/1003 · i18n 1711/1711 · e2e 518/518 · sw hibana-v465 ·
schema 66/0067.

**5. Ritual notes:** DEBT row 8 (rotate.mjs §1-drop) stays QUEUED for a
ladder-capable session per the prompt — this close rotated the §1 chain
MANUALLY again (S259 dropped, S260 kept; the tool's same-version collision
now LOAD-BEARING: all four chain blocks share v0.4.1.52 after this close, so
the NEXT docs-only close without the fix would hit the bug). Healthcheck ping
(via the REAL management-API per-check URL, the S253/S256 doctrine — the
block's `…/hibana` slug path stays unused) + Telegram notify (owner chat)
DELIVERED this time. No zip (docs-only round, no version bump). Mirrored to
the sandbox worklog per Agents.md.

**Next:** the queue is EMPTY — dogfood v0.4.1.52 + desktop v0.1.55. The one
named follow-up is DEBT row 8's micro-fix session (the rotate.mjs one-liner +
the fixture-chain verify + the ladder); a candidate hardening noted in chat:
the probe could guard its cleanup on abnormal termination (this session's
pipe-kill incident is the case study).

## Session S264 — DEBT row 8's micro-fix: the rotate.mjs §1-drop one-liner + guard (2026-11-10)

**The round:** the owner's prompt — the one named follow-up from S263 (DEBT row 8).
Objective verbatim: fix the §1-chain drop's same-version collision (the drop pins by
version + first match; with all four chain blocks sharing v0.4.1.52 after S263 the
relabel makes both the 3rd and 4th blocks match, and the drop deletes the NEWER block),
anchor on the LAST match or pin by the pre-relabel session label, add a guard asserting
the dropped header mentions the expected session, verify against a fixture chain with
duplicate adjacent versions (a copy of the real Changelogs §1 chain), run the
verification ladder, close per §12.4. One fix only — anything else found goes to DEBT.md
first (nothing else was found).

**1. The fix (`47e39c73`, scripts/rotate/rotate.mjs, +26/−3):** the drop anchors on the
LAST match (`lastIndexOf`) — the chain is newest-first, so the pre-relabel 4th block is
the LAST `## 1-prev-prev-prev. Current state (v…` header in the file; a same-version
relabeled 3rd block sits EARLIER (the old first-match indexOf deleted that NEWER block).
Plus the guard, pinned BEFORE the relabel: the 4th block's header line is captured
byte-exact + its session marker extracted (`— S<NNN>,` / legacy `— Session <NNN> (` —
the marker invariant verified across every chain block since the chain's birth); the
dropped header must be byte-identical to that line AND mention its session, else abort
with the file untouched. Supporting change: `at: m.index` recorded per block (the
discovery regex already yielded it — the worklog mode's own pattern). Nothing else
changed: the worklog mode, the relabel steps, the insert anchor, the prose caps, the
dry-run — all untouched (the relabel/insert steps are label-pinned and provably never
cross-match even at equal versions — analysis in-session).

**2. The fixture matrix — 24/24 GREEN** (session-time harness at
`/home/z/debt8-fixture`, not committed; inputs = copies of the REAL Changelogs.md):
- **T1 REPRO (the pre-fix tool from git HEAD, on the real all-v0.4.1.52 chain):**
  exit 0 — the corruption is SILENT — the chain comes out 264,263,262,**260**: the
  NEWER S261 block deleted, S260 wrongly kept as the bottom block. DEBT row 8's
  finding demonstrated on the real bytes.
- **T2 FIX (the same input through the fixed tool):** 264,263,262,**261** — the 4th
  (S260) dropped, the NEWER S261 kept, labels exact, row 264 prepended newest-first,
  §3+ tail byte-identical.
- **T3 GUARD (the fixed tool with the anchor regressed back to first-match):** the
  guard FIRES ("drop guard failed … expected session S260"), exit 1, the file
  byte-untouched — the guard independently catches the failure mode.
- **T4 REPLAY (the finding's own historical shape):** the REAL e11bd2b5 (S261-close)
  file — S259 v0.4.1.51 over S258 v0.4.1.51, exactly where S262 found the bug — plus
  the REAL S262 body/row → **byte-identical to 76693ff4** (the manually-verified S262
  close): the tool now reproduces the manual rotation exactly.
- **T4b REPLAY (mixed versions):** the REAL 76693ff4 + the REAL S263 body/row →
  **byte-identical to 21cf8c46** (the S263 close).
- **T5 MIXED (synthetic):** the 4th block at a different version (no collision) — the
  normal path drops the 4th correctly.
- The PERMANENT regression check is the guard itself — it runs on every future
  rotation and aborts before any damage (AGENTS.md §4's doctrine satisfied in-tool; a
  committed vitest pin would churn the 1003-count pins for a scripts-file outside the
  suite's src/tests scope — deliberately not added).

**3. The ladder GREEN, in order:** `npm run verify` (tsc strict → eslint 0 → vitest
**1003/1003** → prod build → portability → fn-shape → boundaries) + cache-bust PASS +
i18n **1711/1711** + precache (2349 KB / 2350 budget) + bundle-size (+0.3%) +
`node --check` on the touched JS + e2e **518/518 as 6 sequential shards
(90+86+89+81+89+83), ZERO flakes** (the canonical-tree contract — build --restore-html
first; the FA/EN × light/dark × desktop/390px matrix lives inside the suite) + the
workers smoke ALL PASS (local miniflare, real CF creds).

**4. The push + BOTH live legs (§14's tail):** CI SKIPS `scripts/rotate/**` pushes by
design (paths-ignore — the GitHub API confirms 0 workflow runs on `47e39c73`), so
NOTHING deployed and CD never fired: the standing workers are byte-identical to S260's
green release (the designed docs-lane). Both live legs then re-ran GREEN on the REAL
workers with this block's credentials:
- **DEV:** seed (`live-s259-devseed.mjs`, probe-s259-dev@hibana.local) → **58/58 ALL
  GREEN incl. (B4) PASS** → purge → D1 REST verified: **0 probe users / 0 orphan
  archives / users back to the 6 baseline (projects 7)** — S263's post-close state
  exactly.
- **PROD (test account):** **58/58 ALL GREEN incl. (B4) PASS**, zero page/console
  errors, the finally block green (no SIGPIPE this time — output to file, never
  piped): language restored to **fa** + the probe project trashed; final D1 state:
  lang fa · **0 alive S259-regression projects** · 0 orphan archives (trashed probe
  total 6 = S263's 5 + this session's one; trash is the designed flow, the 7-day cron
  purges).

**5. THIS close's §1 rotation ran through the FIXED tool — the live end-to-end proof:**
all four chain blocks shared v0.4.1.52 (S263/S262/S261/S260), so dropping S260
exercised EXACTLY the fixed same-version path on the REAL file (S262/S263 had rotated
manually precisely because of the bug): chain now S264/S263/S262/S261, row 264
prepended, verified after the edit. The worklog rotated to the newest 4 (S261–S264;
the S260 phase round archived).

**6. Drift found: NONE.** No other code touched (the session's red line); no new DEBT
rows (row 8 CLOSED & removed — the repo's second-ever DEBT resolution, the closure
recorded in the commit message + here + Changelogs; 7 rows stand); runtime stays
**v0.4.1.52 @ ea549418** (package untouched; the S201 rotate.mjs precedent — no version
bump, no zip). Desktop: NO change needed — rotate.mjs is a source-repo docs tool, not
island bytes; no public/js/css/HTML touched → no §12.3 re-pin (desktop stays v0.1.55 @
island ea549418; verified the desktop repo carries no rotate.mjs copy).

**Ritual notes:** healthcheck ping DELIVERED (the REAL management-API per-check URL,
the S253/S256 doctrine — the block's slug path stays unused; HTTP 200, the check's
last_ping moved to 2026-11-10T04:49:36Z; ops note: the management API accepts the
`X-Api-Key` header — the `Authorization: Bearer` form 401s on these keys). Telegram
notify NOT DELIVERED — the block's bot token fails `getMe` with 404 (invalid — the
hash is 34 chars vs Telegram's usual 35, likely truncated in the paste; S263's block
carried a working one): flagged to the owner for a re-paste, the notify can ride the
next session's close (the S261/S262 flag-the-failing-credential precedent). No zip
(script-only round, no version bump); mirrored to the sandbox worklog per Agents.md;
spec §14 gains the S264 row.

**Next:** the queue is EMPTY — dogfood v0.4.1.52 + desktop v0.1.55. Standing candidate
(NOT queued, S263's chat note): the probe could guard its cleanup on abnormal
termination (the S263 pipe-kill is the case study) — say the word and it becomes a
DEBT row.
