# Hibana Project/Kanban — Go Desktop Port Plan

> **A concrete, repository-specific blueprint for a future Go-based Windows desktop
> companion sharing Hibana's cloud data.** This is a PLAN — no desktop code exists or
> should exist yet (spec §7). Everything about current behavior is verified against
> **v0.4.1.28 / S205**; everything about the desktop app is clearly marked
> **[PLAN]**. Owner decisions are marked **[OWNER]**.
>
> Prerequisites to read first: `API-AND-SYNC-CONTRACT.md` (the real contracts),
> `DATA-MODEL.md`, `FEATURE-INVENTORY.md` (parity classifications).

## 1. Strategic assessment — what the port reuses

**The frontend is unusually portable** for a no-build vanilla-JS app:

| Layer | Portability | Evidence |
|---|---|---|
| `public/js/devboard.js` (the board library: state, API calls, task editor, label manager) | **HIGH** — pure JSON + DOM, zero htmx/Alpine dependency | self-healing `ensureLib` injection works without the app shell (`board-page.js:624-646`) |
| `public/js/chip-render.js` (title renderer — load-bearing) | **HIGH** — pure DOM functions | shared by both surfaces; byte-parity pinned by tests |
| `public/board.html` + `board-page.js` (the S205 entry surface) | **MEDIUM-HIGH** — DOM + i18n + nav.js soft-nav; the switcher uses fetch/localStorage/history — all available in a WebView |
| `/project.html` surface (htmx server-fragments) | **LOW** — server-rendered HTML designed for the web shell | requires the real Worker (proxy) or a rebuild |
| `sw.js` (offline shell) | **N/A-ish** — service-worker availability inside Wails' WebView2 asset server is **unverified** (mark unknown; the board degrades gracefully without it — `board-page.js` self-heals) |
| Backend (Hono + D1 SQL) | **REUSED AS-IS** — the desktop calls the same API over HTTPS |

**Conclusion: Wails (Go + WebView2, web-frontend reuse) remains the leading candidate**
(spec §6.2 E's directive, confirmed by the architecture): the /kanban experience is a
client-rendered JSON island. A pure-Go GUI (Fyne/Gio) rebuild would discard a working,
tested board renderer — only worth it if WebView2 is unacceptable to the owner.

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
│   │   ├── schema.go            the MIRROR of the cloud subset (§4)
│   │   └── dao.go
│   ├── sync/                    the offline-first engine (§5)
│   │   ├── engine.go            pull (delta) + push (outbox) + conflict policy
│   │   ├── outbox.go            queued mutations, idempotency keys, retries
│   │   └── tombstones.go        deletion propagation (needs API additions §6)
│   ├── auth/                    login (PBKDF2 round-trip), cookie persistence (DPAPI)
│   └── ui/                      the Wails bindings + the embedded web assets
└── frontend/                    copied/adapted from public/ (§2.1)
```

### 2.1 Frontend packaging **[PLAN]**

Embed the **board island only**: `board.html` (adapted: strip nav/rail/SW/htmx scripts),
`devboard.js`, `chip-render.js`, `i18n-en.js`/`i18n-fa.js` + `i18n.js` (FA + Jalali is a
product language — keep it), the CSS sheets the board needs (variables/base/devboard/
project-header/polish-batch/themes/claude-dark/rtl — the board.html link list is the
manifest). Expose Go functions to JS (`window.gohibana.*`) that proxy the API client —
so the UI never needs CORS (same-origin against the embedded asset server) and never
holds credentials (the Go side owns the cookie jar). Replace `fetch` calls in devboard.js
with a thin adapter (`window.hibanaFetch`) — **one seam, ~15 call sites**, keeping the
renderers untouched.

### 2.2 What must be rebuilt (not reused) **[PLAN]**

- The app chrome (rail/panels/palette) — desktop-native alternatives: a project
  sidebar (the S205 switcher's data model: `GET /api/projects?sort=recent`), native menus,
  native shortcuts. The web shell's nav.js/soft-nav is browser-history-bound.
- The offline queue (queue.js) → the Go outbox (§5).
- Auth UI → a native login window (the PBKDF2 round-trip is one POST).

## 3. Cloud API compatibility (what the Go client implements)

Contract: `API-AND-SYNC-CONTRACT.md` §3. **[PLAN] rules for the Go client:**

1. Always `Accept: application/json`, never `HX-Request`.
2. **Send `Origin: https://hibana.ir` on every write** (the T6 gate 403s headerless callers).
3. Hold the `__Host-hibana_session` cookie in an `http.CookieJar`; 30-day rolling expiry
   means a weekly "sync" keeps it alive; 401 → show the login window, re-POST, continue.
4. Respect the ETag revalidation (If-None-Match) the API already emits.
5. Rate limits: uploads 30/60s, auth 30/60s — the sync engine must pace itself (outbox
   drains with ≤N req/s).
6. Login reuses `POST /api/auth/login` (urlencoded or JSON). No secrets ever ship in the
   binary — only the user's credentials at runtime (never stored except the session cookie
   via Windows DPAPI).

## 4. Local persistence **[PLAN]**

- SQLite (pure-Go driver) with the **cloud-subset mirror**: `projects`, `dev_tasks`,
   `sprints`, `categories`, `tags`, `dev_task_tags`, `project_archives` (+ a local
   `outbox` and `meta` table). Column names/types copied verbatim from `DATA-MODEL.md`
   §2 — the same SQL already runs on plain SQLite (the Node self-host proves it).
- The mirror is a CACHE + offline workspace, never the source of truth. Fresh installs
  start empty and pull.

## 5. Offline-first sync design **[PLAN]**

