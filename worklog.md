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

## Session S199 — DEBT ZERO + TRUST GATES (the S198 audit's fix round)

Executed per SESSION-BRIEF-S199.md Batches 1-5 (5 partial), on tree 195bd7e →
released as v0.4.1.24 (push 1cc4779).

**STATUS: RELEASED.** LIVE hibana.ir @ v0.4.1.24, sw v433, schema 63. CI
38122442476 GREEN (all gates, incl. the four new ones) → CD 38123258804 GREEN →
qa/s199-live-verify.mjs ALL GREEN (the 8 escape-hardened controllers
byte-IDENTICAL off their pages + the esc-wrapped quadrant-<option> probes +
sw v433 + the VERSION line 2,841 chars live + health ok/up/63) → tag
v0.4.1.24 → zip via the new scripts/make-zip.mjs (integrity OK, secret-scan
CLEAN) → healthchecks both UP (natural ticks).

**Completed + verification (the ladder, all green):**
- Batch 1: eslint 0 errors 0 WARNINGS (the 162 baseline dead — codemod removed
  ~159 symbols; the 3 `any`s stay as documented inline disables); tsconfig
  noUnusedLocals/noUnusedParameters; CI ratchet --max-warnings 0;
  devboard-helpers dead block deleted; sw.js VERSION trimmed 15,959→2,841
  chars (file −46%). vitest 627/627 (+4).
- Batch 2: scripts/rotate/rotate.mjs (ONE generic entry, shape-verified,
  dry-run — proven on its first real run this session) + scripts/make-zip.mjs
  (de-sandboxed); ONE lockfile (bun@1.3.14 pinned; package-lock retired,
  gitignored; CI audit generates its lock on the fly — 0 vulns verified);
  hibana.db untracked; .gitignore regrouped.
- Batch 3: the gates are real — a11y spec ASSERTS baselines (login 0/2/0/2,
  dashboard 6/49/0/4, offenders collected; was a vacuous green); Lighthouse
  perf+bp ERROR floors 0.9 (measured 0.96-1.0/0.96; seo stays warn at 0.82);
  workers-smoke required on main; THE ESCAPE-LINT GATE (scripts/check-
  escape-lint.mjs — 207 sinks, 51 files, nesting-aware, negative-tested).
- Batch 4: atomic reset single-use (rowcount-checked conditional UPDATE;
  e2e replay-proofed); per-account login counter; TRUST_PROXY clientIp;
  emailLinkOrigin (canonical APP_URL for emailed links); magic-byte sniffing
  on avatar/logo/banner; owner re-scopes on the links/dev-task PATCH writes;
  Agents.md OPEN_REGISTRATION lie + stale numbers + tooling doctrine.
- Batch 5 partial: /api/calendar unit spec ×4 (caught the never-implemented
  400-day bound — now real); signup/confirm/reset pages' first e2e ×3
  (playwright webServer env gains CAPTCHA_SECRET_KEY); favicon 1d+SWR rule.
- FULL e2e 417/417 (414 + 3), zero flakes — run as THREE SEQUENTIAL SHARDS
  because THIS SANDBOX KILLS ALL DESCENDANT PROCESSES between bash
  invocations (nohup AND setsid both die; the QA-server pattern from the
  brief only works within one invocation). Sharding is also the S200 CI plan.
- escape-lint PASS (207 sinks). workers-smoke PASS locally with real CF
  creds. Lighthouse error floors PASS locally. bundle +0.1%. parity
  1570/1570. cache-bust PASS (8 controllers, 53 refs).

**The round's own discoveries (banked for the next agent):**
1. The escape-lint gate caught TWO REAL XSS-class misses the S198 audit's
   sampling missed: the sadhana quadrant-name <option> sinks (app.js:929 +
   calendar-page.js:702) interpolated USER-RENAMEABLE quadrant names
   (sadhana_quadrant_names) — fixed with esc(). ~20 more sites hardened.
2. The a11y spec was VACUOUS: the fixtures are IIFEs whose JSON the spec
   discarded, then probed for functions that never existed ("0 findings"
   always). Now wired + asserted. The REAL numbers: login touch 2 (the
   ringed family — doctrine-exempt), dashboard overflow 6 / touch 49,
   contrast 2+4 (the UX-3 accent-as-text class — visible in the wild).
