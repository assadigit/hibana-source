# Hibana Project/Kanban — Go Desktop Port Plan

> **The strategic master plan for a future Go-based Windows desktop companion sharing
> Hibana's cloud data.** This is a PLAN — no desktop code exists or should exist yet.
> This document owns the **assessment, the architecture, the milestones, and the
> decisions**; the details live in the pack's companion docs
> (cross-referenced below — this plan points at them instead of duplicating them).
> Everything about current behavior is verified against **v0.4.1.35 / S209** (the kanban
> 1:1 parity round, 2026-10-20 — uncommitted working tree; schema 63, sw `hibana-v444`,
> devboard.js v28 / board-page.js v21 / sprint-page.js v20 / project-page.js v76 /
> chip-render.js v12 / devboard.css v34). Everything about the desktop app is clearly
> marked **[PLAN]**. Owner decisions are marked **[OWNER]**. Fresh here? Start at
> `README.md` (the pack index).
>
> **S210 (2026-10-21): THE STACK IS DECIDED [OWNER]** — *"Okay go this way: Go + Wails v2
> + WebView2 + modernc.org/sqlite."* The decision record (ADR-001), the rationale, and the
> full build instructions live in the pack's newest member,
> `GO-DESKTOP-IMPLEMENTATION-GUIDE.md` (the operator's manual: toolchain → scaffold →
> island sync → transport seam → Go module skeletons → the M0–M5 walkthrough → build/CI
> commands). The Fyne fallback condition is retired; the nine other §10 questions remain
> open. No desktop code exists yet — the guide is documents, per the brief.

### The pack cross-reference (what each companion owns)

| Companion doc | What it owns (not duplicated here) |
|---|---|
| `FEATURE-INVENTORY.md` (270 lines) | every user-visible capability traced to code, with the desktop parity classifications **[R]/[O]/[N/A]/[?]**; §12 the keyboard-shortcut map; §13 the S209 1:1 parity decisions — the 8 closed gaps + the 7 deliberate exceptions |
| `USER-FLOWS.md` (369) | the step-by-step flows with UI states, error paths, and the API calls each makes — both board surfaces, the embedded board, the fullscreen writing mode |
| `DATA-MODEL.md` (496) | the authoritative persisted schema (D1 schema 63, migrations end at `0064`); §6 the exact SQLite-mirror DDL for the desktop client; §7 idempotency & identity for offline creates |
| `API-AND-SYNC-CONTRACT.md` (430) | the verified runtime/auth/endpoint/cache facts (§1-§6, §8-§9) + the banked M0 additions at implementation precision (§7a-7e) + the full desktop sync strategy (§10) |
| `UI-UX-REPLICATION-SPEC.md` (514) | the pixel & behavior replication contract: design tokens, board/card anatomy, the editor modal; §7 MUST-reproduce vs MAY-replace + the Wails embedding model; §8 the side-by-side acceptance criteria |
| `WINDOWS-PACKAGING-PLAN.md` (426) | the expansion of this plan's §7: dual-target delivery (NSIS installer + portable zip), code signing, auto-update, CI/CD, data & security posture |
| `GO-DESKTOP-IMPLEMENTATION-GUIDE.md` (NEW, S210) | the operator's manual — the HOW: ADR-001 the locked-stack decision record, toolchain setup, repo scaffold, the island sync ritual, the `hibanaFetch` transport seam (12 verified call sites), the Go module skeletons, the M0–M5 walkthrough, build + CI commands, the builder's hard rules |
| `TEST-MATRIX.md` | the coverage map + honest gaps (at S209: 646 unit / 456 e2e, i18n 1584/1584, escape-lint 220) |

## 1. Strategic assessment — what the port reuses

**The frontend is unusually portable** for a no-build vanilla-JS app:

