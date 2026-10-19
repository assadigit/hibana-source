# Hibana Project/Kanban — Windows Packaging, Distribution & Auto-Update Plan

> **What this is:** the Windows packaging + build/CI + distribution + auto-update plan for
> the Go desktop port of the Hibana kanban — the expansion of `GO-DESKTOP-PORT-PLAN.md` §7
> (the ~10-line packaging sketch, `GO-DESKTOP-PORT-PLAN.md:131-139`) into the complete plan
> the owner asked for on 2026-10-20 (S209): *"…to replicate this kanban and its features and
> sync ability using GO, for a Windows app (both installable and exe)."*
>
> **Convention:** facts about the CURRENT repo are **VERIFIED** against the v0.4.1.35 / S209
> working tree with `file:line` citations (the tree: `package.json:3` = `0.4.1.35`, `git`
> head `8407d63` + uncommitted S209 session changes). Everything about the desktop app is
> **[PLAN]** — no desktop code exists or should exist yet. Decisions only Ali can make are
> **[OWNER]**.
>
> **Prerequisites (read first):** `GO-DESKTOP-PORT-PLAN.md` (§1 stack, §2 tree, §7 sketch,
> §8 milestones), `API-AND-SYNC-CONTRACT.md` (§2 auth/origin, §7–§10 the desktop contract),
> and `UI-UX-REPLICATION-SPEC.md` (landed this session; its §7 is the reproduce-exactly vs
> native-replace contract) — while `board.html`'s own link/script list stays the verified
> ASSET manifest for the island copy: `board.html:10-29` CSS, `:30-47` vendor+JS, `:91`
> `board-page.js`.

## 1. Delivery targets — BOTH an installer and a bare .exe

The owner's requirement is explicit: an **installable app AND a portable exe**, one code
base. The whole plan hangs on this dual-target matrix:

| | (a) INSTALLABLE | (b) PORTABLE |
|---|---|---|
| Artifact | `hibana-setup.exe` (NSIS, §4) | `hibana.exe` (raw Wails output) + `hibana-portable-<ver>.zip` |
| Binary | **identical Go binary** — same `wails build` output | same |
| Data dir | `%LOCALAPPDATA%\hibana\` (mirror, logs, config) | `.\data\` next to the exe (§8) |
| Credentials | DPAPI blob under `%LOCALAPPDATA%\hibana\` | DPAPI blob under `.\data\` (§8 — portable ⇒ DPAPI scope caveat) |
| Shortcuts / Start Menu / uninstall | yes | none — delete the folder |
| Distribution | GitHub Release (§7) or direct download | GitHub Release zip — **the owner already consumes per-version zips** (`Agents.md:95-100`: bump `package.json`, zip `hibana.<version>.zip` to the owner's upload/download folders) |
| Upgrade | run new installer (§6) | in-place swap (§6) |

**Mode selection [PLAN]:** one binary, two wrappers. Portable mode is chosen by a
`--portable` flag on first launch OR a zero-byte `portable.marker` next to the exe; the
choice is recorded in the data dir so the app never silently migrates `%LOCALAPPDATA%` ⇄
`.\data`. Rule: **never mix** — a portable exe finding an installed profile asks once and
writes the answer into `.\data\mode.lock`. The portable zip ships a 2-page
`docs/PORTABLE.md` (where data lives, how to back it up, "don't put the exe in a synced or
protected folder").

### 1.1 Installer technology — NSIS vs WiX/MSI, compared honestly

| | **NSIS** (recommended) | WiX → MSI |
|---|---|---|
| Size overhead | small (~1–2 MB over the payload, LZMA/solid) | heavier (~2–4 MB + MSI machinery) |
| Complexity | NSIS script language (procedural, terse, well-documented) | WiX v4/v5 dotnet toolchain, XML schema, steeper |
| Per-user install (no UAC) | first-class (this plan's default) | MSI is per-machine by default; per-user is possible but awkward |
| Per-machine / enterprise GPO+SCCM | possible but manual | **first-class** (AD deployment, transforms, upgrade codes, rollback) |
| Silent install | `/S` (plus our own flags, §4.3) | `msiexec /qn` — cleaner story |
| Wails integration | **native**: `wails build -nsis` emits the installer, config in `wails.json` | none — separate WiX project wrapping the exe |
| Code signing | sign exe + installer + uninstaller (§5) | sign the .msi (single artifact — slightly simpler) |
| Uninstall completeness | whatever the script does (we spec it fully, §4.4) | reference-counted components; residue is common anyway |

**Recommendation [PLAN]: NSIS.** (1) It is what Wails v2 natively produces (`wails build
-nsis`, config in `wails.json`) — zero extra toolchain to own; (2) per-user install into
`%LOCALAPPDATA%\Programs\hibana` needs no elevation, matching a single-user personal tool
(the app is single-user by design — one owner, one account, cookie session;
`API-AND-SYNC-CONTRACT.md` §2); (3) silent `/S` covers the future auto-update path (§6);
(4) the WiX/MSI advantages (GPO, fleet management) are worthless for a personal tool and
only become real if the owner ever distributes inside a managed organization — at which
point MSI is a bolt-on wrapper, not a rewrite (the Go binary is unchanged).

## 2. The Go stack [OWNER-CONFIRMED 2026-10-21 — S210; details still [PLAN]]

**Wails v2** (Go + WebView2 on Windows) — **the owner locked this stack on 2026-10-21
(S210): *"Okay go this way: Go + Wails v2 + WebView2 + modernc.org/sqlite"*; the decision
record with the full rationale + accepted costs is `GO-DESKTOP-IMPLEMENTATION-GUIDE.md`
§0 (ADR-001), and the step-by-step build instructions are the same guide §1–§12.** This
section keeps its original evidence trail (it matched `GO-DESKTOP-PORT-PLAN.md` §1's
conclusion, "Wails… remains the leading candidate", `GO-DESKTOP-PORT-PLAN.md:25-28`),
which rested on its verified portability table (`GO-DESKTOP-PORT-PLAN.md:16-23`):
`devboard.js`/`chip-render.js` HIGH (pure JSON+DOM), `board.html`+`board-page.js`
MEDIUM-HIGH — the tested board renderer is reusable nearly verbatim, so a WebView-hosting
shell discards nothing. **The Fyne fallback condition below is RETIRED** (it existed only
for "if WebView2 is unacceptable to the owner" — the owner has accepted it); the table
stays for the record.

**WebView2 runtime reality [VERIFIED fact + fallback]:** WebView2 ships preinstalled on
Windows 10/11 (with Edge, via Windows Update); the realistic gaps are LTSC/Server SKUs and
stripped VMs. Fallback: probe the runtime (`GetAvailableCoreWebView2VersionString`) at
boot; if absent, offer to run Microsoft's Evergreen Bootstrapper
(`https://go.microsoft.com/fwlink/p/?LinkId=2124703`) with `/install /silent` — or the
installer bundles it offline (§4.2). Wails' WebView2-strategy build flag (`-webview2
embed|download|browser|error`): re-verify against the pinned Wails v2 CLI [PLAN-verify].

**Alternatives, honestly compared:**

| Stack | Dependency | UI reuse | Honest verdict |
|---|---|---|---|
| **Wails v2** | WebView2 (preinstalled Win10/11) | **the board island runs nearly as-is** (`GO-DESKTOP-PORT-PLAN.md:53-63`) | **DECIDED [OWNER, 2026-10-21]** — the whole point of the portability audit (ADR-001) |
| Fyne | none (pure-Go OpenGL UI) | **zero** — full UI rebuild in Fyne widgets | REJECTED — the fallback condition is retired by the owner's S210 decision; discards the tested board renderer, chip-renderer byte-parity, FA/RTL CSS, and every e2e-pinned behavior — months of re-parity work |
| Gio | none (pure-Go, immediate mode) | zero | same as Fyne, steeper learning curve, smaller widget ecosystem |
| webview/webview_go | WebView2 via minimal bindings | partial (loads the island, but no asset-server/bindings/generation story, no tray, packaging immaturity) | too thin — you end up rebuilding Wails badly |
| Lorca / CEF | full Chrome/CEF download (~100+ MB) | yes | dependency weight is absurd for one board window; rejected |

**SQLite: `modernc.org/sqlite`** (pure-Go, no cgo). Cross-compiling cgo (`mattn/go-sqlite3`)
from Linux CI to Windows needs a mingw toolchain — the classic flake factory; modernc just
builds. Slower than cgo SQLite, but the workload is a single-user board mirror (kilobytes of
rows) — irrelevant. The schema is proven on plain SQLite already: the SAME SQL runs in the
Node self-host via `node:sqlite` (`src/db/sqlite.ts:1-9` — "Same SQL as the D1 adapter;
only the driver differs", zero native deps). The mirror copies `DATA-MODEL.md` §2 columns
verbatim (`GO-DESKTOP-PORT-PLAN.md:88-95`).

**Window / menus / tray [PLAN]:** Wails v2 gives windows, dialogs, native menus and the
JS↔Go bindings. **Tray is NOT in Wails v2 core** — options: `fyne.io/systray` /
`getlantern/systray` (mature but own message loop — coexistence needs a spike; the
tray+global-quick-add-hotkey is a genuine desktop win, `GO-DESKTOP-PORT-PLAN.md:137`), or
Wails v3 (native tray/menus, **alpha** — not for M1–M5). Honest call: tray ships in M5 only
if the spike proves stable; else post-1.0.

## 3. Build recipe [PLAN]

### 3.1 Frontend asset preparation (the island)

1. Copy the island from `public/` into the desktop repo's `frontend/` (a *pinned snapshot*,
   synced by the CI drift check §7.4): `board.html` (adapted: strip nav/rail/SW/htmx — the
   adaptation list is `GO-DESKTOP-PORT-PLAN.md:55-58`), `devboard.js`, `chip-render.js`,
   `board-page.js`, `i18n-en.js`/`i18n-fa.js` + `i18n.js` (FA is a product language; the FA
   dict is *lazily* injected — `i18n.js:14-16,54` — so the embedded asset server must serve
   that path), the board's CSS link list — the manifest IS `board.html:10-29` (variables,
   base, layout, dashboard, dashboard-todo, components, canvas, quicknotes, to-do-list,
   polish-ui, calendar, notifications, polish-batch, project-header, devboard, misc, themes,
   claude-dark-theme, rtl, manrope font-face) — and the fonts (`board.html:7-9`: GeneralSans
   400/500/600; Vazir only if FA typography needs it — see `UI-UX-REPLICATION-SPEC.md`'s
   type/RTL sections for the call).
2. **No bundler step.** The island is IIFE-globals vanilla JS with zero build imports
   (`README.md:139-146`); the canonical `public/js` files are the source (content-hashed
   `/dist/` exists only for web deploys). The desktop embeds canonical files directly — one
   less toolchain, and it makes the §7.4 drift check a plain checksum diff.
3. The **`window.hibanaFetch` seam**: replace the `fetch` calls in `devboard.js`/
   `board-page.js` with a thin adapter routing to Go (`GO-DESKTOP-PORT-PLAN.md:60-63` — "one
   seam, ~15 call sites"), so the Go side owns the cookie jar + `Origin` header on writes
   (`API-AND-SYNC-CONTRACT.md` §2: every write needs `Origin` or `Referer`, headerless is
   403'd — `app.ts:172-194`) and the UI never needs CORS (same-origin against the embedded
   asset server).

### 3.2 Embedding + the build command

- Assets embed via Go's `embed.FS` into the Wails asset server (the standard Wails v2
  `frontend/dist` + `main.go` embed pattern — our `dist` is the copied island, unbuilt).
- Build:

  ```
  wails build -platform windows/amd64 \
    -ldflags "-s -w -X hibana/desktop.Version=0.1.0 -X hibana/desktop.WebRef=v0.4.1.35"
  ```

  `-s -w` strips debug info (smaller exe). `-X` stamps **two** versions: the desktop's own
  semver and the **hibana-source ref the island was copied from** (the parity pin §7.5).
- **Windows VERSIONINFO resource** (what Explorer's file properties shows) is NOT covered by
  `-ldflags -X` — it needs the `wails.json` info block / a `goversioninfo` `.syso` next to
  `main.go` [PLAN: wire it in the same CI step so tag, `-X` var and resource never diverge].
- `GOOS=windows GOARCH=amd64` is the primary target. **arm64 secondary** [OWNER — §10]:
  Wails v2 + WebView2 support `windows/arm64`; build it only when the owner has ARM hardware
  (the same NSIS script keys off the artifact name).

### 3.3 The two artifacts + reproducibility

- Artifacts per release: `hibana.exe` (→ `hibana-portable-<ver>.zip` + the 2-page
  `docs/PORTABLE.md`) and `hibana-setup-<ver>.exe` (NSIS, §4). Reproducibility [PLAN]: `go
  mod vendor` + committed `vendor/` (or at minimum `go.sum` + the CI Go pin); `sha256sum`
  both into `checksums.txt` published with the Release (consumed by the updater §6);
  same-ref builds byte-identical before v1.0 (`-trimpath` may fight WebView2 resource
  embedding — honest unknown).
- **Version parity ritual (VERIFIED convention, extended [PLAN]):** the web app versions via
  `package.json` (`package.json:3` = `0.4.1.35`) + a Changelogs §1 "Current state" row
  (`Changelogs.md:34` = v0.4.1.34/S208; the S209 row lands at session close) + a `v0.x.y` git
  tag when user-facing (`Agents.md:89-90`) + the zip ritual (`Agents.md:95-100`). The desktop
  adds its own `v0.x.y-desktop` tag (§7.3) whose release notes carry BOTH versions (desktop
  semver + embedded web ref). Note for §6: **the `/api/health` endpoint does NOT carry the
  app version today** — see §6.1.

### 3.4 Tree layout

Identical to `GO-DESKTOP-PORT-PLAN.md:32-51` (cited, not restated): `main.go` (bootstrap,
window, single-instance lock), `internal/api|store|sync|auth|ui`, `frontend/` (the copied
island). Packaging adds: `build/windows/icon.ico`, `build/windows/versioninfo.json` (or the
`wails.json` info block), `installer/hibana.nsi` (§4), `scripts/make-portable.(ps1|sh)`.

## 4. The installer spec [PLAN — NSIS, recommended]

### 4.1 Sections

1. **Install scope:** per-user into `%LOCALAPPDATA%\Programs\hibana` (no UAC; the VS Code
   user-installer convention). Per-machine `C:\Program Files\hibana` as a checkbox for the
   rare multi-account machine (elevation required; data stays per-user either way).
2. **Payload + shortcuts:** `hibana.exe`, `docs/PORTABLE.md`, uninstaller; Desktop + Start
   Menu shortcuts (per-user); optional "start with Windows" (per-user Run key — off by
   default [OWNER]).
3. **First-run:** boots to the native login window (the PBKDF2 round-trip is one POST —
   `GO-DESKTOP-PORT-PLAN.md:70-72`); no data is created until first sync.

### 4.2 WebView2 bootstrapper check

Registry probe → if missing: "install WebView2 runtime now (small download)" → Evergreen
Bootstrapper `/install /silent` → no reboot. Offline fallback: a `/WITHWEBVIEW` installer
variant bundling the bootstrapper for air-gapped machines [PLAN — build only if the owner
needs it; the Win11 VM test below will tell us how often the gap is real].

### 4.3 Silent install (for scripting + future auto-update)

`hibana-setup.exe /S` (NSIS standard) — plus `/D=<dir>` and our flags: `/CURRENTUSER=1`
(default), `/ALLUSERS=1`, `/DESKTOP=0|1`, `/AUTOSTART=0|1`. Runnable while the app is open:
detects the running process, prompts to close (or `/FORCECLOSE` in silent mode) first.

### 4.4 The uninstall contract — "leaves no residue"

The S205-era promise from `GO-DESKTOP-PORT-PLAN.md:150` (M5: "clean Win 11 VM install;
uninstall leaves no residue"). NSIS uninstalls: program dir, Desktop + Start Menu shortcuts,
Run key. **Then the data prompt** — the honest part: the uninstaller lists what it found —
`%LOCALAPPDATA%\hibana\hibana.db` (the SQLite mirror), `logs\`, and the **DPAPI-protected
session-cookie blob** (§8) — and asks: *Keep (default — a reinstall finds it and you're
logged in) / Delete (discards your local offline copy; the cloud data at hibana.ir is NEVER
touched)*. Exit code + a `%TEMP%` uninstall log. Nothing else is written anywhere: no
registry beyond the uninstall key, no file associations.

### 4.5 WiX/MSI alternative (the enterprise story, not built unless [OWNER])

If distribution ever goes through managed fleets: a WiX v4 project producing `hibana.msi`
(per-machine, upgrade codes, GPO-deployable, `msiexec /qn`). Same binary; the NSIS script and
the WiX source share a payload manifest so they cannot drift. Not in M1–M5.

### 4.6 Acceptance test (mirrors M5)

A clean Win11 VM snapshot: install → login → pull a board → create a task (verify via the web
client at https://hibana.ir) → uninstall with "delete data" → **diff the whole user profile +
registry before/after — zero residue** = pass. Reinstall on the "keep data" path → still
logged in = pass. Re-run once on a VM WITHOUT WebView2 to exercise §4.2.

## 5. Code signing + SmartScreen [PLAN — OWNER decisions]

**Hard rule first (VERIFIED):** NO secrets in the binary, ever — "Every credential is a
secret… Never hardcoded, never committed" (`Agents.md:68-69`, rule 5; enforced workflow-wide
at `Agents.md:91-94`), and the port plan's "Never" list (`GO-DESKTOP-PORT-PLAN.md:166-168`:
privileged Cloudflare credentials in the binary). The desktop ships only user-runtime
credentials (the session cookie) — never API tokens, never the password at rest (§8).

- **Unsigned (the honest cost):** first download of each new exe trips Windows SmartScreen
  ("unknown publisher") — *More info → Run anyway*; Defender may heuristically flag Go+NSIS
  binaries occasionally (false-positive submission to Microsoft, days not weeks). Reputation
  accrues per-file over downloads — every release resets it until a signing identity exists.
- **Self-signed:** zero distribution benefit (verifying machines would each need the cert
  manually trusted; SmartScreen still warns). Useful only to test the updater's
  signature-check code path locally. Not a real option.
- **OV code-signing cert (2026 estimates — RE-VERIFY at purchase):** roughly **$70–400/yr**
  (open-source/individual developer programs at the low end; standard CAs higher). CA/B
  rules keep keys on hardware tokens or cloud HSMs, so signing becomes a token/CI ritual.
  Builds download reputation over time (not instantly).
- **EV cert (2026 estimates):** roughly **$250–700/yr**, organization validation;
  historically near-instant SmartScreen reputation, though Microsoft has grown less
  deterministic — treat it as a probability, not a contract. The owner is an individual, not
  an org — EV likely needs a registered business; Microsoft's Trusted Signing
  (identity-validated, monthly-fee, individual accounts) is the low-cost alternative.
- **signtool steps (whenever a cert exists):** `signtool sign /fd SHA256 /tr
  <RFC3161-timestamp-URL> /td SHA256 hibana.exe`, then the NSIS installer, then the
  generated uninstaller (NSIS `!uninstfinalize`) — all three must verify; timestamping is
  non-negotiable (untimestamped signatures die with the cert).
- **Recommendation [OWNER]: ship UNSIGNED initially.** Single-user personal tool, sole
  consumer = the owner downloading from his own public repo (§7); the SmartScreen click is a
  per-release annoyance, not a blocker. Revisit (and re-verify prices) on any wider release.

## 6. Auto-update [PLAN — the owner must choose one]

Three candidates, honestly:

### 6.1 (a) Version-check against `GET /api/health` + manual download prompt

The `GO-DESKTOP-PORT-PLAN.md:135` sketch ("a version check against GET /api/health's version
field + a download URL"). **VERIFIED correction — that field does not exist today:**
`GET /api/health` (`src/routes/health.ts:25-49`, `no-store` at `:27`) returns
`{ok, service, environment, db, schema_version, storage, time}` (`health.ts:37-48`) — and
`schema_version` (`health.ts:42`) is the **applied-migration count** (`health.ts:12-22`; live
probes report `63` at S208 close), NOT the app version. Option (a) therefore first needs a
one-line, web-transparent Worker addition: a `version` field injected from `package.json` at
build time (M0-adjacent, riding the existing no-store probe). Then: poll on launch → semver
compare → "new version available?" → open the Release page in the browser. **Zero infra** —
but it only *says* "a new version exists"; download/verify/run stays manual.

### 6.2 (b) GitHub Releases feed + check-on-launch [RECOMMENDED]

The repo reality is verified: `assadigit/hibana-source` is **public since 2026-09-21**
(`Agents.md:12`), CI runs free on public repos and CD auto-deploys (`Agents.md:14-16`); the
desktop repo (§7.1, separate + public) gets the same free Releases/CI. Flow: on launch (+
manual "check now"), read `api.github.com/repos/<owner>/hibana-desktop/releases/latest` →
compare the `-X`-stamped version → if newer: **notify → user confirms → download to `%TEMP%`
→ verify SHA-256 against the Release's `checksums.txt` (§3.3) → run installer `/S` (installed
mode) or in-place swap (portable mode)**. No user data leaves the machine (a GET to a public
API — same traffic class as the web app's own deploys), consistent with the no-telemetry
default (`GO-DESKTOP-PORT-PLAN.md:138-139`).

### 6.3 (c) Full auto-update frameworks

`go-selfupdate` (GitHub-Releases-based binary patching — basically automates (b)'s tail);
Squirrel.Windows (effectively unmaintained, .NET-dependent — reject); Wails v3's built-in
updater (promising but alpha — the v3 dependency is not acceptable for M1–M5). Delta patching
(bsdiff) + update-signature enforcement only pay off with signed builds (§5) and big
binaries; a ~15–25 MB exe makes full-download updates permanently fine.
**Recommendation: (b) with manual-confirm install; (a) as the zero-infra fallback if the
owner dislikes any GitHub coupling.**

### 6.4 Update UX contract

Never auto-restart. Notify ("Hibana 0.1.1 available — notes") → *Install now / Later /
Skip this version*. Install-now: download → checksum verify → (installed) run the setup exe
`/S /FORCECLOSE`; (portable) rename the running exe to `hibana.exe.old` (Windows allows
renaming a running exe), write the new one, restart; delete `*.old` on next boot. Any
failure: keep the current version running + surface the error and the direct download URL.

## 7. CI/CD recipe [PLAN]

### 7.1 Where it lives — separate `hibana-desktop` repo (recommended)

Verified repo discipline: `assadigit/hibana-source` is the public source of truth
(`Agents.md:12`); `assadigit/hibana-safe` stays PRIVATE and carries D1 dumps — real user
data, never public (`Agents.md:16-17`). A third repo `assadigit/hibana-desktop` (public, no
user data — the binary embeds no secrets, §5) holds the Go tree, island snapshot, NSIS script
and its own CI. Why separate rather than a `desktop.yml` lane in hibana-source: the web CI is
a bun-locked, 20-min-capped ubuntu pipeline (`ci.yml:33-37, 47-48`) whose docs-only filter
(`ci.yml:25-27`) and CD-on-CI-green chain (`cd.yml:33-37`, guard `:61-99`) protect the
**deploy to hibana.ir** — a Go/NSIS/windows lane adds failure modes to the pipeline gating
production for zero shared benefit; the single-history counter-argument is answered by the
parity pin (§7.4/7.5). [OWNER confirms — §10.]

### 7.2 The workflow (conventions inherited from the web CI)

New `.github/workflows/desktop.yml` in hibana-desktop, conventions copied from the verified
repo patterns: `actions/checkout@v7` (`ci.yml:39`); pinned toolchains (the web pins bun via
`packageManager` + `setup-bun@v2`, `ci.yml:41-45` — the desktop pins Go via `setup-go`);
frozen installs (`bun install --frozen-lockfile` `ci.yml:48` → `go mod verify` + vendored
deps); timeout-minutes discipline (`ci.yml:37`); failure-only artifact upload with retention
(`ci.yml:191-198`). The web CD's workflow_run-gating + stale-CI guard (`cd.yml:33-37,
:61-99`) is **not** needed — nothing auto-deploys from the desktop repo; Releases are
tag-driven (§7.3).

Matrix [PLAN] — one `build` job, `runs-on: windows-latest`, `strategy.matrix` =
`[{arch: amd64 (primary)}, {arch: arm64 (only after [OWNER] §10})]`, `timeout-minutes` per
the `ci.yml:37` discipline. Steps in order: checkout (`actions/checkout@v7`, `ci.yml:39`) →
`setup-go` (Go pinned by `go.mod`'s toolchain line) → setup bun/node (island-sync +
checksum scripts only) → `scripts/sync-island.mjs --ref <pinned-web-ref> --check` (fails
on drift, §7.4) → `go vet ./... && go test ./...` (the M1+ Go client/store/sync suites) →
`wails build -platform windows/<arch> -ldflags "-s -w -X …"` (version from the tag) →
`wails build -nsis` (installer; amd64 lane) → `pwsh scripts/make-portable.ps1` (zip +
PORTABLE.md) → `sha256sum` → `checksums.txt` → `upload-artifact` (exe + setup + zip +
checksums, every run, 7-day retention — `ci.yml:191-198`).

### 7.3 Tag-driven release

Tags `v0.x.y-desktop` on hibana-desktop main → the workflow's release job (gh CLI — CD
already uses `gh api`, `cd.yml:85-86`) creates the GitHub Release with both artifacts +
`checksums.txt` + notes carrying **both versions** (desktop semver + embedded web ref),
mirroring the repo's tag ritual — "tag (`v0.x.y`) when user-facing" (`Agents.md:89-90`) —
the `-desktop` suffix keeping the namespaces disjoint from web tags on hibana-source.

### 7.4 The smoke test — the realistic minimum

Launching a GUI exe in a CI runner (session-0/no-interactive-desktop WebView2) is flaky and
low-value at M2; do not pretend otherwise. The honest CI floor: (1) build green + `go vet` +
`go test ./...`; (2) the **island drift check** — `sync-island.mjs --check` checksums the
copied island against the pinned hibana-source ref and FAILS on web-island changes without a
desktop sync commit — the highest-value gate, and what makes the separate repo safe; (3) the
**embedded-frontend e2e re-run**: the web board e2e boots its own Node server + scratch
SQLite DB (`playwright.config.ts:15-16` — `E2E_PORT` 3017, `/tmp/hibana-e2e.db`, webServer
`:42`); the desktop CI re-runs the board specs against that LOCAL server — with (2), this
proves what the exe will render. Real launch testing stays human: §4.6 + dogfooding (§9).

### 7.5 Version-sync ritual with the web app

Every desktop release pins the web ref it embeds (`-X …WebRef`, §3.2) and the release notes
cite the web version's Changelogs §1 row (`Changelogs.md:34` convention). The web repo's
version is `package.json`-first (`package.json:3`); the desktop never guesses it from
`/api/health` (§6.1's verified gap) — the pin is the git ref, full stop. When the island
gains a web fix the desktop wants: bump the pin, run sync-island, release `0.x.y+1-desktop`.

## 8. Data + security posture [PLAN]

- **Credentials at rest:** ONLY the session cookie (`__Host-hibana_session`, 30-day rolling,
  `sessions.ts:15,17` per `API-AND-SYNC-CONTRACT.md` §2) — encrypted with **Windows DPAPI**
  (per-user, `CryptProtectData`) at `%LOCALAPPDATA%\hibana\session.bin` (installed) or
  `.\data\session.bin` (portable — DPAPI binds to the USER, not the folder: a portable
  profile moved to another Windows account invalidates the cookie → re-login; correct
  behavior, documented in PORTABLE.md). **The PASSWORD is never stored** — in memory only
  during the login POST (`GO-DESKTOP-PORT-PLAN.md:84-86`). NEVER a Cloudflare/token secret
  in the binary (`Agents.md:68-69`).
- **SQLite mirror:** `%LOCALAPPDATA%\hibana\hibana.db` (installed) / `.\data\hibana.db`
  (portable); WAL + `foreign_keys=ON` like the proven Node adapter (`src/db/sqlite.ts:12-13`);
  a cache + offline workspace, never the source of truth (`GO-DESKTOP-PORT-PLAN.md:94-95`).
- **Logs:** `%LOCALAPPDATA%\hibana\logs\` (installed) / `.\data\logs\` (portable), structured
  JSON lines, **7-day rotation** (`GO-DESKTOP-PORT-PLAN.md:138-139`). No log ever contains
  the cookie value or credentials.
- **Crash reporter:** local-only — panics write `logs\crash-<ts>.log` (+ optional minidump
  into `logs\dumps\`), surfaced on next launch as "Hibana closed unexpectedly — show report".
  **No upload. [OWNER: no telemetry by default]** (`GO-DESKTOP-PORT-PLAN.md:139`).
- **Firewall / network posture:** outbound HTTPS (443) only — to `hibana.ir` (the API; media
  bytes ride the same host, `API-AND-SYNC-CONTRACT.md` §3.3) and, under update mode (b),
  `api.github.com`/release-asset hosts (§6.2). **No inbound listeners** — no TCP port; the
  Wails asset server is an in-process WebView2 virtual host, not a socket [PLAN-verify at M2
  — `netstat` assert in the VM acceptance]. Writes always carry `Origin: https://hibana.ir`
  (`API-AND-SYNC-CONTRACT.md` §2 / `app.ts:172-194`).

