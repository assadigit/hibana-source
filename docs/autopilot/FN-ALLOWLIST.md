# Hibana Autopilot — FN-ALLOWLIST (function-shape exceptions)

> Companion to `scripts/check-fn-lengths.mjs` (the Phase 3 / M3 gate, wired into
> `npm run verify`). Every leaf function over 60 lines that is NOT listed here fails
> the gate. Nesting > 4 has NO allowlist path — the codebase has been at zero since
> Phase 3. Route factories (≥5 route registrations, handlers small) are exempt in the
> script itself: they are the Phase 4 file-splitting domain, recorded once there.
>
> Each row: `path:name` | lines @ Phase 3 | the recorded reason (PLAYBOOK §5 M3).
> Reasons fall into three classes:
> - **[barely-over]** 61–67 lines (≤7 over the bar) — one cohesive guard-chain or
>   template block; splitting scatters a single screen of logic across helpers.
> - **[endpoint-flow]** one endpoint's complete request flow (validate → authorize →
>   query → render). Phase 4 splits routes by feature; extracting mid-flow steps
>   before that split just moves the seam twice.
> - **[adapter/Phase-4]** adapter or client modules are Phase 4's boundary-extraction
>   targets; touching them now risks the portability contract for zero behavior gain.

| Key | Lines | Reason |
|-----|-------|--------|
| `src/auth/middleware.ts:requireAuth` | 61 | [barely-over] the auth gate's guard chain — every branch returns a different Response class (login redirect ×2, 401, banned 403); one screen, one responsibility. |
| `src/db/sqlite.ts:createSqliteDb` | 84 | [adapter/Phase-4] the Node adapter: mutex + AsyncLocalStorage transaction wiring; its 84 lines ARE the concurrency contract AP-15 pinned with 6 tests. |
| `src/lib/html.ts:<anon>@L56` | 67 | [barely-over] single SVG icon table function (the 24-glyph switch). |
| `src/lib/markdown.ts:renderMarkdown` | 65 | [barely-over] the block-level markdown pass — one state machine over line kinds. |
| `src/lib/sadhana-task-controls.ts:sadhanaTaskControls` | 127 | [endpoint-flow] one HTML template block (the task card controls); Phase 4 frontend module work owns splitting it. |
| `src/routes/ai.ts:<anon>@L66` | 74 | [endpoint-flow] /api/ai/text: validate → rate-limit → model call → error envelope. |
| `src/routes/auth.ts:<anon>@L67` | 104 | [endpoint-flow] POST /login: credential verify + dummy-work timing + ban notice + session create + cookie. Heavily test-pinned (auth suites); Phase 4 auth module. |
| `src/routes/calendar.ts:<anon>@L41` | 72 | [endpoint-flow] month-range loader (projects + tasks + sadhana merged windows). |
| `src/routes/core/media.ts:<anon>@L113` | 96 | [endpoint-flow] screenshot/doc upload — the sniff gate + rate limit + size pre-check + storage write + thumb best-effort + row + updated_at bump, one linear endpoint flow. Moved verbatim in the Phase 4 core split. |
| `src/routes/core/media.ts:<anon>@L262` | 62 | [barely-over] shot byte serving — thumb-variant fallback + self-heal meter + per-mime disposition. Moved verbatim in the Phase 4 core split. |
| `src/routes/core/canvas.ts:<anon>@L82` | 72 | [endpoint-flow] canvas sync (the AP-34 validation-tolerance batch path). Moved verbatim in the Phase 4 core split. |
| `src/routes/dashboard.ts:todoCard` | 129 | [endpoint-flow] one template block (the sadhana board card) — Phase 4 frontend module. |
| `src/routes/dashboard.ts:<anon>@L565` | 75 | [endpoint-flow] the overdue-chip aggregate query set. |
| `src/routes/devboard.ts:<anon>@L226` | 79 | [endpoint-flow] GET /api/projects/:projectId/devboard — the one board payload: the seven-query parallel load (S241 added the task_deps edge join; S250 the strategies registry — the 8th key with its catch→[] belt) + the eight-key response with the effective-deadline task rows via boardTaskRows (the S241 read surface; one query-set → one render). Pin moved L177→L188 by the S245 ride-along schema round; L188→L221 by the S250 strategies round; L221→L226 by the S253 db-health round (line drift only — the BE-5b offset schema + the catch-and-map import). |
| `src/routes/devboard.ts:<anon>@L378` | 86 | [endpoint-flow] PATCH /api/devtasks/:id — the S240 deadline-origin stamping + the completed-sprint assignment guard joined the existing done_at/SET-builder screen (one validate → authorize → mutate flow; recorded pre-S240 at under the bar, the spec-pack round grew it). S245 added the §13.4 due_origin_at ride-along (honored only on the null→value transition). Pin moved L305→L316 by the S241 board-payload round; L316→L327 by the S245 extension round; L327→L373 by the S250 strategies round; L373→L378 by the S253 db-health round (line drift only — the handler itself untouched). |
| `src/routes/devboard.ts:<anon>@L482` | 63 | [barely-over] POST …/devtasks/archive-done — the S252 BE-10 round wrapped the snapshot INSERTs + chunked delete in ONE cfg.db.transaction (mirroring /finish) and moved the link fetch SQL-side (BE-5a); the atomic move grew the handler 43→63. Splitting the read-fold out of the write-batch would separate the two halves of the one atomicity contract — Phase 6's devboard split owns the carve. Pin moved L477→L482 by the S253 db-health round (line drift only). |
| `src/routes/devboard.ts:<anon>@L740` | 143 | [endpoint-flow] POST /api/projects/:projectId/sprints — the S240 round's name-uniqueness gate + auto-name collision bump + explicit lifecycle/emoji/due-at stamping on the two create arms (draft + dated); S250 added the together-assignment guard + the strategy_id column on both arms; the S252 correctness pack (BE-2 one-query bump + BE-7's pre-close window validation view) grew it 89→112; the S253 catch-and-map wrapped BOTH create arms' INSERTs (the 0067 TOCTOU belts → the existing 409s, +31 with their reachability comments). Pin moved L616→L627 by the S241 board-payload round; L627→L648 by the S243 archives-list round; L648→L664 by the S245 extension round; L664→L710 by the S250 strategies round; L710→L727 by the S252 correctness pack; L727→L740 by the S253 db-health round. |
| `src/routes/devboard.ts:<anon>@L970` | 127 | [endpoint-flow] PATCH /api/sprints/:id — the S235 audit round's date-window + draft/started validation, grown by the S240 round's name-uniqueness gate + due-at origin rules + ended_at⇔status lock-step; S250 added the re-assignment guard + the strategy_id SET on both branches; S252's BE-9 killed the duplicate sibling round trip; the S253 catch-and-map wrapped BOTH branches' UPDATEs (name belt → duplicate, one-active belt → sprint_active_exists, +19). Pin moved L766→L777 by the S241 board-payload round; L777→L798 by the S243 archives-list round; L798→L814 by the S245 extension round; L814→L886 by the S250 strategies round; L886→L926 by the S252 correctness pack; L926→L970 by the S253 db-health round. |
| `src/routes/devboard-helpers.ts:setTaskTags` | 72 | [endpoint-flow] the S253 BE-1 batched tag resolve+sync — ONE find (NOCASE IN, oldest-wins) → ONE palette read + ONE multi-row ON CONFLICT create (the H1 race recipe, one statement for all names) → executeIn-chunked link sync → the B2/B3 usage+search maintenance; one linear write-path flow whose halves share the keepIds/existing state, splitting it would scatter the batching contract's invariants (the response shape + race semantics are pinned by s253-db-health.test.ts). Pin born S253 (24→72, the round that killed the ~30-round-trip N+1); Phase 6's devboard split owns any carve. |
| `src/routes/integrations/import.ts:<anon>@L12` | 87 | [endpoint-flow] Obsidian import: caps → dedupe → notes → projects (AP-53 taxonomy pinned here). |
| `src/routes/integrations/telegram-webhook.ts:<anon>@L53` | 393 | [route-dispatcher] The Telegram webhook command dispatch — one flat if-chain over ~20 slash-commands + intents, each arm self-contained and independently tested. Split (Phase 4) already extracted /append + /update (telegram-commands.ts) and the callback dispatcher (telegram-callback.ts); the remaining chain is the light commands whose arms are 3–12 lines each — further slicing would scatter a single dispatch table across files (the reason this shape exists). HTTP-level telegram suite (39 tests) is the safety net. |
| `src/routes/integrations/telegram-callback.ts:handleCallback` | 281 | [route-dispatcher] Telegram callback_query op-code dispatcher — same flat self-contained-arm shape as the webhook chain; moved verbatim into its own module in the Phase 4 split (byte-identical body, suite green). |
| `src/routes/module.ts:<anon>@L26` | 81 | [endpoint-flow] client module page aggregate. |
| `src/routes/notifications.ts:<anon>@L38` | 133 | [endpoint-flow] the attention aggregate — 7 parallel queries + group rendering (AP-55 filter pinned here). |
| `src/routes/projects/detail-helpers.ts:renderTitle` | 66 | [barely-over] the flat-dispatch title mini-renderer (was 8-deep nesting before Phase 3 flattened it). |
| `src/routes/projects/detail-helpers.ts:loadDetail` | 62 | [barely-over] the detail pool's parallel loader — ONE Promise.all screen (hurdles→backlog + the S244 effective-deadline seam `devTasksWithDue` + the S246 `taskDepsForProject` edge pool); the additive pool keys grew the destructuring past the bar at S246 (was 60 at S244). Pin added by the S246 dependencies round. |
| `src/routes/projects/index.ts:<anon>@L402` | 64 | [barely-over] PATCH project (history + progress freeze rules). |
| `src/routes/projects/index.ts:<anon>@L668` | 63 | [barely-over] archive/unarchive state machine (409 guards + history). |
| `src/routes/quicknotes-helpers.ts:notebookHtml` | 125 | [endpoint-flow] one template block (the notebook page); Phase 4 frontend module. |
| `src/routes/quicknotes.ts:<anon>@L107` | 65 | [barely-over] quicknote reorder. |
| `src/routes/rail.ts:<anon>@L72` | 101 | [endpoint-flow] the nav rail aggregate (projects + sparks + counts; AP-28 parked filter pinned here). |
| `src/routes/registration.ts:<anon>@L60` | 134 | [endpoint-flow] register: captcha → invite burn → user create → verify email → rollback (7 pinned tests). |
| `src/routes/reports.ts:<anon>@L48` | 85 | [endpoint-flow] activity report (AP-24 bucket ranges pinned here). |
| `src/routes/reset.ts:resetRoutes` | 94 | [endpoint-flow] factory with only 4 registrations — below the script's factory bar but same Phase 4 domain. |
| `src/routes/search.ts:<anon>@L34` | 146 | [endpoint-flow] the 7-group exact-match search (escape + FTS + parked rules pinned). |
| `src/routes/vault/folders.ts:<anon>@L23` | 78 | [endpoint-flow] vault GET /bootstrap — the sidebar one-shot (folders+counts+note-index+tag-index incl. inline #tag extraction). Moved verbatim in the Phase 4 vault split. |
| `src/routes/vault/imports.ts:<anon>@L88` | 62 | [barely-over] vault POST /import/quicknotes (kind-branching title/body derivation + dedupe + inserts). Moved verbatim in the Phase 4 vault split. |
| `src/services/ai.ts:runAiTransform` | 63 | [barely-over] model call + usage accounting. |
| `src/services/backup-planb.ts:sendPlanBBackupToChat` | 89 | [adapter/Phase-4] the Plan-B Telegram channel (chunked send + retention). |
| `src/services/backup.ts:buildUserSnapshot` | 97 | [adapter/Phase-4] the 40-table snapshot builder — one section per table; the backup-audit drift guard pins its coverage. |
| `src/services/github.ts:githubClient` | 109 | [adapter/Phase-4] the Contents-API client (retry + 409 handling) — the external-dependency boundary Phase 4 extracts behind an interface. |
| `src/services/ics-export.ts:loadIcsEvents` | 84 | [adapter/Phase-4] the ICS window loaders (calendar.ts consumes them — CQ-6 family). |
| `src/services/r2.ts:r2Storage` | 78 | [adapter/Phase-4] the SigV4 object store (AP-37 recipe pinned by recomputation test). |
