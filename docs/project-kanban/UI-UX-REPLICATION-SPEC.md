# Hibana Project/Kanban — UI/UX Replication Spec (the Go Windows desktop port's visual & behavioral contract)

**What this is.** The pixel-for-pixel and behavior-for-behavior replication contract for the **Go
Windows desktop port** (Wails + WebView2 leading — the frontend island gets EMBEDDED, so this spec
defines what must be preserved exactly and what is desktop-native instead). UI/UX companion to the
port pack: `GO-DESKTOP-PORT-PLAN.md` (architecture), `API-AND-SYNC-CONTRACT.md` (network),
`DATA-MODEL.md` (storage), `USER-FLOWS.md` (flows), `FEATURE-INVENTORY.md` (surface + §12 keyboard
map + §13 parity decisions), `TEST-MATRIX.md` (coverage).

**Verified against** the S209 working tree at **v0.4.1.35** (the kanban 1:1 parity round, 2026-10-20):
devboard.js v28 (1428 lines), board-page.js v21 (977), chip-render.js v12 (408), devboard.css v34
(1103), board.html (93), sw.js v444, e2e/s209-kanban-parity.spec.ts. Every file:line below was read in
that tree.

**Convention.** Plain statements are **VERIFIED** facts (cite included). Anything the port may decide
differently is marked **[RECOMMENDATION]** — the only places judgment is allowed. Deliberate web-surface
deltas (the S209 exceptions) are repeated in §5 so the port doesn't "fix" them by accident.

---

## §1 Design tokens (VERIFIED)

One CSS variable system drives every surface; the desktop port must ship the SAME tokens (or a
1:1 translation of them) — the board re-skins entirely through them.

### 1.1 The core color system — `public/css/variables.css` (`:root`, :51–499)

| Token | Light value | Ref | Notes |
|---|---|---|---|
| `--bg` | `#E7E7E7` | variables.css:56 | true neutral gray canvas |
| `--bg-soft` | `#DEDEDE` | :59 | deeper surface (hover wash, wells) |
| `--card` | `#FFFFFF` | :67 | every card/frame surface |
| `--statcard-bg` / `--surface-*` | `#F5F6F7` / aliases | :72, :79–81 | row fill inside cards |
| `--text` / `--muted` | `#141414` / `#5C5C5C` | :110, :111 | opaque flattened ink rungs (mix-safe anchors) |
| `--ink-primary/secondary/tertiary` | rgba(0,0,0,.92/.64/.56) | :100–102 | the type-layer rungs |
| `--line` / `--line-strong` | `#D4D4D4` / `#BFBFBF` | :115–116 | hairline weight is 1px everywhere |
| `--accent` / `--accent-hover` | `#4A9FA3` / `#3D8D91` | :117, :126 | the Sadhana teal (icons/borders/fills) |
| `--accent-ink` | `#297073` | :125 | accent-as-TEXT ink (5.74:1) — S200 law |
| `--accent-soft` / `--focus-ring` | rgba(74,159,163,.13) / color-mix(accent 72%, text) | :127, :87 | the ONE focus-ring ink |
| `--brand` / `--cta` / `--cta-hover` | `#4A9FA3` / `#2E7B7F` / `#276A6D` | :367, :145, :148 | CTA one shade deeper for white ink |
| `--ok` / `--err` / `--danger` / `--warn` | `#1f7a34` / `#c02626` / `#b42318` / `#b45309` | :151–154 | |
| `--font-sans` / `--font-mono` | General Sans→VazirFA→Vazir→system / ui-monospace | :353, :168 | Vazir before system fallbacks (FA glyphs in EN docs) |

### 1.2 The priority palette (the card banner family) — variables.css:267–283

FILL+INK pairs, self-contained and theme-independent in light (S150, owner-checked AA):
`--color-low` `#d3d9df`+ink `#45525e` (:267–268) · `--color-medium` `#f4e5bd`+`#604910` (:269–270) ·
`--color-high` `#c14e1b`+white (:271–272) · `--color-urgent` `#bf2a1e`+white (:273–274). Aliases
`--prio-banner-*`/`--prio-banner-ink-*` (:275–283) feed the banner, filter chips and editor
segments — no priority hex exists anywhere else (design-token law, S149/S150).

### 1.3 The 16 category swatch pairs — variables.css:290–305

`--cat-sw-1..16-fill` + `--cat-sw-1..16-ink` — the curated pastel wheel (rose → sand → sage → cyan →
azure → violet → magenta → pink). Picker tiles are READ FROM THE TOKENS at runtime
(`getComputedStyle` — devboard.js:948–965); the server's validation constant carries the same 16
(`src/lib/categories.ts`, unit-pinned). The port must expose this exact wheel — no free-form picker.

### 1.4 Type scale + radii + shadows

- `--fs-xs/--fs-sm/--fs-md/--fs-lg/--fs-xl` (:489–493) resolve onto the S155 rungs — 12/12/14/14/18px
  (:447–479); body 1rem, 700 weight deliberately absent. `--radius` 20px / `--radius-sm` 14px /
  `--radius-lg` 24px (:334–336) — cards `--radius`, rows/modal fields `--radius-sm`. `--shadow`
  `0 2px 14px rgb(30 20 10 / 0.07)`, `--shadow-dropdown` `0 8px 36px …0.12` (:337–340).