- **Pull (delta):** every `N` minutes + on focus + manual: `GET /api/projects/:id/devboard`
  today; after the §6 API additions, `?since=<last-pull>` — keyed on `updated_at`.
- **Push (outbox):** every mutation queues `{op, entity, id, payload, idempotency_key}`;
   drain FIFO with retry/backoff; 409/404 = reconcile (drop + full re-pull of that entity);
   401 = re-auth then retry.
- **Idempotency:** client-generated UUIDs for creates (needs §6.3 for tasks; projects
  already support it).
- **Conflicts:** single-user product with multi-device possibility (desktop + web tab).
  Policy: **last-writer-wins per field** (matches the web's semantics — there is no
  optimistic concurrency server-side today). A changed-on-server notice (not a merge UI)
   is honest and sufficient **[OWNER — confirm acceptable]**.
- **Deletions:** requires the §6.2 tombstones; until then, the desktop treats
  "disappeared from pull" as deleted (with a 7-day local grace copy).
- **Attachments:** upload when online; offline, queue the base64 (≤5MB cap already enforced).

## 6. Required (backward-compatible) API additions **[PLAN — for the Hibana Worker]**

Priority-ordered; each is additive and web-client-transparent (full rationale:
`API-AND-SYNC-CONTRACT.md` §7):

1. **`dev_tasks.updated_at` on tag changes** (one line in `setTaskTags`) — makes
   `updated_at` a complete delta key.
2. **Soft-delete tombstones for dev_tasks** (deleted_at + `?since=` inclusion, 7-day
   window; mirrors the projects purge cron) — deletion propagation.
3. **Optional client `id` on `POST …/devtasks`** (the projects-create pattern) —
   idempotent offline creates.
4. *(Optional, later)* `GET /api/projects/:id/devboard?since=` — server-side delta filter.
5. *(Optional, later)* SSE change feed — only if polling proves insufficient.

**Each addition ships with unit + e2e coverage on the web client first; the desktop
depends on the deployed contract, not the branch.**

## 7. Windows packaging **[PLAN]**

- **Wails v2** → single `hibana.exe` (~15-25MB with WebView2 loader; WebView2 runtime is
  preinstalled on Win 10/11). NSIS installer + a portable zip variant (the owner already
  consumes zips). Auto-update: a version check against `GET /api/health`'s version field +
  a download URL **[OWNER]**.
- Tray icon + global quick-add hotkey (the web app cannot do this — a genuine desktop win).
- Logging: structured to `%LOCALAPPDATA%\hibana\logs`, 7-day rotation; crash reporter
  local-only **[OWNER — no telemetry by default]**.

## 8. Milestones & acceptance criteria **[PLAN]**

| # | Milestone | Acceptance (measurable) |
|---|---|---|
| M0 | Contract hardening on the Worker (§6.1-6.3) + web e2e green | delta key complete; tombstones restorable; idempotent create replay returns the same id |
| M1 | Go API client + auth (no UI): login, board pull, task CRUD round-trip | a Go test binary does: login → pull 2 boards → create/move/archive a task → verify via the WEB client's API |
| M2 | Local store + read-only desktop board (Wails shell, embedded frontend) | cold start < 2s to interactive board; FA/RTL renders; no network needed to view cached boards |
| M3 | Offline mutations + outbox | airplane-mode: create/move/edit tasks; reconnect auto-drains; zero duplicates (idempotency verified) |
| M4 | Attachments + sprints + labels manager parity | FEATURE-INVENTORY [R] rows all functional |
| M5 | Packaging: installer + portable + auto-update check | clean Win 11 VM install; uninstall leaves no residue |

Estimated effort: M0 ~1 session (Hibana repo); M1-M2 ~2-3 sessions; M3-M5 ~2-3 sessions.

## 9. What is preserved EXACTLY vs. desktop-specific improvements **[PLAN]**

**Preserve exactly:** the 5 fixed columns and their semantics; priority-cycle; the
urgent-zone drop rule; label-manager merge semantics; done-archiving; the markdown-lite
title renderer (byte-parity with the web — port `chip-render.js` verbatim or share the
file); Jalali/FA rendering; the S205 switcher model (last-used default, `?project=`
equivalent state).

**Safe desktop-only improvements:** native shortcuts; tray quick-add; larger undo window
(the desktop CAN offer undo for deletes the web board lacks — the API supports re-create
with the same content); offline indicators; multi-window (board + sprint doc side-by-side).

**Never:** a second data store of truth; privileged Cloudflare credentials in the binary
(the desktop uses ONLY the authenticated application API — spec §7's hard rule);
reinventing auth.

## 10. Open questions for the owner **[OWNER]**

1. Wails (web-UI reuse) vs. pure-Go GUI — recommendation: Wails; confirm.
2. Multi-device conflict policy: silent LWW acceptable, or want change notifications?
3. Auto-update mechanism (health-endpoint version check + manual download vs. none)?
4. Telemetry/crash reporting: default-off local logs confirmed?
5. Should the desktop also cover the projects STAGE board and Ideas shelf (out of the
   Kanban scope) or stay Kanban-only (recommendation: Kanban-only first)?

## 11. Unresolved technical unknowns (honest list)

- Service-worker availability inside Wails' WebView2 asset handler (affects offline shell
  caching strategy; the Go local store makes this mostly moot).
- WebView2 print-to-PDF / clipboard fidelity for the board's Export Markdown flows
  (native alternatives exist in Go).
- The Workers AI route (`/api/ai/text`) works from any HTTP client (cookie + Origin) —
  but the magic-wand UX depends on the editor; deferred to M4+.
