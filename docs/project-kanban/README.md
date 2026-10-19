# Hibana Project/Kanban — The Go Desktop Replication Spec Pack

> **What this pack is.** The COMPLETE specification pack for porting the Hibana kanban
> to a **Go Windows desktop app** that shares the cloud data — expanded at **S209**
> (2026-10-20) from the old S205 "port plan + three companions" level into the full pack,
> per the owner's ask: *"…to replicate this kanban and its features and sync ability
> using GO, for a Windows app (both installable and exe)."* The same
> session first landed the **kanban 1:1 parity round** (*"the kanban in the hibana is
> 1:1 the same as the kanban at projects.hibana.ir/kanban"*) so the web app itself is
> the single, converged reference the port replicates. At **S210** (2026-10-21) the owner
> **locked the stack** — *"Okay go this way: Go + Wails v2 + WebView2 +
> modernc.org/sqlite"* — and the pack gained its operator's manual
> (`GO-DESKTOP-IMPLEMENTATION-GUIDE.md`: the decision record + the step-by-step build
> instructions).
>
> **Verified against:** `v0.4.1.35 / S209` (main `e6661c8`, tag `v0.4.1.35`) · **schema 63**
> (migrations end at `0064_user_categories.sql`; no schema changes in S209/S210) · **sw
> `hibana-v444`** · devboard.js v28 / board-page.js v21 / sprint-page.js v20 /
> project-page.js v76 / chip-render.js v12 / devboard.css v34. Test floor at this
> tree: 646 unit / 456 e2e / i18n 1584/1584 / escape-lint 220.
>
> **Convention (all docs).** Plain statements are **VERIFIED** facts with `file:line`
> citations read in the tree above. Anything the port may decide differently is marked
> **[PLAN]** or **[RECOMMENDATION]**. Decisions only the owner (Ali) can make are marked
> **[OWNER]** — the consolidated open list lives in `GO-DESKTOP-PORT-PLAN.md` §10.

## Reading order (for a fresh agent)

Read in this order — each doc assumes the ones before it:

| # | Doc | What it owns (one line) |
|---|---|---|
| 1 | `FEATURE-INVENTORY.md` (270 lines) | Every user-visible capability traced to code, with the desktop parity classes [R]/[O]/[N/A]/[?] — plus §12 the keyboard map and §13 the S209 1:1 parity decisions (closed gaps + deliberate exceptions). |
| 2 | `USER-FLOWS.md` (369) | The step-by-step flows with UI states, error paths, and API calls — both board surfaces, the embedded board, fullscreen writing. |
| 3 | `DATA-MODEL.md` (496) | The authoritative persisted schema (D1 schema 63) + §6 the exact SQLite-mirror DDL for the desktop + §7 idempotency & identity for offline creates. |
| 4 | `API-AND-SYNC-CONTRACT.md` (430) | The verified runtime/auth/endpoint/cache facts (§1-§6, §8-§9) + the banked M0 additions at implementation precision (§7a-7e) + the sync strategy (§10). |
| 5 | `UI-UX-REPLICATION-SPEC.md` (514) | The pixel & behavior contract: tokens, board/card anatomy, the editor modal; §7 MUST-reproduce vs MAY-replace + the Wails embedding model; §8 acceptance criteria. |
| 6 | `WINDOWS-PACKAGING-PLAN.md` (426) | The delivery plan: dual-target (NSIS installer + portable zip), build/CI in a separate repo, signing, auto-update, data & security posture. |
| 7 | `GO-DESKTOP-PORT-PLAN.md` (296) | **The strategic master** — assessment, architecture, milestones M0-M5, preserved-exactly list, owner questions. Points at the companions instead of duplicating them. |
| 8 | `GO-DESKTOP-IMPLEMENTATION-GUIDE.md` (NEW, S210) | **The operator's manual — read this when the build starts**: ADR-001 the locked-stack decision record, toolchain setup, repo scaffold, the island sync ritual, the `hibanaFetch` transport seam (12 verified call sites), the Go module skeletons, the M0–M5 walkthrough with commands, build + CI recipes, the builder's ten hard rules. |
| 9 | `TEST-MATRIX.md` (116) | The coverage map + honest gaps (the regression net the port must keep green; the port's own acceptance gates live in UI-UX §8). |

## Standing decisions (as of S210)

- **THE STACK IS DECIDED [OWNER, 2026-10-21]: Go + Wails v2 + WebView2 +
  modernc.org/sqlite** — the owner's explicit go (*"Okay go this way… prepare specs and
  instructions based on this decision"*). Decision record:
  `GO-DESKTOP-IMPLEMENTATION-GUIDE.md` §0 (ADR-001 — rationale, accepted costs,
  consequences). The pure-Go GUI alternative is rejected and the Fyne fallback condition
  retired. **Build instructions:** the same guide, §1–§12.
- **M0 comes first**: the Worker-side contract hardening (`API-AND-SYNC-CONTRACT.md`
  §7a-7e — the `setTaskTags` `updated_at` bump, dev_tasks tombstones, idempotent creates,
  `?since=`) ships with web tests before any desktop code exists.
- **The cloud stays the single source of truth**; the desktop's SQLite mirror
  (`DATA-MODEL.md` §6) is a cache + offline workspace — never a second store of truth, and
  no Cloudflare credentials ever ship in the binary.
- **The S209 deliberate web-surface deltas are contracts, not defects**
  (`FEATURE-INVENTORY.md` §13) — replicate them or consciously replace them; never "fix".
- **Open owner decisions live in one place**: `GO-DESKTOP-PORT-PLAN.md` §10 — the stack
  question is ANSWERED (item 0, S210); nine remain open (conflict policy, auto-update
  mode incl. the corrected `/api/health` version question, telemetry, scope, installer
  tech, signing, repo split, arm64, tray/hotkey).

## Quick orientation for the port

The web app to replicate: `/kanban` (the auth-gated Worker route serving `board.html` +
`board-page.js` — the client-rendered JSON island the port embeds), with the embedded
board on `/project.html` and `sprint.html` now sharing the same library
(`devboard.js` v28). The API it speaks: `API-AND-SYNC-CONTRACT.md` §3. The data it
renders: `DATA-MODEL.md` §2. The pixels it must match: `UI-UX-REPLICATION-SPEC.md`.
No desktop code exists yet — everything desktop-side in this pack is [PLAN] until the
owner green-lights each milestone; the stack itself is now decided (above), and the
build's first move when it starts is M0 (the Worker contract hardening), then the
`GO-DESKTOP-IMPLEMENTATION-GUIDE.md` walkthrough from §1.