- Kanban column family `--col-idea/planned/progress/done/bug-{bg,dot,ink,edge}` (the S185 OKLCH set,
  variables.css:523–528) — one family, same lightness/softness, hues idea-azure · planned-amber ·
  progress-gold · done-green · bug-red.

### 1.5 Dark-theme mechanics — a TOKEN SWAP, not a second stylesheet (VERIFIED)

`public/css/claude-dark-theme.css` re-declares the SAME custom properties under
`html[data-theme='claude-dark']`: `--bg #141413` (:35), `--bg-soft #1f1e1c` (:36), `--card #1f1e1c`
(:44), `--text #EDEDEC`/`--muted #9C9C9B` (:60–61), `--line #34322f` (:65), clay accent
`--accent #d97757`/`--accent-ink #d9997f` (:89, :94), `--cta #c2643f` (:111), the dark priority
pairs (`--prio-banner-low #292F36`+ink `#83A3C3` … urgent `#3E2828`+`#EC6E65`, :181–184),
`--kanban-tint: 32%` (:192), soft shadows (:211–214), column-family low-alpha washes (:82–86).
The ONLY component rules are for surfaces that hardcode lightness: elevated layers
(`.modal`/`dialog`/popovers → `#262524`, :229–238), inputs a step darker than card (`#1a1917`,
:241–248), dark `--pd-c/--pd-ink` per column status (:482–486). `themes.css:13–56` is the explicit
LIGHT block — a mirror of `:root` existing only to shield against OS-dark bleed. boot.js resolves
the stored preference to an explicit `html[data-theme]` before first paint (S87; variables.css:537–542).
**Port law:** implement dark mode the same way — swap the token table, don't fork component styles.

### 1.6 RTL mechanics (VERIFIED)

- Base rules use **CSS logical properties everywhere** (`border-inline-start`, `margin-inline-end`,
  `inset-inline-start`, `padding-inline`… — devboard.css/project-header.css passim); a `dir=rtl`
  document mirrors automatically.
- `public/css/rtl.css` (85 lines) carries only the **residual flips** logical properties can't
  express; its actual contents: `[dir='rtl'] h1,h2 { letter-spacing: 0 }` (:14 — negative Latin
  tracking fights Arabic joining), `.stat-arrow svg { scaleX(-1) }` (:17), the FAB stack flips to
  physical bottom-LEFT (:31), `.icon.arrow` flips (:33–35), `.sadhana-ribbon rotate(-45deg)` (:43),
  feed/notif hover `translateX(-2px)` (:45–47), tooltip centering `translateX(50%)` (:50–51), today
  calendar cell (:53–56), **`.t-code[data-lang]::before { float: left }`** (:69 — the code-block
  language label flips sides), `.sp-month` border flip (:71–73), sprint paging arrows `scaleX(-1)`
  (:82), skeleton sweep swap (:84–85).
- `i18n.js:94` sets `document.documentElement.dir = fa ? 'rtl' : 'ltr'`; JS-built surfaces set
  per-element `dir` (modals: devboard.js:837; title textarea: :885; `.pd-task-title-row
  dir="auto"`: board-page.js:240 — the S48 dot-follows-title bidi law, project-header.css:443–452).

---

## §2 The board anatomy (VERIFIED)

### 2.1 The /kanban element tree (board.html + board-page.js render)

```
main.shell.shell-flush.board-shell#main            board.html:62  (padding:0; max-inline-size:none — devboard.css:28)
└─ h1.sr-only "Board"                              board.html:68  (axe page-has-heading-one)
└─ .db-frame                                       board.html:69  (ONE var(--card) surface — devboard.css:29–34)
   ├─ .db-toolbar.card#db-toolbar                  board.html:70  (card chrome RETIRED inside the frame — devboard.css:46–53)
   │  ├─ a[data-back-link] ← Back to project       board.html:71  (hidden on /kanban — board-page.js:35–38)
   │  ├─ h2.db-title > button#db-project-switch    board.html:75–80 (the title IS the switcher)
   │  ├─ #db-counts  "{n} of {m} done"             board.html:81  (board-page.js:63–64)
   │  ├─ .db-flex-gap + a#db-sprint-link           board.html:82–83 (→ /sprint.html?project=, href at render — board-page.js:61)
   │  └─ button#db-labels-btn  Labels              board.html:85
   ├─ .db-loading#db-loading [role=status]         board.html:87  (spinner + "Loading board…")
   └─ .db-board#db-board [hidden]                  board.html:88
      ├─ .db-filter[data-db-filter][role=toolbar]  board-page.js:94–108 (search → Priority chips → Label chips → clear/shown)
      ├─ .empty-state.db-filter-empty[hidden]      board-page.js:112–117 (zero-match state, synced :264–265)
      └─ .db-cols                                  board-page.js:170 (grid — devboard.css:83–88)
         └─ section.pd-col[data-status] ×5         board-page.js:181 (idea·bug·planned·in_progress·done — devboard.js:74)
            ├─ header.pd-col-head                  board-page.js:182–188
            │  ├─ .pd-col-title (+ ::before dot)   project-header.css:417–425
            │  ├─ .detail-tab-count  N             polish-ui.css:680–688
            │  └─ .pd-col-actions (archive+clear on done, copy, export)  board-page.js:184–187
            ├─ .pd-tasks[data-pd-tasks=st]         project-header.css:1044 (grid, gap .35rem)
            │  └─ .pd-task-wrap ×N → see §3
            └─ button.pd-task-add[data-add=st]     project-header.css:1007–1040
```

