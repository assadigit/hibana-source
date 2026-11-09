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

## Session S256 (supplement) — the re-sent prompt's round: the authed live visual pass + the close ritual's credential-dependent halves (2026-11-08)

**The situation:** the owner re-sent the Phase 5 §13 prompt with a FRESH credential
block (the prod test account + the D1-correct Cloudflare account + the healthchecks
management/read keys + the Telegram bot token). By the time this session cloned, a
parallel S256 run had ALREADY shipped and closed the phase (836cc18e→6db3ae9,
v0.4.1.49 live; desktop v0.1.50 re-pinned + released, all 14 probes green) — its
honest gap: its own credential block carried a Cloudflare token for the WRONG
account (the devseed's `d1 execute` 404s) and NO prod test account, so the authed
live visual matrix + the zip + the healthcheck ping + the Telegram notify never ran.
This session detected the duplication at push time (rejected, non-fast-forward — no
history rewrite per §0.2), reset to origin/main, and closed EXACTLY those gaps:

- **THE AUTHED LIVE VISUAL PASS (§8 step 5, the phase's missing leg):** the probe's
  PART B unlocked on prod (explicit PROBE_LOGIN/PROBE_PASS — `scripts/live-s256-probe.mjs`
  now runs the visual matrix on prod when the test account is provided, and RESTORES
  the account's language_pref after: the loop ends on 'fa' and prod is the owner's
  real account). **PROD 67/67** (the test account: 16 legs = {en,fa}×{light,claude-dark}×
  {board,sprint,projects,project} — the bundles parse 4048/4098 rules, the theme
  tokens paint, FA flips dir=rtl, content renders, ZERO page errors; the probe
  project soft-deleted; the language restored) and **DEV 67/67** (the seeded probe
  user — the devseed ran with THIS block's `6ff25b…`-account token, the exact
  credential the parallel session lacked; the probe user + archive orphans purged
  after: 0 users / 0 orphans).
- **THE ZIP:** `hibana.0.4.1.49.zip` → the sandbox download folder (wired-HTML
  build, 681 tracked + 80 dist files, integrity OK, **secret-scan CLEAN** — every
  credential value from the block scans zero; the ghp_/cfut_ grep hits are the ops
  scripts' own regex literals + redacted history prose, verified by inspection).
- **THE HEALTHCHECK PING:** via the **REAL per-check URL from the management API**
  (the "Hibana" check, slug e24cc4eb…, its API-served ping_url pinged → HTTP 200 →
  last-ping moved to 20:18:37Z — NOT the credentials block's guessed
  `…/<pingkey>/hibana` slug path; the S253 doctrine re-confirmed: the block's
  slug-path URL is not the check's real ping URL).
- **THE TELEGRAM NOTIFY:** delivered to the owner-role chat (the app's own routing —
  the linked chat resolved from prod's telegram_captures; sendMessage HTTP 200).

**The parallel-implementation note (honest):** this session had independently built
and fully verified a parallel FE-5/FE-13 round before the fetch revealed the closed
phase (998/998 vitest + 510/510 e2e + a mobile Lighthouse before/after + a 114-check
local visual rehearsal). It was NOT pushed — the phase was closed and §0.2 forbids
rewriting published history — and is preserved locally on branch
`s256-parallel-superseded` for reference. The shipped design stands.

**Next:** unchanged — Phase 6 (S257), Backend modularization.

## Session S256 (verification pass) — the prompt's third send, re-verified (2026-11-08)

The owner's Phase 5 §13 prompt arrived a THIRD time, after the phase was already
executed and closed (`836cc18e`→`6db3ae94`, v0.4.1.49 live), supplemented
(`b2bfea2c` — the authed live visual matrix dev 67/67 + prod 67/67, the zip, the
healthcheck ping via the real management-API URL, the Telegram notify), and
desktop-re-pinned (v0.1.50, ALL 14 probes; v0.1.51 rode the worklog push — the
same island). Correct behavior per the S253 precedent: **RE-VERIFY, never
re-execute** — the bundles are live on both workers and re-running a closed round
would churn settled budgets, carriers, and releases for nothing. The re-check,
all green in this session:

- **Repos:** fresh clones, local == origin/main on both (web `b2bfea2c`, desktop
  `d024400`), clean trees; docs complete and consistent (worklog S256 +
  supplement, Changelogs row 256, spec §14 DONE row).
- **Live carriers, BOTH workers (fresh, unauthed):** health ok / db up /
  `schema_version 66`; sw.js `hibana-v463`; `dist/bundles.json` serving both
  ordered part lists; each of the four Projects pages carries exactly ONE bundle
  link (board+sprint → `board-bundle.41b1eacb.css`, projects+project →
  `projects-bundle.253b3917.css`); both bundles 200 immutable with IDENTICAL
  hashes across dev+prod; the concatenation order proofs hold on the live bytes
  (rtl's rules at board-bundle's tail — its last `dir=rtl` at 99.99% of the
  file; magic-wand after rtl in projects-bundle).
- **Desktop:** PIN_REF `6db3ae94` / PIN_PACKAGE_VERSION `0.4.1.49`; desktop.yml
  WEB_REF+WEB_VERSION twins together; releases v0.1.50 + v0.1.51 both carry
  "island @ 6db3ae94" with the full asset chain (checksums.txt + installer +
  portable zip).
- **The lanes:** automated backup lane fresh (latest snapshot
  `2026-11-08T15-23-25Z`, ~5 h old — the 21:23 UTC tick had not fired yet);
  healthchecks.io: all three checks UP ("Hibana" last ping = the supplement's
  20:18:37Z); dev D1 residue: 0 probe users, 0 orphan archives (the supplement's
  purge held).

This pass then re-delivered the close ritual's artifacts for THIS sandbox (the
previous sandbox's copies are not reachable from here): the per-version zip
(`hibana.0.4.1.49.zip` → the sandbox download folder, wired-HTML build,
integrity OK), a fresh healthcheck ping (the real per-check URL from the
management API), and the Telegram notify to the owner chat.

**Next:** unchanged — Phase 6 (S257), Backend modularization (the devboard
split, BE-11/13/14/15/16/17, FN-ALLOWLIST re-pins) — zero route-path changes,
desktop no-op by design.

## Session S257 — Phase 6: Backend modularization (2026-11-08)

**The owner's ask, verbatim:** the §13 next-session prompt for Phase 6 (S257) of the
owner-approved AUDIT-REMEDIATION-SPEC — the behavior-neutral devboard.ts split,
executed EXACTLY per §9, with the atomic same-change obligations, the full §12.2
ladder, the dev→smoke→prod→smoke deploy round, the desktop no-op noted per §0.5,
BE-20 explicitly backlog, and the §12.4 close.

**Anchor re-verification (the spec's own warning):** the spec was written at
`71808075` (devboard.ts 1,337 ln); phases 1–5 landed since — HEAD `d0d95a8f`
carried devboard.ts at **1,511 ln** and **33 endpoint registrations** (the spec's
"31" pre-dates S255's `GET /api/sprints/:id/doc`; at the spec's own commit the file
had 32 — the "31" was a pre-existing minor miscount, honestly recorded). The FN
pins had also drifted: **5** devboard.ts pins (spec said four) + the S253-born
archive-done pin, plus the helpers' setTaskTags. All re-verified before editing.

**The split (commit `e7a2a91d`):** `src/routes/devboard.ts` DELETED, carved by
feature into `src/routes/devboard/{index,schemas,board,tasks,sprints,strategies,
archives,misc}.ts` — all 33 paths byte-identical, mounted at `/` via `app.route`,
`app.ts`'s `import … from './routes/devboard'` resolves to the new index
**untouched**. `devboard-helpers.ts` stays the shared domain layer (its 3
importers + the s241 test import unchanged). The dedups in the same atomic change:
- **BE-11** `categoriesForProject` → `lib/categories.ts` (the byte-identical SQL
  the board GET + the detail pool each carried — diffed before extraction).
- **BE-13** the reorderSchema name collision dissolves: `devtaskReorderSchema`
  (devboard/schemas.ts) vs `projectReorderSchema` (validation/schemas.ts; the one
  importer re-keyed). Quicknotes'/sadhana's own same-named schemas are different
  findings, untouched (out of the audit's flagged pair).
- **BE-14** `buildUpdate()` — the ×4 SET-builder (devtasks PATCH loop + the two
  sprint PATCH arms ride it; **projects PATCH's loop keeps its own shape**: its
  undefined→null belt is different grammar from the skip-undefined entries loop —
  forcing one shape would change belt behavior; documented at the helper).
- **BE-15** `assertNoActiveSibling` + `assertLatestSprint` → devboard-helpers.ts
  (the ×4/×2 verbatim guards; Response-returning, byte-identical verdicts).
- **BE-16** `touchProject` (the ×18 project-stamp — the byte-identical
  `cfg.db.execute` shape rides the helper at 15 sites: devboard ×9, core/media ×3,
  core/links ×2, core/hurdles ×1; hurdles' two queued `tx.sql` sites + module.ts's
  two user-scoped variants keep their own statement, documented) + the
  rate-limit body ×2 + glance query ×2 folds (local helpers in projects/index.ts).
- **The carves:** PATCH-sprint's 127-line FN pin DISSOLVES (the handler is a thin
  dispatcher + `patchDraftSprint` / `startedSprintSets` / `patchStartedSprint`,
  each under the bar — the spec's own ask); archive-done's fold rides archives.ts's
  `foldTagSnapshots` (the SHARED snapshot builder /finish uses too) and its
  63-line pin dissolves. **FN pins: 6 → 4** (devboard.ts's 5 → board 102 /
  tasks 73 / sprints 143; setTaskTags stays by design; 2 dissolved) — recorded
  before/after. FILE-ALLOWLIST: the sprints.ts row (556 ln, the one module over
  ~400) replaces the retired monolith row.
- **The two documented test read-target updates** (the ONLY test edits):
  acceptance-s247's contract-mirror block reads the new modules; sprint-ui-s243's
  archives twin reads archives.ts. Every behavioral test UNTOUCHED — proven by the
  suite.

**The ladder (all green, in order):** tsc strict → eslint 0 → vitest **998/998** →
prod build → portability → fn-shape (PASS, pins re-keyed) → boundaries →
`node --check` on every moved/touched file (Node 24 type-stripping — verified
genuine: a broken temp file exits 1) → cache-bust + i18n 1707/1707 + precache +
bundle-size + css-bundles + dist-wiring → workers-runtime smoke (PBKDF2 + login +
render on the real Workers runtime) → **e2e 510/510, zero flakes** (24.5 min, the
Playwright browser installed fresh in this sandbox).

**Live (the §9.6 round):** push `e7a2a91d` → CI green → CD deployed dev AND prod
(its own dev probe gates the prod step). The new `scripts/live-s257-probe.mjs`
(the S255 pattern): a **63-check smoke** over ALL six modules — (A) health ok +
schema 66 + sw v463 unchanged, (B) the eight-key board payload + lean + the
304 stamp round-trip, (C) task create/labels/deps family (idempotent/self/cycle)/
tag add-remove/PATCH-done/reorder/archive-done, (D) the paged archives + restore-
labeled + delete, (E) the FULL sprint lifecycle (draft arm + dates-rejection belt
→ start → started arm: extend→closed, reopen via null end → the one-active 409 on
a second draft's start → pause → resume → finish → the completed-sprint DELETE
refusal), (F) strategies (create/PATCH/case-twin 409/assign/completion-guard 409/
complete-after-pause/delete), (G) the category quick-add (new + case-insensitive
reuse), backlog docs, project tags, the htmlx ping, (H) the browser boots on
/kanban + /sprint.html (one lean GET each, zero page errors). **Local rehearsal
63/63 → dev 63/63 (the seeded probe user, purged after: 0 users, 0 orphan
archives) → prod 63/63 (the test account; probe project soft-deleted)**. Prod
error_log 0 rows since the deploy.

**Desktop: NO-OP by design (§0.5/§9.7)** — zero island files touched (no
public/js, public/css, or HTML change in the diff; the desktop bridge is
path-based and every path is byte-identical; per-path ETags ride the version
stamp, also unchanged). The desktop repo received no commit; the island pin
stays `6db3ae94` @ web v0.4.1.49 — noted here as the phase's explicit written
parity record.

**BE-20 (detailHtml carve-up): stays backlog** per §9.8 — not attempted.

**Version:** 0.4.1.49 → **0.4.1.50**. Commit: `e7a2a91d` + this close.

**Next:** Phase 7 (S258) — UI/UX polish (FE-6 focus trap, FE-9 the strategy
filter strip, FE-11 scoped clear-done, FE-17 sidebar state, FE-18 keyboard lane
move) — an island round → the desktop re-pin + release.

## Session S257 (verification pass) — the re-sent prompt's round, re-verified (2026-11-09)

The owner's Phase 6 §13 prompt arrived AGAIN, after the phase was already executed
and closed (`e7a2a91d` + `0771db73`, v0.4.1.50 live, §14 DONE). Correct behavior per
the S253/S256 precedent: **RE-VERIFY, never re-execute** — the split is live on both
workers and re-running the carve would churn settled code, pins, and the release for
nothing. The re-check, all run fresh in this session's sandbox:

- **Repo:** fresh clone, local == origin/main (`0771db73`), tree clean; docs complete
  and consistent (worklog S257, Changelogs row 257, spec §14 DONE row 6).
- **The split re-proven on the bytes:** `src/routes/devboard.ts` gone; the 8 modules
  present ({index,schemas,board,tasks,sprints,strategies,archives,misc}.ts); ALL 33
  endpoint path registrations extracted from BOTH the pre-split monolith
  (`git show e7a2a91d~1`) and the new modules — the sets diff EMPTY (the 33rd is
  `app.all('/api/devboard/ping')`, invisible to a get/post/patch/delete-only regex —
  the honest reconciliation of the close's count); index.ts mounts the six sub-routers
  at `/` behind ONE `requireAuth` exactly as spec'd.
- **The dedups re-proven in place:** BE-11 `categoriesForProject` (lib/categories.ts,
  both board.ts + detail-helpers.ts ride it), BE-13 `devtaskReorderSchema`/
  `projectReorderSchema`, BE-14 `buildUpdate` (helpers:50; sprints×2 + tasks + 
  strategies), BE-15 `assertNoActiveSibling`/`assertLatestSprint` (×4/×2), BE-16
  `touchProject` (15 call sites) + the rate-limit ×2 + glance ×2 folds in
  projects/index.ts; FN-ALLOWLIST re-keyed 6→4 (board 102 / tasks 73 / sprints 143 +
  setTaskTags; 2 dissolved; 4 drift-re-anchors) and FILE-ALLOWLIST's sprints.ts row.
- **The only two test edits re-proven read-target-only:** acceptance-s247 + 
  sprint-ui-s243 — the diffs move WHICH file is read, never what is asserted.
- **Ladder re-run green:** `npm run verify` EXIT 0 (tsc strict, eslint 0, vitest
  **998/998**, prod build, portability, fn-shape, boundaries) + cache-bust + i18n
  1707/1707 + precache (+8 KB headroom) + bundle (0.0%) + css-bundles + dist-wiring
  + workers-runtime smoke + parse-check on every moved file. **e2e 510/510**: this
  sandbox is ~4× slower, so the suite ran as 6 sequential shards — 509 passed in
  shards + the ONE non-split-related timing flake (s120-draft-flush notes-autosave
  convergence under shard load) re-run in isolation: **4/4 green** — de-flaked by
  proof, not by retry-blindness. (The Playwright browser was installed fresh — the
  first 508-failure round was the missing binary, environmental.)
- **Live re-proven on BOTH workers:** latest deployments 2026-11-08T23:52 (dev+prod —
  the close push's CD); health ok/db up/schema 66 on both; `live-s257-probe.mjs`
  (the 63-check smoke): **local 63/63** (scratch Node server + seeded user) → **dev
  63/63** (probe user seeded via D1 with this block's token, PURGED after: 0 users /
  0 orphan projects / 0 archives) → **prod 62/63**: the single FAIL is
  `(G) category quick-add creates (201) — 200` — PROVEN benign: the user-scoped
  category library on the test account already carries `S257 Probe Cat` (created
  2026-11-08T23:34:02Z by the close session's own prod probe run; `projects: 3` now),
  and the 200 is the DOCUMENTED S152 existing-reuse shape
  (`{"ok":true,"id":"…","existing":true}` — verified by a direct API round-trip);
  the follow-up case-twin reuse check passes with the exact expected shape. NOT a
  regression — a stale expectation when the probe re-runs against the same account.
  Prod error_log: **0 rows** (24 h window).
- **Desktop re-proven NO-OP:** repo == origin (`d024400`); island pin `6db3ae94` @ 
  web v0.4.1.49 unchanged; desktop.yml twins together; releases v0.1.50 + v0.1.51
  both carry "island @ 6db3ae94" with the full asset chain.
- **Close ritual re-delivered for this sandbox:** `hibana.0.4.1.50.zip` (806 files,
  integrity OK, secrets-scanned clean) → the sandbox download folder; healthcheck
  ping via the REAL per-check URL from the management API (the "Hibana" check
  `9cb70b04…` → HTTP 200, last_ping moved to 2026-11-09T01:18:23Z — the block's
  slug-path URL was NOT used, the S253 doctrine); Telegram notify delivered to the
  owner's linked private chat (resolved from prod's telegram_captures → 92788333,
  sendMessage ok, message_id 152).

**Honest residue note:** the prod test account's category library still carries the
probe-created `S257 Probe Cat` row (from the close session's run; harmless, invisible
outside the category library) and three trashed `S257 …` probe projects (trash; the
7-day cron purges). Nothing was deleted from prod beyond the documented probe flow.
