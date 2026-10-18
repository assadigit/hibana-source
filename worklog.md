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

---

## Session S207 — THE MOTHER-CONTAINER + TRUE-FULL-WIDTH + GHOST-SWEEP ROUND (the owner's three-item follow-up)

Task ID: S207 (single-agent session)
Agent: Hibana S207 agent (Z.ai Code)
Task: The owner's three-item follow-up on the S206 kanban (2026-10-19, with two screenshots): (1) "put them into a mother container with relatively white color — the kanban needs a container", (2) "it's not still full width", (3) junk rows in the project switcher ("s209 repro 9").

Work Log:
- Re-read the two owner screenshots (VLM): 11l.png — the board a centered ~1366px island on the gray desk with NO grouping container; fgfg.png — the switcher listing "S206 repro9 (self-cleaning)" + "S206 repro5 (self-cleaning)" beside the 7 real projects.
- Live recon (agent-browser, owner account, projects.hibana.ir/kanban @1920): body.rail-edge active, but main.shell computed max-inline-size 1366px — ROOT CAUSE: misc.css's item-12 page-width preference (html[data-page-width="standard"] main.shell.shell-flush, specificity (0,3,2), the default for every fresh user) capped the S206 full-bleed board; the rail gutter fix never re-checked it. /api/projects listed exactly 2 ghost rows — both S206 hang-hunt probe artifacts (their cleanup DELETE only ran on success paths).
- Item 1 (the container): board.html — .db-frame wraps #db-toolbar + #db-loading + #db-board; devboard.css — the frame is one var(--card) surface (token-driven: white in light, the dark surface in dark), padding 0.9rem/1rem (phone 0.65rem), min-block-size floor (100dvh − 1.5rem; below 1025px 100dvh − 4.5rem − safe-area, respecting the mobile-nav reserve); the toolbar's .card chrome retires into the frame's header row (transparent, ring gone, hairline below — (0,2,0) beats .db-toolbar/.card).
- Item 2 (full width): misc.css — html[data-page-width="standard"] main.shell.board-shell { max-inline-size: none } appended AFTER the item-12 block (same specificity, later source wins); devboard.css — main.shell.board-shell { padding: 0 } so the frame is edge-to-edge; board.html's main gains board-shell; the Notes vault (the other shell-flush consumer) KEEPS the cap; cache-bust devboard.css v33 + misc.css v24 (refs bumped in all 23/24 HTML consumers); sw v441→v442; package 0.4.1.33.
- Item 3 (the ghosts): qa/s207-ghost-sweep.mjs (env-only creds; narrow patterns ^S\d+ repro|live probe|final|sprint probe + '(self-cleaning)'; runbook + try/finally guidance for future probes) — RUN LIVE: 9 before, 2 ghosts DELETEd (200/200), 7 real remain, 0 after; the owner's hibana-kanban-last pointed at a deleted ghost → the S205 gone-state fallback resolved the board to SportSignal (as designed).
- Tests: 5 new e2e (e2e/s207-kanban-frame.spec.ts — frame structure + white bg + retired card chrome; TRUE full width under the standard page-width choice: shell cap none + padding 0 + frame left 0/right=vw + cols ≥ 90% vw; the height floor; /board.html same frame + exemption while keeping the icons-rail 64px + Back-link contract; mobile 390px full-bleed + slim inset). One test-authoring fix along the way (border-width shorthand → longhands).
- Ladder all green: typecheck 0 · vitest 642/642 · eslint 0 · escape-lint 214 · cache-bust PASS · build 85 (prod) · bundle +0.8% PASS · precache PASS (+148KB headroom) · dist-wiring canonical · board/sprint/label e2e 34/34 (s207×5 + s206-kanban-edge×5 + s205-kanban-entry×9 + board-filters + s206-sprint-fixes + label-manager + sprint-ux×4 — the dev/dev-build gate tripped once on a stale public/dist from the prior session + a dev-build run; cleaned + --prod, both gates PASS).
- Released: push fd42f56 → CI 39151681090 GREEN → CD 39152680541 GREEN → LIVE VERIFY on both hosts: projects.hibana.ir + hibana.ir /kanban — frame 0→1920 @1920 (white at the pixel edges, VLM-verified after the first VLM pass hallucinated margins — DOM + pixel checks are the ground truth), shellMax none, shell padding 0, toolbar chrome retired, rail-edge intact (keyboard focus reveal open/close verified live; the hover tripwire is hidden in headless (hover: none) by design — CI's Playwright pins the hover path), the switcher lists exactly the 7 real projects, sw v442 serving, 0 page errors.
- Docs: Changelogs §1 rotated to v0.4.1.33 + row 207 (rotate.mjs); this handover; SESSION-BRIEF status line.

Stage Summary:
- LIVE hibana.ir + projects.hibana.ir @ v0.4.1.33, sw v442, schema 63 — all three owner asks shipped + verified live on both hosts; the switcher is clean (7 real projects); the sweeper is the standing post-probe-round remedy.
- Remaining (owner-side or next-phase, all banked from S205/S206): the M0 API additions for the Go desktop; the owner's five port-plan questions; the mobile More-sheet Kanban row e2e; the dated-create overlap validation (INSERT path); the request-swallow is worked around, not root-caused (apply the signal+deadline+retry recipe if it appears on other same-URL GET paths).
- Artifacts: commit fd42f56; tag v0.4.1.33; zip hibana.0.4.1.33.zip; new tools qa/s207-ghost-sweep.mjs + e2e/s207-kanban-frame.spec.ts.

## Session S208 — THE TASK-OPTION PARITY ROUND (the owner's follow-up: the upload button + all the original hibana's task options on the kanban)

Task ID: S208 (single-agent session)
Agent: Hibana S208 agent (Z.ai Code)
Task: The owner's message (2026-10-20): "When creating a new task, it doesn't let you (show the button) to upload a picture. But already established tasks give you the option. Make sure you've implemented all of the kanban options of the original hibana into this one." — a PARITY round: the kanban editor must carry the full original-hibana task option set.

Work Log:
- The parity audit (two Explore agents — backend API surface + project-page task UI): the kanban's db-modal lacked the ENTIRE screenshots pipeline (no upload button, no staged grid, no pinned grid, no lightbox) AND hid the tags field for new tasks (isNew ? '' — the create body never sent tags); the original's full option set enumerated (title+content, formatting, status/priority/category/sprint/tags, staged shots, pinned grid, pin badge, ⋯ Edit/Copy/Delete; NO due-date/checklist fields exist anywhere to mirror).
- THE PORT (public/js/devboard.js, +~520 lines): project-page.js's uploader stack (S35/S46/S61/S67/S69/S86 — uploadShotXHR with the ≤1600px WebP prepare pass + thumb tile, makeUploadStrip per-file progress rows with cancel, uploadOne, the staged-shots lifecycle, the inline pinned grid, openShotLightbox/lbShotStep, the note dialog) moved into the shared board client scoped to state.projectId; image-resize.js lazy-loads on first editor open (app.js's ensureImageResize recipe — board/sprint pages never linked it); openTaskShots (the taskShotsDialog port) exported for the card badge.
- THE MODAL: the Upload File paperclip (full S86 accept list incl. video/webm + docs) renders in BOTH modes; new tasks stage → PIN on save (PATCH taskId per shot) → DELETE on cancel/Esc (closeModal's synchronous grab+clear); established tasks pin live per file + the inline grid; TAGS for new tasks (staged chips ride create's tags[]); a LATENT TITLE-WIPE fixed (syncTitleToDraft — a tag chip mid-edit used to rebuild the card and drop the typed title, the existing-task flow carried it too); the modal's Esc handler guards on !shotLightbox + the lightbox's document keydown (module-load registration order) preventDefaults + stopImmediatePropagations so Esc closes ONLY the lightbox.
- THE PAYLOAD + THE BADGE: devboard.ts — every task row carries shot_count (LEFT-JOIN COUNT on screenshots.task_id + a pre-0054 catch-belt); board-page.js — the .pd-task-shots pin badge on the card meta line (the project page's exact contract), its click opens openTaskShots (zoom + unpin → reload), the card-click editor-open path excludes the badge; COPY joins the ⋯ menu (data-raw-title → clipboard + toast).
- i18n: db.taskShotsHint + db.taskShotsBadge EN+FA (parity 1584/1584); cache-bust devboard v27 · board-page v20 · i18n-en v100 · i18n-fa v94 · i18n v154 (refs bumped in all HTML consumers + the board/sprint injector literals); sw v442→v443; package 0.4.1.34.
- BUGS FOUND EN ROUTE: (1) a comma where a + belonged in the modal template — `innerHTML = a + b, c + d` binds the assignment to (a+b) and DISCARDS the rest (the modal rendered half, the footer + handlers gone; node --check can't see it, the DOM dump did); (2) the title-wipe above (found by the tags-on-create e2e itself); (3) my own live-verifier raced the async pinned-grid render — fixed the WAIT, not the product.
- Tests: +1 unit (src/tests/devboard-shots.test.ts — shot_count explicit-0/counts/unpin-drops); +6 e2e (e2e/s208-kanban-shots.spec.ts — the owner's exact complaint, staged→save→pin API-verified→badge, cancel-deletes-nothing-orphans, the edit-modal button + pinned grid + lightbox-Esc-precedence + second-Esc, tags-on-create, the badge dialog + unpin reload; storage: rows seeded + upload-POST/file-serve route-fulfilled so pin/unpin PATCH+DELETE run real). LADDER: typecheck 0 · vitest 643/643 · eslint 0 · escape-lint 220 · cache-bust · bundle +2.1% · precache +127KB · smoke · FULL e2e 449/449 quarter-shards (one s207 geometry flake under load — green standalone ×3 + CI-identical local shard + the failed-job re-run).
- RELEASED: push 6f8089e → CI 39161116606 (e2e shard 2's s207 full-width test flaked once at frame.left=6 mid-animation; re-run GREEN) → CD 39163566793 GREEN → qa/s208-live-verify.mjs ALL GREEN 25/25 on projects.hibana.ir (the REAL upload pipeline end-to-end against prod storage inside a self-cleaning throwaway project: button+accept+tags in the NEW modal, real png staged→saved→pinned (API truth), payload shot_count=1 + tag, the card badge, the edit modal's button + inline grid, lightbox + Esc pair, the badge dialog + unpin + reload, 0 page errors) → both hosts sw v443.

Stage Summary:
- LIVE hibana.ir + projects.hibana.ir @ v0.4.1.34 (sw v443): the kanban editor now carries the original hibana's full task option set — the upload button in BOTH new-task and edit modals (the owner's exact complaint), staged→pinned attachments with progress/cancel/notes/delete/zoom, tags on create, the card pin badge + pinned-pictures dialog, and Copy on the card menu. One data-loss bug fixed en route (the mid-edit title wipe). Left as documented (deliberate): the title/content SPLIT + contenteditable rich editor (the board's single textarea is its Session-22/23 contract; the port would change the editing model), the detail slide-over (the board opens the editor directly — faster), paste/drag-drop upload (the original's dialogs are picker-only too).