### 2.2 Geometry contracts (e2e-PINNED — do not reinterpret)

| Contract | CSS | e2e pin |
|---|---|---|
| Full-bleed 0→viewport: shell padding 0, cap none | devboard.css:28 + misc.css:888–898 (the 'standard' 1366px cap exemption for `main.board-shell`) | s207-kanban-frame.spec.ts:135–150 (`maxInline none`, `padding 0px`, frame `left===0`, `right===vw`) |
| The 100dvh floor, scoped to the PAGE-OWNING board | devboard.css:41 (`main.board-shell .db-frame { min-block-size: calc(100dvh - 1.5rem) }`); ≤1024px reserve 4.5rem+safe-area (:57–59) | s207:171–178 (`floor.height ≥ vh - 48`) |
| The phone rhythm ≤640px | devboard.css:60–63 (frame padding `.6rem .65rem .8rem`; toolbar padding-inline 0); ≤1024px the floor respects the bottom mobile-nav | s207:204–225 (390px: left 0, width vw, inset pad ∈ (0,16]px) |
| 5-column grid | devboard.css:83–88 (`repeat(5, minmax(0,1fr))`, gap .8rem); **1100px → 2 cols** (:89); **640px → 1 col** (:90) | s207:155–160 (cols ≥ 90% vw, left < 40px) |
| The frame is the card token, toolbar chrome retired | devboard.css:29–34, 46–53 | s207:104–117 (`rgb(255,255,255)`; toolbar bg transparent, bottom border 1px, radius 0) |

### 2.3 The embedded variant — `.pd-board.db-frame` (S209, VERIFIED)

The project page's board (`#pd-board`) wears the same mother-container recipe scoped for its
embedded context: **outline + reading measure, NO floor**. `detail-helpers.ts:412–420` renders
`<section class="pd-board db-frame" id="pd-board">`; `devboard.css:75–82` gives it `flex column;
gap .8rem; border 1px solid var(--line); border-radius var(--radius); margin-block-end
clamp(1.25rem, 2.5vw, 2rem)` — the outline + page margin stay because it floats under the project
header in the reading measure. Pinned by e2e/s209-kanban-parity.spec.ts:252 and
src/tests/kanban-parity.test.ts:56–86 (the `<section class="card pd-board">` chrome is gone).
Head row = the same `.db-toolbar` hairline header (detail-helpers.ts:421); filter mount
`div.db-filter.pd-filter[data-pd-filter hidden]` (:445, client-built); grid = `.pd-board-grid`
(flex track, project-header.css:225–240) of 5 `.pd-col`s with the EXTRA embedded-only affordances:
collapse chevron `.pd-col-collapse` (detail-helpers.ts:468; CSS project-header.css:257–331) and
`+N more` windowing MAX_VISIBLE=5 (:455–456, :492).

### 2.4 Column anatomy (shared by both surfaces — project-header.css)

`.pd-col[data-status]` resolves four custom props from the `--col-*` family (:396–402): `--pd-c`
(edge RGB triplet), `--pd-ink`, `--pd-h` (header tint), `--pd-dot`. Box: grid, gap .35rem, padding
.55rem, `border 1px var(--line)` at 28% of `--pd-c`, **3px inline-start edge** at 55% (:403). The
**tinted header strip** `.pd-col-head` bleeds to the column's edges (`margin: -.55rem -.55rem
.45rem`), `background: var(--pd-h)`, top corners `calc(var(--radius-sm) - 1px)` (:409–416). The dot
hugs its label via `.pd-col-title::before` (0.55rem circle, `--pd-dot`, :418–425); the title speaks
the eyebrow rung (12px/500/+0.03em). Count badge `.detail-tab-count` + actions cluster round out the
strip (:668–670). Drag-over cue: `.pd-col.drag-over` (border 70% + 8% tint, :405).

---

## §3 The card anatomy (VERIFIED)

### 3.1 The wrap and the priority banner

```
.pd-task-wrap[data-task-card][data-priority]        board-page.js:236  (embedded twin carries the data-pd-* family:
                                                    detail-helpers.ts:477 — data-pd-task/status/created/priority/tags/cat/SPRINT/done)
