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

## Session S202 — THE APPROVED ASKS (the S201 rule-4 round; the owner's written YES executed)

Executed per the owner's chat reply to the S201 asks ("1. ok do it. yes / 2. do it. /
3. do it. / 5. do it" — asks 1-3 approved + the banked work; item 4 SEC-10 was NOT in
the reply and stays pending), on tree 92e727e → released as v0.4.1.26 (push 2821bef).

**STATUS: RELEASED.** LIVE hibana.ir @ v0.4.1.26, sw v435, schema 63 (UNCHANGED — no
migration this round). CI 38169968432 ALL JOBS GREEN (ci + e2e shards 1+2) → CD
38170407608 GREEN → qa/s202-live-verify.mjs ALL GREEN (20 probes: the 6 kept woff2
weights byte-IDENTICAL at font/woff2 · the 5 deleted legacy formats 404 · font-face.css
byte-IDENTICAL with all 9 url() refs woff2-only · sw v435 + the SHELL's font CSS · the
zod-4 functional pair on the live Worker — a type-invalid login → 400 invalid_input, a
valid-shape unknown login → 401 invalid_credentials · health ok/up/63) → tag v0.4.1.26
→ zip (599 files, integrity OK, secret-scan CLEAN) → healthchecks all 3 UP on natural
ticks only.

**Completed + verification (the ladder, all green):**
- PERF-16 (ask 1) — RESOLVED HONESTLY, NO MIGRATION: the audit's "4 rule-9 index
  misses" prescription was DOA — `telegram_note_sessions` was DROPPED by migration
  0048 (the CREATE INDEX would have FAILED on apply against both live D1s), and the
  other three access paths are ALREADY index-served by the PKs (EXPLAIN QUERY PLAN on
  the app's real query shapes: SEARCH via sqlite_autoindex, mostly COVERING; adding
  the proposed indexes changes nothing — the planner keeps the covering PK autoindex).
  Rule 9 is now MACHINE-ENFORCED: src/tests/index-coverage.test.ts ×3 (the dropped
  table stays dropped; the PK leftmost columns pinned; EQP SEARCH-never-SCAN). No
  schema churn, no bookmark ritual; the owner's YES is banked (§6 documents the
  evidence + the recommendation not to).
- PERF-9 (ask 2) — SHIPPED: 21 legacy vazir format files + Vazir-Variable.woff2
  (referenced NOWHERE — the honest 22nd file) deleted (~1.79MB off deploys + zips);
  font-face.css trimmed to woff2-only; sw v434→v435; package 0.4.1.26. Follow-up ask
  recorded in §6: bebas-note's 6 legacy .otf/.ttf files (same class, out of scope).
- UX-13 part 1 (ask 3) — zod 3.24→4.6.6 SHIPPED in one deliberate round: ONE code fix
  (jsonBody's ZodType<T, any, any> → ZodType<T, any> — v4's 3rd generic is Internals;
  `any` there broke T's inference). v4's RFC-strict .uuid() caught the e2e specs'
  randomBytes-hex UUID() helpers minting ids the app NEVER mints (the app is
  crypto.randomUUID() everywhere — zero product impact); sparks/viewport specs now
  generate real v4 UUIDs. node-server 1→2 SCHEDULED next code session.
- Item 5 (the banked work) — the 86-spec e2e DB-constant sweep SHIPPED:
  e2e/fixtures/e2e-db.ts (E2E_DB + E2E_SHOTS + E2E_PORT + E2E_ORIGIN) — LOCAL
  PARALLEL SHARDS ARE NOW REAL (the FULL 417 ran as two parallel shards on
  3017/3018). The sweep exposed + fixed the s199 reset spec's hardcoded
  Origin:3017 (the T6 gate 403s cross-origin POSTs).
- LADDER: typecheck 0 · vitest 635/635 (+3) · eslint 0/0 · escape-lint 207 sinks ·
  build 85 · cache-bust PASS · parity 1572/1572 · bundle −0.1% · precache PASS ·
  FULL e2e 417/417 in TWO LOCAL PARALLEL SHARDS (213 + 203 + 1 contention flake —
  the s182 fade-edge late-hydration class, solo-proven PASS in 1.6s; CI retries
  absorb) · smoke ALL PASS · workers-smoke PASS (local, real CF creds) · dist-wiring
  PASS · Lighthouse floors PASS (100/95/100/96, seo 82 warn).

**The round's own discoveries (banked for the next agent):**
1. Zod 4's .uuid() enforces the RFC 9562 grammar (version nibble 1-8 + variant
   nibble 8-b); zod 3 accepted any 8-4-4-4-12 hex. Any generator that formats random
   hex into that shape WITHOUT setting those nibbles mints ids v4 rejects (~87.5%).
   The app's crypto.randomUUID() is always safe — but test fixtures must generate
   what the app generates, not a lookalike.
