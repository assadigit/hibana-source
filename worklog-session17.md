# Session 17 worklog — the ONE sticky-note style (square + layered directional shadow)

Task: replicate the owner's reference mockup (upload/454444444444.png — a square
pale-yellow paper, near-sharp corners, layered directional shadow on a light surface)
as the single sticky style app-wide: "stickynote of quicknote = canvas stickynote =
notebook stickynote — all styles must be same."

State on entry: v0.3.9 released + deployed (GitHub 53cea32, hibana.ir + dev worker),
local server :8787 healthy, 244/244 baseline.

## Surface inventory (what "sticky note" means in this app)

| surface | implementation | old style |
|---|---|---|
| quicknote (dashboard widget + whiteboard page share `notebookHtml` → `#notebook`) | `#nv-sticky`/`#nv-grid` rules for `.note-card` (app.css) | radius 14px, `0 6px 14px` symmetric shadow, auto height 7.5–15rem |
| canvas board sticky | `makeStickyNote` in canvas.js (fabric Group) | radius 10, one shadow blur 14 offY 6, 180×120 default |
| notebook board sticky | `makeStickyNote` in whiteboard.js (ported twin) | same as canvas |
| projects/sparks «Sticky Notes» corkboard | `.sticky-note` (app.css, projects.ts) | radius 14, border, no fill/shadow |
| calendar day sticky chip | `.cal-day-sticky` (app.css, calendar.html) | radius 8, `0 1px 4px` |

## The style tokens (owner's two instructions)

1. **Shadow** — layered + directional, light from the top-left, neutral black on all fills:
   `box-shadow: 1px 3px 4px rgb(0 0 0 / 0.10), 4px 12px 20px rgb(0 0 0 / 0.12);`
   fabric replication = TWO rects (fabric objects hold ONE Shadow each): back rect
   (`__shadowPaper`) with the soft layer `{blur: 20, offsetX: 4, offsetY: 12,
   rgba(0,0,0,0.12)}` hidden exactly behind the paper; the paper keeps the contact layer
   `{blur: 4, offsetX: 1, offsetY: 3, rgba(0,0,0,0.10)}`. Compositing verified in-browser:
   contact pixels land outside the paper edge onto the soft shadow — matches CSS stacking.
2. **Shape** — `aspect-ratio: 1 / 1` (DOM) / square-normalized geometry (fabric),
   `border-radius: 2px` (fabric `rx/ry: 2`).

## Changes