└─ button.prio-banner.prio-<p>[data-db-cycle-prio]  board-page.js:207–208 (server: detail-helpers.ts:478 data-pd-cycle-prio)
   └─ .prio-banner-label  "HIGH PRIORITY"           chip-render.js:354–365 PRIO_LABEL (long wording — the server twin's)
└─ .pd-task.st-<status>[draggable role=button tabindex=0]   board-page.js:237 / detail-helpers.ts:479
   └─ .pd-task-body                                 project-header.css:442
      ├─ .cat-chip                                  §3.2
      ├─ .pd-task-title-row[dir=auto] > .pd-task-title[data-raw-title(+data-clamped)]
      ├─ .pd-task-preview                           §3.3
      ├─ .pd-read-more[data-task-read-more]
      ├─ .pd-task-tags (.pd-tag ×n + .db-sprint-badge)      §3.4
      ├─ .pd-task-meta (date · clock · .pd-task-shots)      §3.5
      └─ .spark-menu.db-card-menu[hidden]           board-page.js:253 (⋯ menu, injected post-render)
```

**The priority banner** (polish-batch.css:797–817): a colored strip fused across the card's top —
`inline-size: 100%`, `padding .28rem .6rem`, top-only radii `var(--radius-sm)`, **10px/700/0.09em
uppercase** label, `color: var(--prio-banner-ink-<p>)` on `background: var(--prio-banner-<p>)`
(:812–815); hover `brightness(1.1)`; the card below loses its start corners so the strip reads fused
(:817); the wrap goes column-flex when a banner exists (:796); DONE-column cards fade the banner to
an 18% card mix + muted ink (polish-batch.css:828–833). **The banner IS the cycle affordance**
(click = low → medium → high → urgent — board-page.js:639–653, optimistic PATCH). **The four tint
recipes that derive from the palette** live in the `.db-seg` prio rules — devboard.css:261–267 —
the reference implementation of `color-mix()` over the tokens: low/medium = 38% fill + border mixed
45% ink into `--line`; high/urgent = 32%/35% fill + 55% fill into `--line`. Reproduce these formulas
wherever the port paints priority.

### 3.2 The category chip

`.cat-chip` (quicknotes.css:1539–1551): inline-flex pill, `padding .14rem .55rem`, radius 999px,
0.72rem/700, inset hairline `rgb(0 0 0 / 0.06)`, one-line ellipsis; inline
`background:<color_fill>; color:<color_text>` from the stored pair — one of the 16 curated
`--cat-sw-*` pairs (§1.3). Sits DIRECTLY ABOVE the title row (S152 placement; board-page.js:211,
detail-helpers.ts:273–278).

### 3.3 The title — markdown-lite output (the load-bearing renderer)

`.pd-task-title`: 0.75rem/700, `white-space: pre-line`, `overflow-wrap: anywhere`
(project-header.css:454–467). The renderer is **chip-render.js `renderTitle`** (:47–110), shared
byte-for-byte with a **server twin** (`detail-helpers.ts:303–365` + `titleHtml` :366–374,
`previewHtml` :377, `titleAttrs` :386, `readMoreBtn` :387). The vocabulary the port MUST
reproduce exactly:

| Input | Output | Ref |
|---|---|---|
| `**x**` | `<strong>x</strong>` | chip-render.js:59 |
| `__x__` | `<u>x</u>` | :60 |
| `~~x~~` | `<s>x</s>` | :61 |
| `- x` / `* x` lines | `<ul><li>` (bullets sit NEXT to text) | :90–95 |
| `1. x` lines | `<ol><li>` | :91–99 |
| `{:left\|center\|right\|justify}` | `<div style="text-align:…">` per paragraph | :84–88 |
| ` ``` ` fences (+lang) | `<code class="t-code" dir="ltr" data-lang>` — mono LTR island, fence lines kept as hidden `.t-fence` markers INSIDE so **textContent round-trips the RAW title** | :72–79 |
| unclosed fence | renders as code till end (self-healing) | :108 |

`.t-code` CSS (project-header.css:529–570): `direction: ltr; unicode-bidi: isolate; white-space:
pre; overflow-x: auto`, `--fs-xs` mono, bg `var(--bg-soft)`, lang label via `::before content:
attr(data-lang)` floated right (RTL flips it left — rtl.css:69); the FA-font override re-asserts
mono (project-header.css:552–555).

**The 150-char clamp** (`TITLE_CLAMP = 150`, chip-render.js:32): `titleHtml` (:117–123) renders the
FIRST LINE only (split at `\n`, S48j), first 150 chars visible + the rest in a hidden `.pd-title-rest`
span WITHIN the title element — textContent keeps reading the FULL title (copy/export/delete/undo
all consume it). `data-clamped` attr + `::after '…'` (project-header.css:491–493); the
`.pd-read-more` pill toggles it (chip-render.js:130–132; board-page.js:662–681; CSS
project-header.css:494–518 — accent-soft pill, `--link` ink, hover flips to the CTA fill).
**The preview** `.pd-task-preview`: the lines after the first `\n`, flattened, ~110 chars
single-line ellipsis (chip-render.js:138–147; CSS project-header.css:471–483). `titleAttrs` stamps
`data-raw-title` (the editor round-trip key, S77 — chip-render.js:125–128).

### 3.4 Tags + the ◆ sprint badge

`.pd-task-tags` row (project-header.css:1390) holds `.pd-tag` chips (:1391–1404: 999px pill,
`calc(--fs-xs * .85)`, 7px `.pd-tag-dot` in the tag's color, `data-pd-tag-name` = the lowercase
filter key) and — when the task has a sprint — the **`◆ <sprint name>` badge** `.db-sprint-badge`
(devboard.css:127–134: `--badge-building` pair, 999px, one-line). Board render: board-page.js:212–220;
server twin `taskTagChips(id, sprintBadgeHtml)` (detail-helpers.ts:243–249, :262–264); the shared row
builder is `chip-render.js tagChipsRow(list, extra)` (:164–171 — the S209 `extra` param is exactly
the sprint badge slot). Pinned: kanban-parity.test.ts:88–113 asserts
`<span class="db-sprint-badge">◆ Parity Sprint</span>` byte-for-byte.

### 3.5 The meta line + pin badge

`.pd-task-meta` (project-header.css:611–624): `calc(--fs-xs * .8)`, muted, flex row on ONE line —
date · clock (`chip-render.js metaDateHtml/metaLine` :370–400: **Jalali + FA digits via Intl persian
calendar for fa, Gregorian + 12h AM/PM for en, UTC edge**; server twin `taskMetaLabel`
detail-helpers.ts:200–211) and the **pin badge** `.pd-task-shots` (layout.css:1738–1745: `#B4762E`
ink on `rgb(201 151 59 / 0.12)` pill) fed by the payload's per-task `shot_count` (board-page.js:230–234;
server pinsByTask detail-helpers.ts:110–116, badge :488). Click opens the pinned-pictures dialog (§4).