| Layer | Portability | Evidence |
|---|---|---|
| `public/js/devboard.js` v28 (the board library: state, `api()` transport, task editor modal with the full toolbar + fullscreen, label manager, pinned-pictures dialog) | **HIGH** — pure JSON + DOM, zero htmx/Alpine dependency | self-healing `ensureLib` injection works without the app shell (`board-page.js:876-905`); the whole export surface is one `window.HibanaBoard` object (`devboard.js:1418-1427`) |
| `public/js/chip-render.js` v12 (title renderer — load-bearing) | **HIGH** — pure DOM functions | shared by both surfaces (`board.html:46`, `project.html:75`); byte-parity pinned by the meta-parity e2e + the parity unit tests |
| `public/board.html` + `board-page.js` v21 (the /kanban entry surface) | **MEDIUM-HIGH** — DOM + i18n + nav.js soft-nav; the switcher uses fetch/localStorage/history — all available in a WebView | the S205-S209 entry stack |
| `/project.html` surface (htmx server-fragments) | **LOW** for the SERVER fragments (Worker-rendered `detail-helpers.ts` needs the real Worker or a rebuild) — but S209 converged the CLIENT side: the embedded board now runs the same devboard.js v28 + chip-render.js v12 (`project.html:75, 80`) including the label manager + the shared editor vocabulary | server fragments ≠ portable; client island already shared |
| `sw.js` v444 (offline shell) | **N/A-ish** — service-worker availability inside Wails' WebView2 asset server is **unverified** (§11; the board self-heals without it — `ensureLib`) | — |
| Backend (Hono + D1 SQL, schema 63) | **REUSED AS-IS** — the desktop calls the same API over HTTPS | `API-AND-SYNC-CONTRACT.md` §1 |