## 9. Milestone integration [PLAN]

How packaging lands across `GO-DESKTOP-PORT-PLAN.md:143-152`'s M1–M5:

| Milestone (port plan §8) | Packaging work in it | Deliverable |
|---|---|---|
| M0 (Worker contract hardening) | the `/api/health` `version` field IF update mode (a) is chosen (§6.1) | web-side one-liner + tests |
| M1 (Go API client, no UI) | none — `go test` binaries only | — |
| **M2 (read-only board, Wails shell)** | **first portable exe** — `wails build` + zip, unsigned, handed to the owner with the existing zip ritual (`Agents.md:95-100`) | **dogfooding starts here**: the owner runs the real exe against hibana.ir weekly |
| M3 (offline mutations/outbox) | rebuild portable; no new packaging | — |
| M4 (attachments/sprints/labels parity) | rebuild portable; island sync ritual begins (§7.4) | — |
| **M5 (packaging)** | NSIS installer (§4), CI/CD `desktop.yml` + Releases (§7), updater choice wired (§6), Win11 VM acceptance (§4.6), signing decision executed or explicitly deferred (§5) | the full dual-target v1.0 |

The M2-early-portable choice is deliberate: every later milestone's risk (sync correctness,
island drift) gets caught by the owner's real usage months before M5 polishes distribution.

## 10. Open questions for the owner [OWNER]

1. **Installer preference:** NSIS per-user (recommended, §1.1/§4) vs WiX/MSI — confirm.
2. **Signing budget:** ship unsigned (recommended for the personal-use phase, §5) vs fund an
   OV cert / Trusted Signing once the app leaves your own machines (2026 prices — re-verify).
3. **Auto-update choice:** (b) GitHub Releases check + manual-confirm (recommended) vs (a)
   health-endpoint check + manual download (zero infra; needs the one-line Worker `version`
   field first, §6.1) vs none. Also decides whether M0 includes that Worker change.
4. **Separate-repo decision:** `hibana-desktop` as its own public repo (recommended, §7.1)
   vs a `desktop.yml` lane inside hibana-source.
5. **arm64:** do you have (or plan) Windows-on-ARM hardware? Build that lane only if yes.
6. *(carried from the port plan's own owner list, `GO-DESKTOP-PORT-PLAN.md:170-177`, where
   packaging-adjacent:)* tray/hotkey priority in M5 + confirm the local-only crash-reporter
   default (§8).