### 3.6 The ⋯ spark-menu

`.spark-menu.db-card-menu` injected INSIDE the card (board-page.js:486–540): ⋯ button →
`.spark-menu-pop` with **Copy / Edit / Delete** (Copy copies the RAW title, `data-raw-title`
first — :516–528). Embedded twin: `injectPdTaskMenus` (project-page.js:4023–4107). Styling:
quicknotes.css:808/827 (absolute, inset-block-start .25rem, hover-reveal).

---

## §4 The task editor modal (VERIFIED — the shared devboard.js modal)

### 4.1 Structure — the S89 one-scroll-region layout

`.db-modal` (devboard.css:137–146): `position: fixed; inset: 0; z-index: 90`, scrim
`rgb(15 12 8 / 0.4)`, grid-centered, `padding 1rem` — a plain div, NOT a native dialog.
`.db-modal-card` (:147–169): `inline-size: min(52rem, 100%)`, `max-block-size: 90vh`,
**`overflow: hidden` flex column** — the card NEVER scrolls. `.db-modal-head` pinned (:174,
hairline under) + `.db-modal-foot` pinned (:184, hairline above) + ONE middle region `.db-modal-body`
(:175–183: `flex 1 1 auto; min-block-size: 0; overflow-y: auto; overscroll-behavior: contain;
scrollbar-gutter: stable`). Built by `renderModal` (devboard.js:830–944), opened by
`openEditor(taskId|null, opts)` (:769–791); Esc/backdrop/✕ all route through one handler (:754–765).

### 4.2 The FULL 10-op formatting toolbar (S209)

`div.pd-tb[role=toolbar]` (devboard.js:862–876) — the ORIGINAL editor's complete set, same
buttons/icons/separators as project.html's composer: **bold · underline · strikethrough |
bullet list · ordered list | align-left · align-center · align-right · align-justify | code**
(three `.pd-tb-sep` separators). CSS: project-header.css:576–609. Every op writes RAW markdown into
the single title textarea (devboard.js:966–1026): `**x**`, `__x__`, `~~x~~`; `- ` line prefix,
`1. ` ordered **numbered sequentially**; `{:left|center|right|justify}` at line start REPLACING an
existing marker (clicking another align switches it); ` ```\n…\n``` ` fences on their own lines.
Both editors produce the identical markdown-lite vocabulary (§3.3) — pinned by
e2e/s209-kanban-parity.spec.ts:169.

### 4.3 Segments, selects, tags

- **Status/priority `.db-seg`** (devboard.js:886–891): 999px pills (devboard.css:229–249); `.is-on`
  = `bg-soft` + 600 + `--brand` border; hover = CTA fill; the **prio is-on tints** are the §3.1
  color-mix recipes (devboard.css:261–267).
- **Category select + inline `__new`** (devboard.js:893–900, 946–965): choosing `＋ New category…`
  reveals `.db-cat-new` with a name input + the **16 swatch tiles** read from the `--cat-sw-*`
  tokens; save calls `createCategory(name, fill, ink)` (:1212–1220). A task holding a
  disabled-later category keeps its option so edits round-trip (:896–898).
- **Sprint select + inline `__new`** (:901–905, 1054–1057): drafts tagged `— draft`; on save a
  `__new` choice REUSES an existing draft if present (the S206 409 draft_exists fix, :1221–1231).
- **Tags — live vs staged**: existing task = live add/remove via API (`Enter` adds,
  chip `✕` removes — :1067–1092); new task = staged chips riding the create body's `tags[]`
  (:1093–1115, :1240). `syncTitleToDraft()` rides every re-render so a tag add/remove mid-edit
  never wipes the typed title (:1058–1066).

### 4.4 Attachments — Upload File, strips, grids, lightbox, pinned-pictures

- **The button + accept list** (devboard.js:928–935): hidden `multiple` file input,
  `accept=".pdf,.csv,.xlsx,.docx,.md,.txt,image/png,image/jpeg,image/webp,image/gif,video/webm"`
  (the full S86 bucket). New tasks STAGE (upload now, PIN on save, DELETE on cancel — :1135–1138,
  :1242–1249, closeModal cleanup :821–827); existing tasks upload+pin in one round-trip per file
  (:1139–1142).
- **The upload strip** `makeUploadStrip` (:389–458): per-file rows (name + size + progress bar + % +
  ✕ cancel), states reading → active → done/error/canceled; done rows fade after 650ms, error rows
  linger 6s, canceled drop neutrally; `aria-live=polite`. The prepare pass (`uploadShotXHR`
  :326–384) binds images ≤1600px WebP q0.85 + a ≤320px thumb when oversized.
- **The grids**: staged `renderStagedGrid` (:665–672) / pinned `renderPinnedGrid` (:673–685) — image
  tiles (zoom), video tiles (inline player, zoom on dblclick/Enter :578–599), doc tiles (download
  `<a>` :294–302); the note editor is a small native `<dialog>` (:630–659).
- **The lightbox** `openShotLightbox` (:526–565): `role=dialog`, prev/next walk the sibling figures
  with wrap-around + live counter + caption + resolved state; mounts INTO an open native dialog's
  top layer, else body-append at z-200 (layout.css:1606–1607). **Esc precedence** (:566–577): its
  document keydown is registered at module load — BEFORE buildModal's listener — and
  `stopImmediatePropagation`-shields the modal; the modal's own guard `!shotLightbox` (:757–765)
  is the belt. Arrows are RTL-aware (:574–576).