**Conclusion — DECIDED [OWNER, 2026-10-21]: Wails v2 + WebView2 + modernc.org/sqlite**
(the owner's explicit go on the recommendation; the full decision record is
`GO-DESKTOP-IMPLEMENTATION-GUIDE.md` §0/ADR-001): the /kanban experience is a
client-rendered JSON island, so a pure-Go GUI (Fyne/Gio) rebuild would discard a working,
tested board renderer for zero owner benefit — the fallback condition
(`WINDOWS-PACKAGING-PLAN.md` §2's alternatives table) is retired; the table stays for the
record.

**The S209 parity round improved the port's economics.** The embedded surface and
/kanban now share the same editor vocabulary — the shared modal's FULL 10-op formatting
toolbar + fullscreen writing (`devboard.js:845, 862-876`) emit the identical
markdown-lite language the project page's composer emits, and the same label-manager
dialog serves both heads. The port embeds ONE renderer, not two. The one known editing
divergence that remains is **deliberate**: the project page's title/content
split-editor (WYSIWYG contenteditable) vs the board's single raw-textarea — capability
parity via the toolbar, two editing models, one output language. See
`FEATURE-INVENTORY.md` §13's decisions table for the full closed-gap + deliberate-
exception list; **do not "fix" the deliberate exceptions in the Go port without owner
input.**

## 2. Recommended architecture **[PLAN]**

```
hibana-desktop/                  (Go, Wails v2)
├── main.go                      app bootstrap, window, single-instance lock
├── internal/
│   ├── api/                     THE client for the existing cloud API (§3)
│   │   ├── client.go            cookie-jar transport, Origin header, retries
│   │   ├── projects.go          /api/projects* calls (typed structs)
│   │   ├── devboard.go          /devtasks, /sprints, /categories, /tags
│   │   └── media.go             screenshots upload/download (base64 path)
│   ├── store/                   local SQLite (modernc.org/sqlite — pure Go, no cgo)
│   │   ├── schema.go            the MIRROR of the cloud subset (§4 → DATA-MODEL §6)
│   │   └── dao.go
│   ├── sync/                    the offline-first engine (§5 → API-AND-SYNC-CONTRACT §10)
│   │   ├── engine.go            pull (delta) + push (outbox) + conflict policy
│   │   ├── outbox.go            queued mutations, idempotency keys, retries
│   │   └── tombstones.go        deletion propagation (needs API additions §6)
│   ├── auth/                    login (PBKDF2 round-trip), cookie persistence (DPAPI)
│   └── ui/                      the Wails bindings + the embedded web assets
└── frontend/                    copied/adapted from public/ (§2.1 → UI-UX-REPLICATION-SPEC §7.3)
```

### 2.1 Frontend packaging **[PLAN]**

Embed the **board island only**: `board.html` stripped of web chrome (SW/htmx/nav
layer), plus the JS + CSS asset set. The exact, verified lists live in
`UI-UX-REPLICATION-SPEC.md` §7.3 (the embedding model): the 19 CSS sheets in load order
(the `board.html:10-29` link list is the manifest — `rtl.css` last), the JS set
(devboard.js v28 + chip-render.js v12 + the i18n trio + `jalaali.min.js` +
`image-resize.js` + the toast component), and the fonts. FA + Jalali is a product
language — keep it. Expose Go functions to JS (`window.gohibana.*`) that proxy the API
client — so the UI never needs CORS (same-origin against the embedded asset server) and
never holds credentials (the Go side owns the cookie jar). Replace the network calls
with a thin adapter (`window.hibanaFetch`): **the seam, corrected from the old "~15
call sites" estimate — `api()` is ONE choke point serving 21 endpoint call sites, plus
11 raw fetch/XHR sites** (devboard.js's 5 label-manager `fetch(` bypasses + 2 XHR
upload paths + board-page.js's 4 direct sites); replace them all, keeping the renderers
untouched (`UI-UX-REPLICATION-SPEC.md` §7.3 has the verified count with line refs).

### 2.2 What must be rebuilt (not reused) **[PLAN]**

- The app chrome (rail/panels/palette) — desktop-native alternatives: a project
  sidebar (the S205 switcher's data model: `GET /api/projects?sort=recent`), native menus,
  native shortcuts. The web shell's nav.js/soft-nav is browser-history-bound.
- The offline queue (queue.js) → the Go outbox (§5).
- Auth UI → a native login window (the PBKDF2 round-trip is one POST).

## 3. Cloud API compatibility (what the Go client implements)

**The contract now lives in `API-AND-SYNC-CONTRACT.md`** — §2 auth/origin (the T6 gate),
§3 the endpoint surface, §8 the exact ETag/no-store/cache-semantics rules, §9 offline
behavior + its desktop equivalent; §7a-7e the banked M0 additions; §10 the full
conflict/sync strategy. **[PLAN] rules summary for the Go client:**

1. Always `Accept: application/json`, never `HX-Request`.
2. **Send `Origin: https://hibana.ir` on every write** (the T6 gate 403s headerless callers).
3. Hold the `__Host-hibana_session` cookie in an `http.CookieJar`; 30-day rolling expiry
   means a weekly "sync" keeps it alive; 401 → show the login window, re-POST, continue.
4. Respect the ETag revalidation (If-None-Match) the API already emits — and honor the
   per-route cache rules instead of the web client's blanket `cache:'no-store'` (that was
   an S206 browser workaround, not a server contract — §8).
5. Rate limits: uploads 30/60s, auth 30/60s — the sync engine must pace itself (outbox
   drains ≤N req/s; uploads count against their own bucket).
6. Login reuses `POST /api/auth/login` (urlencoded or JSON). No secrets ever ship in the
   binary — only the user's credentials at runtime (never stored except the session
   cookie via Windows DPAPI).

## 4. Local persistence **[PLAN]**

**The exact schema is `DATA-MODEL.md` §6** — the cloud-subset mirror DDL (projects,
dev_tasks, sprints, categories, tags, dev_task_tags, project_categories,
project_archives, screenshots metadata + the local `outbox`/`meta` tables), column
names/types copied VERBATIM from the verified cloud shapes; feasibility is already
proven (the same SQL runs on plain SQLite — the Node self-host `src/db/sqlite.ts`).
**Offline-create identity rules are `DATA-MODEL.md` §7** (server-minted ids today; the
M0 client-id addition; the pre-M0 reconciliation loop the desktop must run). Summary:

- SQLite (pure-Go driver) with the cloud-subset mirror; the mirror is a CACHE + offline
  workspace, **never the source of truth**. Fresh installs start empty and pull.
- What does NOT get mirrored: sessions, rate_limits, `_migrations`, the users password
  hash (`DATA-MODEL.md` §6's exclusion list).

## 5. Offline-first sync design **[PLAN]**

**The full strategy is `API-AND-SYNC-CONTRACT.md` §10** (pull cadence + ETag cheap-poll,
outbox drain rules per status code, LWW-per-field conflict policy, deletion
propagation, attachment pacing). Summary:

- **Pull (delta):** on focus + every 5 min + manual: `GET /api/projects/:id/devboard`
  with `If-None-Match` today; after the §6 additions, `?since=<last-pull>` — keyed on
  `updated_at`.
- **Push (outbox):** every mutation queues `{op, entity, id, payload, idempotency_key}`;
  drain FIFO, ONE in-flight at a time, retry/backoff; 404 on PATCH/DELETE =
  deleted-or-archived → drop + full re-pull of that entity; 401 = re-auth then retry.
- **Idempotency:** client-generated UUIDs for creates (needs §6.3 / contract §7c for
  tasks; projects already support it).
- **Conflicts:** single-user product with multi-device possibility (desktop + web tab).
  Policy: **last-writer-wins per field** (matches the web's semantics — there is no
  optimistic concurrency server-side today). A changed-on-server notice (not a merge UI)
  is honest and sufficient **[OWNER — confirm acceptable]**.
- **Deletions:** requires the §6.2 tombstones; until then, the desktop treats
  "disappeared from pull" as deleted (with a 7-day local grace copy). Archived ≠
  deleted — the archives view keeps them restorable.
- **Attachments:** upload when online; offline, queue the base64 (≤5MB cap already
  enforced); mirror only `?variant=thumb` tiles to bound disk.

## 6. Required (backward-compatible) API additions **[PLAN — for the Hibana Worker]**

Priority-ordered; each is additive and web-client-transparent. **The
implementation-precision spec is `API-AND-SYNC-CONTRACT.md` §7a-7e** — request/response
shapes, backward-compat arguments, the exact cron/purge vehicle for tombstones, and the
required test coverage per addition:

1. **`dev_tasks.updated_at` on tag changes** (one line in `setTaskTags`) — makes
   `updated_at` a complete delta key. (§7a)
2. **Soft-delete tombstones for dev_tasks** (deleted_at + `?since=` inclusion, 7-day
   window; rides the existing daily-purge cron) — deletion propagation. (§7b)
3. **Optional client `id` on `POST …/devtasks`** (the projects-create pattern) —
   idempotent offline creates. (§7c)
4. *(Optional, later)* `GET /api/projects/:id/devboard?since=` — server-side delta
   filter. (§7d)
5. *(Optional, later)* SSE change feed — only if polling proves insufficient. (§7e)

**Each addition ships with unit + e2e coverage on the web client first; the desktop
depends on the deployed contract, not the branch.**

## 7. Windows packaging **[PLAN]**

**The complete plan is `WINDOWS-PACKAGING-PLAN.md`** — this section is now a summary +
pointer, replacing the old ~10-line sketch. What it owns: the dual-target matrix (NSIS
installer **and** a portable zip — same Go binary, two wrappers, never-mix data rule),
the Go stack rationale (Wails v2 + WebView2 Evergreen + modernc.org/sqlite), the build
recipe (island copy + `embed.FS` + version stamping), the installer/uninstall contract
("leaves no residue"), code signing (ship unsigned initially), auto-update, CI/CD in a
separate `hibana-desktop` repo, and the data/security posture (DPAPI cookie, 7-day log
rotation, outbound-443-only).

**One correction this master plan owes the pack (verified):** the old sketch here
claimed auto-update would use "a version check against `GET /api/health`'s version
field." **That field does not exist** — `GET /api/health` returns
`{ok, service, environment, db, schema_version, storage, time}` (`src/routes/health.ts:37-48`),
and `schema_version` (`health.ts:42`) is the **applied-migration count**
(`health.ts:12-22` — live probes report 63), NOT a package.json-parity app version.
The two real options (`WINDOWS-PACKAGING-PLAN.md` §6):

- **(a)** add a `version` field to `/api/health` as an M0 one-liner Worker change
  (web-transparent, rides the existing no-store probe) **[OWNER — decide whether M0
  includes it]**, then poll-on-launch → semver compare → open the Release page; or
- **(b)** the packaging plan's **[RECOMMENDED]** option: a GitHub Releases feed +
  check-on-launch with manual-confirm install and SHA-256 verification (§6.2; the repo
  is public, so Releases/CI cost nothing).

Tray icon + global quick-add hotkey stay the genuine desktop wins (the web app cannot
do these); logging to `%LOCALAPPDATA%\hibana\logs` with 7-day rotation and a local-only
crash reporter stay the defaults **[OWNER — no telemetry]**. Milestone placement: the
first **portable exe ships from M2** for dogfooding; installer/CI/update work
concentrates in M5 (`WINDOWS-PACKAGING-PLAN.md` §9).

## 8. Milestones & acceptance criteria **[PLAN]**

| # | Milestone | Acceptance (measurable) |
|---|---|---|
| M0 | Contract hardening on the Worker (§6.1-6.3 → contract §7a-7c) + web e2e green | delta key complete; tombstones restorable; idempotent create replay returns the same id; *(+ the `/api/health` `version` field ONLY if update option (a) is chosen — packaging §6.1)* |
| M1 | Go API client + auth (no UI): login, board pull, task CRUD round-trip | a Go test binary does: login → pull 2 boards → create/move/archive a task → verify via the WEB client's API |
| M2 | Local store + read-only desktop board (Wails shell, embedded frontend) | cold start < 2s to interactive board; FA/RTL renders; no network needed to view cached boards; **the desktop UI matches `UI-UX-REPLICATION-SPEC.md` §8's side-by-side criteria** (1920/390, EN+FA, light+dark pixel-diff + the s207/s209 geometry pins re-run inside the WebView); first portable exe handed to the owner (packaging §9) |
| M3 | Offline mutations + outbox | airplane-mode: create/move/edit tasks; reconnect auto-drains; zero duplicates (idempotency verified) |
| M4 | Attachments + sprints + labels manager parity | `FEATURE-INVENTORY.md` [R] rows all functional — including the S209 full-toolbar + fullscreen editor contract and the pin/sprint badges |
| M5 | Packaging: installer + portable + auto-update + signing decision | clean Win 11 VM install (packaging §4.6); uninstall leaves no residue; the §6 update mode wired; the web suite stays green throughout (TEST-MATRIX) |

Estimated effort: **M0 ~1 session** (Hibana repo; the spec pack has already written the
contracts); **M1-M2 ~2-3 sessions** (the S209 parity round removed the two-renderer
risk); **M3-M5 ~3-4 sessions** (honest bump from the old "~2-3": the packaging plan's
dual-target + separate-repo CI/CD + auto-update scope is real work beyond the old
sketch).

## 9. What is preserved EXACTLY vs. desktop-specific improvements **[PLAN]**

**Preserve exactly** (the MUST list with implementation refs is
`UI-UX-REPLICATION-SPEC.md` §7.1; the S209 decisions behind it are
`FEATURE-INVENTORY.md` §13): the 5 fixed columns and their semantics; priority-cycle;
the urgent-zone drop rule; label-manager merge semantics; done-archiving; the
markdown-lite title renderer (byte-parity with the web — port `chip-render.js`
verbatim or share the file); **the 10-op formatting toolbar's exact markdown products**
(`**bold**`, `__underline__`, `~~strike~~`, `- `/`1. ` prefixes, `{:align}` markers,
```` ``` ```` fences); **the fullscreen-writing toggle with its exit-first contract**
(Esc/✕/Cancel/backdrop leave focus mode before the modal); **the ◆ sprint badge + pin
badge on cards (all surfaces)**; Jalali/FA rendering; the S205 switcher model
(last-used default, `?project=` equivalent state). The deliberate S209 exceptions
(Back-link/rail split between /board.html and /kanban; the embedded board's reading
measure + `+N` windowing; the split-editor; the slide-over; the two delete models) are
**entry-context decisions, not defects** — replicate or consciously replace them, never
"fix" them.

**Safe desktop-only improvements** (`UI-UX-REPLICATION-SPEC.md` §7.2's MAY table):
native shortcuts; tray quick-add; larger undo window (the desktop CAN offer undo for
deletes the web board lacks — the API supports re-create with the same content);
offline indicators; multi-window (board + sprint doc side-by-side).

**Never:** a second data store of truth; privileged Cloudflare credentials in the binary
(the desktop uses ONLY the authenticated application API — spec §7's hard rule);
reinventing auth.

## 10. Open questions for the owner **[OWNER]**

0. ~~Wails (web-UI reuse) vs. pure-Go GUI~~ — **ANSWERED 2026-10-21 (S210): Wails v2 +
   WebView2 + modernc.org/sqlite, per the owner's explicit go.** Decision record:
   `GO-DESKTOP-IMPLEMENTATION-GUIDE.md` §0 (ADR-001). Build instructions: the same guide,
   §1–§12.
1. Multi-device conflict policy: silent LWW acceptable, or want change notifications?
2. **Auto-update mechanism — corrected options** (`WINDOWS-PACKAGING-PLAN.md` §6): (b)
   GitHub Releases feed + check-on-launch + manual-confirm **[recommended]**, (a)
   health-endpoint check + manual download — which first needs the one-line Worker
   `version` field (see §7's correction; that Worker change is an M0 item only if you
   pick (a)), or none?
3. Telemetry/crash reporting: default-off local logs confirmed?
4. Should the desktop also cover the projects STAGE board and Ideas shelf (out of the
   Kanban scope) or stay Kanban-only (recommendation: Kanban-only first)?
5. **Installer technology** (`WINDOWS-PACKAGING-PLAN.md` §10.1): NSIS per-user
   (recommended) vs WiX/MSI — confirm.
6. **Signing budget** (§10.2): ship unsigned (recommended for the personal-use phase)
   vs fund an OV cert / Trusted Signing once the app leaves your own machines?
7. **Repo split** (§10.4): a separate public `hibana-desktop` repo (recommended) vs a
   `desktop.yml` lane inside hibana-source?
8. **arm64** (§10.5): any Windows-on-ARM hardware (current or planned)? Build that lane
   only if yes.
9. Packaging-adjacent carried items (§10.6): tray/hotkey priority in M5 + confirm the
   local-only crash-reporter default.

## 11. Unresolved technical unknowns (honest list)

- Service-worker availability inside Wails' WebView2 asset handler (affects offline
  shell caching strategy; the Go local store makes this mostly moot).
- **WebView2 rendering of the modal's fullscreen-writing mode (`.db-fullscreen`), the
  lightbox + its Esc-precedence chain, and native `<dialog>` elements** — expected to
  work (same Chromium engine; `UI-UX-REPLICATION-SPEC.md` §7.2 assumes dialogs render
  identically) but unpinned inside a WebView until M2's side-by-side criteria run.
- WebView2 print-to-PDF / clipboard fidelity for the board's Export Markdown flows
  (native alternatives exist in Go).
- The Workers AI route (`/api/ai/text`) works from any HTTP client (cookie + Origin) —
  but the magic-wand UX depends on the editor; deferred to M4+.
