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

## Session S201 — MAJORS + APPROVALS (the S198 brief's owner-decision round; docs/ops only — no version bump)

Task ID: S201 (single-agent session)
Agent: Hibana S201 agent (Z.ai Code)
Task: Execute SESSION-BRIEF-S199.md's S201 plan — present the four rule-4 asks (prepare, never ship unprompted), run + record the restore drills (UX-12), the error_log daily monitor → healthchecks /fail (UX-11), the worklog rotation mode + row caps (HLTH-27), the project-page.js split ride-along (HLTH-24).

Work Log:
- Cloned @ 64864af (S200 release state); read Agents.md → SESSION-BRIEF → §4/§6 → worklog tail. Live-state audit first: hibana.ir health ok/up/63; CI #559 + CD #409 + Uptime #154 all green on 64864af; both healthchecks up; prod error_log EMPTY (7-day retention, 0 rows); planb_backups 27 rows (newest 2026-09-08).
- UX-12 (the drills — FIRST EVER run; they shipped 2026-09-11 with zero recorded runs):
  - `bun run drill` initially FAILED twice and both failures were REAL latent drill bugs, now fixed: (1) my own .secrets.env had GITHUB_REPO=hibana-source (the drill wants the ASSETS repo — the Worker's own value hibana-safe; env-var lesson, not a repo bug); (2) Part B's seed still used pre-0060 status vocabulary ('doing'/'awaiting' fail the projects.status CHECK — dead since 0060, the same blindness that had killed explain-hotpaths in S200).
  - Post-fix: drill PASS in ~2s (Part A loud-skip — newest backup snapshot-2026-10-11T15-23-26 is AES-GCM and BACKUP_ENCRYPTION_KEY is owner-held by design; Part B synthetic round-trip 9/9: export→restore→FTS rebuild, users untouched, rule-8 clean).
  - drill:planb initially had its OWN latent bug: the D1 parser read `result[0].results.results` (undefined → every non-empty planb_backups reads EMPTY — caught by the first-ever run). Post-fix: PARTIAL PASS in ~4s — steps 1–3 green on the 2026-09-08 document (D1 log row → Telegram getFile → sha256 match → HIBENC1 magic); steps 4–5 loud-skip (owner key).
  - Recorded in Changelogs §4 as the new "Drill log" block (date + duration + result + the two fixed bugs + the owner-machine residue).
- UX-11 (the error monitor — "the owner never reads code; 'feels broken' is the only signal"):
  - Created healthchecks.io check "Hibana errors" — RANDOM slug (the §4 leaked-ping-key doctrine; NEVER the burned /hibana slug), 24h period + 6h grace, the account's email channel (same as the other two checks).
  - Repo secret HIBANA_ERRORS_PING_URL set via the GitHub Actions API (libsodium sealed-box; the ping URL value never touches the tree).
  - NEW .github/workflows/errors.yml — daily 04:23 UTC cron (+ dispatch), NO checkout (pure curl+jq): counts prod error_log rows <24h via the D1 REST API (5xx > 5 = real breakage, total > 20 = incl. the 4xx auth-invalid bursts errorlog.ts deliberately keeps) → /fail with top paths, else a success tick. Anti-masking: pings ONLY its own check. Dry-run of the exact bash logic against real D1: PASS (total 0, 5xx 0). Documented in §4 Monitoring.
  - The /fail path was deliberately NOT live-tested (it would email the owner a false alarm); its fail() helper is verbatim the proven uptime.yml recipe, and everything up to the ping was verified.
- HLTH-27 (the rotation + caps):
  - rotate.mjs gains `--worklog [--keep N]` (default 4): anchors on the modern `## Session` markers, archives everything older to worklog-archive.md (append-only, chronological, born with its own header), leaves a rotation note in the worklog header; shape-verified + dry-run + aborts untouched on surprise.
  - Prose caps: --row ≤ 2,000 chars, --body ≤ 8,000 chars (hard fail; negative-tested both). Existing rows are history.
  - Applied for real: worklog.md 2,871 → 305 lines (S198/S199/S200/S201 kept; wrap-up…S197 archived — integrity proven: 305 + 2,575 archive − 9 header/note lines = the original 2,871, zero content loss).
  - Agents.md doc map documents the archive + the rotation command.
- The four rule-4 asks (ASK, never ship unprompted): written to Changelogs §6 as the PENDING OWNER APPROVAL block and presented to Ali in chat — PERF-16 (the 4 rule-9 indexes, one migration 0065, impact honestly LOW/doctrine MED), PERF-9 (1.75MB legacy fonts — HONESTLY CORRECTED: the files ARE referenced in font-face.css as src fallbacks, so the fix = delete 21 files AND trim the src lists to woff2-only), UX-13 (zod-4 + node-server-2, one round each), SEC-10 (__Host- prefix, one-time logout). Each verified against the tree before asking (the 4 indexes confirmed absent; only idx_project_tags_tag exists; the font refs confirmed; SESSION_COOKIE confirmed at src/auth/sessions.ts:7).
- HLTH-24 (project-page.js split) — BANKED with the §6 NO-GO reconciled: the file is one 5,870-line mount closure (all state via closure, the S48 IIFE-bug warning); a big-bang split contradicts the standing S49 doctrine. The SAFE path stays: incremental pure-function extraction (HibanaChips-style) when the file is next touched for real work. Recorded in §6.
- Ladder (fast lane — zero shipped assets touched, so no cache-bust/e2e-local needed; CI runs the FULL suite on the push since the workflow file isn't paths-ignored): node --check ×3 · typecheck 0 · vitest 632/632 · eslint 0/0 · build 85 · cache-bust PASS · parity PASS · bundle −0.1% · precache 2,138KB PASS · escape-lint 207 sinks PASS · smoke ALL PASS.
- Secret-scan CLEAN before commit (9 credential values absent · owner email absent from every touched file — it remains pre-existing in the S193/S194 worklog history, public since S194 · account-id confined to the 5 pre-existing public-surface scripts).

Stage Summary:
- S201 shipped as a docs/ops round (S198 precedent): no version bump, no tag, no zip, no §1/§2 rotation — the durable records are §4's Drill log + Monitoring block, §6's PENDING OWNER APPROVAL block, and this section.
- The DR drills are now PROVEN (and their two latent bugs dead — the zero-runs policy was hiding them); the error monitor closes UX-11 (three healthchecks now: backup cron, uptime, error growth); the worklog can never again grow monotonic.
- Next session: on Ali's written YES per ask, execute the approved items (each behind the full ladder + release ritual; PERF-16 needs the §9 bookmark ritual on both DBs); otherwise the S200 banked list (the 86-spec e2e DB-constant sweep, opportunistic --accent-ink conversions, the mobile Lighthouse preset UX-17) + the owner-machine drill run reminder stand.
- VERIFICATION (post-push): 0779b79 → CI #560 (38164530115) ALL JOBS GREEN — ci 3.8 min (audit + eslint 0/0 + escape-lint + build + bundle + precache + typecheck + cache-bust + parity + vitest 632 + smoke + dist-wiring + workers-smoke + Lighthouse) + e2e shards 6.7/6.3 min in parallel → CD #410 GREEN (same bits redeployed; no asset changes) → error monitor DISPATCH run #1 (38165291625) GREEN with the real D1 probe in its log ("prod error_log since 2026-10-10T18:47:36Z: total=0 5xx=0" + "error monitor PASS") → healthchecks "Hibana errors" flipped new→up (n_pings=1 @ 18:47:37, exactly the run's ping; the other two checks up on natural ticks) → hibana.ir health ok/up/63. The monitor's first scheduled cron run: tomorrow 04:23 UTC.

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