- **The pinned-pictures dialog** `openTaskShots` (:690–740): native `<dialog>` grid of the task's
  pinned shots (zoom via the lightbox + unpin `PATCH {taskId: null}` + `onChanged` → board reload
  so the badge count stays true).

### 4.5 Fullscreen writing mode — `.db-fullscreen` (S209)

Toggle button `[data-db-fullscreen]` in the modal head (devboard.js:845; wiring :1029–1035). CSS
(devboard.css:191–207): the card grows to `min(78rem, 100%)` + `block-size: calc(100dvh - 1.5rem)`;
the title textarea flexes to fill; **every metadata row hides** — `.db-field:not(:has(textarea[name=title]))`,
`.db-two`, `.db-cat-new`, `.pd-taskadd-shots` all `display: none`. **The exit-first contract**
(`exitFullscreenOrClose` :800–804): Esc, ✕, Cancel and the backdrop all strip `.db-fullscreen` FIRST
and never close the modal — one keypress never discards the writing focus mode AND the task
definition; `closeModal` also strips the class (:810) so a re-open never starts focused. Pinned by
e2e/s209-kanban-parity.spec.ts:212 (first Esc exits fullscreen, modal stays; second Esc closes).
Title textarea: Enter saves / Shift+Enter newline (:1258–1261); dir follows the UI locale (:885).

### 4.6 The alternate model (documented, deliberate)

The project page's split editor (`openPdTaskEditor`, project-page.js:4376–4494) keeps the
title/content SPLIT + a `#pde-input` contenteditable WYSIWYG (execCommand + `htmlToMd`,
chip-render.js:229–344) + its own fullscreen toggle. Two editing models, one output language — a
banked S209 decision (FEATURE-INVENTORY §13 row 3); the port implements the shared-modal model and
treats the split editor as the documented web-only alternate.

---

## §5 Toolbar/chrome per surface (VERIFIED)

| Surface | Chrome | Refs |
|---|---|---|
| `/kanban` | Back link **hidden** + in-place switcher + counts + Sprints + Labels + **edge-hover rail** (rail fully hidden; revealed when the pointer nears the start edge) | board-page.js:35–38; nav.js:388 `RAIL_EDGE_PAGES`, :400–417 edge zone |
| `/board.html?project=` | Back link **visible** (→ `/project.html?id=`, href set post-boot board-page.js:953) + classic **icons-rail** + 64px gutter | nav.js:383 `RAIL_ICON_PAGES`; s207 e2e:196–200 |
| Embedded head (project.html) | New sprint / Categories / **Labels** / Full screen board → `/board.html?project=` / Sprints (+count) — the S209 Labels button opens the SAME shared dialog via `HibanaBoard.openLabels` | detail-helpers.ts:421–441; project-page.js:3120–3144; project.html:80 |
| sprint.html `sp-toolbar` | Back → project · `#sp-title` plain h2 · time paging ‹ › · zoom select (d/w1/m1/m3/m6/y1) · **Board → `/kanban?project=`** (the S209 fix) · ◆ Sprint define · Finish sprint | sprint.html:56–85; sprint-page.js:1465–1467 |

**Documented exceptions (do NOT "fix" in the port — FEATURE-INVENTORY §13, verified):**
/board.html's Back+icons-rail vs /kanban's edge rail (entry context); the embedded board's
reading-measure + outline + no floor; the split-WYSIWYG editor vs the raw-textarea modal; the
read-only detail slide-over (S149, project-page.js:4209) vs the board's direct editor-open
(board-page.js:695); "+N more" windowing + column collapse embedded-only; delete models
(styled-confirm board / optimistic+Undo embedded — §6); server-baked `trL()` strings on the
embedded fragments vs client `t()` on the board pages.

---

## §6 Interactions & feedback (VERIFIED)

