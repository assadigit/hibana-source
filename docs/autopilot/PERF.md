# Hibana — PERF.md (Phase 5 measurement ledger, DP-3: measure first)

> Every Phase 5 change lands with a before/after row here. PERF_REGRESSION_LIMIT = 0%
> (no measured metric may get worse without a written reason). Raw JSON lives next to
> the harnesses (`scripts/perf-baseline.json` — regenerated per measurement round).

## Baseline 1 — 2026-10-27 (post-Phase-4 tree, main @ 130206d)

Harness: `scripts/perf-seed.mjs` (deterministic busy-solo dataset: 90 projects, 250
dev tasks, 180 sadhana tasks + 600 journal rows, 1200 canvas elements, 70 screenshots
/ 5.4 MB) + `scripts/perf-pages.mjs` (8 key pages × EN/FA × cold/warm × 3 cycles,
medians; server = plain Node + node:sqlite on :3017) + `scripts/explain-hotpaths.mjs`
(EXPLAIN QUERY PLAN at synthetic busy scale) + the build's own bundle-size gates.

### Page loads (median of 3; load event, transfer, API count/ms, DOM nodes)

| page | lang | cold load | cold xfer | warm load | warm xfer | apis | apiMs (cold) | dom |
|------|------|-----------|-----------|-----------|-----------|------|--------------|-----|
| dashboard | en | 250 ms | 891 KB | 223 ms | 1992 KB | 5 | 108 | 2748 |
| dashboard | fa | 223 ms | 1016 KB | 245 ms | 2194 KB | 5 | 95 | 2750 |
| projects | en | 238 ms | 631 KB | 211 ms | 1711 KB | 5 | 45 | 526 |
| projects | fa | 221 ms | 790 KB | 223 ms | 1946 KB | 5 | 40 | 528 |
| project-detail | en | 247 ms | 891 KB | 205 ms | 2302 KB | 6 | 55 | 1653 |
| project-detail | fa | 339 ms | 1012 KB | 267 ms | 2500 KB | 6 | 59 | 1655 |
| notes-vault | en | 277 ms | 754 KB | 253 ms | 1976 KB | 5 | 105 | 1925 |
| notes-vault | fa | 279 ms | 912 KB | 276 ms | 2211 KB | 5 | 127 | 1927 |
| gallery | en | 212 ms | 701 KB | 217 ms | 1750 KB | 24 | 926 | 1475 |
| gallery | fa | 217 ms | 895 KB | 278 ms | 1985 KB | **44** | 765 | 1477 |
| calendar | en | 226 ms | 661 KB | 212 ms | 1741 KB | 7 | 78 | 473 |
| calendar | fa | 281 ms | 779 KB | 225 ms | 1934 KB | 7 | 51 | 479 |
| whiteboard | en | 248 ms | 825 KB | 248 ms | 2055 KB | 4 | 27 | 384 |
| whiteboard | fa | 257 ms | 1049 KB | 251 ms | 2290 KB | 4 | 37 | 386 |
| settings | en | 291 ms | 669 KB | 243 ms | 1759 KB | 6 | 47 | 720 |
| settings | fa | 319 ms | 828 KB | 301 ms | 1995 KB | 6 | 74 | 722 |

Notes: (a) warm transfer > cold because the SW precache materializes the full shell on
first visit — expected under the offline-first design, not a regression. (b) The
gallery's per-shot API fan-out (24–44 sub-500-byte `GET /api/screenshots/:id` calls)
and the FA gallery's 20 extra calls vs EN are the two most obvious AP-71/AP-72
candidates. (c) `/api/dashboard` responds ~218 KB JSON at seed scale — the biggest
single payload; candidate for field-trimming/pagination review.

### Query plans (explain-hotpaths, busy-solo scale)

- Every hot query resolves to INDEX `SEARCH` plans — zero full TABLE SCANs.
- Worst query: **117.78 ms** at synthetic busy-solo scale (SQLite in-process; D1 adds
  ~10–40 ms network RTT per batch regardless of plan quality).
- Index inventory in use: `idx_projects_user_status`, `idx_projects_user_updated`,
  `idx_hurdles_project`, `idx_quick_notes_sort`, `idx_sadhana_board`, `idx_sadhana_quad`,
  `idx_sadhana_updates`, `idx_canvas_y`, `idx_vault_notes_user`, `idx_vault_notes_sort`,
  `idx_screenshots_project`, plus the PK autoindexes.

### Bundle gates (from `npm run verify`, same tree)

- `check-bundle-size` / `check-precache-size` PASS (baselines in
  `scripts/bundle-size-baseline.json`); build = 85 entries, content-hashed.

### Lighthouse / mobile profile

- Deferred to the AP-70 continuation: the repo's lighthouserc.json + .mobile.json
  configs exist; the runs need the same seeded server + lighthouse CLI round. Recorded
  as the first item of the next Phase 5 session (STATE.md plan step 1 remainder).