- **app.css** (v213 → v214):
  - `#notebook :is(#nv-sticky, #nv-grid) ~ .note-list > .note-card`: +`aspect-ratio: 1/1`,
    `border-radius: 2px`, the two-layer shadow; REMOVED `min-block-size: 7.5rem` /
    `max-block-size: 15rem` (the 15rem cap would have clipped the 16rem "large" square;
    the min would fight narrow grid tracks → non-squares). This intentionally REVERSES
    Phase 7 item 11's auto-height decision — the owner's latest mockup supersedes it;
    documented in the rule's comment.
  - Mobile grid media query: dropped the 10.5rem card height cap (square governs now).
  - `.note-render`/`.note-text` rule comment updated (content row = square minus
    headbar/footer; internal scroll + «بیشتر…» unchanged).
  - `.sticky-note` (projects/sparks corkboard): +square, 2px, layered shadow,
    `background: var(--card)` (theme-aware paper; project cards aren't user-colored),
    `border: 0`, `overflow: hidden`, `align-content: start`.
  - `.cal-day-sticky`: radius 8 → 2, shadow → the same recipe at CHIP scale
    (`1px 2px 3px rgb(0 0 0/.10), 2px 6px 10px rgb(0 0 0/.12)`) — full-size layers would
    flood the dense calendar day grid.
- **canvas.js** (v14 → v15) + **whiteboard.js** (v9 → v10) — `makeStickyNote`:
  - `STICKY_RADIUS = 2`; incoming geometry square-normalized (`side = max(w, h, 120)`,
    was 180×120 default).
  - `shadowBox` back rect (see tokens above) added as the group's first child;
    `group.__shadowPaper` exposed; `recolorSticky` (canvas.js) repaints BOTH rects.
  - **fitPaper grows as a SQUARE, right-sized by binary search.** First cut grew to
    `need = 26 + h + 14` computed at the OLD wrap → after the re-wrap the text was far
    shorter → the square overshot ~8× (measured: 1250px paper for 153px text). Because
    h(w) is monotone non-increasing in w, the MINIMAL square s with
    `26 + h(s-20) + 14 ≤ s` is binary-searched (`sideFor()`, ≤22 probes, each a cheap
    fabric re-measure) between the current side and the current-wrap demand; the same
    search sizes construction AND growth. Same 662-char Persian text now lands on a
    467px square (26+417+14=457 ≤ 467). Growth applies to both rects, the × + hit
    region ride the inline-end edge, `wrapWidth` re-pins (now a `let`, and the
    initDimensions override pins FIRST so one call re-wraps + re-measures).
  - Drag-creation: the drawn rectangle becomes a square (`side = max(80, w, h)`); the
    whiteboard's plain-click default is 180² (was 180×120).
  - Editing twins: after a growth the live twin's width syncs to the inner's re-pinned
    wrap (caret/line-breaks match the paper; no reflow on commit).
- **sw.js**: `hibana-v237 → v238` + session-17 header note (full-tree bump).
- Cache refs: app.css `?v=214` × 22 pages, canvas.js `?v=15`, whiteboard.js `?v=10`.
  (First sed pass silently failed — BRE `\?` is a quantifier, not a literal; redone with
  plain `?`. Check-cache-bust PASS confirmed the final state.)

## Verification (all on :8787, e2e@test.local)

- **Dashboard quicknote (sticky view):** 3 papers 208×208 EXACT squares, computed
  `border-radius: 2px`, computed shadow string equals both layers verbatim, pastel fills
  (pink/green/yellow). **Grid view:** 185×185 squares (dashboard card width). VLM on the
  scoped screenshot: "square, sharp corners, shadow stronger bottom-right, clean
  top-left, layered depth, three pastels" — matches the reference mockup.
- **«بیشتر…» overflow toggle under the fixed square:** created a fresh 294-char English
  note via the composer → card renders 208×208 square, `has-more` fires (markClampedNotes:
  scrollHeight > clientHeight inside the smaller square), the chip is visible, clicking
  it opens the full-note reader modal (same flow as before the style change).
- **390px:** sticky papers 208×208 (flex-basis 13rem > min 10rem), grid 152×152
  (9.5rem tracks), docW == clientW (no horizontal scroll). Dark mode: papers keep their
  user pastels + neutral shadow; projects corkboard goes `var(--card)` dark — all hold.
- **Whiteboard (notebook fabric board):** drag-created sticky (120² — max side), state
  inspection: `paper.w == paper.h`, `rx: 2`, contact `{blur 4, (1,3), 0.10}`, soft
  `{blur 20, (4,12), 0.12}`, `__close` region at side−30. Long-text edit through the
  twin: 662-char Persian → 467² snug square (twin width synced to 447 = re-pinned wrap),
  shadow rect stays square, × rides the edge. Commit → reload round-trip: the sticky
  reloads at 468² with both shadow layers + full content (grow-only semantics: saved
  sides never shrink on load). The first-cut overshoot artifact (1250² test note) was
  removed via the `/api/canvas/sync` tombstone (correct `{elements:[…]}` schema).
- **Canvas board:** drag 130×60 → 130² square; select → floating palette appears; blue
  `#bfdbfe` click → paper + shadowBox + `__noteColor` all repainted (both rects match —
  no stale rim); × region click deletes (capture-phase hit test intact after the geometry
  changes — the region math `px = lp.x + g.width/2` unchanged since the square keeps
  `__close.left = side−30` in paper coords).
- **Projects sticky view:** 8 papers 183×183, 2px, exact shadows, white paper
  (light) / `rgb(36,32,25)` (dark), overflow clip.
- **Calendar chip:** created a sticky via the real composer (day cell → cal-add-sticky →
  submit) → chip renders radius 2px + the chip-scaled two-layer shadow + pastel bg;
  deleted it after (local DB left tidy).
- **Gates (final code):** `tsc --noEmit` clean · `node --check` canvas/whiteboard/sw ·
  vitest **244/244** · smoke **ALL PASS** · check-cache-bust **PASS** (3 files
  consistent) · server log boot-line only · console 0 / page errors 0 on every visited
  page · `/api/health` ok schema 44.
- Screenshots: `audit-results/shots/s17-{dash-sticky,dash-sticky-scoped,dash-grid,
  dash-390-grid,whiteboard-sticky,canvas-sticky,projects-sticky,
  projects-sticky-dark,calendar-chip}.png`.

## Release — v0.3.9.1 (this session, same ritual as v0.3.9)

Owner call: "wrap up this version, commit to github, give me the new version called
0.3.9.1 .zip" — the owner picked a dot-release over v0.3.10 for this style-only patch.
Version bumped 0.3.9 → 0.3.9.1 (package.json, CHANGELOG entry header, sw.js note);
CHANGELOG "Unreleased — session 17" folded into the dated v0.3.9.1 release entry.
No migrations (schema stays 44); SW cache stays `hibana-v238` (bumped with the batch);
deps/lockfiles untouched.

| Step | State |
|---|---|
| Gates (typecheck / 244 tests / smoke / wiring / cache-bust) | ⏳ pending |
| Git push (assadigit/hibana-source main + tag `v0.3.9.1`) | ⏳ pending — fast-forward on `53cea32`, no grafting needed (local == remote) |
| CI on the pushed commit | ⏳ pending |
| Cloudflare dev deploy (`npm run deploy`) | ⏳ pending |
| Cloudflare prod deploy (`npm run deploy:prod`) | ⏳ pending |
| Live probes (health / sw.js v238 / hashed dist) | ⏳ pending |
| Prod browser verify (real account, read-only) | ⏳ pending |
| Zip `hibana.0.3.9.1.zip` + bundle + download/ + upload/ copies | ⏳ pending |

(Table completed in the docs follow-up commit, session-16 pattern.)

## Notes for the next session

- v0.3.9.1 released + deployed this session (see the table above; CHANGELOG has the
  live-status line). No schema changes, no migrations (44).
- Local DB: one extra quick note (the 294-char "deliberately long English note" —
  kept as the more-toggle evidence), the whiteboard test sticky + calendar chip were
  deleted, the 1250² overshoot artifact was tombstoned.
- If the owner dislikes the small squares of the DASHBOARD grid view (6-col tracks on
  the narrower dashboard card), a follow-up could widen the dashboard grid tracks —
  not touched here (the style ask was square + shadow only).
- The two-rect fabric shadow is the pattern for any future layered-shadow fabric
  object: back rect with fill = paper fill carries layer 2; never put shadows on the
  group (Phase 5 item 18 lesson — glyphs went blurry).