- **DnD** (board-page.js:771–842): `dragstart` adds `.dragging` (0.45 opacity, devboard.css:110);
  `dragover` paints the **column cue** `.pd-col.drag-over` (project-header.css:405) and **live-reorders**
  the DOM inside `.pd-tasks` (insertBefore at the hovered card's half-point); `drop` PATCHes status on
  cross-column moves, POSTs the reordered id list, then reloads. **The urgent-zone adoption rule**
  (:819–826): a SAME-COLUMN drop ADOPTS the priority of the card it landed next to (columns are
  priority-sorted — the neighbor IS the tier zone); a differing tier PATCHes priority with the move.
  **Failure → toast(err) + full reload** (:837–840).
- **Priority banner click-cycle** (:639–653): optimistic `task.priority = next` + re-render (the column
  re-sorts for free), PATCH behind it; on error toast + reload. **Label-chip = filter toggle**
  (:628–635): clicking a card's `.pd-tag[data-pd-tag-name]` toggles that label in `filterTags`
  (GitHub behavior; cursor pointer devboard.css:919) — runs BEFORE the card-open branch, which
  excludes read-more/banner/chips/menu/badge (:695).
- **The filter bar**: search input → `db-filter-q` debounced **150ms** (:847–861; the project page's
  twin debounces 120ms); priority chips render REVERSED (urgent first, :100–102); empty selection =
  show all; OR within a group, AND across groups + the query (:81–91); the **"{n} of {m} shown"**
  counter appears only while filtering (:107; `.db-filter-shown` devboard.css:908); the **zero-match
  empty state** mounts under the bar (:112–117, synced post-paint :264–265; `.db-filter-empty`
  devboard.css:894–896); Clear chip + `[hidden]` must win over `.chip` display (devboard.css:907).
- **Toasts** — `window.hibana.toast(message, kind, ms, actions)` (app.js:253–317): kinds **ok / err /
  info**. `ok` = pastel green + leading ✓ + top-right dismiss, 4s default; `err` = persistent; others
  4s. The **Undo action shape**: `toast('Deleted', 'info', 6000, [{label:'Undo', onClick:undoFn}])`
  (app.js:247) — actions are `{label, onClick, kind?}` buttons that dismiss the toast after firing.
- **Dialogs** — the native `<dialog>` recipe: `document.createElement('dialog')` + `className='dialog'`
  + inner `<form class="modal" method="dialog">`, `showModal()`, backdrop-click closes (delete-confirm
  board-page.js:556–594; shot-note devboard.js:630–659; pinned-pictures :690–740). The shared task
  editor is the ONE exception (a z-90 div, §4.1).
- **Loading / gone / fail**: `#db-loading` spinner (board.html:87); `fail` = message + **Try again**
  button `#db-retry` (board-page.js:906–912, re-boots :598–601); `gone` (404) = "This project doesn't
  exist" + Back to projects link (:915–921); no-projects empty state `renderNoProjects` (:457–468).
- **The signal+3s+retry GET contract** (invisible but behavioral — devboard.js:10–64): every GET
  dispatches with an `AbortController` signal + a **3s deadline + ONE retry** (10s second deadline)
  on AbortError; mutations keep the plain path (retrying would double-write); `cache:'no-store'`
  rides every call; thrown errors carry `err.status` (404 = gone vs transient). The port's HTTP layer
  must reproduce this resilience behavior.
- **Keyboard map** (verified against the tree; full table = FEATURE-INVENTORY §12): card Enter/Space
  opens the editor (board-page.js:863–873); Esc family — card ⋯ menus (:551), label manager
  (devboard.js:1412), **editor exits fullscreen first** (devboard.js:757–765 + :800–804), switcher
  closes + focus returns (board-page.js:450–455), **lightbox closes ONLY the lightbox**
  (devboard.js:566–577); editor title Enter saves / Shift+Enter newline (devboard.js:1258–1261);
  tag inputs Enter adds/stages (:1067–1115); switcher ↑/↓/Enter/Esc (:376–396); lightbox ←/→
  RTL-aware (:574–576); global `g`+letter (`g k` → /kanban`, go-to.js:13–19), Ctrl/Cmd+K, `/`, `?`
  (command-palette.js:741–755).
- **i18n / RTL laws**: render-time `t()` for every JS-built string (devboard.js:66; board boot awaits
  `hibanaI18n.ready` — board-page.js:965–970); **`faDig`** digits → ۰-۹ (devboard.js:112–115;
  chip-render.js:360); **Jalali** dates for fa (chip-render.js:380–385 via Intl persian; server twin
  detail-helpers.ts:205–207 via toJalali; jalaali vendor for sprint dates); **dir per locale**
  (i18n.js:94 document-level; per-element `dir` — §1.6); static chrome via `data-i18n` attributes
  (board.html:50, 68, 71, 76, 83, 85, 87); the embedded fragments bake strings server-side via
  `trL()` (detail-helpers.ts passim). EN/FA dictionary parity is 1584/1584
  (scripts/check-i18n-parity.mjs).

---

## §7 What the desktop port MUST reproduce exactly vs MAY replace with native [RECOMMENDATION]

### 7.1 MUST reproduce exactly (the load-bearing visual identity)

1. **The token system** (§1) — light + claude-dark tables, the priority palette, the 16 category
   pairs, the fs/radius/shadow scale, the column `--col-*` family.
2. **The board anatomy** (§2) — the `.db-frame` mother container, hairline header row, 5-column grid
   with its 1100/640 breakpoints, the 100dvh floor on the page-owning surface, full-bleed 0→viewport,
   the tinted `.pd-col-head` strips, `.pd-tasks`/`.pd-task-add`.
3. **The card anatomy** (§3) — the wrap > banner > card > body tree, the prio-banner recipe + its
   four color-mix tints, the `.cat-chip`/`.pd-tag`/`◆ sprint badge`/`.pd-task-shots` chips, the
   12px/700 title register.
4. **The markdown-lite renderer output** (§3.3) — byte-compatible HTML for the same raw title
   (strong/u/s/ul/ol/align-divs/`.t-code` LTR islands/hidden `.t-fence` markers), the 150-char
   clamp + `.pd-title-rest` + read-more, the 110-char preview, `data-raw-title` round-tripping.
5. **The modal** (§4) — the S89 one-scroll-region layout, the 10-op toolbar + its exact markdown
   products, the `.db-seg` is-on recipes, the fullscreen-writing exit-first contract, the lightbox
   Esc precedence.
6. **FA/RTL** (§1.6, §6) — logical-property mirroring, `faDig`, Jalali, `dir` per locale, the
   `.t-code` LTR islands.

### 7.2 MAY replace with native [RECOMMENDATION]

| Web affordance | Desktop-native replacement | Notes |
|---|---|---|
| Edge-hover rail / icons rail | Native sidebar, menus, or a native title-bar menu | The web rail exists because browsers lack chrome; a desktop app has real menus. Keep `g k`-style shortcuts mapped to menu items. |
| Toasts (`window.hibana.toast`) | Native Windows notifications **or keep the web toasts** | Keep the ok/err/info semantics + the Undo action shape either way — an Undo must be a button, not a transient banner. |
| Native `<dialog>` confirms | **Keep the web dialogs** (they render identically in WebView2) | Deleting/archiving confirms stay in-page. |
| HTML5 drag & drop | **WebView2 mouse DnD works as-is** (the board is mouse-first: board-page.js:771–842); the touch long-press path (touch-drag.js / S151 pointer path) is irrelevant on desktop | Preserve the drag-over cue, live reorder preview, urgent-zone adoption, failure→reload. |
| Project switcher popover | A native list/combobox **or keep the web popover** | If native, keep the searchable-list + current-row semantics (board-page.js:357–409). |
| Fullscreen writing mode | **Keep it** (it is content UI, not chrome) | §4.5. |
| `window.confirm` calls (clear-done, archive-confirm, the modal's Delete) | Keep or swap for the styled dialog recipe — but pick ONE | The web app itself mixes both (board-page.js:740/758 vs :556–594); the port should unify on the styled `<dialog>` recipe. |

### 7.3 The embedding model (what the Wails frontend copies) [RECOMMENDATION]

- **board.html stripped of web chrome** — drop the SW/htmx/nav layer (`htmx.min.js` +
  `idiomorph-ext.min.js` board.html:30–31, `<div data-nav>` :53, the page loader :52, boot.js's SW
  registration), keep the board markup (:62–89).
- **JS**: `devboard.js` (v28) + `chip-render.js` (v12) + the **i18n trio** (`i18n-en.js` v100,
  `i18n.js` v154, lazy `i18n-fa.js`) + `vendor/jalaali.min.js` + `image-resize.js` (lazy-loaded by
  devboard.js:307–319) + `app.js`'s toast component (or a native equivalent exposing the same
  `window.hibana.toast` signature).
- **CSS — the actual list from board.html's `<head>` (board.html:10–29, 19 sheets + font css)**:
  `variables.css` → `base.css` → `layout.css` → `dashboard.css` → `dashboard-todo.css` →
  `components.css` → `canvas.css` → `quicknotes.css` → `to-do-list.css` → `polish-ui.css` →
  `calendar.css` → `notifications.css` → `polish-batch.css` → `project-header.css` → `devboard.css`
  → `misc.css` → `themes.css` → `claude-dark-theme.css` → `rtl.css` (+ Manrope font-face). Load order
  matters: `rtl.css` last (rtl.css:6), `themes`/`claude-dark` before it.
- **The network seam**: `window.hibanaFetch` is the port plan's proposed thin adapter
  (GO-DESKTOP-PORT-PLAN.md:61–63, "~15 call sites"). **Verified count in the tree**: devboard.js has
  **6 literal `fetch(` sites** — the `api()` seam itself (:33) plus **5 label-manager calls**
  (:1280, :1336, :1352, :1372, :1382) that bypass it — while **21 endpoint call sites** funnel
  through the single `api()` function (:159, :173–219, :473–478, :825), and the uploader uses
  **2 XHR paths** (:337–339, :367–369). `board-page.js` adds **4 direct `fetch(` sites** (:287
  projects list, :579 delete, :741 archive-done, :761 clear-done). The honest seam is therefore
  **`api()` + 11 raw fetch/XHR sites** — replace them all with the adapter (Go-side cookie jar +
  same-origin asset server), keeping the renderers untouched.

---

## §8 Acceptance criteria [RECOMMENDATION]

1. **Side-by-side screenshots**: the desktop window at **1920×1080 and 390×844** equivalents, in
   **EN and FA, light and claude-dark** (8 combinations), rendering the SAME seeded project —
   pixel-diff the board against the web `/kanban` reference (same Chromium/WebView2 engine; allow
   only font-hinting deltas).
2. **Geometry pins re-run inside the WebView**: port the assertions of `e2e/s207-kanban-frame.spec.ts`
   (frame structure :85–100, surface color :104–105, retired toolbar chrome :109–117, full-width
   :135–160, height floor :171–178, mobile inset :212–223) and `e2e/s209-kanban-parity.spec.ts`
   (toolbar :169, fullscreen Esc-first :212, embedded frame :252, badges :297, in-place archive
   :348) as automated checks against the embedded island.
3. **Byte-parity renderer tests**: the port's title renderer must pass the existing parity net —
   `e2e/s110-meta-parity.spec.ts` (byte-identical meta across surfaces), the `kanban-parity.test.ts`
   markup pins (:71–76, :103, :131), and a new chip-render-vs-port golden-file suite over the full
   markdown-lite vocabulary (every row of §3.3's table + clamped titles + fences + FA/RTL cases).
4. **Behavioral parity**: DnD (incl. urgent-zone adoption + failure reload), the banner cycle, filter
   debounces + shown-counter + zero-match state, the signal+3s+retry GET behavior, the toast kinds +
   Undo shape, and the full §6 keyboard map — each exercised end-to-end in the desktop shell.
5. **Regression floor**: the web suite stays green while the port lands (current tree: 646/646
   vitest; e2e incl. the S205–S209 kanban specs per TEST-MATRIX.md) — the port's UI files replace
   the web island only behind the `window.hibanaFetch` seam, so no web test may regress.
