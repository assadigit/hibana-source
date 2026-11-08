# Hibana — SWOT Audit S198 (2026-10-11)

**Audited tree:** `123f902` (= origin/main, LIVE v0.4.1.23, sw v432, schema 63).
**Method:** four parallel read-only audit passes — performance, security, codebase health, UI/UX+ops —
plus verifier spot-checks on every load-bearing number in this file. **This audit changed no code;
its push is docs-only** (CI will re-run the ladder and CD re-deploys the same verified assets —
the normal docs-push chain).

**Re-run during this audit (all green):** vitest 623/623 (74–76 s) · i18n parity 1570/1570 ·
eslint 0 errors / 162 warnings · `npm audit --omit=dev` **0 vulnerabilities** · build 85 entries ·
dist total 1,747,617 B (+0.1% vs baseline, PASS) · git tree clean after build.

Finding IDs: **PERF-*** (performance/optimization), **SEC-*** (security), **HLTH-*** (codebase
health), **UX-*** (UI/UX + ops/docs). Effort tags: S (≤1 h), M (half-session), L (full session).
Anything marked **[approval]** needs Ali's explicit written sign-off before shipping (rule 4).

---

## 0. Executive summary — the SWOT matrix

| | **Positive** | **Negative** |
|---|---|---|
| **Internal** | **STRENGTHS:** verification ladder is real and machine-enforced end-to-end; identity-palette regression-pin system (49 pins); race-proofed CI→CD chain; layered encrypted backups + anti-masking dead-man switch; sessions/PBKDF2/CSRF/headers all verified strong; Zod on every write handler; user_id scoping verified on the destructive surface; one clean Db abstraction for D1+Node; i18n parity 1570/1570; S197 touch floor honestly re-measured; all 51 JS build entries wired (S161 class closed). | **WEAKNESSES:** 162 eslint warnings, ~92% genuinely dead code, un-gated (silent drift); sw.js VERSION line = 15,959 chars (55% of the file); 14 write-once rotate scripts + dual lockfiles + 0-byte hibana.db at root; CI e2e single-worker at ~19 min against a 20-min cap; Lighthouse perf floors warn-only; the e2e "a11y test" asserts nothing; 312 innerHTML sinks = whole XSS defense is manual escaping; Node path trusts spoofable XFF + Host; ~35 dead CSS rules + 509 KB render-blocking CSS per page. |
| **External** | **OPPORTUNITIES:** one session kills the warning baseline forever (ratchet + noUnusedLocals); sharding buys ~2× CI headroom; escape-lint gate mechanizes the XSS class; N+1 fixes copy in-repo recipes; Login.jpg→WebP + favicon rule; dead-CSS diet cuts both first-visit and precache bytes; zod-4/node-server-2 majors can be scheduled deliberately; restore drill is one command away from a recorded proof. | **THREATS:** CI-cap breach arrives within weeks at +7 e2e/release and the Oct cadence; sw.js grows ~1 KB/release on a file revalidated every page load; public repo + 312 public sink files = attacker-offline-reviewable XSS surface; runtime dep majors (zod 3→4, node-server 1→2) compound the longer they wait; warning drift already moved 163→162 un-noticed; unbounded worklog/Changelogs line-weight slowly tax every fresh agent's first hour. |

---

## 1. Strengths (verified — keep and lean on these)

1. **The verification ladder is real.** CI runs: eslint → build → bundle-size (total +15%/file +25%)
   → typecheck → cache-bust → i18n parity → 623 unit → smoke → dist-wiring byte-identity with
   `git diff --exit-code` → full 414 e2e → Lighthouse floors → `npm audit --omit=dev` (0 today).
   Re-verified locally this audit: vitest 623/623, parity 1570/1570, cache-bust PASS.
2. **The regression-pin system** (`src/tests/identity-palette.test.ts`): 49 `it()` pins across 11
   design rounds pinning CSS geometry, contrast ratios, optical strokes and tap floors —
   "removing a `::after` ring inset fails CI" is literally true.
3. **CI/CD is race-proofed** (cd.yml): workflow_run-gated (CI green ⇒ CD), queue serialization
   (no cancel), stale-CI guard with last-green-wins, checkout pins the exact verified SHA,
   dev→probe→prod→purge→restore-HTML. The S59b race was observed and designed against.
4. **Auth/session crypto hygiene**: 256-bit CSPRNG session tokens stored only as SHA-256 hashes;
   30-day rolling expiry with 15-day extend; ban kills all sessions atomically; password change
   revokes other sessions; PBKDF2 100k (the documented Workers cap) with constant-time compares
   and a tamper floor (`MIN_ACCEPTED_ITERATIONS`); reset tokens 244-bit, SHA-256-hashed, 1 h TTL.
5. **CSRF + headers**: origin/referer required AND trusted, headerless callers 403; SameSite=Lax;
   `form-action 'self'`; full modern header set on Worker responses AND static assets — the two
   CSP strings verified byte-identical this audit; HSTS preload-ready.
6. **Rule 10 held under scan**: 139 write handlers checked — every body-bearing user route
   validates via Zod (shared `jsonBody`); dynamic `SET` builders key off Zod-stripped objects;
   all SQL parameterized. Rule 1 held on the destructive surface (project delete/restore/archive,
   screenshot delete, trash purge, export scope — all user_id-scoped).
