# Hibana Project/Kanban — Go Desktop Implementation Guide (the build instructions)

> **What this is.** The **operator's manual** for building the Windows desktop port — the
> "do this, in this order, with these commands" layer requested by the owner on
> **2026-10-21 (S210)** after locking the stack decision: *"Okay go this way: Go + Wails v2
> + WebView2 + modernc.org/sqlite. prepare specs and instructions based on this decision."*
> The WHY and the WHAT live in the pack's spec documents (cited throughout — this guide
> never re-argues them); this guide owns the HOW.
>
> **Convention (inherited from the pack).** Statements about the CURRENT repo are
> **VERIFIED** against `v0.4.1.35 / S209` (main `e6661c8`, tag `v0.4.1.35`, schema 63,
> sw `hibana-v444`) with `file:line` citations re-verified at S210. Everything
> desktop-side is **[PLAN]** — **no desktop code exists or should exist yet**; the code
> blocks below are skeletons/specs written into a document, not a shipped app. Decisions
> only Ali can make are **[OWNER]**. Command lines marked `[PLAN-verify]` must be
> re-checked against the pinned Wails CLI at build time (the one external dependency
> whose minor versions move).
>
> **Prerequisites (read first):** `GO-DESKTOP-PORT-PLAN.md` (§0 the decision record, §2
> the architecture tree, §8 the milestones this guide walks), `README.md` (the pack index).

---

## 0. The decision record — ADR-001 [OWNER — DECIDED 2026-10-21]

**Decision:** the Hibana Kanban Windows desktop app is built with **Go + Wails v2 +
WebView2 (Evergreen) + `modernc.org/sqlite`**. The pure-Go GUI alternative (Fyne/Gio/walk)
and the thin `webview/webview_go` binding are **rejected**; the Fyne fallback condition is
**retired** (it existed only for "if WebView2 is unacceptable to the owner" — the owner has
explicitly accepted the WebView2 dependency).

**Context.** The owner asked for the honest pros/cons of pure-Go vs Go+Wails before
committing (2026-10-21). The comparison that informed the decision, in summary:

| Dimension | Pure Go (Fyne/Gio) | **Go + Wails v2 + WebView2 (chosen)** |
|---|---|---|
| Reuse of the tested board island (`devboard.js` v28, `chip-render.js` v12, 19 CSS sheets) | 0% — full widget rebuild, months of re-parity | **~90% — embed & shim** (`GO-DESKTOP-PORT-PLAN.md` §1's portability table) |
| 1:1 visual parity with /kanban | approximate at best (new design language) | **identical rendering engine** (Chromium = what the web app already targets) |
| EN+FA + RTL | high-risk (toolkit RTL immaturity; manual mirroring) | **web-grade** (CSS logical properties, Chromium bidi, `faDig`, Jalali — `UI-UX-REPLICATION-SPEC.md` §1.6/§6) |
| Build/CI | Fyne needs CGo + mingw cross-compile | **cgo-free on Windows** (Wails v2 win32 + `modernc.org/sqlite` — plain Go toolchain) |
| External runtime dep | none | WebView2 (preinstalled Win10/11; bootstrapper fallback — WINDOWS-PACKAGING-PLAN §2) |
| Footprint / startup | ~40–100 MB, instant | ~100–250 MB, ~300 ms (acceptable for a productivity board) |
| Offline layer | Go-native by construction | **Go+SQLite mirror — strictly stronger than the web's service-worker cache** (API-AND-SYNC-CONTRACT.md §9) |
| UI test continuity | Go drivers only | **vitest + Playwright keep working against the island** |

**Rationale (the owner's product constraint decided it):** the port's mandate is
*"replicate this kanban and its features and sync ability"* — **parity is the product**.
Wails makes the port a port, not a rewrite; keeps the FA/RTL/i18n investment
(1584/1584 dictionary parity, `scripts/check-i18n-parity.mjs`) at web-grade fidelity; and
maps directly onto the owner's dual delivery ask (portable `.exe` + NSIS installer, both
natively produced by `wails build`, WINDOWS-PACKAGING-PLAN.md §1/§3).

**Accepted costs (known, deliberate):**
1. **WebView2 runtime dependency** — ubiquitous on Win10/11; gaps are LTSC/Server/air-gapped
   SKUs, covered by the Evergreen Bootstrapper probe at first run
   (WINDOWS-PACKAGING-PLAN.md §2, §4.2 — that workstream is now REAL, not conditional).
2. **Evergreen drift** — WebView2 auto-updates via Windows Update; same risk class the
   web app already lives with (it *is* the web audience's engine). M2's side-by-side
   acceptance runs are the containment (UI-UX-REPLICATION-SPEC.md §8).
3. **Heavier RAM (~100–250 MB) + ~300 ms cold start** vs a pure-Go GUI — accepted for a
   productivity app, not a kiosk utility.
4. **The JS↔Go bridge is an API surface** — every bound method is callable from JS; inputs
   must be validated and raw file/system operations never exposed naively (§4.4 below).
5. **No built-in auto-update** — the updater is our code
   (WINDOWS-PACKAGING-PLAN.md §6: GitHub Releases feed + check-on-launch + manual-confirm
   is the recommended mode, still [OWNER — Q3]).
6. **Wails v2→v3 transition risk** — v3 is beta; mitigation: keep the bridge layer thin
   (§4.4) so a future v3 migration (native tray/menus) is contained.

**Consequences.** The pack's remaining **[OWNER]** questions
(`GO-DESKTOP-PORT-PLAN.md` §10, now 9 open after this one) are unaffected: this decision
locks the STACK, not the M0 Worker additions (API-AND-SYNC-CONTRACT.md §7a-7e still await
the owner's go), and not the auto-update mode / installer tech / signing / repo split /
arm64 choices (each still [OWNER] in their sections of WINDOWS-PACKAGING-PLAN.md §10).

---

## 1. Prerequisites — the toolchain [PLAN]

Install, in order, on the **Windows dev box** (canonical build host — the CI build also
runs `windows-latest`, WINDOWS-PACKAGING-PLAN.md §7.2; cross-compiling from Linux is
possible for a pure-Go Wails app but the WebView2 loader makes Windows-on-Windows the
low-friction path — use it):

1. **Go** — latest stable (≥ 1.23). Pin the exact toolchain via `go.mod`'s `toolchain`
   line so CI and local match (the repo's own discipline: bun pinned via
   `packageManager`, `package.json:5`).
2. **Wails v2 CLI** — `go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.x` —
   **pin the version** `[PLAN-verify exact latest v2.x at install time]`. Verify:
   `wails doctor` (reports Go, WebView2 runtime presence, NSIS availability).
3. **WebView2 SDK** — rides the Wails dependency (`github.com/wailsapp/wails/v2`
   brings the loader); the **runtime** is preinstalled on Win10/11. Probe it:
   `reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv`
   (empty/missing → install the Evergreen runtime from
   `https://go.microsoft.com/fwlink/p/?LinkId=2124703` — the same probe+fallback the app
   itself ships at first run, WINDOWS-PACKAGING-PLAN.md §2/§4.2).
4. **NSIS** — needed only for the installer artifact; `wails build -nsis` expects it on
   PATH (the Wails CLI can fetch it — `wails doctor` tells you; `[PLAN-verify]`).
5. **Node or Bun** — only for the island-sync + checksum scripts (§3); no frontend build
   step exists (the island is unbuilt vanilla JS — WINDOWS-PACKAGING-PLAN.md §3.1).
6. **Git + a GitHub repo** `assadigit/hibana-desktop` (public, separate — the
   recommendation under [OWNER — Q4] in WINDOWS-PACKAGING-PLAN.md §7.1; do not start
   building in hibana-source).

Sanity gate: `wails doctor` green on all three (Go, WebView2, NSIS) before M1 starts.

---

## 2. Session 1 of the build — the repo scaffold [PLAN]

```bash
wails init -n hibana-desktop -t vanilla   # NO frontend framework — the island is plain HTML/JS
cd hibana-desktop
go get github.com/wailsapp/wails/v2@v2.10.x
go get modernc.org/sqlite@latest
```

Then reshape the scaffold to the architecture tree (`GO-DESKTOP-PORT-PLAN.md` §2 — cited,
not restated): `main.go` (bootstrap, window, single-instance lock, portable-mode
detection) + `internal/api|store|sync|auth|ui` + `frontend/` (the island, §3 below) +
packaging additions (`build/windows/icon.ico`, `build/windows/versioninfo.json`,
`installer/hibana.nsi`, `scripts/make-portable.ps1`, `scripts/sync-island.mjs`).

**`wails.json` essentials [PLAN]:**

```jsonc
{
  "name": "hibana",
  "outputfilename": "hibana",
  "frontend:install": "",           // no frontend toolchain — nothing to install
  "frontend:build": "",             // no build — frontend/dist IS the island copy
  "frontend:dev:watcher": "",       // wails dev serves frontend/ directly
  "info": {                         // Explorer's file-properties VERSIONINFO
    "productName": "Hibana Kanban",
    "productVersion": "0.1.0",
    "copyright": "Ali"              // keep in lockstep with the -ldflags stamps (§7)
  }
}
```

Window defaults: **1600×900, min 1100×720** (the board's 5-column grid breaks at 1100 —
`UI-UX-REPLICATION-SPEC.md` §2's breakpoint table); light background `#ffffff` (the
`.db-frame` is a `var(--card)` white surface, `devboard.css` v34); title "Hibana Kanban".

**Single instance** (Wails v2.5+): `app.SingleInstanceLock().SetInstanceId("hibana-kanban")`
in `main.go` before `wails.Run` — second launch focuses the first window instead of
forking a second data-dir writer (the never-mix rule, WINDOWS-PACKAGING-PLAN.md §1).

---

## 3. The island sync — `frontend/` from `public/` [PLAN]

The island is a **pinned snapshot** of the web app's board surface, synced by checksum —
never a live subtree. `scripts/sync-island.mjs` (bun/node) does the copy + adaptation +
verification; the desktop repo's CI re-runs it with `--check` to FAIL on web-island drift
(WINDOWS-PACKAGING-PLAN.md §7.4 — the highest-value gate of the separate-repo design).

### 3.1 What gets copied (the VERIFIED manifest)

From `public/board.html` (the /kanban entry — the port's replication target):

| Asset | Verified source | Notes |
|---|---|---|
| HTML shell | `board.html:62-89` (the board markup: `#db-toolbar`, `#db-loading`, `#db-board`) + head CSS links | **adapted** per §3.2 |
| CSS (19 sheets + font) | `board.html:10-29`, in EXACT load order: `variables.css?v=27` → `base.css?v=14` → `layout.css?v=67` → `dashboard.css?v=43` → `dashboard-todo.css?v=25` → `components.css?v=9` → `canvas.css?v=11` → `quicknotes.css?v=50` → `to-do-list.css?v=13` → `polish-ui.css?v=39` → `calendar.css?v=10` → `notifications.css?v=12` → `polish-batch.css?v=29` → `project-header.css?v=50` → `devboard.css?v=34` → `misc.css?v=24` → `themes.css?v=9` → `claude-dark-theme.css?v=31` → `rtl.css?v=5` **last** (rtl.css:6) + `vendor/manrope/font-face.css` | Load order is a contract (`rtl.css` must win) |
| Fonts | `board.html:7-9` (GeneralSans 400/500/600) + Vazir for FA typography | `UI-UX-REPLICATION-SPEC.md`'s type/RTL sections own the Vazir call |
| JS — board core | `js/devboard.js` (v28), `js/chip-render.js` (v12), `js/board-page.js` (v21) | devboard/board-page get the seam patches (§4) |
| JS — i18n trio | `js/i18n-en.js` (v100), `js/i18n.js` (v154), **lazy `js/i18n-fa.js`** | the FA dict is *lazily* injected (`i18n.js:14-16,54`) — the embedded asset server must serve that exact path or the lazy fetch 404s |
| JS — vendor | `vendor/jalaali.min.js` (sprint dates) | |
| JS — lazy loader | `js/image-resize.js` | lazy-loaded by devboard.js:307-319 on first editor open — same path requirement |
| JS — toast shim | **not copied from `app.js`** — reimplemented (§4.5) exposing the identical `window.hibana.toast` signature | app.js is the web shell; only its toast component contract carries over (`UI-UX-REPLICATION-SPEC.md` §7.3) |

### 3.2 The HTML adaptation list (what gets stripped from `board.html`)

Strip the **web chrome** (each is browser-shell machinery the desktop replaces natively):
`vendor/htmx.min.js` + `vendor/idiomorph-ext.min.js` (`board.html:30-31`), `js/boot.js`
(SW registration), `js/app.js`, `js/hib-init.js`, `js/touch-drag.js` (touch long-press —
irrelevant on desktop, `UI-UX-REPLICATION-SPEC.md` §7.2), `js/nav.js` (browser-history
rail), `js/command-palette.js`, `js/mobile-nav.js`, `js/zen-mode.js`,
`js/micro-interactions.js`, `js/go-to.js`, `vendor/alpine.min.js`, the `<div data-nav>`
block (`board.html:53`), the page loader (`:52`). **Keep** the board markup `:62-89` and
the CSS manifest intact. Add: the seam shim `<script src="/js/desktop-shim.js">` BEFORE
`devboard.js`/`board-page.js` (§4), and the Go-bindings bridge Wails injects.

The i18n `data-i18n` attributes on the kept markup (`board.html:50, 68, 71, 76, 83, 85,
87`) work unchanged — the trio carries them.

### 3.3 The sync ritual

1. `sync-island.mjs --ref <git-sha>` — copies the manifest from a CHECKED-OUT
   hibana-source at that sha, applies the §3.2 strip + §4 seam patches, writes
   `frontend/dist/`, and records the ref into `frontend/dist/web-ref.json`
   (`{ref, packageVersion}` — e.g. `e6661c8`, `0.4.1.35`).
2. Checksums every copied file into `island.checksums.json` (the CI `--check` mode's
   input — WINDOWS-PACKAGING-PLAN.md §7.4).
3. The ref is stamped into the binary at build time (`-X …WebRef`, §7) and into every
   Release's notes (the parity pin, WINDOWS-PACKAGING-PLAN.md §7.5).
4. When the island gains a web fix the desktop wants: bump the pin, re-run sync, release
   `0.x.y+1-desktop`. Never hand-edit `frontend/dist/` — change the patch script, so the
   patch is itself version-controlled and drift-detectable.

---

## 4. The transport seam — `window.hibanaFetch` [PLAN]

The ONE functional adaptation to the island's JS: all network traffic routes through Go,
so the Go side owns the cookie jar, the `Origin` header on writes (the T6 gate 403s
headerless writers — `src/app.ts:172-194`, verified), the ETag store, and the retry
contract. The renderers are touched **not at all**.

### 4.1 The verified site list (12 call sites, re-verified at S210)

| # | Site | Kind | What it calls |
|---|---|---|---|
| 1 | `devboard.js:33` — `const send = (signal) => fetch(path, {...})` inside `api()` | **the choke point** | 21 endpoint call sites funnel here (the board's whole CRUD surface) |
| 2–6 | `devboard.js:1288, 1344, 1360, 1380, 1390` | raw `fetch` | label manager: `GET /api/tags`, `PATCH …/tags/:id` (name), `PATCH` (color), `POST …/merge`, `DELETE …/tags/:id` |
| 7–8 | `devboard.js:337, 367` — `new XMLHttpRequest()` | XHR | screenshot upload (progress events) + its cancel path |
| 9–12 | `board-page.js:287, 579, 741, 761` | raw `fetch` | `GET /api/projects?sort=recent` (switcher), `DELETE /api/devtasks/:id`, `POST …/devtasks/archive-done`, clear-done's `DELETE` fan-out |

(Same 12 sites `UI-UX-REPLICATION-SPEC.md` §7.3 enumerates; line numbers re-verified at
S210 against the committed tree.)

### 4.2 The patch strategy

`sync-island.mjs` applies mechanical patches (string replaces, each recorded in the
script) so the web files stay untouched in hibana-source and the desktop copies are
reproducible:

1. **`api()` choke point (devboard.js:33)** — replace the module-level `fetch` with the
   adapter: the patch rebinds `send = (signal) => window.hibanaFetch(path, {...opts,
   signal})`. The 3s-deadline + one-retry + `cache:'no-store'` behavior
   (`devboard.js:10-64`) moves INTO the Go client (§5.1) where it belongs — the web's
   workaround becomes the desktop's real contract; `err.status` propagation (404 = gone vs
   transient, `devboard.js:56-61`) must survive the adapter round-trip byte-for-byte.
2. **5 label fetches** — same one-line replace per site.
3. **2 XHR uploads** — the adapter exposes an `xhr`-compatible wrapper
   (`window.hibanaXHR`) that proxies `open/send/setRequestHeader/abort` +
   `onprogress/onload/onerror` to Go's streaming upload; devboard.js's uploader code
   (progress rows, cancel) works unmodified.
4. **4 board-page fetches** — same one-line replace per site.

### 4.3 The shim (`frontend/dist/js/desktop-shim.js` — the only NEW island file)

```js
// desktop-shim.js — the transport + toast shim for the embedded island.
// Loads BEFORE devboard.js/board-page.js. Owns NOTHING else.
(function () {
  'use strict'
  // hibanaFetch: fetch-compatible → Go binding. Body stays JSON string; the Go side
  // owns cookies/Origin/ETag/retries. Response shape mirrors fetch: {ok, status,
  // json(), text()} — callers that check err.status keep working (devboard.js:56-61).
  window.hibanaFetch = async function (path, opts) {
    opts = opts || {}
    const method = (opts.method || 'GET').toUpperCase()
    let body = null
    if (opts.body != null) body = String(opts.body)
    const res = await window.gohibana.api.Request(method, path, body)
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: { get: (h) => (h.toLowerCase() === 'etag' ? res.etag || null : null) },
      json: async () => JSON.parse(res.body),
      text: async () => res.body,
    }
  }
  // hibanaXHR: XMLHttpRequest-compatible upload proxy → Go streaming upload.
  // Implements exactly the surface devboard.js:337-369 uses: open/send/abort,
  // setRequestHeader, upload.onprogress, onload/onerror/onreadystatechange.
  window.hibanaXHR = /* thin proxy — spec'd in §5.4, implemented in M4 */
  // Toast shim: the app.js contract (app.js:253-317), kept as WEB TOASTS (they render
  // identically in WebView2 — UI-UX-REPLICATION-SPEC.md §7.2): kinds ok/err/info, the
  // {label, onClick} actions shape (Undo must stay a button — app.js:247).
  window.hibana = { toast: /* reimplementation of the app.js recipe */ }
})()
```

### 4.4 The bridge discipline (the security rule)

Every Go method bound into JS is callable from the island — and the island renders
user-authored task titles. Rules (they go in `internal/ui/bindings.go`'s doc comment and
are enforced by review + the M2 test list):

1. The bound surface is exactly **one method** (`gohibana.api.Request(method, path, body)`)
   plus the upload stream and the UI queries (`gohibana.ui.*` for state/commands) —
   **never** generic file/system/exec bindings.
2. `Request` validates `method` against the allow-list, `path` against the API
   prefix allow-list (`/api/…` + the media file route), and enforces size caps (the 5 MB
   upload ceiling is the server's own — API-AND-SYNC-CONTRACT.md §10).
3. Go never trusts island-supplied credentials — the cookie jar lives Go-side only
   (DPAPI at rest, WINDOWS-PACKAGING-PLAN.md §8).

### 4.5 Why same-origin CORS disappears

The island is served by Wails' in-process asset server (`wails://` / the embedded
virtual host), and `hibanaFetch` is a JS function call, not an HTTP request from the
WebView — so no CORS preflight, no cookie domain games, and the `Origin` header on writes
is set by the GO client to `https://hibana.ir` (the trusted origin, `app.ts:172-194`).

---

## 5. The Go modules — skeletons [PLAN]

### 5.1 `internal/api/client.go` — the cloud client

Owns: cookie jar (`__Host-hibana_session`, 30-day rolling — API-AND-SYNC-CONTRACT.md §2),
`Origin: https://hibana.ir` on every write, ETag map + `If-None-Match` on every GET (§8's
cheap-poll), the signal+deadline+retry contract, and per-bucket pacing (uploads 30/60s,
auth 30/60s — §3.6).

```go
// Request executes one API call. The web client's resilience recipe (devboard.js:10-64)
// re-homed: GETs carry a 3s deadline + ONE retry (10s second deadline); mutations never
// retry blind (double-write risk) — the OUTBOX owns their retry semantics (§5.3).
// err.Status is preserved for the 404-gone vs transient branch (devboard.js:56-61).
func (c *Client) Request(ctx context.Context, method, path string, body []byte) (*Response, error)

// Login runs the PBKDF2 round-trip: POST /api/auth/login (JSON {login, password} — the
// route accepts JSON and form-encoded, auth.ts:63-78) → Set-Cookie lands in the jar →
// DPAPI-persist. Password exists in memory only for this call. Never logged, never stored.
func (c *Client) Login(login, password string) error
```

Rate-limit pacing: drain ≤ N mutations/s; uploads count against their own 30/60s bucket;
429 → wait for the next 60s window (API-AND-SYNC-CONTRACT.md §10).

### 5.2 `internal/store` — the SQLite mirror

`modernc.org/sqlite` (pure Go — no cgo, cross-compiles with the plain toolchain; slower
than cgo but irrelevant at single-user board scale — WINDOWS-PACKAGING-PLAN.md §2).
**The DDL is `DATA-MODEL.md` §6 verbatim** — cloud-subset mirror (projects, dev_tasks,
sprints, categories, tags, dev_task_tags, project_categories, project_archives,
screenshots metadata + local `outbox`/`meta`), column names/types copied from the verified
cloud shapes; `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON` (the proven Node adapter's
own settings, `src/db/sqlite.ts:12-13`). Local-only: schema versioning via embedded SQL
migrations in the module (never D1's `_migrations` table). The mirror is a cache + offline
workspace — **never the source of truth** (GO-DESKTOP-PORT-PLAN.md §4).

### 5.3 `internal/sync` — the offline-first engine

The full strategy is `API-AND-SYNC-CONTRACT.md` §10 (pull cadence: focus + 5 min +
manual, ETag cheap-poll, then `?since=` after M0; outbox: FIFO, ONE in-flight,
backoff 1s→60s+jitter, the status-code table — 401 re-auth-and-retry-once, 403 check
Origin then treat as ban, 404-on-PATCH/DELETE drop + re-pull, 409 drop + surface, 429
next-window, 5xx retry ≤5 then dead-letter; LWW-per-field; tombstones/7-day grace;
attachment pacing). Offline-create identity rules: `DATA-MODEL.md` §7. The engine's
packages: `engine.go` (the loop), `outbox.go` (the queue — replaces the web's
`queue.js`), `tombstones.go` (deletion propagation, needs M0 §7b).

### 5.4 `internal/api/media.go` — attachments

`POST /api/projects/:id/screenshots` (base64 ≤ 5 MB, 11 mimes) then
`PATCH /api/screenshots/:id {taskId}` to pin — the exact S208 pipeline contract
(API-AND-SYNC-CONTRACT.md §10's attachment block). Offline: queue base64 in the outbox;
mirror only `?variant=thumb` tiles; originals on demand (`/api/media/screenshots/:id/file`,
1h `max-age` — cache content-keyed by screenshot id, immutable in practice).

### 5.5 `internal/auth` — the login window

A small native window (or an island-rendered login card — pick ONE, M2 decision): one
`POST /api/auth/login` (urlencoded or JSON, `auth.ts:63-78`), the cookie lands in the
jar, DPAPI-persist (`%LOCALAPPDATA%\hibana\session.bin` installed / `.\data\` portable —
WINDOWS-PACKAGING-PLAN.md §8). 401 mid-session → the session-expiry dialog → re-POST →
the failing op retries once (the outbox's 401 rule). **No secrets ever ship in the
binary** (`Agents.md:68-69` rule 5).

### 5.6 `main.go` — bootstrap

Window (§2), single-instance lock, **portable-mode detection**: `--portable` flag OR
zero-byte `portable.marker` next to the exe → data dir `.\data\`, else
`%LOCALAPPDATA%\hibana\`; the choice locks into `mode.lock` (never silently migrate —
WINDOWS-PACKAGING-PLAN.md §1); WebView2 runtime probe + bootstrapper offer (§1.3 here);
logs with 7-day rotation; local-only crash reporter.

---

## 6. M0 — the Worker contract hardening (BEFORE any desktop UI) [awaiting OWNER go]

**M0 is Hibana-source code, not desktop code** — the standing rule
(`README.md`'s decision list): the desktop depends on the DEPLOYED contract, so the
additions ship with web unit + e2e coverage first. The stack lock (ADR-001) does **not**
green-light M0; when the owner says go, this is the exact work (API-AND-SYNC-CONTRACT.md
§7a-7e, implementation precision):

1. **§7a** — `setTaskTags` bumps `dev_tasks.updated_at` (one line,
   `src/routes/devboard-helpers.ts:191-225`): completes `updated_at` as a delta key.
2. **§7b** — soft-delete tombstones for `dev_tasks` (`deleted_at` column, one migration;
   GET filters; `?since=` stubs; purge rides the existing daily cron
   `src/routes/admin.ts:692-724`, 03:23 UTC prod).
3. **§7c** — idempotent creates (optional client `id` UUID on
   `POST …/devtasks` — the `POST /api/projects` pattern, `src/routes/projects/index.ts:394-402`).
4. *(§7d `?since=`, §7e SSE — optional, later.)*
5. Each with its unit + e2e tests, full web ladder, deploy, live verify — then the
   desktop repo pins the new web ref.

**M0 acceptance** (GO-DESKTOP-PORT-PLAN.md §8): delta key complete; tombstones
restorable; idempotent create replay returns the same id.

---

## 7. M1 → M5 — the build walkthrough [PLAN]

Each milestone's acceptance is `GO-DESKTOP-PORT-PLAN.md` §8 (cited); this is the how.

**M1 — Go API client + auth, no UI.** Implement `internal/api` + `internal/auth`
(§5.1, §5.5) against the live API. The acceptance round-trip is a Go test binary:
login → pull 2 boards (`GET /api/projects/:id/devboard`) → create/move/archive a task →
verify via the WEB client's API. Run: `go vet ./... && go test ./...`. No Wails window
opens; this milestone proves the cloud contract end-to-end.

**M2 — the Wails shell + read-only board.** Run the island sync (§3) → wire `main.go` +
bindings + shim (§4) → `wails dev` (hot reload) → the read-only board renders from the
mirror. Acceptance: cold start < 2 s to interactive board; FA/RTL + light/dark correct;
no network needed to view cached boards; the **side-by-side criteria**
(UI-UX-REPLICATION-SPEC.md §8: 1920×1080 + 390×844 equivalents, EN+FA × light+dark =
8 combinations, pixel-diff vs the web /kanban reference, font-hinting deltas only; the
s207/s209 geometry pins re-run INSIDE the WebView — enable the WebView2 remote-debugging
CDP port and drive the same assertions). **First portable exe ships here**
(`wails build` → zip + `docs/PORTABLE.md` → the owner's zip ritual, `Agents.md:95-100`)
— dogfooding starts months before M5 polishes distribution.

**M3 — offline mutations + outbox.** The sync engine (§5.3) goes live: airplane-mode
create/move/edit tasks; reconnect auto-drains; zero duplicates (the §7c idempotency
verified by replay). The offline indicator copies the web queue's badge contract
(idle/N-unsynced/saving/saved/auth — `queue.js:17-24`).

**M4 — attachments + sprints + labels parity.** Media pipeline (§5.4), the sprint doc
surface, the label manager dialog — every `FEATURE-INVENTORY.md` [R] row functional,
including the S208/S209 editor contracts (the 10-op toolbar, fullscreen exit-first,
pin/sprint badges). The island-sync ritual (§3.3) starts biting: bump the pin when the
web island moves.

**M5 — packaging.** NSIS installer (`installer/hibana.nsi` — WINDOWS-PACKAGING-PLAN.md
§4: per-user `%LOCALAPPDATA%\Programs\hibana`, WebView2 bootstrapper check §4.2, silent
`/S`, the leaves-no-residue uninstall contract §4.4), the desktop CI + Releases
(§8 below), the updater wired to the owner's chosen mode (§6 of the packaging plan —
still [OWNER — Q3]), the Win11-VM acceptance (§4.6), the signing decision executed or
explicitly deferred (§5 — recommendation: unsigned initially).

---

## 8. Building the two artifacts [PLAN]

```bash
# The shared binary — version stamps: the desktop semver + the pinned web ref (parity pin)
wails build -platform windows/amd64 \
  -ldflags "-s -w -X hibana/desktop.Version=0.1.0 -X hibana/desktop.WebRef=e6661c8"

# The installer (same binary, NSIS wrapper)
wails build -platform windows/amd64 -nsis \
  -ldflags "-s -w -X hibana/desktop.Version=0.1.0 -X hibana/desktop.WebRef=e6661c8"

# The portable zip (pwsh)
pwsh scripts/make-portable.ps1   # hibana.exe + docs/PORTABLE.md → hibana-portable-<ver>.zip

# Checksums (the updater's verification input)
sha256sum hibana.exe hibana-setup-<ver>.exe hibana-portable-<ver>.zip > checksums.txt
```

Rules that keep the artifacts honest (WINDOWS-PACKAGING-PLAN.md §3): the
`-X` stamps, the `wails.json` info block, and the git tag must NEVER diverge (one CI
step derives all three from the tag); `go mod vendor` or the CI Go pin for
reproducibility; arm64 lane only after [OWNER — Q9]; VERSIONINFO comes from
`wails.json`/`versioninfo.json`, NOT `-ldflags`.

---

## 9. The desktop CI — `.github/workflows/desktop.yml` [PLAN]

Conventions inherited from the verified web CI (`ci.yml`): `actions/checkout@v7`
(`ci.yml:39`), pinned toolchain (`setup-go` honoring `go.mod`'s toolchain line — the
web's `setup-bun@v2`/`packageManager` discipline), frozen deps (`go mod verify`),
`timeout-minutes` discipline (`ci.yml:37`), failure-only artifacts with retention
(`ci.yml:191-198`). One `build` job on `windows-latest`; steps in order
(WINDOWS-PACKAGING-PLAN.md §7.2):

```yaml
on: { push: { branches: [main] }, workflow_dispatch: {} }   # Releases are TAG-driven, not CI-driven
jobs:
  build:
    runs-on: windows-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-go@v6            # pin via go.mod toolchain [PLAN-verify version]
        with: { go-version-file: go.mod }
      - uses: oven-sh/setup-bun@v2           # island-sync + checksum scripts only
      - run: bun install --frozen-lockfile   # only if scripts carry package deps
      - run: node scripts/sync-island.mjs --ref ${{ env.WEB_REF }} --check   # FAILS on island drift
      - run: go vet ./... && go test ./...
      - run: wails build -platform windows/amd64 -ldflags "-s -w -X hibana/desktop.Version=${{ env.VER }} -X hibana/desktop.WebRef=${{ env.WEB_REF }}"
      - run: wails build -platform windows/amd64 -nsis -ldflags "…same stamps…"
      - run: pwsh scripts/make-portable.ps1
      - run: sha256sum … > checksums.txt
      - uses: actions/upload-artifact@v4      # exe + setup + zip + checksums, 7-day retention
```

Tag-driven release: `v0.x.y-desktop` tags → the release job (gh CLI, mirroring the web
CD's `gh api` usage) creates the GitHub Release with both artifacts + `checksums.txt` +
notes carrying BOTH versions (desktop semver + embedded web ref). The smoke floor is
honest (WINDOWS-PACKAGING-PLAN.md §7.4): build green + vet + test + the island drift
check + the embedded-frontend e2e re-run against a local server; real launch testing
stays human (the Win11 VM acceptance + the owner's dogfooding).

---

## 10. Acceptance & parity testing — how to run it [PLAN]

1. **Go side:** `go vet ./... && go test ./...` per milestone; the M1 round-trip test is
   the cloud-contract gate; the store gets migration + CRUD tests against a throwaway
   `.db`; the sync engine gets table-driven tests over the status-code table
   (API-AND-SYNC-CONTRACT.md §10) with an `httptest` fake Worker.
2. **Island side:** the web suite keeps running in hibana-source (the drift check pins
   the copy); the desktop repo re-runs the board e2e specs against a local Node server +
   scratch SQLite (`playwright.config.ts:15-16` pattern — `E2E_PORT`, `/tmp/hibana-e2e.db`)
   proving what the exe renders.
3. **In-WebView verification:** launch the packaged exe with the WebView2 remote-debugging
   CDP port enabled (`--webview2-additional-browser-arguments="--remote-debugging-port=9222"`
   `[PLAN-verify flag]`) → point Playwright at it → re-run the s207/s209 geometry pins +
   the fullscreen/lightbox/Esc contracts inside the real window (the pin list is
   UI-UX-REPLICATION-SPEC.md §8.2 with the spec-file line refs).
4. **Side-by-side pixel diffs:** the 8 combinations (1920/390 × EN/FA × light/dark) against
   the web /kanban reference on the same seeded project — allow only font-hinting deltas.
5. **The never-green-never-ship rule:** the web repo's suite (646 unit / 456 e2e at S209)
   stays green through every milestone that touches shared contracts (M0 especially) —
   the desktop never lands on a broken web suite (TEST-MATRIX.md).

---

## 11. The hard rules (the builder's ten commandments)

1. **No secrets in the binary. Ever.** Only the user's runtime session cookie (DPAPI at
   rest) — never API tokens, never the password at rest (`Agents.md:68-69`,
   WINDOWS-PACKAGING-PLAN.md §5/§8).
2. **The cloud stays the single source of truth**; the SQLite mirror is a cache + offline
   workspace (GO-DESKTOP-PORT-PLAN.md §4).
3. **Don't "fix" the deliberate exceptions** — the S209 parity decisions
   (FEATURE-INVENTORY.md §13) are contracts; replicate or consciously replace, never
   "fix" without owner input.
4. **Keep the seam thin** — 12 call sites through one adapter (§4.1); if a 13th appears,
   the web code changed and the sync ritual must re-run, not a hand-patch.
5. **Origin on every write** (`app.ts:172-194`); the Go client owns it, the island never
   knows about it.
6. **Never mix data dirs** — installed vs portable mode locks at first launch
   (WINDOWS-PACKAGING-PLAN.md §1).
7. **M0 before desktop mutations** — the outbox depends on §7a-7c being DEPLOYED.
8. **The web suite stays green** through anything shared (TEST-MATRIX.md).
9. **Both versions on every release** — desktop semver + embedded web ref, in the tag,
   the stamps, and the notes (WINDOWS-PACKAGING-PLAN.md §7.5).
10. **The bridge is an API surface** — one `Request` method, allow-listed paths,
    validated inputs (§4.4).

## 12. Where everything lives (the builder's map)

| Need | Document | Section |
|---|---|---|
| The decision + rationale | this guide | §0 |
| Feature parity classes [R]/[O]/[N/A] | `FEATURE-INVENTORY.md` | all + §12 keyboard + §13 exceptions |
| The flows to replicate | `USER-FLOWS.md` | all |
| The local schema DDL | `DATA-MODEL.md` | §6 (+ §7 identity) |
| Endpoint shapes, auth, ETag, sync rules | `API-AND-SYNC-CONTRACT.md` | §1-§10 |
| Tokens, anatomy, MUST/MAY tables | `UI-UX-REPLICATION-SPEC.md` | §1-§8 |
| Installer, signing, updater, CI detail | `WINDOWS-PACKAGING-PLAN.md` | §1-§10 |
| Milestones + remaining owner questions | `GO-DESKTOP-PORT-PLAN.md` | §8 + §10 |
| The regression net to keep green | `TEST-MATRIX.md` | all |
