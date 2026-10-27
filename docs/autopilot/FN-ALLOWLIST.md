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
| `src/routes/core.ts:<anon>@L461` | 96 | [endpoint-flow] hurdle create (order + history + updated_at). |
| `src/routes/core.ts:<anon>@L610` | 62 | [barely-over] link create/delete pair handler. |
| `src/routes/core.ts:<anon>@L763` | 72 | [endpoint-flow] canvas sync (the AP-34 validation-tolerance batch path). |
| `src/routes/dashboard.ts:todoCard` | 129 | [endpoint-flow] one template block (the sadhana board card) — Phase 4 frontend module. |
| `src/routes/dashboard.ts:<anon>@L565` | 75 | [endpoint-flow] the overdue-chip aggregate query set. |
| `src/routes/devboard.ts:<anon>@L630` | 87 | [endpoint-flow] sprint finish flow (status cascade + history + archives). |
| `src/routes/integrations/import.ts:<anon>@L12` | 87 | [endpoint-flow] Obsidian import: caps → dedupe → notes → projects (AP-53 taxonomy pinned here). |
| `src/routes/integrations/telegram-webhook.ts:<anon>@L53` | 393 | [route-dispatcher] The Telegram webhook command dispatch — one flat if-chain over ~20 slash-commands + intents, each arm self-contained and independently tested. Split (Phase 4) already extracted /append + /update (telegram-commands.ts) and the callback dispatcher (telegram-callback.ts); the remaining chain is the light commands whose arms are 3–12 lines each — further slicing would scatter a single dispatch table across files (the reason this shape exists). HTTP-level telegram suite (39 tests) is the safety net. |
| `src/routes/integrations/telegram-callback.ts:handleCallback` | 281 | [route-dispatcher] Telegram callback_query op-code dispatcher — same flat self-contained-arm shape as the webhook chain; moved verbatim into its own module in the Phase 4 split (byte-identical body, suite green). |
| `src/routes/module.ts:<anon>@L26` | 81 | [endpoint-flow] client module page aggregate. |
| `src/routes/notifications.ts:<anon>@L38` | 133 | [endpoint-flow] the attention aggregate — 7 parallel queries + group rendering (AP-55 filter pinned here). |
| `src/routes/projects/detail-helpers.ts:renderTitle` | 66 | [barely-over] the flat-dispatch title mini-renderer (was 8-deep nesting before Phase 3 flattened it). |
| `src/routes/projects/index.ts:<anon>@L402` | 64 | [barely-over] PATCH project (history + progress freeze rules). |
| `src/routes/projects/index.ts:<anon>@L668` | 63 | [barely-over] archive/unarchive state machine (409 guards + history). |
| `src/routes/quicknotes-helpers.ts:notebookHtml` | 125 | [endpoint-flow] one template block (the notebook page); Phase 4 frontend module. |
| `src/routes/quicknotes.ts:<anon>@L107` | 65 | [barely-over] quicknote reorder. |
| `src/routes/rail.ts:<anon>@L72` | 101 | [endpoint-flow] the nav rail aggregate (projects + sparks + counts; AP-28 parked filter pinned here). |
| `src/routes/registration.ts:<anon>@L60` | 134 | [endpoint-flow] register: captcha → invite burn → user create → verify email → rollback (7 pinned tests). |
| `src/routes/reports.ts:<anon>@L48` | 85 | [endpoint-flow] activity report (AP-24 bucket ranges pinned here). |
| `src/routes/reset.ts:resetRoutes` | 94 | [endpoint-flow] factory with only 4 registrations — below the script's factory bar but same Phase 4 domain. |
| `src/routes/search.ts:<anon>@L34` | 146 | [endpoint-flow] the 7-group exact-match search (escape + FTS + parked rules pinned). |
| `src/routes/vault.ts:<anon>@L182` | 78 | [endpoint-flow] vault note PATCH (autosave: field-diff UPDATE builder). |
| `src/routes/vault.ts:<anon>@L600` | 62 | [barely-over] vault folder delete (unfile cascade + counts). |
| `src/services/ai.ts:runAiTransform` | 63 | [barely-over] model call + usage accounting. |
| `src/services/backup-planb.ts:sendPlanBBackupToChat` | 89 | [adapter/Phase-4] the Plan-B Telegram channel (chunked send + retention). |
| `src/services/backup.ts:buildUserSnapshot` | 97 | [adapter/Phase-4] the 40-table snapshot builder — one section per table; the backup-audit drift guard pins its coverage. |
| `src/services/github.ts:githubClient` | 109 | [adapter/Phase-4] the Contents-API client (retry + 409 handling) — the external-dependency boundary Phase 4 extracts behind an interface. |
| `src/services/ics-export.ts:loadIcsEvents` | 84 | [adapter/Phase-4] the ICS window loaders (calendar.ts consumes them — CQ-6 family). |
| `src/services/r2.ts:r2Storage` | 78 | [adapter/Phase-4] the SigV4 object store (AP-37 recipe pinned by recomputation test). |
