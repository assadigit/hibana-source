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

## Session 218 — the publish + the auto-release lanes (2026-10-19)

**The owner's ask, verbatim:** "commit and push and release new version, after every update auto-release on github please."

**Opening state:** the sandbox reset had LOST the S216/S217 LOCAL commits (desktop v0.1.5 dark mode + v0.1.6 sync button). hibana-desktop remote: c586dbd (v0.1.4). The built exes survived in the delivery folders.

**The recovery (byte-exact, proven):** the islands were CARVED out of the surviving exes (go:embed stores island files verbatim; the v0.1.6 exe yielded index.html/theme.js/sync-js/sync-css, the v0.1.5 exe yielded its own index.html — proven byte-equal to v0.1.6's minus exactly the 4 S217 ops). sync-island.mjs re-extended round-by-round: the S216-only variant reproduces the 52-file v0.1.5 island byte-identical to the carve; the full script reproduces the 54-file v0.1.6 island byte-identical; `--check` green + idempotent + tamper-proven. The Go layers re-implemented from the session records (theme.go, InjectShellState, the tray Theme submenu, the registry boot background, round.go, ui/sync.go, the emit relay). The two-round history rebuilt faithfully: 372dc2e (v0.1.5, 61 tests + -race) → 6981fee (ci: the release notes ride the annotated tag) → a254d4d (v0.1.6, 74 tests + -race + the autorelease lane).

**The push + the honest finding:** main + v0.1.5-desktop + v0.1.6-desktop pushed. Every Actions run refused to start — "recent account payments have failed or your spending limit needs to be increased" (the private-repo Windows minutes, 2× billed, consumed by the S211-S217 rounds). NOT a workflow bug — the runs were created, the runners refused. **The releases were published the direct way:** both artifact sets built HERE from the tagged trees (wails CLI v2.17.0 via go install on Linux; NSIS 3.12 extracted from the Debian deb with NSISDIR — the wails `-nsis` lane works on Linux, the installer is a real Nullsoft PE; portable zips + checksums per the make-portable contract) and published via the GitHub API with the tag-message notes. Every asset re-downloaded as a user + sha256-verified against its own checksums.txt (installer + zip + the zip's embedded exe).

**RELEASES LIVE:** https://github.com/assadigit/hibana-desktop/releases/tag/v0.1.5-desktop + …/v0.1.6-desktop — each carrying hibana-amd64-installer.exe + hibana-portable-X.Y.Z.zip + checksums.txt. Delivered to download/hibana-desktop-0.1.5-windows/ + …-0.1.6-windows/.

**The auto-release lanes (the standing ask, wired + ready):** (1) desktop `.github/workflows/autorelease.yml` — every push to main that is not a release-bump commit, not already hand-tagged, and is the branch tip gets the NEXT patch cut automatically: the version files bumped in lockstep on a `chore(release): bump to X.Y.Z (auto-release)` commit (wails.json + versioninfo.json via jq, the desktop.yml placeholder + make-portable default + main.go stamp via sed), the annotated tag carrying the commit-range notes, pushed → the EXISTING tag lane builds + publishes. Three loop guards close the cycle. (2) this repo's `.github/workflows/release.yml` — package.json's version is the release truth; a NEW version cuts tag vX.Y.Z.W + a release whose notes are the project's own Changelogs row (docs pushes skip by paths-ignore). (3) the desktop.yml release job rewritten: the notes ride the annotated tag (read back via the pure-API call) — ONE mechanism for hand-cut AND auto-cut releases.

**Owner-side next:** fix the Actions billing (Billing & plans) OR flip both repos public (the standing Q7 — standard runners free + login-free downloads) — then the lanes prove themselves on the very next push; dogfood v0.1.6 on Windows (sync flow → offline → mid-round reopen → the v0.1.5 theme surfaces → the v0.1.4 switcher → the v0.1.3 tray); the M0 §7a-7e go; M3 → M4 → M5.

## Session 219 — the public flip + the lanes' first live firings (2026-10-20)

**The owner's ask, verbatim:** "Make the repo's public and continue your job."

**The public flip:** BOTH repos flipped PUBLIC via the API (hibana-source + hibana-desktop) — free standard runners (the billing wall was a private-repo-minutes problem) + login-free release downloads. The nine §10 questions' Q7 finally closed.

**The re-runs:** release/CD/Uptime GREEN (the release lane's guard exit: "tag v0.4.1.36 exists — this update rides the already-released tag. Nothing to cut."), the desktop main CI GREEN, the desktop autorelease guard-exit GREEN.

**The live firings + the two landmines (only a live firing could expose them):**
1. the desktop.yml dev-placeholder sed: bash double quotes collapsed the pattern's double-backslash-dollar-v into a bare dollar-v expansion — set -u killed it ("v: unbound variable", run 39347297230). Fixed with the full escape; rehearsed END-TO-END against a seeded bare repo BEFORE re-pushing (bump commit + 5-file lockstep + annotated tag + push all reproduced clean).
2. the bump push refused: GITHUB_TOKEN can NEVER push a workflow-file change (GitHub refuses App-token workflow updates), and the hard-9 lockstep bump touches desktop.yml by design. Fixed with the RELEASE_PAT repo secret (the owner PAT, workflow scope, sealed via the sealed-box API — the HIBANA_SOURCE_TOKEN precedent), embedded in origin's URL by the checkout so `git push origin main "$TAG"` inherits it.
3. plus the re-run-safety round: the desktop release job IDEMPOTENT (existing release → only missing assets upload) + the pinned-ref gate public-clone fallback (a stale HIBANA_SOURCE_TOKEN can never red the gate).

**The end-to-end proof:** the fix push itself fired the lane: cut v0.1.7-desktop (bump 0571b78, lockstep ×5, annotated tag, loop guard closed) → the FREE windows runner built (both island gates green — the fresh sync at e6661c8 reproduced the committed island byte-for-byte; NSIS via the choco/SourceForge fallback; dual -X stamps) → release v0.1.7-desktop LIVE with installer + portable zip + checksums. Every asset re-downloaded + sha256-verified (installer OK · zip OK · the zip's embedded exe MATCH); the PE strings carry main.Version=0.1.7 + WebRef=e6661c8 + manifest 0.1.7.0; the four 0.1.6 residues are the island's own sync-button feature comments (benign).

**The web lane:** the re-run guard-exited green on the pre-existing v0.4.1.36; the next package.json bump cuts v0.4.1.37 hands-free (release.yml, package.json = the release truth).

**The one honest red — the CI e2e shard-2 flake (diagnosed, NOT a product regression):** the ci job (the full unit/type/lint/build ladder) GREEN; e2e shard 1 GREEN; e2e shard 2: the s207 kanban-frame WIDTH geometry test failed ALL THREE shard runs tonight with three DIFFERENT offsets (frame.left = 10px, 57px, 15px — each attempt a different value breaking the exact-zero edge-to-edge pins) + the sprint-doc test's FIRST attempt hit the "Payments flow12.1" name-concatenation race twice (GREEN on the in-job retry both times — the suite's documented S196 race class; the first title-path catches after "the title never flaked in 40+ runs"). The same tree was FULLY e2e-green at 19:17 (run 39309699841); the traces prove the client sent perfect payloads (POST name clean; the autosave PATCH description-only by design), every CSS 200, every API 200, the correct rail-edge boot class — the breaks are runner-side render nondeterminism, not app bits. Same runner version + ubuntu-24.04 label on both sides; the rolling-image/Chromium drift theory is unproven from the outside. NO blind test patch this session — the S196-style flake-hunt round owns the fix (pin the runner image off the rolling label / re-harden the exact-pixel pins / hunt the sprint-doc title race at its source).

**Owner-side next:** dogfood v0.1.7 on Windows (login-free download now); the M0 §7a-7e go; the e2e flake-hunt round; M3 → M4 → M5.

## Session 220 — the desktop sync-button visibility round (2026-10-20)

**The owner's ask, verbatim:** "There is still No Sync button, I want a sync button on the header of app, next to sprints and labels, but colored. (fill colored) also sprints and labels need to be same size."

**The honest diagnosis:** v0.1.6 HAD shipped a sync button — but as a ghost ICON-ONLY control at the toolbar's far edge, after the theme icon. To the owner's eye that reads as NO sync button at all. The round's brief: make it unmissable, exactly where asked.

**The fix (hibana-desktop v0.1.8):** the button is now a LABELED, FILL-COLORED CTA pill directly after Labels (Sprints | Labels | **Sync** | theme) — the app's own bare-button solid-primary grammar (--cta teal #2E7B7F light / terracotta #c2643f dark, white ink, the refresh glyph + the "Sync" label, EN/FA desktop-localized + live-repainted). The "same size" ask exposed a real bug: Sprints (an `<a>`, a.ghost's 0.75rem/400 box) had diverged from Labels (a `<button>`, the global 1rem/500) — ONE #id twin rule pins both identical; all three buttons measure exactly 41.3px.

**The island layer:** regenerated through its ONLY mutator — the button op re-anchored to the pinned Labels line, DESKTOP_SYNC_CSS grew the twin rule + the CTA pill (the transparent 1px border keeps the filled box the ghost-hairline height), DESKTOP_SYNC_JS grew the btnLabel pair + the label repaint, and verifyDist grew the position/label/twin gates. --check green 54/54, idempotent.

**The proof (browser, real island bytes, InjectShellState-parity mocks):** the trio measured 41.3px ×3 with the fill rgb(46,123,127)/rgb(194,100,63); the modal round end-to-end ("will not vanish" + counts + time, Done closes); the FULL FA/RTL boot mirrors the row + completes the FA modal; VLM light/dark/RTL screenshots clean; ZERO console errors. Tooling lesson recorded: a literal "[main]" renders as "ain]" through ANSI-escape stripping — the workflows were never corrupted (blob-hash-proven); read bytes, not rendered output.

**The release, zero hands:** the push fired the lane → v0.1.8-desktop cut (bump 25ff370, loop guard closed) → the free windows runner built + published (tag-lane run 38 green). Every asset re-downloaded + sha256-verified (installer 9,180,216B 75f4319a… · zip 7,533,252B e7ecbfe2… · the embedded exe 876da16b… MATCH); PE needles main.Version=0.1.8 + db-sync-cta + db-sync-btn-label.

**Owner-side next:** dogfood v0.1.8 (login-free download; the colored Sync between Labels and the theme icon, the twins, the dark terracotta, the FA mirror); the M0 §7a-7e go; the e2e flake-hunt round; M3 offline mutations → M4 screenshot upload → M5 DPAPI + installer polish.

## Session S221 — the desktop sign-out round (2026-10-20)

**The owner's ask, verbatim:** "It must also have option of logout and enter with a new account."

**The gap:** v0.1.8's board signed IN beautifully but had NO way to sign OUT — a stored session booted straight to the board forever, and a second account on the same machine was impossible.

**The deliverable (hibana-desktop v0.1.9):** the toolbar row now CLOSES with a LABELED ghost **Sign out** button (Sprints | Labels | Sync | theme | **Sign out** — the account zone), riding the PIN'S OWN `nav.signout` key (EN 'Sign out' / FA 'خروج' via data-i18n — the S220 lesson: a bare icon at the row's edge reads as nothing) + `common.cancel`, twin-sized with its neighbors (all four labeled buttons exactly 41.3px). The click opens a NATIVE confirm dialog (the web's own `dialog.dialog` + `.modal`): the confirm is the BARE `<button>` — the S186 CTA grammar, the login gate's own "Sign in" shape (the first cut used the neutral `.btn`; the VLM pass caught it and the fix landed BEFORE the release).

**The Go side (ui.API.Logout — the §5.5 login surface's counterpart):** POST /api/auth/logout BEST-EFFORT (an offline sign-out still completes; a 401 answer is the already-dead end state; a 10s deadline), then the LOCAL account state dies in a fixed order — the client's cookie + ETag cache TOGETHER (`api.ClearSession`: a surviving validator would let the post-login pulls cheap-poll 304 against a mirror that was just wiped), the persisted session file, the mirror's account-scoped rows + pull cursors (`store.ResetAccount`, ONE transaction; the `ui.theme` + `ui.hide_on_close` DEVICE prefs survive a sign-out — the keep-list is caller-parameterized), and the silent state flip (no `hibana:auth-required` event — the island reloads into the gate). desktop-logout.js `location.reload()`s on `{ok:true}`: the shell serves `data-desktop-authed="false"`, the login card opens at FIRST PAINT, and signing in with the NEW account boots its kanban.

**The island layer:** 4 recorded HTML ops + js/desktop-logout.js (click-time Logout resolve, the notWired/unreachable branches, the EN/FA body pair live-flipped, NO storage) + css/desktop-logout.css, all through the ONLY mutator; verifyDist grew the position/S186/click-time/reload/body-copy/twin/chain/manifest/no-storage/node-check gates. --check green 56 files, idempotent.

**The proof:** +7 Go tests (client round-trip + the ClearSession pair-dies + re-login; ResetAccount full coverage; the bridge round-trip incl. the silent flip + the re-login + the offline completion); gofmt/vet (linux+windows)/test/race green; the cgo-free windows cross-build PE-verified with the db-logout-* + nav.signout needles. **scripts/probe-logout.mjs 28/28** on the REAL regenerated island bytes: the stored-session boot, the row order + the four twins, the dialog labels, Cancel = no state change, the confirm → reload → the gate VISIBLE at first paint, the NEW-ACCOUNT sign-in → the gate hides + the toolbar returns, the FA/RTL DARK mirror ('خروج', dir=rtl, the mirrored row, the FA dialog); VLM clean on all four screenshots; ZERO page errors. One probe lesson: the /wails/runtime.js mock must be built PER REQUEST (a module-level constant froze the EN state into the FA pass — the bindings read the LIVE Go state; data-desktop-authed is only the first-paint hint).

**The release, zero hands:** the push (1b17171) fired the lane → v0.1.9-desktop cut (the lockstep bump c11578b) → the free windows runner built + published; every asset re-downloaded + sha256-verified against the release's own checksums.txt.

**Owner-side next:** dogfood v0.1.9 on Windows (the Sign out at the toolbar's end, the confirm modal, the post-sign-out login card, a second account, the FA 'خروج' mirror, the dark look); the M0 §7a-7e go; the e2e flake-hunt round (the S219 shard-2 diagnosis); M3 offline mutations → M4 screenshot upload → M5 DPAPI + installer polish.