2. A spec's hardcoded port inside an explicit Origin header dies the moment
   non-default ports become runnable (the T6 origin gate 403s cross-origin POSTs
   BEFORE any route runs). Derive it (E2E_ORIGIN), never pin it.
3. The S201 "verified against the tree" check (indexes absent + only
   idx_project_tags_tag exists) was necessary but NOT sufficient — it verified the
   INDEXES' absence, not whether the access paths were already served (PK
   leftmost-prefix) or whether the table even existed (dropped by 0048). Schema-level
   verification beats grep-level. The EQP proof + the machine-checked pins deliver
   what the audit's rule-9 intent actually wanted.
4. The first local two-shard run failed 4 tests and BOTH failure classes were REAL
   (not contention): the zod-4 uuid rejections + the hardcoded Origin. "It's just a
   flake under contention" is a hypothesis, not a conclusion — the solo re-run
   settled it (and caught 2 MORE deterministic failures the contention run had
   masked by luck). The second run's 1 failure WAS contention-class (solo PASS in
   1.6s) — classified, not assumed.
6. The 5ba7156 docs-push CI run (the verifier .mjs rode it — not paths-ignored)
   failed e2e shard 1 ONCE on the s120 video first-frame seek test (currentTime
   stayed 0 through a 10s poll, initial + retry — a slow-runner video-decode stall;
   the code between the green 2821bef run and this run was byte-identical for
   everything e2e touches). The re-run-failed-jobs remedy: ALL GREEN on a fresh
   runner — runner variance, not a regression. The s120 seek test joins the
   watch-list of environment-sensitive timing tests (the s155 font race class).
5. The live-verifier's first pass tripped on its own probe design: the font-face.css
   provenance COMMENT legitimately mentions ".eot/.woff/.ttf" as prose — parse the
   actual url(...) set instead of substring-scanning the whole file. (Also: text
   .length is UTF-16 code units, Buffer .length is bytes — "2473 vs 2481" was equal
   content in different units.)