7. **Admin hardening**: ONE owner-gate middleware after requireAuth; self-role-change +
   last-owner guards; delete confirm-typing; the S196 test net pins ban presets, far-future
   dates, session kill, banned-401.
8. **Backups**: 4×/day AES-GCM-256 snapshots to the private assets repo; `sessions` +
   `password_resets` tables and `password_hash` column excluded (rule 8 verified in code);
   prod refuses plaintext; Plan-B Telegram channel (D1-independent) + Time Travel;
   anti-masking dead-man switch (the 2026-10-10 missed tick resolved itself by design).
9. **The Db abstraction** (`src/db/`): 153 LOC, one interface, D1 + node:sqlite adapters, honest
   documentation of the pre-batch-read semantic gap, exactly one `as T[]` cast. The portability
   requirement is satisfied structurally (Node entry runs the same numbered migrations; KV
   shots have a disk fallback).
10. **Front-end delivery architecture**: content-hashed immutable dist (1 y cache) + deploy-time
    HTML wiring verified byte-identical by CI; HTML no-store everywhere (the S108 stale-shell
    cure); sw.js/manifest no-cache; fabric/Vazir/i18n-fa deliberately excluded from precache;
    lazy-loading discipline (emoji picker, code-highlight, FA dictionary). No orphaned
    controllers: all 51 public/js files are build entries — the S161/S196 miss class is closed.
11. **Backend hot paths are batched**: auth = 1 query + `waitUntil`-deferred writes; dashboard =
    one Promise.all of 14 capped queries; rail = one Promise.all of 9 bounded queries;
    `loadProjectSignals` (IN + GROUP BY) exists as the reusable no-N+1 recipe; D1 writes batch
    via `d1.batch`.
12. **Docs-as-memory culture**: Changelogs §1 rotation (4 blocks, bounded); worklog lessons are
    specific and honestly re-learned; migration numbering is perfect (63 files, one documented
    0007 gap); secrets hygiene verified: zero secret-pattern hits in tracked files, .gitignore
    covers all secret files, `hibana.db` is a 0-byte placeholder (no user data in git history).
13. **i18n discipline**: parity 1570/1570; every sampled string keyed; FA dictionary + Vazir font
    lazy-loaded FA-only; lang/dir FOUC killed for returning users.

---

## 2. Weaknesses (ranked; IDs point into §5)

1. **The eslint warning baseline is dead code, not documentation, and it drifts silently.**
   HLTH-1/2/3: ~126 unused imports + ~25 dead locals + a whole dead schema block in
   devboard-helpers; the "162" number lives only in prose (already drifted 163→162); nothing in
   CI ratchets it.
2. **sw.js carries a 15,959-char VERSION comment** — 55% of the 28,889-byte file, growing
   ~1 KB/release, on a file that revalidates on every page load (PERF-2/HLTH-11).
3. **CI wall-time is at the cap's throat**: single job, e2e `workers: 1`, 414 tests growing ~7
   per release; measured 15.0–15.3 min at 322 e2e (S181); the S197 gate rode green with the
   414-test suite but headroom is minutes; docs-only pushes re-run the entire ladder (PERF-1,
   UX-8, UX-9).
4. **The a11y/perf nets have holes exactly where they're advertised**: Lighthouse perf floors are
   `warn`-only (UX-1); the e2e a11y spec asserts nothing and never collects its contrast results
   (UX-2); the Workers-runtime smoke is `continue-on-error` (UX-10).
5. **The XSS defense is 312 manual escapes.** CSP `unsafe-inline`+`unsafe-eval` is the documented
   tradeoff, but nothing mechanizes the escaping discipline — every future `${` inside an
   innerHTML sink is a security-critical review point (SEC-1).
6. **Node-path edge trust**: `TRUST_PROXY` documented but unimplemented (client IP from first
   spoofable XFF hop — full rate-limit bypass on a self-hosted Node deployment, SEC-3); emailed
   links derive origin from the request URL — Host-header poisoning of reset links on the same
   path (SEC-4).
7. **Fine-grained security gaps, each one-function fixes**: reset-token single-use is
   check-then-act (SEC-5); auth throttling is per-IP only, no per-account counter (SEC-2);
   avatar/logo uploads trust client-declared MIME (SEC-9).
