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

## Session S224 — the desktop refresh round (2026-10-20)

**The owner's ask, verbatim:** "I tried something, deleted something from hibana, clicked sync on the app, but it didn't got deleted. it seems we need a refresh button."

**The honest diagnosis:** the sync round DID pull the boards — deletions included — into the Go mirror (`ReplaceBoard` swaps the full task set; anything absent from the fresh payload was deleted upstream) — but the ISLAND'S OWN DOM kept the boot-time render: `board-page.js` has NO poll (verified: only the filter-search debounce timer; no interval/focus/visibility loop), so the visible kanban never re-fetched after a green sync. A task deleted on hibana.ir stayed on screen until a manual restart. The mirror was fresh; the SCREEN was not.

**The deliverable (hibana-desktop v0.1.12), both surfaces + the mirror honesty:**

- **THE REFRESH BUTTON** — a LABELED ghost pill right after the Sync CTA (the toolbar row is now Sprints | Labels | Sync | Refresh | theme | Log out): one click re-boots the island (`location.reload` — board-page.js pushState'd `?project=`, so a refresh re-enters the SAME board), and the boot fetches ride the bridge's ALWAYS-FRESH interactive transport (`bindings.go` `RequestFresh` — never the conditional poll; the S215 304-against-a-blank-renderer lesson is structural), so the cloud's truth — the deletion included — paints. Ghost on purpose (Sync stays the ONE colored action), twin metrics with all five labeled neighbors (41.3px, spread 0), the desktop-owned EN 'Refresh'/'Refresh board' + FA 'به‌روزرسانی'/'به‌روزرسانی تخته' pair (the pin carries no refresh key), a data-busy glyph spin (prefers-reduced-motion respected), a one-click guard.
- **THE SYNC ROUND'S OWN REFLEX** — the exact gap the owner hit ("clicked sync, but it didn't got deleted"): `SyncRound`'s outcome now carries `pulled` (round.go no longer discards it — the boards whose pull was a live 200, the mirror rows that MOVED, deletions included), the sync step's done detail names the delta honestly ("N board(s) updated · P project(s) · B board(s) checked" vs "every board already current · …"), `desktop-sync.js` paints the pulled fact in the ok panel ("N board(s) updated from the cloud — the board shows them when you close this." + the FA twin) and reloads the island when the modal CLOSES (the native close event — Done AND Esc both fire it; the reload lands AFTER the user reads the success, never under it), so the pulled cloud truth reaches the VISIBLE board. pulled=0 (all 304s) claims NOTHING and reloads NOTHING — the screen was already the truth; `needsReload` re-earns its verdict on every fresh round; a mid-round Close (the round finishing Go-side unseen) never carries a stale reload.
- **THE MIRROR HONESTY** for web-deleted projects (the same bug's second half): a project deleted on hibana.ir vanishes from the server list and its board answers the web's gone state (404 "doesn't exist or was deleted", board-page.js:913-921) — but its mirror row stayed live forever, re-polling a dead board every round and counting as a live project in the modal's own success line. `SyncOnce`'s gone branch now TOMBSTONES the row (`store.MarkProjectGone` — `deleted_at` stamped; idempotent by the `deleted_at IS NULL` guard so the FIRST stamp is the honest death time; a missing id is a no-op, never an error), the pull loop skips tombstoned rows, and the LIST PULL owns resurrection: a fresh server row clears the tombstone via the upsert's `excluded.deleted_at` overwrite.

**The island's records:** 3 recorded ops (the refresh sheet/script ride the newproject round's own emitted lines; the Refresh pill rides the sync CTA's own class+id pair — `class="small db-sync-cta" id="db-sync-button"`, unique at its turn) + the two sheets (`js/desktop-refresh.js` + `css/desktop-refresh.css`) + the `desktop-sync.js` v0.1.12 growth, all through the ONLY mutator; `--check` green at 60 files byte-identical + idempotent (58→60); the new verify gates: the button id + label + aria, the sync<refresh<theme row order, the controller's reload + busy hook + EN/FA pairs, the sheet's twin-metrics rule, `desktop-sync.js`'s `out.pulled > 0` + the close listener + BOTH pulled-fact strings, the CSS manifest + the script chain (theme → shim → login → sync → logout → newproject → refresh → devboard → board-page) + node --check + no-storage, all extended.

**The proof:** `scripts/probe-refresh.mjs` — 32/32 on the REAL island bytes in Chromium, the mock bridge at the exact Wails boundary (the SyncNow mock resolves the probe-controlled outcome at CALL time, so pulled>0 and pulled=0 are both drivable): the row renders Refresh VISIBLE + LABELED + aria'd + twin-sized (41.3px ×5, spread 0) in the ghost grammar; THE OWNER'S EXACT SCENARIO end to end — the board boots with both task cards → the task is deleted server-side → the still-booted island KEEPS showing it (the honest before; no island-side poll) → ONE Refresh click → the re-booted board shows the cloud's truth, the deleted card GONE; the sync reflex: pulled=2 → the ok panel names the fact → Done → the island reloads; pulled=0 → NO update claim → Done → NO reload; the FA/RTL dark mirror: the به‌روزرسانی label + aria + the row mirrored (Log out leftmost, Refresh between Sync and theme) + the FA pulled fact + the FA close reload; ZERO page errors — + VLM clean on all 4 screenshots (toolbar-row / refresh-applied / sync-modal-pulled / refresh-fa-dark). Go: +`store.MarkProjectGone` (dao) + the tombstone branch in `SyncOnce` + `RoundOutcome.Pulled` + the honest detail; gofmt clean, vet green linux AND windows, `go test -count=1 -race` green (7 packages; +3 tests: the pulled-count contract, the pulled=0 no-claim contract, the tombstone lifecycle — gone → not re-polled → resurrected via a fresh list row); the cgo-free windows cross-build at 0.1.12-probe PE-verified (the dual -X stamps + every round needle: db-refresh-button ×6 / db-refresh-btn-label / desktop-refresh / Refresh board / updated from the cloud / out.pulled + the prior-round db-logout/db-sync/db-newproject + status:'planning' + the S222 winc_Form/DWMWCP_ROUND2 needles intact).

**The release, zero hands:** the push (b0e8e4c, rebased onto the lane's own v0.1.11 bump be77e26 first) fired the desktop autorelease lane → v0.1.12-desktop cut (lockstep bump 9258522 + the annotated tag) → the free windows runner built + published; EVERY asset re-downloaded + sha256-verified against the release's own checksums.txt (installer 9,202,745B 05723b7d… OK · zip 7,553,103B 49d8bbad… OK · the zip's embedded exe 7b600a39… MATCH checksums.txt's own line) and the RELEASE exe PE-verified (main.Version=0.1.12 + WebRef=e6661c8 + every needle + the prior-round needles; the FA UTF-8 needles verified by direct byte grep — به‌روزرسانی ×14 — plain `strings` misses multibyte runs, an encoding artifact, not a miss).

**Owner-side next:** dogfood v0.1.12 on Windows (delete a task on hibana.ir → the desktop still shows it → click Refresh → it is gone; or just click Sync — when the round says "N board(s) updated from the cloud", closing the modal re-renders the board with the deletions landed; a project deleted on the web stops counting in the sync line the next round); the M0 §7a-7e go; the e2e flake-hunt round (the S219 shard-2 diagnosis); M3 (offline mutations — the upload step becomes REAL then) → M4 (screenshot upload) → M5 (DPAPI + installer polish).

## Session S225 — the desktop sound + sync-modal-animation round (2026-10-21)

**The owner's ask, verbatim:** "I want some sound engineering , some modern , futurist and low-key sounds. for this: 1. when you login. 2. when you delete a task 3. when you fulfill a tasks 4. when you move a task to another state 5. when syncing complete. also in modal i want syncing animation with icons and animation."

**The deliverable (hibana-desktop v0.1.13), both halves:**

- **THE SOUND ENGINE** — `js/desktop-audio.js`, a NEW desktop-owned generated file loading blocking right AFTER the shim (it wraps the seam the shim just defined; the head chain is now theme → shim → **audio** → login → sync → logout → newproject → refresh → devboard → board-page): a PROCEDURAL Web Audio synth — ZERO audio files, nothing binary ever enters dist — in a deliberately FUTURIST + LOW-KEY grammar: pure sine/triangle partials, PERFECT-FIFTH intervals, short exponential pluck envelopes (8-16ms attacks), per-voice lowpass shaping, master gain 0.5 with per-voice peaks 0.02-0.1 (~-20dBFS — every cue sits UNDER the work). The five cues the owner named: **login** = the welcome fifth (E5→B5 over an E4 bed + a faint E6 shimmer; desktop-login.js plays it on the ok resolve and DELAYS the reload ~700ms so the chime LANDS — a reload kills the AudioContext; the submit stays busy through it; with no engine the reload is immediate, byte-identical to before); **delete** = the dissolve thock (a 320→165Hz triangle glide + a 98Hz sub + a band-passed noise puff — dissolution, never a trash-can crash); **fulfill** = the completion ding (G5 + D6 plucks over a G3 bed + a high sparkle); **move** = the micro tick (a 540→660Hz sine glide, 75ms — the quietest of the five); **sync** = the all-clear (the stacked-fifth arpeggio A4→E5→B5 + a glassy E6 tail — the sonic twin of the green "Everything synced" panel).

- **THE TASK-ACTION OBSERVER on the ONE seam** — the engine wraps `window.hibanaFetch` and classifies BEFORE the call (the island state still holds the PREVIOUS status while the request is in flight — `window.HibanaBoard.findTask` reads it live), playing ONLY on a 2xx resolve (a failed mutation is silent — nothing happened): `DELETE /api/devtasks/:id` (exactly one path segment — the tag/screenshot deleters never match) → delete; a PATCH carrying a status the task did NOT already have → `done`=fulfill, any other change=move; the same-status PATCH (the editor resends status on EVERY save) is a plain edit and STAYS SILENT; same-cue plays within 150ms coalesce so bulk "Clear done" sounds ONCE. The gesture unlock: the first pointerdown/keydown warms the context; every play() re-resumes it — all five call sites follow a real gesture.

- **THE SYNC-MODAL HERO** — the modal's living emblem above the factual step rows: the PULSE RING reaches out on connect, three PACKETS rise through upload, the h-SPARK orbits while the round is in flight (faster through sync), and the central glyph MORPHS per stage (cloud → upload arrow → orbit → check/cross, a 280ms cubic pop, never a swap); ok settles the emblem green with the check POP beside the all-clear chime; err tints it danger; the step rows pop their checks in, the result panel slides up; the hero re-boots to connect on every fresh round + Retry so no verdict ever leaks; `prefers-reduced-motion` respected with exact-match `[data-stage][data-kind]` selectors (the first probe run caught the specificity bug: lower-specificity reduced overrides LOSE to the running rules).

- **The records** — the 1 recorded op (the audio script rides the SHIM'S OWN tag — the login insert rides the same anchor but emits a DIFFERENT line) + the audio template + the login/sync/js/css growth all ride `sync-island.mjs` (the ONLY mutator), `--check` green **61 files** idempotent (60→61: +js/desktop-audio.js); the new verify gates: the audio file + the five cue names + the wrapper + the devtasks classifier regex + the fulfill-vs-move verdict + the same-status silence, the hero id/class anatomy + all five glyph classes, the controller's stage/kind wiring + the sync chime + the live relay, the login chime + the 700ms delayed reload, the CSS keyframe manifest, the chain order shim<audio<login, no-storage extended, node --check extended.

**The proof:** `scripts/probe-soundfx.mjs` — 40/40 ALL GREEN on the REAL island bytes (the mock bridge at the exact Wails boundary; SyncNow probe-DEFERRED so the mid-round hero stages are drivable; an instrumented AudioContext tallies every osc.start + captures f0 on `frequency.setValueAtTime` — the first run's lesson: the param's `.value` at start() time is still the 440Hz default because the engine schedules 20ms ahead): the engine loads + all five cues schedule their exact stacks (login 330/659/988/1319 · delete 320/98 · fulfill 196/784/1175/2349 · move 540 · sync 220/440/659/988/1319); unknown names no-op; coalescing holds; THE LOGIN LEG end to end (the gate → submit → the chime schedules → the doc still alive at ~T+600ms → authed=true, the gate hidden, 2 cards); THE DELETE LEG through the REAL UI path (⋯ menu → Delete → `#db-del-ok` → the thock + the seam crossed server-side + the reloaded board shows the card GONE); the fulfill/move PATCHes with the SILENCE rules (the same-status editor resend SILENT, the /tags/:tagId path SILENT); THE HERO LEG (connect pulse + cloud glyph + the spark orbiting → upload arrow + rising packets → sync orbit glyph → ok settle + pop + green panel + the all-clear chime side by side → Done → NO reload at pulled=0 → the err round tints danger + the cross); the FA/RTL dark mirror (the FA labels + the chimes identical — sounds are language-free); reduced motion keeps the STATE, stills the loops; ZERO page errors on every surface + VLM clean on all screenshots. The prior probes ALL PASS on the new dist — ZERO regressions (login/logout/newproject/refresh; the refresh round's own pulled-fact + close-reload contracts intact).

**Go untouched:** gofmt clean, vet green linux AND windows, `go test -count=1 -race` green (7 packages); the cgo-free windows cross-build at 0.1.13-probe PE-verified (the dual -X stamps + every round needle: db-sync-hero/db-sync-emblem/db-sync-packets/db-sync-glyph-connect/desktop-audio/hibanaAudio + all prior-round needles intact).

**The release, zero hands:** the push (4eff900) fired the desktop autorelease lane → v0.1.13-desktop cut (lockstep bump 41e3b2b + the annotated tag) → the free windows runner built + published; EVERY asset re-downloaded + sha256-verified against the release's own checksums.txt (installer 9,208,627B 5bf5499b… OK · zip 7,560,711B 2877b8e4… OK · the zip's embedded exe 8371f981… MATCH checksums.txt's own line) and the RELEASE exe PE-verified (main.Version=0.1.13 + WebRef=e6661c8 + every round needle + all prior-round needles intact).

**Owner-side next:** dogfood v0.1.13 on Windows (sign in → the welcome chime; delete/fulfill/move tasks → the thock/ding/tick; Sync → the hero's choreography + the all-clear chime beside the green panel; FA/RTL + dark + reduced-motion all verified); the M0 §7a-7e go; the e2e flake-hunt round; M3 (offline mutations — the upload step becomes REAL then) → M4 (screenshot upload) → M5 (DPAPI + installer polish).

## Session S226 — the desktop auto-update round (2026-10-21)

**The owner's ask, verbatim:** "Add an auto update for the app. when the new version releases in the github, app syncs with the internet and github, and if new version, whether portable or installer released, show a button for update. it must update from github and replace without losing data or needing user to re login."

**The deliverable (hibana-desktop v0.1.14), both halves meeting at the bridge:**

- **THE GO HALF — a NEW internal/update package.** FetchLatest reads `github.com/assadigit/hibana-desktop/releases/latest` ANONYMOUSLY (no token ever embedded — a PAT in a public app's exe is a self-inflicted wound), normalizes "v0.1.14-desktop" → "0.1.14", and IsNewer compares against the -X stamped main.Version FAIL-CLOSED (equal never newer; garbage never updates). PickAsset honors "portable or installer": the portable zip preferred (per-user self-replace, no wizard), the NSIS installer the fallback, neither = no button. **THE VERIFICATION CHAIN** — the release's own checksums.txt pins BOTH the asset's sha256 AND (zip flow) the embedded hibana.exe entry (VerifyZipEntry), so a tampered release fails closed before anything spawns; Prepare stages in `<dataDir>/updates` (atomic .part→rename, a 256KiB progress tick, a stale-round prune) and RE-EARNS the verdict at apply time. **THE REPLACE** — the WPP §1 never-mix rule is the load-bearing fact: session.bin + mirror.db live in the DATA dir, never next to the exe; apply_windows.go spawns a DETACHED PowerShell helper (CREATE_NO_WINDOW; named -File params — zero injection surface) that WAITS for the parent PID, swaps the exe, relaunches the SAME path → auth.Restore boots straight into the board: no re-login, nothing lost. The installer fallback runs the wizard VISIBLE (never /S — a silent UAC would hang unseen); apply_other.go keeps the Linux ladder honest, pinned by a test.

- **THE BRIDGE — internal/ui/update.go.** TWO bound methods, ZERO arguments: CheckForUpdates (single-flight through ONE shared busy guard with the apply; an available verdict is cached + relayed as `hibana:update-available`; an unreachable GitHub is an ERROR logged + retried — the app never claims "no update" when it could not ask) and ApplyUpdate (requires the cached verdict; relays every tick as `hibana:update-progress` {stage,received,total,pct}; resolves every outcome as a VERDICT — busy / no-update / a real error / the honest 45-minute timeout — never a rejection, re-armed on every exit). main.go's updateLoop checks at boot+10s then every 2 hours ("syncs with the internet and github"), and the restart is scheduled 1.5s after the {ok:true} resolve so the restarting panel is on screen when the window goes — quitRequested bypasses the close-to-tray contract (the helper must never wait on a hidden-but-alive process).

- **THE ISLAND HALF — through the ONLY mutator.** A LABELED Update pill right after Refresh (Sprints | Labels | Sync | Refresh | **Update** | theme | Log out), HIDDEN at boot — no update = no button, the honest default — revealed by `hibana:update-available`; the solid --ok green (light #1f7a34 + white ink; claude-dark olive #9BA77A + dark ink, the AA pair flip), twin metrics (41.3px, spread 0), EN 'Update' / FA 'نسخهٔ جدید'. The update modal (the web's own dialog grammar): the version line, the kind + honest size ('Portable update — 7.2 MB from GitHub'), the data-stays note, the live progress bar (the fill SIZES via the PHYSICAL width — the probe's lesson: a Chromium logical inline-size fill never renders — and ANCHORS via the logical inset so RTL mirrors; reduced-motion stills the tween), the restarting panel on ok — NO reload (the Go process restarts the island). The 4 recorded ops (sheet/script on the refresh round's emitted lines; the dialog on the newproject dialog's OWN create id — a bare '</dialog>' anchor now matches THREE spliced dialogs and must never be used; the pill on the Refresh pill's own class+id pair), --check green 63 files idempotent (61→63).

**The proof:** `scripts/probe-update.mjs` — 54/54 ALL GREEN on the REAL island bytes (the mock bridge at the exact Wails boundary; the ApplyUpdate mock HOLDS its response until the probe releases it, so the mid-download ticks are drivable deterministically): the honest default (pill HIDDEN, no event, zero page errors) → the available event reveals the twin-sized green labeled pill in the right row seat → the modal's every fact → Later closes + the offer stands → THE LIVE ROUND (0%→25%→100% → the verify note → the RESTARTING panel, the actions gone, NO reload — the marker survives, the binding exercised once) → the honest verdicts (busy; a real sha256-chain error riding the localized title verbatim; the not-wired rejection; the FA no-update line) → the FA/RTL dark mirror (نسخهٔ جدید + بروزرسانی هیبانا + the mirrored row + the olive fill with DARK ink + the FA modal copy + the FA progress note) → reduced motion. The first VLM pass caught the INVISIBLE BAR (an inline-size fill never rendering) — the probe now reads the RENDERED geometry after the tween settles, so the gate proves the bar on screen, not in the style; VLM clean on all screenshots after the fix. The prior probes ALL PASS on the new dist — ZERO regressions (probe-login / probe-logout / probe-newproject / probe-refresh / probe-soundfx).

**Go:** +internal/update (+11 tests: the parse table incl. the suffix rules, the fail-closed IsNewer, the asset classification incl. the raw hibana.exe asset that must never be picked, both checksums forms incl. the Get-FileHash * marker, the tamper + missing-line fail-closed paths, the zip-entry chain, the progress pacing + the never-surviving .part, the staged Prepare end-to-end vs a fake GitHub, the same-version refusal, the stub contract) + internal/ui/update.go (+7 tests: not-wired ×2, the no-cached-verdict refusal, the emit-only-on-available rule, the shared busy guard + the re-arm, the progress relay, the error/timeout-as-verdicts); gofmt clean, vet green linux AND windows, `go test -count=1 -race` green (8 packages); the cgo-free windows cross-build at 0.1.14-probe PE-verified (dual -X stamps + every round needle: releases/latest, assadigit/hibana-desktop, hibana:update-available, hibana-portable-, checksums.txt, Wait-Process, Expand-Archive).

**The release, zero hands:** the push (9411510) fired the desktop autorelease lane → v0.1.14-desktop cut (lockstep bump 7c25fbc + the annotated tag) → the free windows runner built + published; EVERY asset re-downloaded + sha256-verified against the release's own checksums.txt (installer 9,276,965B 877bad6b… OK · zip 7,630,598B 31eba36d… OK · the zip's EMBEDDED exe deb00965… MATCH — the updater's own verification chain proven against the real release) and the RELEASE exe PE-verified (main.Version=0.1.14 + WebRef=e6661c8 + every round needle INCLUDING the LIVE bound-method bodies — "no update is available" + "the update download timed out" present in the wails-built exe, confirming the plain-cross-build DCE artifact documented since v0.1.6 — + the FA needles by direct byte grep: نسخهٔ جدید ×4, بروزرسانی هیبانا, the FA modal copy).

**Owner-side next:** dogfood v0.1.14 on Windows — install v0.1.13 (or any older release), run it: within ~10 seconds a green Update pill appears next to Refresh; click → Update now → the live bar → "Update ready — restarting…" → the app relaunches ITSELF on v0.1.14 with the boards + sign-in intact (no re-login); `data/logs/hibana.log` carries the "update to 0.1.14 staged + helper spawned — restarting" line. The M0 §7a-7e go; the e2e flake-hunt round (the S219 shard-2 diagnosis); M3 (offline mutations — the upload step becomes REAL then) → M4 (screenshot upload) → M5 (DPAPI + installer polish).

## Session S227 — the S227 triple-fix round (2026-10-26)

**The owner's asks, verbatim:** (1) "[MEDIUM] When you sync using Hibana Desktop, the modal is not complete and needs fix." (2) "[MEDIUM] Hibana desktop, even portable app, must have an automatic appareance in the taskbar (quick access) so next time windows runs it's easily accessible.." (3) "[MEDIUM] In hibana desktop, upload file button exists and it shows a loading as well, but after the loading ends, it doesnt show whether it was sucessful or not, because it doesnt show the thumbnail of the uploaded picture."

**The deliverable (hibana-desktop v0.1.15) — three root causes, three fixes:**

- **THE SYNC MODAL'S COMPLETE FACTS.** The owner's screenshot was the evidence: every step note — the round's LIVE PROOF ("signed in as aliassadi@live.c…", "everything is already s…", "7 b…") — was ellipsized by the note CSS's `max-inline-size: 60%` + `nowrap` + `text-overflow: ellipsis`. The rows are now a mark + (label, note) GRID: the note owns its own full-width line UNDER the label, wraps (overflow-wrap: anywhere keeps a long email inside the card), never ellipsizes; the mark rides column one with a 0.05rem optical offset. Fixed through the ONLY mutator (scripts/sync-island.mjs) with new verify needles — including a HARD FAIL if `text-overflow: ellipsis` ever returns to the sheet.

- **THE UPLOAD'S VERDICT + THUMBNAIL — both missing halves.** (a) The M4 Upload bridge (guide §5.4) never existed: the shim's XHR proxy fired onerror "not implemented until M4" and the row just vanished. Now `ui.Upload(callID, method, path, body, headers)` rides the SAME session/Origin machinery as Request (the full validation grammar), paces on the client's own upload bucket (30/60s), and streams through `client.WriteStream` — a KNOWN-Content-Length write whose progressReader counts bytes AS THE SOCKET ACCEPTS THEM (120ms-throttled) and relays `hibana:upload-progress {id, loaded, total}`; the shim passes the callID FIRST (parallel uploads share one path) and routes events to the per-file bars. The row ends on ✓ + the green "Screenshot uploaded" toast. (b) The media proxy: the island's shot tiles are `/api/media/…` img srcs that landed on the EMBEDDED asset server and 404'd — `bridge.MediaMiddleware` proxies them through the Go cookie jar (authed routes) with Content-Type + Cache-Control forwarded; the THUMBNAIL now loads like on the web.

- **THE TASKBAR QUICK ACCESS.** The portable zip ships NO shortcuts — Windows Search can't find the exe, and after a reboot nothing Hibana remains. `internal/quickaccess` writes its own per-user shortcuts on boot (idempotent via a data-dir marker; a moved portable folder rebuilds at the new path): a Start Menu "Hibana Kanban" entry + a Startup .lnk with `--autostart`, so the next time Windows runs Hibana boots itself to the TRAY (`StartHidden`; one tray-icon click reopens the board). The tray menu gains a checkable "Start with Windows" (default ON per the "must have an automatic appearance"; persisted in mirror meta like close-to-tray). The .lnk writer is a PowerShell WScript.Shell helper with named -File params (the apply_windows.go technique).

**The proof:** the NEW `scripts/probe-completefacts.mjs` — 33/33 ALL PASS in Chromium on the REAL generated island bytes: the modal's three notes render COMPLETE (the owner's exact screenshot facts; no ellipsis, no hidden overflow, on their own line, 91% column width), a 74-char no-break email wraps inside the card, the modal never overflows; the upload round drives the real shim end to end (callID-first call, the bar climbing from the routed byte events, ✓ + toast + the staged tile whose thumbnail LOADS naturalWidth>0 through the media route) — + VLM-verified screenshots. ALL SIX prior probes re-run green on the new dist — ZERO regressions.

**Go:** +internal/quickaccess (pure decision core + windows writer + no-op ladder) + internal/ui/upload.go + client.WriteStream/Media + tests for every new surface (the marker decision table, the bridge allow-lists + 201/429 paths, the media proxy contract, the stream throttle, the tray command mapping, main's --autostart/preference tables); gofmt clean, vet green linux AND windows, `go test -count=1 -race` green (9 packages); the island `--check` green 63 files; docs/PORTABLE.md documents the round.

**The release, zero hands:** the push (79ef5d4) fired the desktop autorelease lane → v0.1.15-desktop cut (lockstep bump f5a8e17 + the annotated tag) → the windows runner built + published (exe + NSIS installer + portable zip + checksums.txt).

**Owner-side next:** dogfood v0.1.15 on Windows — (1) sync: the modal's three facts read IN FULL, long emails wrap; (2) upload: attach a picture to a task — the bar fills with real bytes, ✓ + the green toast + the THUMBNAIL in the grid; (3) after the next reboot Hibana is in the tray (Start with Windows on by default; the tray menu toggles it), and "Hibana Kanban" is in the Start Menu. Then M3 (offline mutations) → M5 (DPAPI + installer polish).

## Session S229 — the per-card sync badge round (2026-10-27)

**The owner's ask:** the design addendum (badge in the card's bottom meta row at the inline-end, four states, no taller cards, teal/muted/danger tokens, Retry pill, Sync button count) + "push commit merge deploy and release" on hibana-source AND hibana-desktop — "they share same kanban."

**The discovery:** the referenced spec + mockup were never in this repo — they live at hibana-desktop's repo ROOT (`hibana-sync-status-spec.md` + `hibana-sync-status-mockup.html`). Read both completely; the spec is the rule set (its §4 label table, §8 timing rules, §9 count rule, §12 a11y and §14 one-source-of-truth are ALL stricter than the chat addendum — e.g. NO tab stop on icon-only badges, the 500ms syncing threshold, announce-only-user-caused-changes, prefer-no-schema-change). Followed the spec; the deltas are noted in the Changelogs S229 row.

**The deliverable (v0.4.1.37):** see Changelogs §1 S229 — the badge on both kanban surfaces, sync-state.js (the one tracker), the byte-identical server twin, the editor-footer detail variant, the four registry icons, EN+FA labels, the full cache-bust sweep + SW v445, and 769/769 with the full ladder green. NO schema change (spec §14 honored — the state is client-derived from the mutation acks, nothing persisted).

**Next (this session, hibana-desktop):** bump the island pin to this ref, add sync-state.js to the island manifest, re-run sync-island (the 12 seam strings are UNTOUCHED — verified: the api() choke point + the 11 fetch/XHR sites are byte-preserved), then the Sync button count badge (#db-sync-button subscribes to HibanaSyncState; count = pending+failed, hidden at zero; icon rotates while any sync runs; SyncNow start marks all pending+failed syncing per §9) + release.

**Credentials note:** the owner pasted a GitHub PAT in chat (again — 5th time). Per the runbook policy ("any token pasted in chat → rotate"), it must be rotated after this round; this push used it only for github.com/assadigit (his own repos, his explicit instruction).
**S229 addendum (the desktop-round support API):** sync-state.js gains hasSyncing() (is any card mid-sync — the desktop Sync button's icon-rotation cue) + its test; sync-state.js v1→v2. Rides v0.4.1.37 (the release workflow's own guard: no new version, no new tag).


## Session S230 completion — the kanban UI redesign, base + completion (2026-11-01)

**The situation:** the previous session's push (aee9acf — the redesign base: hidden #db-counts, the ⋯
menus, the empty states at /icons/empty-state/, the sr-only embedded heading, EN+FA keys) was already
on origin/main when this session started; this session had independently implemented the same handoff
locally (83e80fd, backed up as the tag s230-mine-backup, dropped). Per the preserve-prior-work rule the
base stayed; this round is the completion on top.

**The completion (this commit):** the neutral canvas (var(--statcard-bg)) behind the white lanes,
bleeding to the frame's edges; the scroll scope (only the lanes scroll — the base scrolled the whole
frame, toolbar included); the full-height flex chain (the base's lanes hugged their content); the empty
group's central placement (:has flex); the helper hint's legibility (var(--muted) @ .85 — the base's
#7B8491 @ .66 landed under 2:1); the dark-theme art lift (0.72 — the base's .46 read too faint);
inline EN fallbacks for every empty-state string; the solid ⋯ dots; the version ladder the base owed
(package 0.4.1.38, sw v446 SHELL re-fetch, devboard.css v36 + board-page v24); the e2e the base owed
(board-filters adapted to the ⋯ menu — its hidden data-db-copy broke the spec — + the NEW
e2e/s230-kanban-redesign.spec.ts 10/10); Changelogs + worklog rows; QA shots ×10 VLM-verified
(light/dark/FA-RTL/1100×720/800px/menu/add-flow).

**The FA shots lesson:** the shots script first reused the EN user's boards for the FA session — the
gone state ("این پروژه وجود ندارد") rendered instead of the board (ownership: a user cannot open
another user's project). The FA shots now seed the FA user's own boards; the FA copy + first-lane-on-
the-right verified char-by-char.

**Desktop round (next):** bump the island pin to this ref, add public/icons/empty-state/*.png to the
sync manifest, re-run sync-island (the 12 seam strings verified byte-intact in the base), drift check,
probes, release.

## Session S232 — delete-any-label (2026-11-01)

**The owner's ask, verbatim:** "There are two labels that can't be deleted. why? fix it." (with a
screenshot of the Labels dialog: s208-live used 2×, s211-acceptance used 1×, no ✕ on either row).

**The why (a designed limit, not a bug):** the S30 label manager made delete UNUSED-ONLY on purpose
("delete-unused tags", the owner's own 2026-09-12 wording): devboard.js rendered the ✕ only on
usage_count=0 rows, and the endpoint enforced it (409 tag_in_use). Any label attached to a task was
un-deletable — the only path out was unlinking it from every task (or merging) first.

**The fix, one seam, three surfaces (v0.4.1.40):**

- **THE ENDPOINT** (`src/routes/tags.ts:169`): DELETE /api/tags/:id takes `?force=1` — a used tag
  cascades exactly like a merge with no target: dev_task_tags + project_tags links drop,
  `syncTaskSearchTagsBatch` rewrites every affected task's search_tags (FTS forgets the name), the
  response carries `removed_from`. WITHOUT force the 409 guard stays (old clients + accidental
  deletes keep their protection). The vitest suite proves the cascade end-to-end: links gone from
  the board GET, search q=Beta → 0 hits, removed_from 2, unused-delete flow kept.
- **THE LABELS DIALOG** (devboard.js, S232): the ✕ rides EVERY row. A used label confirms first
  through the S210 design-system modal (danger grammar; the count baked into the message —
  db.labelsDelConfirm EN+FA) then DELETEs with force; an unused one deletes at once as ever; a
  race-lost delete (409 between load and click) surfaces the new db.labelsInUse toast. The hint
  copy follows ("deleting a used label removes it from its tasks").
- **THE SETTINGS CHIPS** (tags.ts chipsHtml): the hx-delete ✕ rides used chips too — count baked
  into hx-confirm server-side, force=1 on the URL; the "Used tags are merged, never deleted"
  footnote retired for the cascade truth.

**The ladder:** typecheck 0 · vitest 770/770 · parity 1527/1527 (+3 keys ×2) · cache-bust PASS
(devboard.js v30, i18n-en v103, i18n-fa v97 across every page + the three JS injectors; sw v448
SHELL re-fetch) · e2e label-manager 3/3 (both used rows carry the ✕; cancel keeps the label;
confirm → force=1 → 200, row gone, every card's chip gone, the 3 tasks stay) · the kanban suites
36/36 (s206/s207/s209/s230/filters — devboard.js is shared). Docs: API-AND-SYNC-CONTRACT §3.4,
DATA-MODEL §2.5, GO-DESKTOP-IMPLEMENTATION-GUIDE §4.1 table re-lined. Changelogs row 232 + the
backfilled 231 row (the polish round shipped without one).

**The desktop half (hibana-desktop, next commit):** the island rides this ref (pin bump +
the DELETE seam patch re-record — the find-string grew the force expression), AND the round fixes
a pre-existing island gap this feature exposed: the shim never provided `window.hibana.confirm`
(the web gets it from app.js, which §3.2 strips) — so on desktop the task-editor delete, label
merge, archive-done and clear-done confirms all threw silently. The shim now owns the S210 confirm
modal (same markup, same classes — components.css ships the styles in the island already).

## Session S233 — every modal carries a top-right close (2026-11-01)

**The owner's ask, verbatim:** "Make sure all modals, like the screenshot , which is settings, have
close button on top right." (the screenshot: the DESKTOP settings sheet — Sync / Update app /
GitHub access / Account / Appearance — with NO corner close; only the bottom Done button.)

**The scope, honestly:** the app's modal grammar unifies on ONE contract — a close affordance rides
the header row's inline end (RTL mirrors to the trailing corner) of EVERY modal. The task editor,
labels manager, pinned-pictures dialog and lightbox ALREADY spoke it (the row-spread ✕ grammar).
This round brings the remaining surfaces of the shared seam; the desktop's five native dialogs
(sync / logout / new-project / update / settings — the screenshot's own) + the shim's confirm port
follow in the island round (pin bump below).

- **THE S210 CONFIRM CARD** (app.js — the app-wide confirm): a head row — title (when present) on
  the inline start + the corner ✕ (`data-hib-confirm="x"`, its OWN value so the e2e cancel
  locators stay single-match) wired to `close(false)` — the cancel path's twin, never the confirm.
  A title-less card keeps the corner (`margin-inline-start:auto`). CSS: `.hib-confirm-head` /
  `.hib-confirm-x` in components.css (36px tap floor for the glyph-only control).
- **THE SHOT-NOTE EDITOR** (`#db-shotnote`, devboard.js) + **THE DELETE-TASK CONFIRM**
  (`#db-del-confirm`, board-page.js): the h3 rides a `row spread` with the ✕ on the inline end
  (`aria-label` = the pin's own `common.close` — EN+FA already in parity), wired to the dialog's
  close (the Cancel twin). Esc / backdrop / Cancel contracts untouched.

**The ladder:** typecheck 0 · vitest 770/770 · parity 1527/1527 (no new keys) · cache-bust PASS
(app.js v221, devboard.js v31, board-page.js v26, components.css v10 across every page + the three
devboard injectors; sw v449 SHELL re-fetch) · NEW e2e/s233-modal-close 2/2 (the board's modal
census — editor + labels ✕ close their modals; the delete-task confirm's title-row ✕ closes with
the task surviving; the danger confirm's corner ✕ resolves cancel — overlay gone, the used label
kept) + the kanban suites 27/27 (label-manager/s206/s209/s230/filters) + s193/s152 spot-checks.

**The desktop half (hibana-desktop, next commit):** the island rides this ref (pin bump to this
sha + the five native dialogs' own ✕ rows + the shim's confirm port kept 1:1 with app.js + the
kept-markup pins extended + v0.1.30).

## Session S237 — Focus Mode (2026-11-04)

**The spec'd round (self-contained S237 brief):** a per-lane visual isolation for the board —
"when the user writes/adds tasks in one column, the other four columns' text, color and movement
are distracting." One settings toggle (default OFF) gates two per-lane head controls: a blur
focus (the other four lanes dim + go inert) and an enlarge sheet (the lane as a centered modal
with a quick-add). F / [ / ] / Esc keyboard layer. Persisted + auto-restored.

**THE S236 FINDING (read this first — it shapes the whole round):** the session brief's stated
baseline (hibana-source @ d0245ba, hibana-desktop @ c5106eb + tag v0.1.33-desktop, "local, not
yet pushed") does NOT exist anywhere reachable: remote main is 097f91e (S235), the live worker is
v449-era, the dev worker v446-era, no branch/PR/tag carries S236 — the commit lived only in the
previous session's sandbox and is gone with it. S237 therefore builds on the REAL remote base
(097f91e). The version ladder RESERVES S236's slots rather than reusing them — SW jumps
v449 → v451 and the desktop will jump 0.1.32 → 0.1.34, so the documented ladder (v450 / 0.1.33
= S236) stays truthful and a future S236 re-run takes fresh numbers above v451. Disclosed here
and in the final report; the owner should re-run S236 (sprint-page optimistic local mutations)
as its own session if that work is still wanted.

**The scope, honestly — pure client, zero server/API/DB surface:**

- **THE PURE CORE (public/js/focus-core.js, NEW):** every decision extracted from the DOM half —
  parseToggle ('on' is the only ON spelling; default OFF), cycleLane (the [ / ] wrap over the
  five lanes, DOM order), escLayer (EXACTLY one layer per press, sheet → focus, else null — not
  our Esc), autoRestore (toggle-on × valid-lane), resolveFKey (hover → last → null, never a
  guess). Zero DOM/fetch/i18n; evaluated byte-for-byte by the new suite (the sync-state harness
  doctrine). Loaded by board.html only (defer, before devboard.js); board-page.js's self-healing
  ensureLib re-injects it at the same ?v=.
- **THE BOARD HALF (board-page.js + devboard.css):** module focus state {enabled,
  focusedStatus, sheetStatus} + the two head buttons INSIDE the ⋯ wrap (before the ellipsis —
  the wrap owns the inline-end grouping, ghost .db-col-menu-btn metrics, aria-pressed + is-active
  on the focus button). OFF = byte-identical markup to today. The dim recipe is ONE class per
  lane container (.db-dim: blur(3px) saturate(.5) opacity .4 + pointer/select inert — DOM order
  untouched, Tab users pass through), re-applied by applyFocus() at every render's tail so the
  focus SURVIVES re-renders (task creates/edits/moves all funnel through render()). The
  ~150ms transition lives on the lane unconditionally (inert while OFF — filter/opacity never
  change elsewhere) so enter/move/exit all play; prefers-reduced-motion kills it in CSS.
- **THE ENLARGE SHEET:** a centered dialog (role=dialog, aria-modal, S233 corner-✕ grammar,
  focus-return to its opener) over a z-80 dimmed-board overlay (below the editor's z-90 so an
  editor opened from a sheet card stacks on top; below confirm 800 / toasts 600). Sticky
  auto-focused quick-add — Enter creates through devboard's OWN createTask (the same POST the
  editor path uses; zero duplicated logic; the desktop's S234 classifier still sees the create
  cue), clears + STAYS OPEN for rapid entry. The cards are CLONED from the board lane's
  .pd-tasks innerHTML (the sheet mirrors the lane — same markup, same filter view, count mirrors
  the board badge) into a .db-focus-cards.db-cols container that re-scopes every `.db-cols …`
  card rule verbatim with only the lane GRID geometry neutralized (vertical flex) — the two
  surfaces can never drift. Drag disabled in-sheet (v1): post-render draggable=false + the
  dragstart guard. One sheet at a time; backdrop click + ✕ + Esc close; sheets are ALWAYS
  transient (never restored).
- **THE KEYBOARD LAYER:** capture-phase document listener + stopImmediatePropagation on a
  consumed Esc — one press peels exactly one layer and never double-fires zen-mode's own
  (web-only) Esc listener in the same press; when no focus layer is ours the press is left alone
  (menus/dialogs/zen keep their contracts). F toggles the hovered lane (mouseover tracking) or
  the last lane — the button's twin, never a guess. [ / ] cycle with wrap, only while focus is
  active. Input/textarea/contenteditable guard + modifier guard (Ctrl+F stays the browser's).
  <800px: the buttons hide via CSS + the lane shortcuts no-op (Esc-sheet-close stays armed —
  modal hygiene at any width; a documented default).
- **THE SETTINGS SURFACE + I18N:** settings.html gains the toggle row (the autopolish pattern);
  settings-page.js persists hibana-focus-mode = 'on'|'off' and dispatches hibana:focus-mode —
  the SAME key + event the desktop panel writes (two codebases, one switch; the board listens
  and re-renders LIVE, no reload). hibana-focus-last persists the focused lane, auto-restored at
  boot (fresh DOM, no animation). db.focus.* — 9 keys EN+FA (mode, hint, toggle, exit, enlarge,
  sheetAdd, sheetTitle, on, off), inline EN fallbacks at every _t() call site; parity 1536/1536.
- **THE PROBE SURFACE:** window.HibanaBoard.focusState() → { enabled, focusedStatus,
  sheetStatus } (attached at boot, removed at unmount — desktop probe-focus reads it).

**RTL decisions (recorded per the spec's ask):** the sheet + head buttons are all logical
properties (mirrors for free). [ / ] operate on READING order (= DOM order): [ is
"reading-order previous" in BOTH languages — physically left in EN, physically right in FA,
matching the OS-level RTL arrow-mirroring convention. This was REASONED, not user-tested —
flagged for the owner's FA check; flipping later is a two-line change in focus-core.js
(cycleLane's step sign under document.dir === 'rtl').

**The ladder:** typecheck 0 · eslint 0 · vitest 796/796 (778 existing + 18 NEW:
src/tests/focus-mode-s237.test.ts — the real focus-core.js evaluated against a fake window
[parseToggle's truth table, the [/] wrap both directions + stale-value fallback + the
devboard.js STATUSES parity tripwire, escLayer's inside-out ordering, autoRestore's rule + all
five lanes, resolveFKey's hover/last/nothing ladder] + the wiring pins [board.html's tag order,
board-page.js's capture/stopImmediatePropagation/dialog roles/createTask reuse/the exactly-4
fetch sites, devboard.css's recipe markers, the settings surfaces, both dictionaries, sw v451])
· parity 1536/1536 · cache-bust PASS (focus-core.js v1 NEW, board-page.js v27, devboard.css v38
across 23 pages, i18n-en.js v104 + i18n.js v157 across 26 pages — v157 carries the lazy
i18n-fa.js?v=98 injector literal — settings-page.js v18; sw v451 SHELL re-fetch) · escape-lint
PASS (215 sinks) · fn-shape PASS — one PRE-EXISTING row allowlisted (devboard.ts PATCH
/api/sprints/:id @L650, 72 lines, grown by the S235 audit round before this session; recorded in
FN-ALLOWLIST.md with the provenance note) · bundle-size PASS (+4.5%) · precache PASS ·
package 0.4.1.42 + Changelogs row.

**The desktop half (hibana-desktop, next commit):** the island rides this ref (pin bump +
focus-core.js joins JS_FILES + the panel's Focus-mode row writes the same key + probe-focus as
the 11th probe + v0.1.34 — S236's 0.1.33 slot reserved-lost, same doctrine as the SW ladder).

## Session S237 delivery — the red-CI unblock (2026-11-05)

**The state found at delivery time:** dac869f was already on remote main, tag v0.4.1.42
cut, the GitHub Release published — but CI had been RED for EIGHT consecutive main pushes
(since S231's 6037d8f1, 2026-10-31), so CD's deploy lane was skipped every time
(workflow_run conclusion ≠ success) and prod sat at v449 (S233-era, last deployed by
hand). The whole red run was TWO stale e2e pins — assertions still encoding the
pre-S231 typography that S231 deliberately replaced (its own CSS comments say so):

- e2e/s105-owners-agenda.spec.ts S105-6 pinned the board title at 12px; S231's line reads
  `.db-cols .pd-task-title { font-size: 0.875rem } /* 14px — the board's scan size */`.
- e2e/s110-meta-parity.spec.ts pinned board metaFont === project metaFont; S231's line
  reads `.db-cols .pd-task-meta { font-size: var(--fs-xs) } /* 12px — was fs-xs × 0.8 =
  9.6px */` — the board's meta reads at the full token BY DESIGN now; the project page
  keeps the 9.6px whisper. The byte-identical MARKUP parity pins (meta text, banner,
  chip renderer) still hold — only the font sizes are per-surface by design.

**The fix (this commit):** the two specs adopt the S231 values — the title pin moves to
14px (weight 700 unchanged) and the meta font pin becomes the two per-surface values
(project 9.6px / board 12px), each with a provenance comment citing S231's CSS. ZERO
production-code changes. Both specs re-run locally 11/11, then the FULL suite re-run as
CI's own two-shard split: 238/238 (shard 1) + 231/231 (shard 2) — the first full-suite
green since 073bb953's round.

**The chain this unblocks:** CI green on this commit → CD's guard passes → the deploy
lane fires (dev worker → health probe → prod on hibana.ir) → the S237 carriers go live →
scripts/live-focus-probe.mjs (follows as its own chore commit, the S232 precedent)
verifies the deployed round end-to-end. The desktop half was already fully delivered:
07835cf + tag v0.1.34-desktop pushed, the Windows release PUBLISHED with all three
assets (installer.exe + portable.zip + checksums), island --check byte-identical at pin
dac869f, probe-focus ALL GREEN (6 LEGs / 33 assertions).