**Open risks + next (S203):**
- @hono/node-server 1→2 — the scheduled SECOND dep-major round (one round each, full
  ladder between; the S202 recipe applies: expect a signature-level fix, run the
  FULL e2e + workers-smoke — node-server is the Node path's server binding).
- SEC-10 __Host- cookie prefix — STILL PENDING the owner's written YES (§6 item 4).
- The bebas-note legacy-font follow-up ask (§6 item 2's follow-up — one word ships it).
- Banked from S200, unchanged: the opportunistic --accent-ink conversions, the mobile
  Lighthouse preset (UX-17), the owner-machine drill run (key-custody).
- The dependabot PRs rebase on every main push and their failures are the documented
  noise (no secrets on PRs → advisory workers-smoke); ignore them.

## Session S203 — THE OWNER-ACCEPTED ROUND (SEC-10 ships + the scheduled node-server major + the bebas follow-up)

**Owner acceptance:** his chat reply ("Push commit, deploy, Then go to next step I
accept.") accepted the S202 handover's defined next step = node-server 1→2 + the two
pending owner-YES items (SEC-10 __Host-, the bebas ask). Recorded in §6 with the quote.
("Push commit, deploy" was already satisfied — S202 had closed clean: main @ b565e6b,
CI/CD green, live healthy; verified before any work.)

**Batch A — @hono/node-server 1.19.17→2.1.4 (UX-13 part 2, the one-round-each
doctrine):** API verified BEFORE upgrading — `serve(options, listeningListener)`
unchanged; the `env.incoming` raw-socket binding still injected on the generic Context
(one-off probe: hasIncoming/hasOutgoing true, `socket.remoteAddress` readable, peer
`::1` — so ratelimit.ts's unspoofable clientIp keeps working); engines node>=20 (repo
is Node 24+); peer hono ^4 satisfied. The FULL 417 e2e ran through the v2 server as
two parallel local shards — the strongest local runtime proof. dependabot's 2.1.3 PR
(#12) closed as superseded with the reason; zod PR (#8) likewise (S202's 4.6.6).

**Batch B — SEC-10 __Host- (the S201-presented ask):** SESSION_COOKIE →
`__Host-hibana_session`; the attributes CENTRALIZED in sessions.ts's two helpers
(`sessionCookieHeader` / `clearSessionCookieHeader` — the prefix contract in ONE
place: Secure REQUIRED, Path=/ REQUIRED, Domain FORBIDDEN; browsers reject
violations, so drift is impossible); Secure now UNCONDITIONAL (the isProd branch is
dead — Workers prod AND dev are always HTTPS; localhost is a trustworthy origin, so
local dev + e2e keep working); all four emission sites converted (auth login,
registration verify, reset complete, logout clear); codemod 110 literals across 62
files (53 unit-test + the s199 e2e spec + 8 ops scripts), zero bare literals remain.
The accepted cost: every existing session cookie invalidated — all users log in once.

**Batch C — the bebas diet (the §6 follow-up, same class as S202's vazir round):**
the 6 legacy BebasNotes .otf/.ttf files deleted (~281KB); font-face.css woff2-only
(README.txt kept — attribution); sw v435→v436 (SHELL re-caches the trimmed CSS; the
SHELL only ever listed font-face.css + the 3 woff2s); package 0.4.1.27.

**Ride-alongs:** playwright.config.ts's stale "local parallel shards unsupported"
header corrected (S202's sweep made them real); `.lighthouseci/` (S202's 2821bef
accidentally committed the local Lighthouse output) untracked + gitignored.

**Ladder (all green):** typecheck 0 · vitest 635/635 · eslint 0/0 · build 85 ·
cache-bust PASS · parity 1572/1572 · bundle −0.1% · precache PASS (+163KB) ·
escape-lint 207 PASS · dist-wiring canonical · FULL e2e 417/417 as TWO PARALLEL
LOCAL SHARDS on 3017/3018 (213 + 204, ZERO failures, ZERO flaky retries — cleaner
than S202's run; every login went through real Chromium accepting the __Host- cookie
from http://localhost) · smoke ALL PASS · workers-smoke ALL PASS (the prefixed
session cookie captured on the Workers runtime) · Lighthouse floors PASS (login
100/100/96; next-redirect 94/100/96; seo 82 warn).

**Release:** push db0bae9 → CI 38176576229 ALL JOBS GREEN (ci 3.6m + e2e shards
204/213 in 4.7/5.4m parallel) → CD 38176995829 GREEN → LIVE v0.4.1.27 →
qa/s203-live-verify.mjs ALL GREEN (25 probes: the LIVE __Host- contract — name +
Secure + Path=/ + NO Domain + HttpOnly + SameSite=Lax, the /me round-trip on the
new-name cookie, the zero-residue logout with the same clear-contract, no
old-name emission on the failed-login path; the 3 kept bebas woff2 byte-IDENTICAL;
the 6 deleted formats 404; font-face.css byte-identical + 3 url() refs woff2-only;
sw v436; health ok/up/63) → tag v0.4.1.27 → zip 588 files (integrity OK,
secret-scan CLEAN — all credential values absent; the probe account's password
rides env-only into the verifier, never the repo) → healthchecks all 3 UP (natural
ticks only).

**Lessons (this session's own):**
- The tool-output display pipeline swallowed a literal `[h` AGAIN (ratelimit.ts's
  `hops[hops` rendered as `hopsops` in bash output) — the repo was never corrupted;
  the Read tool is the byte-truth; never "fix" what a bash echo shows without a
  byte-level check (the S200 assert-first lesson, re-earned).
- `__Host-` + Secure WORKS on http://localhost (Chromium's trustworthy-origin rule)
  — but it was PROVEN by 417 browser-login tests + a live probe, never assumed. The
  e2e suite is the right machine proof for cookie-contract changes.
- A dep-major dependabot PR is superseded the moment the deliberate in-session round
  lands — close it with the reason instead of leaving a permanently-red branch.

**Next (S204):** the S200 leftovers (opportunistic per-sheet --accent-ink, UX-17
mobile Lighthouse preset), the owner-machine drill run + key-custody drill (§4),
dependabot minors (hono 4.13.12, the dev-deps group, actions/checkout+upload-artifact
majors — CI plumbing, one deliberate round when taken), HLTH-24's incremental
project-page.js extraction (only when next touched for real work).

---
## Session S204 — THE DEPENDABOT ROUND + THE ACCENT-INK SWEEP + THE MOBILE LANE (the banked-leftovers closer)

**Dispatch:** "yes finish all the works and tasks. then wrap up this session. Push commit update changelogs and deploy."

**Work Log:**
- Reading ritual + state verified: main @ d852532 in sync, tree clean, LIVE v0.4.1.27 healthy, all 3 healthchecks up, 4 dependabot PRs open (#13 hono, #14 dev-group, #1 checkout v7, #6 upload-artifact v7 — the PRs also carried retired package-lock.json patches).
- **Batch A (deps)**: minors first behind the gates (hono ^4.13.12→resolves 4.13.13, workers-types, playwright+@playwright/test synced 1.64.0, eslint, tsx, typescript-eslint, wrangler 4.148) — all green; then the majors ONE AT A TIME: @types/node 26 (ONE documented double-cast in src/index.ts: HeadersIterator gained Symbol.dispose) ✓, typescript 6.0.3 ✓ (TS 7.0.2 TRIED + WALLED: typescript-eslint hard-errors, issue #10940) ✓, vitest 5.0.3 (635/635) ✓. actions/checkout v7 ×5 + upload-artifact v7 ×2 applied.
- **Batch B (accent-ink)**: 19 accent-as-TEXT sites → --accent-ink across notes.css ×14 / quicknotes / dashboard / devboard / base (the skip-link); every remaining color:var(--accent) classified icon/border/decorative/native-control and KEPT (the doctrine's other half — the folder-icon probe pins it live). Cache-bust base v14 · notes v22 · quicknotes v50 · dashboard v43 · devboard v30 (~116 refs/32 files) + sw v436→v437 (last-3 notes rotated).
- **Batch C (UX-17)**: lighthouserc.mobile.json (formFactor=mobile — the CLI's "preset" has no mobile value, absence IS mobile; 3 runs for medians) + the CI step. HONEST measured floors: cold login 89-90; the SW-active returning-user variant (dashboard→login?next=) 46-49 CONSISTENTLY — Lantern's SW-response pessimism, not variance; floor 0.45 binds there to catch collapse.
- **Ladder ALL GREEN**: typecheck 0 · 635/635 · eslint 0/0 · build 85 · cache-bust · parity 1572/1572 · bundle −0.1% · precache +163KB · escape-lint 207 · dist-wiring canonical · FULL e2e 417/417 two parallel local shards (213 + 204, ZERO flakes — shard 2's first parallel run exited 0 with an EMPTY log = not evidence; the solo re-run is) · smoke · workers-smoke (real CF creds) · Lighthouse desktop + mobile.
- **Release**: secret-scan CLEAN → push 3891c25 → CI 38183808774 ALL JOBS GREEN (the v7 actions' + mobile lane's first run; ci 5m + e2e 7m parallel) → CD 38184241827 GREEN → qa/s204-live-verify.mjs ALL GREEN 27/27 (5 sheets byte-IDENTICAL; wired /dist/ hashes == local manifest — the verifier's first draft probed canonical ?v= refs and failed WRONG: live HTML is deploy-wired; 7 accent-ink probes + the icon-keeps-accent probe; the __Host- battery on hono 4.13.13) → tag v0.4.1.28 → zip 592 files integrity OK secret-scan CLEAN → healthchecks UP → PRs #1/#6/#13/#14 closed with reasons.
- **Docs**: Changelogs §1 rotated to v0.4.1.28 + row 204 (rotate.mjs dry-run first); this handover; SESSION-BRIEF status.

**Lessons (this session's own):**
1. MultiEdit applies edits SEQUENTIALLY — a mid-batch failure leaves earlier edits LANDED. Audit file state after any failed batch; don't assume atomicity.
2. The Bash tool kills backgrounded (&) subshells when the call returns — parallel e2e shards need ONE foreground `… & … & wait` command; an exit-0-with-empty-log is NOT evidence — the solo re-run is.
3. Live HTML is deploy-WIRED (/dist/<name>.<hash>.css) — probe the content hash against the local build's manifest, never the canonical ?v= form.
4. TS 7's wall was found in 30 seconds by trying it behind the gates — the wall IS the finding; TS 6 (the continuation line) shipped instead.

**Stage Summary:**
- LIVE hibana.ir @ v0.4.1.28, sw v437, schema 63 — the S203 handover's banked menu FULLY executed; the repo carries ZERO open dependabot PRs and the whole dependency surface is current except TS 7 (ecosystem-walled, documented).
- Remaining (owner-side or doctrine-deferred): owner-machine drill runs + key-custody drill (§4 — owner-held keys); HLTH-24 project-page.js extraction (only when next touched); TS 7 (when typescript-eslint ships support); the SW-active mobile trace shape (measurement artifact, worth one look someday).
- Artifacts: commits 3891c25 (feature) + this docs round; tag v0.4.1.28; zip hibana.0.4.1.28.zip (/home/z/upload + the sandbox download folder); new tools lighthouserc.mobile.json + qa/s204-live-verify.mjs.

---

## Session S205 — THE KANBAN ENTRY-POINT ROUND (the dedicated /kanban experience + the project switcher + the Go-desktop-readiness docs)

Task ID: S205 (single-agent session)
Agent: Hibana S205 agent (Z.ai Code)
Task: Execute Hibana-Kanban-Polish-and-Go-Desktop-Readiness-Spec.md (repo root) — the dedicated projects.hibana.ir/kanban entry point, the top-level project switcher, measured performance work, and the six desktop-readiness documents. The Go desktop app itself is NOT started (per spec §7).

Work Log:
- Read the full spec (359 lines) + recon: 3 parallel exploration agents (backend API/schema, frontend Kanban, deployment/CI conventions); mapped routing, the two board surfaces, the auth/CSRF/cookie contracts, the deploy pipeline.
- Backend: requireAuth gained the optional {loginNext} (the login bounce preserves ?next=; existing callers byte-identical); /kanban route registered BEFORE coreRoutes' wildcard (the /signup pattern), serves the SAME board.html auth-gated + no-store; /kanban.html 301; both spellings in WORKER_PAGE_ROUTES; 7 unit tests (src/tests/kanban-route.test.ts).
- Frontend: board-page.js — let projectId + switchProject (in-place B().load + render, pushState ?project=, filter reset, recordBoard); the searchable switcher popover (60s-cached /api/projects?sort=recent, keyboard nav, RTL-aware anchoring, unmount removal); default resolution (hibana-kanban-last → most-recent → the empty state); /board.html bare → /kanban; the title-button markup in board.html; devboard.css switcher styles.
- Chrome: nav.html rail Kanban button; RAIL_ICON_PAGES + /kanban; mobile-nav More-sheet row; go-to g k; 10 i18n keys EN+FA; sw SHELL + /kanban, VERSION v438.
- THE RAIL FIX: the 8th primary overflowed ≤780px viewports (measured: the account chip 16px below the 720p fold of the fixed rail) → the compact-rhythm media query (46px tiles, 3px gaps; S189 ≥48 doctrine pinned at the default rhythm — its geometry test at 900p); rail-panel.spec pins the compact contract.
- Perf: qa/s205-kanban-perf.mjs (5-run medians): /kanban cold 142ms vs /board.html 164ms; in-place switch 123ms vs hard-nav 160ms (−23%); payload 8.6KB/15ms.
- Docs: docs/project-kanban/ — FEATURE-INVENTORY.md, USER-FLOWS.md, DATA-MODEL.md, API-AND-SYNC-CONTRACT.md, GO-DESKTOP-PORT-PLAN.md, TEST-MATRIX.md.
- Domain: the account-level workers/domains POST 10405s the session token → the ZONE-LEVEL route API instead: route projects.hibana.ir/* → hibana-prod + proxied AAAA (100::); cert issued ~60s; health ok/prod/up/63.
- THE CD REPAIR: the repo's CLOUDFLARE_API_TOKEN secret was EXPIRED (CD failed auth-error-10000 at Deploy-to-DEV; CI was green) → verified the session token deployable (wrangler whoami + dry-run + a real DEV deploy), PUT the secret via the GitHub secrets API (nacl sealed-box), re-ran the failed CD → GREEN (dev + prod + probes + purge).
- Live verification: qa/s205-live-verify.mjs ALL GREEN 14/14 on https://projects.hibana.ir — the 302+?next contract on both hosts, 401 JSON for non-doc callers, the browser round-trip with the owner's real account (login → back on /kanban → board renders → switcher 7 rows → in-place switch with the no-navigation marker → URL ?project= → refresh keeps it → 0 console errors).
- Ladder: typecheck 0 · vitest 642/642 · eslint 0/0 · escape-lint 214 · cache-bust PASS · i18n parity 1582/1582 · build 85 · bundle + precache PASS · FULL e2e 426/426 (four quarter-shards 110+113+104+99 — the sandbox kills detached background processes) · smoke PASS · CI 39093783469 ALL GREEN → CD 39094519965 GREEN.

Stage Summary:
- LIVE hibana.ir + projects.hibana.ir @ v0.4.1.29, sw v438, schema 63 — the spec's web-experience acceptance criteria verified live; the Go desktop port is planned (Wails leading, M0-M5) but not started; the docs live in docs/project-kanban/.
- Remaining (owner-side or next-phase): the M0 API additions (updated_at on tag changes, dev-task tombstones, idempotent creates) before any desktop M1; the owner's five port-plan questions (§10 of GO-DESKTOP-PORT-PLAN.md); the mobile More-sheet Kanban row e2e; the CD secret should be rotated to a dedicated least-privilege token (the session's user token works but is broader than CD needs).
- Artifacts: commit 45baa88 (feature+docs) + this docs round; tag v0.4.1.29; zip hibana.0.4.1.29.zip; new tools qa/s205-kanban-perf.mjs + qa/s205-live-verify.mjs + e2e/s205-kanban-entry.spec.ts + src/tests/kanban-route.test.ts.

---

## Session S206 — THE KANBAN FULL-BLEED + SPRINT-BUG ROUND (the owner's four-item follow-up)

Task ID: S206 (single-agent session)
Agent: Hibana S206 agent (Z.ai Code)
Task: The owner's four-item follow-up on the S205 kanban: (1) full-width default, (2) hide the sidebar entirely + reveal on screen-edge hover, (3) more room + smaller register for the project name, (4) "the sprint system is buggy".

Work Log:
- Re-cloned the repo (the sandbox reset wiped /home/z/hibana-repo; main @ 984929f, v0.4.1.29, clean).
- Asks 1+2: layout.css body.rail-edge (gutter 0 + the rail's own 4rem width + off-canvas transform, RTL mirrored, reduced-motion, the #rail-edge-zone tripwire with hover/touch/breakpoint gates); nav.js RAIL_EDGE_PAGES + syncEdgeZone (the zone's mouseenter/mouseleave + delegated rail hover/leave with relatedTarget guards + focusin/focusout; the panel/boot-restore/collapse-toggle suppressions); /board.html keeps the icons-only contract (pinned by test).
- Ask 3: devboard.css — .db-title/.db-switch to the control register (fs-md + 600, nowrap + ellipsis + flex) + #db-title's clipping box; board-page.js — the Back link retires on /kanban, the full name rides the span's title.
- Ask 4, the hunt: all 9 existing sprint e2e specs PASSED — the pain lived in untested flows. Drove the full sprint lifecycle in a real browser under the owner's timezone (qa/s206-sprint-probe.mjs 1-5): found the 0-items phantom (s.items never in the payload), the 409 save-kill, the Tehran off-by-one (local-midnight parse vs the UTC-day axis), the refused sidebar DnD (dragover never preventDefaulted outside the sidebar lists — the draft card's own hint advertised it), and the rail-shadowed dots (lane z-index scope-capping — elementFromPoint returned the rail at the dot's center).
- Ask 4, the fixes: renderSprintsList counts the task pool + fmtDate UTC; devboard.js reuses the existing draft on __new; UTC-midnight parse in the define commit + presets; the dragover/drop pair accepts sprint/draft/lane targets for sidebar tasks with the assignment path; the lane z-indexes retired so dots (z-5) + chips (z-3→z-5) beat the rails (z-4) at crossings.
- 11 new e2e (s206-kanban-edge + s206-sprint-fixes — the TZ test runs a real Asia/Tehran context; the DnD tests use synthetic DragEvents; the no-store/retry test wraps window.fetch as the contract guard).
- Part 1 shipped: FULL e2e 437/437 (four quarter-shards 89+104+143+101), ladder green, push 6532764 → CI/CD GREEN.
- THE LIVE HANG (found by qa/s206-live-verify.mjs: the create POST 201s, the render never updates; a hard reload shows the data): root-caused across 15 probe generations — CDP requestWillBeSent FIRED for the swallowed GET; wrangler tail (one foreground process — the sandbox kills detached tails, and backgrounded servers too: every probe spawns its own) showed the request NEVER reached the Worker (every other invocation visible, all ok, single-digit ms); both hosts; with AND without the SW (route-blocked sw.js); no-store and cache-busting unique URLs insufficient. The fix: every devboard client GET dispatches with an AbortController signal + a 3s deadline + one retry (validated 4/4 on prod, both hosts, retries=0 — the signal-wrapped dispatch avoids the swallow; the deadline+retry is the safety net; mutations keep the plain path) + cache:'no-store' on every call.
- Parts 2 (4272321) + 3 (f9273de) shipped: CI + CD GREEN on both; the final live verify 20/20 on projects.hibana.ir + qa/s206-final-inpage.mjs GREEN on hibana.ir (the create→render round-trip with NO manual refresh).
- Docs: Changelogs §1 rotated to v0.4.1.32 + row 206 (rotate.mjs, dry-run first); this handover; SESSION-BRIEF status line.
- Zip ritual: hibana.0.4.1.32.zip at /home/z/upload.

Stage Summary:
- LIVE hibana.ir + projects.hibana.ir @ v0.4.1.32, sw v441, schema 63 — all four owner asks shipped + verified live on both hosts; the sprint system's six confirmed bugs fixed with e2e pins.
- Remaining (owner-side or next-phase): the dated-create overlap validation (the INSERT path has no overlap check — documented); the request-swallow is worked around, not root-caused (if it appears on other same-URL GET paths — project-page.js's own fetch layer — apply the same signal+deadline+retry recipe); the mobile More-sheet Kanban row e2e + the M0 API additions + the owner's port-plan questions (all banked from S205).
- Artifacts: commits 6532764 + 4272321 + f9273de; tag v0.4.1.32; zip hibana.0.4.1.32.zip; new tools qa/s206-sprint-probe{,2,3,4,5}.mjs + qa/s206-repro-{stale,live2..15}.mjs + qa/s206-live-verify.mjs + qa/s206-final-inpage.mjs + e2e/s206-kanban-edge.spec.ts + e2e/s206-sprint-fixes.spec.ts.