8. **Render-blocking monolithic CSS**: ~22 `<link>` sheets / ~509 KB minified per heavy page —
   first-visit gz 220–304 KB on the big pages (PERF-6/7, UX-7); ~35 genuinely dead rules across
   the top sheets (HLTH-5/6 — the banked "layout.css 2.2k dead hunt" is a myth: it's 8/243).
9. **Repo-root sprawl + tooling drift**: 14 write-once rotate scripts hardcoding sandbox paths;
   two lockfiles with no `packageManager` field; a 0-byte `hibana.db` tracked at root; Agents.md
   carries 4 stale numbers + a stale OPEN_REGISTRATION line that could re-open registration by
   accident (HLTH-9/10/12/13, SEC-17, HLTH-26, UX-19).
10. **A11y stragglers**: light-theme `--accent` as text fails AA (3.10:1 on white — UX-3);
    15 title-only buttons with no accessible name (UX-4); the skip-link CSS exists but no page
    renders it (UX-5); fine-pointer floor is internally inconsistent — `q-pen` 22 px,
    `cal-note-x` ~20 px fine-world (UX-6).
11. **Coverage holes where it matters**: `/api/calendar` has zero unit tests (HLTH-16);
    signup/confirm/reset pages never load in any e2e (HLTH-18); `waitForTimeout` (166) outnumbers
    `expect.poll` (63) 2.6:1 — flakes are retry-masked, not poll-eliminated (HLTH-19).

---

## 3. Opportunities (ranked by leverage per hour)

1. **Kill the warning baseline in one session** (HLTH-1/2/3/22): mechanical removal + CI
   `--max-warnings` ratchet + optional `noUnusedLocals`. Warning drift becomes structurally
   impossible. Effort M, risk ≈ 0 (623-test gate).
2. **Shard the e2e step** (PERF-1/UX-8): 2-job matrix `--shard=i/2`, parametrized PORT/DB_PATH,
   `actions/cache` for the Playwright browser, optional `paths-ignore` for docs-only pushes
   (UX-9) — ~2× CI headroom without touching app code. Effort M.
3. **The escape-lint gate** (SEC-1): fail any `innerHTML =`/`insertAdjacentHTML(` template
   containing `${` not wrapped in `esc(`/`escHtml(` — mechanizes the app's only real XSS
   exposure class. Effort S–M.
4. **sw.js VERSION trim** (PERF-2): last 3 release notes, ~200 chars; ~13 KB off every SW
   update download. Effort S.
5. **Trust the edges** (SEC-3/4/5/2/9): TRUST_PROXY on the Node entry; APP_URL-first link
   origin; atomic single-use reset UPDATE; per-account auth counter; upload magic-byte checks —
   five small functions, one hardening round. Effort M.
6. **Make the advertised gates real** (UX-1/2/10): promote Lighthouse perf to `error` (or add
   an LHCI bytes budget), baseline-assert the a11y spec + collect contrast offenders, decide
   the workers-smoke gating. Effort M.
7. **The bundle diet, aimed at the real top files** (PERF-6/7): i18n-fa 186.6 KB raw,
   project-page 148.1, app 102.6 (measured — the banked "fabric is the top dist entry" was
   wrong; fabric is a vendor file only canvas/whiteboard load); dead-CSS removal (~35 rules) +
   optional per-page CSS bundling cuts first-visit AND precache bytes. Effort M–L.
8. **Repair the perf measuring sticks** (PERF-3/19): explain-hotpaths is broken (STAGES list
   predates the 0060 status rename → CHECK-constraint crash); perf-baseline.json is ~20
   releases stale. Effort S each.
9. **Fix the real N+1s with in-repo recipes** (PERF-11/12/13): /api/clients (1+2N),
   tag-rename FTS rewrites (serial per-task), timeline's 4 sequential windows. Effort S–M.
10. **One a11y token + two rings** (UX-3/4/5/6): `--accent-ink` for text-in-accent (keep
    `--accent` for icons); aria-labels on the 15 title-only buttons; re-add the skip-link;
    fine-world ring fixes for q-pen/cal-note-x. Effort S–M.
11. **Close the coverage holes** (HLTH-16/18): one /api/calendar unit spec; one
    signup/confirm/reset page e2e spec. Effort S.
12. **Small asset wins** (PERF-8/10): Login.jpg → WebP (~110 KB → ~40–60 KB); favicon cache
    rule; delete 1.75 MB of unreachable legacy font formats **[approval]** (vendor tree).

---

## 4. Threats (trajectory — what bites if nothing ships)

1. **The CI cap is the nearest cliff.** ~1–5 min of true headroom; +7 e2e/release at the Oct
   cadence (8 releases in 5 days) breaches it within weeks — and it fails at the LAST step
   (Lighthouse), reading as "the code failed" when the cap failed (the S181 failure mode
   re-occurring). The structural exit is sharding, not another cap raise.
2. **sw.js bloat is linear and per-release** (10 k → 15.96 k chars in two rounds). sw.js
   revalidates on every page load and fully re-downloads on every deploy.
3. **The public repo makes the XSS surface a homework problem.** 312 sink files are
   downloadable; with unsafe-inline/eval the escaping discipline is the ONLY barrier; a single
   future template-literal miss = same-origin script execution (cookie is HttpOnly, but the
   attacker acts as the user). The escape-lint gate is the trajectory-correct counter.
4. **Runtime dependency majors compound quietly**: zod 3→4 (every route's validation layer) and
   @hono/node-server 1→2 (Node adapter). The longer the gap, the more custom code sits on old
   APIs — a future security advisory would force the migration mid-quarter instead of
   scheduled. Standing red dependabot PRs erode "CI red = broken".
5. **Warning drift is un-gated** (163→162 unnoticed); dual lockfiles with mixed tooling
   (CI installs with bun, audit reads npm's lock, no `packageManager` field) can silently fork
   dependency resolution — external mutation pressure (dependabot's 9-dev-dep PR failing CI) is
   already knocking.
6. **Monitoring blind spots surface only when the owner "feels broken"**: warn-only Lighthouse
   floors, no error tracking on the client, no alert on error_log growth, no Lighthouse
   regression alert (UX-11). The owner never reads code — "feels broken" is the only signal,
   which historically costs user-bug-report rounds.
7. **The backup chain is well-designed but unproven-by-record**: the quarterly restore-drill
   policy has zero logged runs since the scripts shipped (UX-12). RPO = max 6 h by design.
8. **Docs-as-load-bearing history slowly taxes onboarding**: unbounded repo worklog (2,577
   lines, no rotation), 2–7 k-char single-line Changelogs rows, stale numbers in the canonical
   rules file — the exact first-hour cost the repo exists to minimize.

---

## 5. Findings catalog

Severity: **High / Med / Low / Info**. All evidence was spot-verified or measured this session.

### 5.1 Performance & optimization (PERF)

| ID | Sev | Finding | Evidence | Fix (effort) |
|---|---|---|---|---|
| PERF-1 | High | CI 20-min cap vs e2e growth; single job, `workers: 1` | ci.yml:20; playwright.config.ts:12-15; 414 tests ≈ 18.0 m local (S197); +7/round | 2-shard matrix + browser `actions/cache` + optional vitest parallel job (M) |
| PERF-2 | High | sw.js VERSION comment = 15,959 chars (55% of 28,889 B), ~+1 KB/release | public/sw.js:16 (measured) | Trim to last 3 notes + git-show pointer (S) |
| PERF-3 | High | `perf:explain` broken since schema 60 — STAGES list predates the 0060 status rename → CHECK-constraint crash | scripts/explain-hotpaths.mjs:39 vs migrations/0060 | Re-pin STAGES + refresh hot queries; re-run as baseline (S) |
| PERF-4 | Med | Bundle-size per-file guard keyed on content-hashed filenames → never fires; only the +15% total guard is real | scripts/check-bundle-size.mjs:57-64 vs build.mjs hashing | Key per-file compare on logical manifest name (S) |
| PERF-5 | Med | Precache ≈ 2.13 MB raw / 125 assets; in-code "~1.87MB" comment stale; no gate tracks precache growth | sw.js:21-71 + manifest.json (measured 2,179 KB) | Update comment; optional CI precache-size assert (S) |
| PERF-6 | Med | Every page ships the full app CSS (~105 KB gz / ~509 KB minified; 19–22 sheets/page). Accepted soft-nav tradeoff but dead CSS rides it | dashboard 21 links; dist CSS totals (measured) | Dead-CSS diet now; optional per-page CSS bundles later (M–L) |
| PERF-7 | Med | The banked top-5 bundle list was wrong. Real top dist entries (raw/gz): i18n-fa 186.6/27.0, project-page 148.1/39.8, app 102.6/26.5, sadhana-page 76.4/20.7, emoji-data 69.8/17.1. fabric (285.3) is vendor, canvas+whiteboard only | public/dist measured | Aim dead-code hunt at project-page.js + app.js + 3 big CSS sheets (M) |
| PERF-8 | Med | Login.jpg 110 KB where WebP ≈ 40–60 KB; preloaded on login+signup | public/Login.jpg; login.html:8 | Re-encode + `<picture>` (S) |
| PERF-9 | Low | 1,749 KB of unreachable legacy font formats (.eot/.woff/.ttf) inflate every deploy upload + release zip | public/vendor/vazir/ (measured) | Delete legacy formats **[approval — vendor tree]** (S) |
| PERF-10 | Low | favicon.ico has no cache rule → revalidated every page load | public/_headers (gap) | Add `/*.ico` 1 d rule (S) |
| PERF-11 | Med | Genuine N+1 at GET /api/clients (1 + 2N queries) | src/routes/module.ts:26-39 | Two grouped IN+GROUP-BY queries (copy loadProjectSignals recipe) (S) |
| PERF-12 | Med | Tag rename/merge does serial per-task FTS rewrites (500-tag = 500 round trips) | src/routes/tags.ts:112,124,145 | Batch via d1.batch / INSERT…SELECT (S) |
| PERF-13 | Low | /api/timeline runs 4 windows sequentially (Promise.all inside each) | src/routes/timeline.ts:97-110 | Flatten to one Promise.all (S) |
| PERF-14 | Low | Sync object-store GETs in media/avatar/banner routes — mitigated (1 h private cache, thumbs, lazy) | core.ts:555-616, settings.ts:226-233 | Note only |
| PERF-15 | Low | Unbounded reads on growth paths (rail projectTasks, /api/media, sadhana) — owner-mandated, solo-scale fine | rail.ts:137-146, core.ts:405-418 | Keep in back pocket for multi-user |
| PERF-16 | Low | 4 letter-of-rule-9 index misses (project_tags.project_id, telegram_note_sessions.user_id, telegram_bot_sessions.user_id, sadhana_quadrant_names.user_id) | migrations 0003/0016/0043 + hot-path queries | One migration ×4 CREATE INDEX **[approval — rule 4; impact honestly Low, doctrine Med]** (S) |
| PERF-17 | — | Middleware chain lean: O(headers), no DB/IO pre-auth; auth = 1 query + waitUntil writes | src/app.ts:48-194, auth/middleware.ts:16-19 | Strength — no action |
| PERF-18 | Med | e2e structurally serial — only sharding buys real time; retries:1 currently ~free (zero flakes at S197) | playwright.config.ts | Shard (see PERF-1); scan viewport/sparks specs for dead waits (M) |
| PERF-19 | Low | perf-baseline.json 2026-09-17 (~20 releases stale); the harness itself is good | scripts/perf-baseline.json:3 | Re-pin each Track-C round (S) |
| PERF-20 | Low | /js,/css 1 h+SWR header rules are dev-surface only (prod HTML wires /dist immutable) | _headers + build.mjs:306-365 | Note only — don't "optimize" expecting prod effect |
| PERF-21 | Low | No precompressed files; no double-compression; HTML no-store everywhere is the right trade | public/ scan | Strength — no action |
| PERF-22 | Low | No duplicate dist/vendor loads; lazy-loading well-targeted (highlight 124.5 KB only on code blocks; emoji-picker on demand; i18n-fa FA-only) | project-page.js:3401, emoji-picker.js:18-28 | Strength — no action |

### 5.2 Security (SEC)

*(Corrected during verification: ci.yml DOES run an `npm audit --omit=dev` gate — the audit
draft's claim of a missing dependency gate was wrong. Dev-tree: 9 vulns (2 critical), all
devDependencies, not shipped to Workers — accepted posture.)*

| ID | Sev | Finding | Evidence | Fix (effort) |
|---|---|---|---|---|
| SEC-1 | High | CSP `unsafe-inline`+`unsafe-eval` × 312 innerHTML/insertAdjacentHTML sinks across 51 files — the whole XSS defense is escaping discipline (currently holding; sampled clean) | src/app.ts:90-101 + rg count (worst: project-page.js 63, app.js 43, sadhana-page.js 30) | CI escape-lint: fail `${` in sink templates not wrapped in esc()/escHtml() (S–M); mid-term: hash-based CSP for static inline scripts + delegated listeners (L) |
| SEC-2 | Med | Auth rate limit is per-IP only (30/60 s); no per-account counter — distributed IP rotation gets 30 tries/min/IP against one account | src/services/ratelimit.ts:18-19,73,95 | Second counter `auth:user:<login>` (no schema change) (S) |
| SEC-3 | Med | Node path: client IP = first (spoofable) XFF hop; TRUST_PROXY documented in Agents.md but 0 hits in src/ → full rate-limit bypass on self-hosted Node behind any proxy. (Workers path uses CF-Connecting-IP — prod safe) | ratelimit.ts:95; rg TRUST_PROXY src/ = 0 | Implement TRUST_PROXY: peer address when unset; last untrusted hop when true (S) |
| SEC-4 | Med | Node path: emailed links derive origin from request URL → Host-header poisoning leaks one-time reset tokens into attacker links | src/lib/http.ts:11; reset.ts:54; registration.ts:293 | Prefer cfg.appUrl/APP_URL (exists: src/lib/app-url.ts) for link construction (S) |
| SEC-5 | Low | Reset single-use is check-then-act (TOCTOU): two concurrent requests can both mint sessions | reset.ts:75-89 | Atomic `UPDATE … WHERE used_at IS NULL` + rowcount check (S) |
| SEC-6 | Low | Math captcha is a human-check, not a bot defense (documented); registration is invite-only today — exposure low | captcha.ts:1-11; registration.ts:246 | Revisit only if open registration returns |
| SEC-7 | Low | Registration enumerates emails (409 email_taken) — inherent to UX; suppression correct everywhere else | registration.ts:80-89 | Accept or 201-no-op if strictness ever wanted |
| SEC-8 | Low | Invites: any member mints unlimited 48-bit codes (documented trust model) | registration.ts:262-274 | Optional cap (5 live unused/member) (S) |
| SEC-9 | Low | Avatar/logo uploads trust client MIME; paths are server-generated (no traversal); nosniff global | settings.ts:42-44, 217-223; projects/index.ts:893-905 | PNG/JPEG/WebP magic-byte check before pushFile (S) |
| SEC-10 | Low | Session cookie lacks `__Host-` prefix; SameSite=Lax not Strict (mitigated: form-action self + no state-changing GETs — verified) | auth.ts:127-131 | Optional `__Host-hibana_session` on prod (S) |
| SEC-11 | Low | Check-then-act UPDATEs not re-scoped by user_id in 2 spots (rows UUID-keyed + pre-validated — practical risk ≈ nil) | core.ts:345, devboard.ts:291 | One-line `AND project_id IN (…)` re-scope for consistency (S) |
| SEC-12 | Low | dev route `?host=` unvalidated (owner-only) | dev.ts:71 | Scheme+host allowlist if desired |
| SEC-13 | Low | dev test-email accepts arbitrary recipient (owner-only, quota-guarded) — note in incident playbook | dev.ts:129-143 | Accept (owner-gated) |
| SEC-14 | Info | /api/health exposes env + schema + storage backend (by design, monitors need it) | health.ts:37-48 | Keep |
| SEC-15 | Info | npm audit: prod 0; dev 9 (all devDeps) | run this audit | Periodic re-run (gate exists in CI) |
| SEC-16 | Info | CF account id in 4 pre-existing public-surface scripts (non-credential, acknowledged S93) | custom-domain.mjs:13 etc. | No action |
| SEC-17 | Low | **Doc drift with security consequence**: Agents.md claims OPEN_REGISTRATION="true" in wrangler.toml both envs; it's absent → invite-only. A future agent following the stale line could re-open registration | Agents.md:173; wrangler.toml | One doc line (S) — **fix in S199** |
| SEC-18 | ~~Med~~ | ~~No dependency-audit gate~~ — **WRONG as drafted; corrected**: ci.yml:32-34 runs `npm audit --omit=dev --audit-level=high` | ci.yml (verified) | None — gate exists and passes |
| SEC-19 | Low | Rate limiter fails open on DB error (documented availability tradeoff; CF WAF primary) | ratelimit.ts:85-90 | Keep as documented |
| SEC-20 | Info | PBKDF2 100k = documented Workers cap; tamper floor + lazy-rehash scaffold correct | auth/password.ts:20-23,56,73-83 | Keep (raise only if Node-only ever happens) |
| SEC-21 | Low | Node static path traversal guard is correct but untested (no traversal spec) | server.ts:63-65 | Add one spec (S) |
| SEC-22 | Info | CSP `img-src https:` allows remote hotlinks (documented, canvas tools need it) — tracking-pixel channel, not script exec | app.ts:94 | Keep per invariant |

### 5.3 Codebase health (HLTH)

| ID | Sev | Finding | Evidence | Fix (effort) |
|---|---|---|---|---|
| HLTH-1 | High | The 159 unused-vars are ~92% dead code: ~126 unused imports + ~25 dead locals + only ~13 unused params. The "API-shape documentation" framing under-estimated the debt | eslint --format json classification; sadhana-helpers 28 all on import block, telegram-helpers 19, quicknotes 14+9 | Mechanical removal (`_`-prefix the ~13 params) (M) |
| HLTH-2 | High | devboard-helpers.ts: 9 zod schemas + `dayIdx` dead, duplicated live in devboard.ts | devboard-helpers.ts:29-89 vs devboard.ts:43,60,84,101,186 (verified) | Delete the dead block (S) |
| HLTH-3 | Med | CI eslint gate fails on errors only; "162" is prose, un-ratcheted, already drifted 163→162 | ci.yml ESLint step; eslint.config.mjs | `--max-warnings <post-cleanup>` + ratchet (S) |
| HLTH-4 | Low | 3 no-explicit-any warnings, all documented boundary decisions | http.ts:54, fabric-shim.ts:96 | Accept or type as unknown (S) |
| HLTH-5 | Med | layout.css is clean: 8/243 classes candidate-dead (3.3%) — the banked "2.2k-line dead rule hunt" is a myth | token analysis: .topbar-search :53, .rail-sync :269, .is-other :847, .pc-corner :1389, .activity-more :1516 +3 | Delete the 8 after visual pass; retire the myth (S) |
| HLTH-6 | Low | Other top sheets: ~35 genuine dead rules (quicknotes 5, notes 5, dashboard 10 incl. the typo'd `.precent*` family :402-454, misc 6, project-header 5 — its 10 `.hljs-*` are runtime-applied, NOT dead) | per-sheet token analysis | Remove in the bundle-diet round (S) |
| HLTH-7 | — | Zero orphaned JS controllers; build-entry graph closed (51/51) | build.mjs:48-73 | Strength — no action |
| HLTH-8 | — | fabric-shim.ts alive (build-time shim) | build.mjs:223 | No action |
| HLTH-9 | High | 14 write-once rotate-s*.mjs at root (120 KB); only variance = version strings + content blocks | diff rotate-s196 vs s197 | `scripts/rotate/rotate.mjs --session N --version V --body … --row …` generic (M) |
| HLTH-10 | Med | rotate + zip scripts hardcode sandbox-only absolute paths (`/home/z/hibana-source`, `/home/z/upload`) | rotate-s197.mjs:8; make-zip.mjs:14 | Repo root from import.meta.url; output from env (S) |
| HLTH-11 | Med | sw.js VERSION line 15,959 chars (grew past the banked 10k) | sw.js:16 (measured) | Trim to last 3 (S) — with PERF-2 |
| HLTH-12 | High | Dual lockfiles (bun.lock 83 KB + package-lock.json 184 KB), no `packageManager` field; CI installs with bun while audit reads npm's lock | git ls-files; ci.yml | Declare packageManager; ONE lockfile (S) |
| HLTH-13 | Low | 0-byte tracked hibana.db at root (placeholder — no data; real dev DB is data/hibana.db, gitignored) | git blob e69de29 | `git rm hibana.db` (S) |
| HLTH-14 | — | lighthouserc.json belongs at root (LHCI convention) | ci.yml | No action |
| HLTH-15 | Low | .gitignore comprehensive but unsorted; stray `-- -s`/`-s` entries from a curl accident | .gitignore:44 lines | Tidy with the rotate fold (S) |
| HLTH-16 | Low | /api/calendar: zero unit-test coverage (the only endpoint-prefix hole; every other prefix has corpus hits) | grep src/tests (verified empty) | One spec — event shaping + user scoping (S) |
| HLTH-17 | Low | Services without direct unit import: captcha, email, reset, shotstore (black-box covered via createApp) | rg over src/tests | Optional shotstore precedence test (S) |
| HLTH-18 | Med | e2e page gaps: confirm.html, reset.html, signup.html never load in any spec; clients.html only incidentally | token scan over 85 specs | One small spec copying login.spec.ts pattern (S) |
| HLTH-19 | Med | 166 waitForTimeout vs 63 expect.poll (2.6:1) — retry-masked flakiness, not poll-eliminated; screenshots.spec.ts waits 1.5–2 s | counts across e2e/ | Convert short waits opportunistically (M) |
| HLTH-20 | Low | 124 test.skip blocks are all inert browser guards (Chromium-only project defined) | playwright.config.ts:22-27 | Accept + document, or periodic firefox smoke (S) |
| HLTH-21 | — | No todo/only/fixme anywhere in either suite | grep | Strength |
| HLTH-22 | Low | tsconfig strict but no noUnusedLocals/noUnusedParameters (why 159 dead symbols compile silently) | tsconfig.json | Enable after HLTH-1 cleanup (S) |
| HLTH-23 | — | src/db abstraction exemplary (153 LOC, 2 adapters, 1 cast, honest gap docs) | types.ts/d1.ts/sqlite.ts | Strength — cite as the pattern |
| HLTH-24 | Med | Size hot-spots: project-page.js 5,869 lines (348 KB — largest tracked file), app.js 4,261, canvas.js 3,180; routes: helpers.ts 1,013, sadhana.ts 999, telegram.ts 946 | wc -l | Split by concern when next touched (L, ride-along) |
| HLTH-25 | — | Auth-guard duplication already solved (requireAuth middleware + Hono generics; zero user! / as-user casts) | ~10 app.use sites | Optional cosmetic createUserRouter helper |
| HLTH-26 | Med | Agents.md stale numbers: migrations "0060" vs 0064; tests "506" vs 623; parity "1427" vs 1570; schema "59" vs 63; server.ts:15-16 cites better-sqlite3 (removed) + DEPLOY.md (gone) | Agents.md:62,111,135,142; server.ts | 6-line doc patch; "numbers live in Changelogs §1" discipline (S) |
| HLTH-27 | Med | Changelogs rows up to 7,366 chars on one line (13 lines >2k); repo worklog 2,577 lines, monotonic, no rotation | wc + awk | Extend the rotate tool with --worklog; cap row prose (M) |
| HLTH-28 | Low | Largest tracked files fine (4 visual-regression PNG baselines 828 KB etc. — legitimate); .git 7.1 MB total | git ls-files du | No action |
| HLTH-29 | — | Migrations discipline perfect (63 files, one documented gap, verify+bookmark tooling) | migrations/ | Strength |
| HLTH-30 | Low | qa/ (40) + scripts/ (48) are one-shot verification receipts by design | ls | Fold live-verify probes into generic entry or accept as archive (S–M) |

### 5.4 UI/UX + Ops + Docs (UX)

| ID | Sev | Area | Finding | Evidence | Fix (effort) |
|---|---|---|---|---|---|
| UX-1 | High | A11y/Monitoring | Lighthouse floors: perf/bp/seo are `["warn", …]` — only a11y is error. A perf regression ships silently | lighthouserc.json:18-21 | Promote perf to error at measured level, or add LHCI bytes budget (S) |
| UX-2 | High | A11y | The e2e a11y spec asserts nothing ("report, don't fail — for now"); the eval'd contrast checker's results are never collected | e2e/a11y.spec.ts:29-44 | Baseline-count assertions + collect contrast offenders (M) |
| UX-3 | Med | A11y | Light-theme accent-as-text fails AA: `#4A9FA3` on white = 3.10:1; on accent-soft = 2.73:1 (dark passes: 5.34:1). ~98 `var(--accent)` declarations, many text | notes.css:160,634; computed math verified | New `--accent-ink` (≈#297073 which passes 5.74:1) for TEXT usages; keep --accent for icons/strokes (M) |
| UX-4 | Med | A11y | 15 title-only buttons (no accessible name): canvas pen widths, reports copy/CSV, sadhana qeEmo/qeEmpty | canvas.html, reports.html, sadhana.html scans | Mirror existing titles into aria-labels (keys exist) (S) |
| UX-5 | Med | A11y | Skip-link CSS exists (base.css:552-587) but NO page renders it (removed Session 21) | grep across 27 pages | Re-add `<a class="skip-link" href="#main">` per shell page (S) |
| UX-6 | Med | UX | Fine-pointer floor inconsistent vs the app's own recipes (.icon-btn 44px / ring ≥44px): q-pen 22 px, cal-note-x ~20 px fine-world; several 32 px no-ring | sadhana-board.css:226; layout.css:975; notes.css:107-124 | One documented fine-world rule + ring fixes for the two sub-24 offenders (S–M) |
| UX-7 | Med | Perf-UX | 22 render-blocking stylesheets / ~509 KB CSS on heavy pages; sadhana loads canvas+devboard+misc CSS it barely uses | grep counts; dist totals | Per-page CSS manifest in build.mjs, or merge per page-set (M–L) |
| UX-8 | Med | Ops | CI: one sequential job; e2e workers:1; +7 tests/release; measured 15.0–15.3 at 322 e2e (S181) — now 414; ~10–20 releases of headroom at Oct cadence | ci.yml; playwright.config.ts; Changelogs §2 trend | Shard (see PERF-1) (M) |
| UX-9 | Med | Ops | Docs-only pushes re-run the full 15–19-min ladder (no paths filter); S197 ran the chain twice | ci.yml:7-11 | `paths-ignore` for *.md + rotate scripts; note CD is workflow_run-gated (S) |
| UX-10 | Med | Ops | Workers-runtime smoke `continue-on-error: true` — the portability net is non-gating (the PBKDF2-600k class would not fail CI) | ci.yml:82 | Remove continue-on-error (repo secrets already exist for CD) (S) |
| UX-11 | Med | Monitoring | No error tracking/RUM/Lighthouse-regression alert; error_log has an owner-only viewer but nothing pings on growth | grep; check-prod-errors.mjs is manual | Tiny daily cron: count error_log rows <24 h, /fail past threshold via the existing healthchecks channel (M) |
| UX-12 | Med | Ops | Restore-drill policy ("quarterly") has ZERO recorded runs since scripts shipped 2026-09-11; key-custody drill still open | Changelogs §6/§4 grep | Run `npm run drill` + `drill:planb`, record date+duration in §4 (S) |
| UX-13 | Med | Ops | Runtime majors pending: @hono/node-server 1→2, zod 3→4 (vitest 3→5, TS 5→7 toolchain); minors: wrangler/hono/playwright; dependabot PR parked red | bun outdated | Schedule one deliberate migration round each behind the full ladder (L) |
| UX-14 | Low | A11y | lang/dir post-JS on first visit for FA-first users (static `lang="en"`; i18n.js flips) | i18n.js:93-100 | Optional: server reads Accept-Language, emits fa/rtl (S) |
| UX-15 | Low | A11y | 404 statics mixed-language pre-JS (EN title, FA body) | 404.html:6,54-65 | Ride-along with UX-14 |
| UX-16 | Low | UX | Micro-consistency drift: notes.css uses zero radius tokens (10×8px, 9×99px…); pill literals 99 vs 999; 3 muted names (--muted/--text-muted/--text-dim); --faint defined never used | variables.css:326-328 vs sheet scans | One-sheet-at-a-time token pass; delete --faint (M) |
| UX-17 | Low | Perf-UX | Lighthouse: 2 URLs × 1 run × desktop only; 25 pages incl. fabric-heavy canvas never audited; mobile preset (the touch-floor world) unmeasured | lighthouserc.json:4-14 | Add sadhana/canvas/projects + mobile preset ×2 runs (S) |
| UX-18 | Low | UX | Loader-veil: 26 pages, 24 lift via app.js, 3 exceptions own controllers; the gap is only for FUTURE app.js-less pages | clip-page.js:30, 404-page.js:12 | One-line guard in check-cache-bust or a fixture test (S) |
| UX-19 | Low | Docs | Agents.md/README drift: stale counts (506/1427/0060/59); README reading order omits worklog.md; sandbox lore lives only in worklog tails | Agents.md; README | 6-line patch + worklog.md as reading item 4 (S) |
| UX-20 | Low | Docs | Rotation sprawl + unbounded worklog + sw VERSION line — the Track-C banked list, confirmed with measurements | 16 rotate scripts; worklog 2,577 lines | As banked (HLTH-9/11/27) |
| UX-21 | Low | Docs | Onboarding 90% complete; missing: worklog.md in reading order + 10-line sandbox-gotchas block | README/Agents.md | Same patch as UX-19 |
| UX-22 | Info | Perf-UX | PWA/SEO surfaces complete (manifest icons/maskable/share_target; robots managed; fabric/Vazir out of precache by design) | manifest.webmanifest; sw.js | No action |
| UX-23 | Info | Ops | Portability verified sound structurally (same app, same migrations, disk-shots override, KV-REST fallback; AI wand 503s localized on Node) | server.ts:22,122-128 | No action (residual = UX-10) |
| UX-24 | Info | UX | Guided tour doctrine-compliant (one-time, account-age-gated, Esc-closable) | tour.js:2-12 | No action |

---

## 6. Needs owner approval before shipping (rule 4)

1. **PERF-16** — the 4 rule-9 index misses → one migration with `CREATE INDEX` ×4
   (project_tags.project_id, telegram_note_sessions.user_id, telegram_bot_sessions.user_id,
   sadhana_quadrant_names.user_id). Impact honestly LOW (tiny tables); doctrine-value MED.
   **Ask, don't ship.**
2. **PERF-9** — deleting 1.75 MB of unreachable legacy font formats from `public/vendor/`
   (touches the vendor tree; zero user-facing effect).
3. **UX-13** — the zod 4 + @hono/node-server 2 major migrations: owner should pick the
   scheduling (recommend one round each, not both at once).
4. **SEC-10** — `__Host-` cookie prefix (renames the cookie → logs all users out once;
   harmless but user-visible).

Everything else in this audit is code/doc/CI-level and needs no schema or policy approval.

---

## 7. Verification record (what this audit itself ran)

- `bun install` (258 pkgs) + `bun run build` → 85 entries, dist rebuilt (gitignored), tree clean.
- `npx eslint src/` → 0 errors / 162 warnings (breakdown via JSON analysis).
- `bun run test` (vitest) → 623/623 PASS (74–76 s).
- `node scripts/check-i18n-parity.mjs` → 1570/1570 PASS.
- `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities.
- Measured: sw.js 28,889 B (line 16 = 15,959 chars); dist total 1,747,617 B; precache
  ≈ 2,179 KB raw; Changelogs 568 lines / worklog 2,577 lines; git 612 tracked files, .git 7.1 MB.
- Spot-verified against agent claims: ci.yml npm-audit step EXISTS (SEC-18 corrected);
  devboard-helpers dead schemas CONFIRMED; /api/calendar test gap CONFIRMED; accent-contrast
  math re-computed by hand (3.10:1 confirmed).
- Live state at audit time: hibana.ir @ v0.4.1.23, sw v432, schema 63 (per S197 release record);
  both healthchecks up on natural ticks.

*The execution plan for these findings lives in `SESSION-BRIEF-S199.md` (root). Read that next.*