3. /api/calendar's documented 400-day range bound was never implemented
   (comment/code lie) — implemented + pinned.
4. The tool-output pipeline SWALLOWS literal `[m` sequences — ci.yml's
   `branches: [main]` DISPLAYED as `branches: ain]` in every read (grep,
   cat -A, GitHub API). The repo was NEVER corrupted — an assert prevented a
   phantom "fix". Lesson: verify suspicious byte-level findings with od
   -c / python counts before acting on them.
5. The live-verify lesson re-learned on JS bundles: app.js embeds its
   lazy-asset refs — verify byte-identity against the WIRED tree (the
   S191/S193 lesson, now in the verifier's header).

**Open risks + next (S200 per the brief):**
- S200 "Speed + Diet": CI sharding (the 20-min cap cliff — this session
  proved 3 sequential shards work; CI needs the matrix + browser cache +
  paths-ignore for docs-only pushes), explain-hotpaths STAGES fix,
  perf-baseline re-pin, the bundle-size per-file guard re-key, the dead-CSS
  diet, the N+1 fixes (/api/clients, tag-merge FTS, timeline), the
  waitForTimeout → expect.poll batch, PERF-8 Login.jpg WebP.
- S201 "Majors + Approvals" unchanged (the rule-4 asks: the 4 rule-9
  indexes, legacy font deletion, zod-4/node-server-2 scheduling, __Host-
  cookie prefix; the restore drill; error monitoring).
- Batch 5 banked UX items: UX-3 --accent-ink (the contrast offenders are now
  COLLECTED + counted by the gate — the fix has a ratchet waiting), UX-4
  aria-labels, UX-5 skip-link, UX-6 fine-world rings.
- The dependabot PRs (4 dynamic runs observed during this release) are still
  dep-bump noise; the advisory-on-PR workers-smoke keeps them non-blocking.

## Session S200 — SPEED + DIET (the S198 audit's perf round)

Executed per SESSION-BRIEF-S199.md's S200 plan (all six batches) on tree c80c184 →
released as v0.4.1.25 (push 9970919).

**STATUS: RELEASED.** LIVE hibana.ir @ v0.4.1.25, sw v434, schema 63. CI
38161304761 GREEN — the FIRST run of the sharded structure: the `ci` fast lane
2.6 min + the two e2e shards 6.5/6.8 min in PARALLEL (~9.5 min wall vs the old
15-19 single-job) — the 20-min-cap cliff (the audit's THREAT #1) is dead with
~2× headroom. CD 38161773669 GREEN → qa/s200-live-verify.mjs ALL GREEN (15
CSS/JS bundles byte-IDENTICAL off their pages + every content probe + sw v434
with /Login.webp in the SHELL + the WebP itself byte-identical at image/webp +
the skip-link/aria-label HTML probes + health ok/up/63) → tag v0.4.1.25 → zip
(615 files, integrity OK, secret-scan CLEAN — all 8 credential values absent)
→ healthchecks both UP (natural ticks).

**Completed + verification (the ladder, all green):**
- Batch A (PERF-1/UX-8/UX-9): e2e → a concurrent 2-shard matrix job (fail-fast
  off, per-shard artifacts, actions/cache for the chromium download keyed on
  bun.lock); docs-only pushes skip CI entirely (paths-ignore **.md +
  scripts/rotate/** — CD is workflow_run-gated, so they deploy nothing by
  design; the next code push carries them); playwright.config parametrized
  (E2E_PORT/E2E_DB/E2E_SHOTS).
- Batch B (PERF-3/19/4/5): the perf harness was DEAD since migration 0060 —
  explain-hotpaths' STAGES list predated the status rename (CHECK-constraint
  crash on seed) and perf-seed still seeded the per-project task_categories
  table (FK-fail against 0062's global categories). Both rebuilt on current
  schemas; perf-pages speaks current vocab; perf-baseline.json re-pinned
  (2026-10-11, 96 rows, 0 console errors). check-bundle-size per-file guard
  re-keyed on LOGICAL manifest names (hashed keys made it structurally dead —
  any edit re-hashed the filename and the guard skipped it as "new";
  negative-tested with a faked baseline). NEW check-precache-size gate:
  SHELL + manifest raw bytes against the SW's EXACT install filter (vendor
  + i18n-fa excluded), budget 2,300 KB, measured 2,138 KB post-WebP — wired
  into CI + package.json, ratchets DOWN only. sw.js's stale "~1.87MB" comment
  corrected with the measured number.
- Batch C (PERF-11/12/13): /api/clients 1+2N → 3 grouped IN-list queries (the
  loadProjectSignals recipe; ORDER BY project_id, created_at preserves the
  per-project order); tag rename/merge/collision-merge FTS rewrites N round
  trips → ONE syncTaskSearchTagsBatch UPDATE (the devboard-helpers export; a
  500-task tag rename was 500 sequential D1 RTTs at 10-40ms each); timeline
  on-this-day 4 sequential windows → one flattened Promise.all of all 12
  queries. 13 related unit tests re-run green.
- Batch D (HLTH-19): the brief's named short waits converted — sprint-ux ×3
  500ms (geometry → expect.poll on the actual boxes; the text assertion needs
  no wait at all — expect() auto-retries); the 3 login-settle 300-400ms waits
  → the loader-veil .is-hidden poll (the app's own boot-complete signal); the
  cancel-test's 400ms grace KEPT with a comment (negative-proof windows have
  no event to poll — documented so nobody "converts" it into a flake).
- Batch E (HLTH-5/6): the dead-CSS diet, honestly re-verified — 15 rule
  families deleted across 7 sheets (layout: .topbar-search family + .is-other
  + .rail-cal-legend + .activity-more; dashboard: the typo'd .precent* S45
  family; misc: .precent-all; quicknotes: .lang-check; notes: .vault-move-* +
  .vault-tag-pop; to-do-list: .progress-label; dashboard-todo: .activity-more
  selector). The audit's ~35-43 estimate CORRECTED: its per-sheet token
  analysis couldn't see JS-CONSTRUCTED class names — dot-* (NOTE_COLOR_HEX),
  ftag-* (TAGS cls), status-* (tone), p-in_progress/on_hold (progress), is-l2/3
  (outline level), pd-pin-box-* (t.status), feed-* (it.kind), hljs-* (runtime
  highlight) are ALL alive; and its layout candidates .rail-sync/.pc-corner
  were already comment tombstones. The vacuous .precent-row e2e probe removed
  with its class (it had passed on an empty NodeList since the S45 redesign).
- Batch F (UX-3/4/5/6 + PERF-8): --accent-ink lands (light #297073 = 5.74:1 —
  the same ink as --link; dark #d9997f the ink-grade clay; icons/strokes KEEP
  --accent) + the ONE real measured offender converted (.dash-vault-label,
  was 2.5:1 on the card) + contrast-fn.js's TWO false-positive classes die:
  (a) bubbled textContent audited wrapper DIVs at inherited colors (the
  loader's dark-tile mark measured its white glyph's "H" at --text — a 1.1:1
  phantom), (b) effectively-invisible elements were measured (the opacity-0
  veil's children compute opacity:1; the display:none mobile bar's anchors
  compute their own display:flex) — the fn now walks ancestors + skips
  aria-hidden (WCAG 1.4.3 decorative exemption) + requires a DIRECT text
  node. The a11y baseline re-pins contrast 2+4 → 0+0 (re-pin DOWN) + 5 new
  identity-palette pins. UX-4: aria-labels on the REAL title-only set (canvas
  pen widths ×4 reusing existing keys; sadhana qeEmo/qeEmpty with 2 new i18n
  keys — parity 1572; the audit's reports copy/CSV buttons already carried
  text spans, spark-pin was already JS-labeled). UX-5: the skip-link re-added
  on all 24 shell pages (the a11y.skipToMain key existed in BOTH dictionaries
  all along — only the markup was removed in Session 21); 4 main-less pages
  gain id="main" (canvas/whiteboard/sadhana/sprint). UX-6: the fine-world
  rule DOCUMENTED once (24px WCAG 2.5.8 EFFECTIVE via the ring idiom, in
  misc.css beside the 40px coarse floor) + rings for the two sub-24 offenders
  (q-pen 22→26 effective; cal-note-x ~20→~26). PERF-8: Login.jpg → Login.webp
  (112,648 B → 69,992 B at q70; preloads + CSS + SW SHELL swapped; precache
  2,180 → 2,138 KB).
- LADDER: typecheck 0 · vitest 632/632 (+5) · eslint 0/0 · build 85 ·
  cache-bust PASS (15 assets, ~370 refs) · parity 1572/1572 (+2) · bundle
  −0.1% PASS (logical keys) · precache 2,138 KB PASS (new gate) · escape-lint
  PASS (207 sinks) · FULL e2e 417/417 in TWO SHARDS (212+1flaky / 203+1flaky
  — both known-class font/modal races, retry-passed, zero failures; total
  matches the S199 count) · smoke ALL PASS · workers-smoke PASS (local, real
  CF creds) · dist-wiring PASS · Lighthouse floors PASS locally (login perf
  100 / a11y 100 / bp 96; next-redirect 94/100/96; seo 82 warn).

**The round's own discoveries (banked for the next agent):**
1. THE BUMP-SCRIPT BUG (nearly shipped): a cache-bust version-bump script's
   replace pattern used an OPTIONAL leading slash — `(\/?notes\.css\?v=)\d+`
   — which tail-matched inside `quicknotes.css?v=48`, silently DOWNGRADING
   25 refs to a stale v21/22 URL (a URL old clients may still have cached
   from an ancient release). Caught by diffing HEAD's authoritative versions
   (`git show HEAD:file | rg`) after the numbers looked wrong vs the §1
   record; fixed to v49. LESSON: after ANY scripted version bump, verify each
   file's new version against `git show HEAD:` + max-scan, and never use an
   optional-slash pattern when a longer filename can end with the shorter one.
2. The audit's dead-CSS method (per-sheet token analysis) over-counts by
   construction: any class emitted via template literals (`feed-${kind}`,
   `dot-${c}`, `status-${tone}`) reads as dead. The construction-site grep
   (`rg "ftag-\\$|dot-\\$" ...`) is the mandatory second pass. Real dead set:
   15 families, not ~35-43.
3. contrast-fn's visibility check read only the ELEMENT's own styles —
   opacity/display on ANCESTORS doesn't propagate to computed styles, so the
   opacity-0 loader veil and the display:none mobile bar were audited as
   visible. Any DOM walker that checks visibility must walk ancestors.
4. esbuild escapes non-ASCII as \uXXXX in the dist bundles (the i18n-fa
   Persian probes must key on the KEY NAME, not the value) and the CSS
   minifier KEEPS the space in custom-property values (`--accent-ink:
   #297073`) — both learned by the live-verify's first pass.
5. The `[m`-swallowing tool-output artifact (S199's discovery) is BROADER:
   `[h` in selectors (`.user-menu-item[href=...]`) also vanishes from
   displayed output — and it can bite in BOTH directions (a Python repr also
   displayed mangled). od -c remains the byte truth. WORSE: copying text from
   a mangled display into a Write pastes the CORRUPTION into the file (this
   session corrupted ci.yml's `branches:` lines that way and fixed them via
   chr()-built strings).

**Open risks + next (S201 per the brief):**
- S201 "Majors + Approvals" unchanged: ASK ALI (rule 4) the four asks (the 4
  rule-9 indexes; legacy font-format deletion; zod-4 + node-server-2
  scheduling; __Host- cookie prefix); run + RECORD the restore drill; the
  error_log daily monitor → healthchecks /fail; project-page.js split
  (ride-along); worklog rotation mode + Changelogs row-wrap.
- Banked from S200: the e2e spec DB-constant sweep (86 files hardcode
  /tmp/hibana-e2e.db — the blocker for LOCAL parallel shards; CI shards are
  unaffected); the per-sheet --accent-ink conversion continues opportunistically
  (the a11y gate ratchets every page it measures — new accent-as-text fails CI
  until it uses the ink); the mobile Lighthouse preset (UX-17) still unmeasured.
- The 2 e2e flake classes (the Vazir font race on s155, the sprint-doc modal
  under load) are retry-absorbed (retries:1) — the waits-to-polls conversion
  continues per HLTH-19 but these two predate it.

---

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
