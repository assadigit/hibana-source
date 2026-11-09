import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

// S242 — the spec pack's Phase 3 client round (Core Kanban + task-form UI, sprint
// integration). The API surface this UI rides was pinned server-side in Phases
// 1+2 (sprint-deadline-deps-domain + api-surface-s241); this suite pins the
// CLIENT contracts the round added, the same source-evaluation doctrine as
// focus-mode-s237/task-view-s238 (vitest runs in node; nothing imports
// public/js — the real files are read byte-for-byte):
//   1. D2 CLOSED: the modal's task-create body sends an EXPLICIT sprint_id
//      (`sprintId ?? null`) — never `undefined` (the legacy draft/open
//      auto-assign the old `|| undefined` tripped; contract §12.4).
//   2. The sprint dropdown: identity glyph (emoji else ◆), completed sprints
//      hidden from NEW assignment (a task already in one keeps it selected),
//      the ＋ New sprint entry preserved.
//   3. The quick-create dialog: opens at SELECTION time, required name, the
//      emoji picker, OFF-by-default description/due toggles, the sprint
//      define-popover's UTC end-of-day due parse, INLINE 409 duplicate /
//      draft_exists errors, auto-select on success.
//   4. The toolbar sprint VIEW filter: All tasks default + No sprint + every
//      sprint, composing with search/priority/labels, on BOTH board surfaces.
//   5. The card sprint identity row (client twin) + the seam pins the desktop
//      island round re-verifies (board-page.js keeps EXACTLY 4 fetch sites).

const readPublic = (rel: string) => readFileSync(join(process.cwd(), 'public', rel), 'utf8')

describe('S242 — the D2 fix (explicit sprint_id on task create)', () => {
  it('devboard.js: the create body sends sprint_id: sprintId ?? null — the || undefined auto-assign trip is GONE', () => {
    const js = readPublic('js/devboard.js')
    // the exact D2 line (contract §12.4): null = No sprint, undefined = legacy auto-assign
    expect(js).toContain('sprint_id: sprintId ?? null,')
    // the OLD shape must not survive anywhere in the file
    expect(js).not.toContain('sprint_id: sprintId || undefined')
    // the edit path keeps its explicit null (already correct pre-S242)
    expect(js).toContain('sprint_id: sprintId || null }')
  })

  it('devboard.js: the quick-create owns __new at SELECTION time — draft.sprint_id never becomes __new', () => {
    const js = readPublic('js/devboard.js')
    // the old onchange wrote '__new' into the draft; the new one opens the dialog and returns
    expect(js).not.toMatch(/draft\.sprint_id = sprintSel\.value === '__new'/)
    expect(js).toMatch(/sprintSel\.value === '__new'\) \{[\s\S]{0,900}openSprintQuickCreate\(/)
    // the save path carries only the unreachable belt — no S206 draft-reuse createSprint()
    expect(js).not.toMatch(/const r = existing \|\| await createSprint\(\)/)
    expect(js).toMatch(/if \(sprintId === '__new'\) sprintId = null/)
  })
})

describe('S242 — the sprint dropdown (Add/Edit Task)', () => {
  it('devboard.js: every option wears the identity glyph; completed sprints are not NEW-assignment options; the current completed sprint stays selected', () => {
    const js = readPublic('js/devboard.js')
    // the shared identity helpers (dropdown + filter + card row read the same one)
    expect(js).toContain("const sprintGlyph = (s) => (s && s.emoji ? String(s.emoji) : '◆')")
    expect(js).toContain("const sprintCompleted = (s) => !!(s && (s.status === 'completed' || s.ended_at))")
    // the option shape: glyph + name (+ the legacy draft tag), hidden for completed
    // unless the task is already in THAT sprint (historical association, spec §8)
    expect(js).toMatch(/if \(sprintCompleted\(s\) && d\.sprint_id !== s\.id\) return ''/)
    expect(js).toMatch(/esc\(sprintGlyph\(s\) \+ ' ' \+ s\.name\)/)
    // the ＋ New sprint entry survives (Screen D)
    expect(js).toContain(`'<option value="__new">' + '＋ ' + esc(t('db.newSprint', 'New sprint')) + '</option>'`)
  })

  it('api() surfaces the {error} code — the quick-create needs the 409 family to answer inline', () => {
    const js = readPublic('js/devboard.js')
    // S243: the parse now carries the WHOLE body (err.body — the H1 conflict modal
    // reads active_id from the 409 sprint_active_exists payload). Pin extended from
    // the S242 one-line shape; the err.code contract itself is unchanged.
    expect(js).toMatch(/if \(b && b\.error\) err\.code = b\.error/)
    expect(js).toMatch(/if \(b && typeof b === 'object'\) err\.body = b/)
  })
})

describe('S242 — the sprint quick-create dialog (spec §7.1 / Screen D)', () => {
  it('the dialog: required name, emoji picker, OFF-by-default description + due toggles, cancel/create actions', () => {
    const js = readPublic('js/devboard.js')
    for (const marker of [
      'function openSprintQuickCreate(opts)',
      "t('db.newSprint', 'New sprint')",
      'data-sq-name',
      'data-sq-emoji-btn',
      'window.hibanaEmojiPicker',
      'picker.open({ anchor: emojiBtn, current: emoji, onPick:',
      'data-sq-desc-toggle',
      'data-sq-due-toggle',
      // the OFF-by-default contract: the revealed inputs ship hidden. S244
      // (Phase 5 — D6): the interim bare <input type="date"> became the shared
      // control's MOUNT (data-sq-due-mount) — the due controls still ship hidden
      // behind the OFF-by-default toggle; the intent (compact form until asked)
      // is unchanged.
      '<textarea class="db-sq-desc" data-sq-desc maxlength="2000" dir="auto" hidden',
      '<div class="db-sq-due-mount" data-sq-due-mount hidden></div>',
      'data-sq-cancel',
      'data-sq-create',
    ]) {
      expect(js.includes(marker), `devboard.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // the toggles reveal their inputs on change (spec §4.2) — S244: the due
    // toggle now reveals the mounted shared control (due-control.js) instead of
    // a bare input; the reveal-on-change contract itself is unchanged.
    expect(js).toMatch(/descToggle\.onchange = \(\) => \{ descTa\.hidden = !descToggle\.checked \}/)
    expect(js).toMatch(/dueToggle\.onchange = \(\) => \{[\s\S]{0,400}dueMount\.hidden = !dueToggle\.checked/)
  })

  it('the create POST: name + optional emoji/description/due_at; the due date resolves through the SHARED control (S244 superseded the UTC end-of-day parse — LOCAL 23:59 per §11.2)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/const body = \{ name \}/)
    expect(js).toMatch(/if \(emoji\) body\.emoji = emoji/)
    expect(js).toMatch(/if \(descToggle\.checked\) \{ const dv = descTa\.value\.trim\(\); if \(dv\) body\.description = dv \}/)
    // S244 (D6 — the kickoff's sanctioned supersession): the S242 interim
    // new Date(val + 'T23:59:59Z') UTC parse is GONE — the shared control's
    // value() (the ISO instant, date-only resolved to LOCAL 23:59) rides the
    // create body instead. The intent (a date-only pick = end of day) is
    // preserved; the timezone became the user's own (spec §11.2).
    expect(js).not.toContain("new Date(dueIn.value + 'T23:59:59Z')")
    expect(js).toMatch(/if \(dueToggle\.checked\) body\.due_at = dueVal/)
    expect(js).toMatch(/api\('\/api\/projects\/' \+ state\.projectId \+ '\/sprints',/)
  })

  it('the 409 family answers INLINE (never a silent rename, never a save-kill)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/err\.code === 'duplicate'[\s\S]{0,200}db\.sq\.dupErr/)
    expect(js).toMatch(/err\.code === 'draft_exists'[\s\S]{0,200}db\.draftExists/)
    // required-name inline error
    expect(js).toMatch(/if \(!name\) \{ showErr\(t\('db\.sq\.nameRequired'/)
  })

  it('on success the new sprint joins state.sprints + gets selected for the current task (spec §7.1 recommended default)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/if \(!state\.sprints\.some\(\(x\) => x\.id === sp\.id\)\) state\.sprints\.push\(sp\)/)
    expect(js).toMatch(/modalCtx\.draft\.sprint_id = sp\.id/)
    // the synthetic row is born a draft (planned) — quick-create never sends started_at
    expect(js).toMatch(/is_draft: r\.draft \? 1 : 0, status: r\.draft \? 'planned' : 'active'/)
  })
})

describe('S242 — the toolbar sprint VIEW filter (spec §7.5 / Screen A)', () => {
  it('board-page.js: All tasks default, No sprint option, every sprint with its glyph, composing with search + priority', () => {
    const js = readPublic('js/board-page.js')
    for (const marker of [
      "let filterSprint = ''",
      "data-db-filter-sprint",
      "db.filterSprintAll', 'All tasks')) + '</option>'",
      "value=\"__none\"",
      "if (filterSprint === '__none' ? !!task.sprint_id : task.sprint_id !== filterSprint) return false",
      "|| filterSprint !== ''",
      "filterSprint = sel.value",
    ]) {
      expect(js.includes(marker), `board-page.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // the clear paths reset the sprint dimension too
    expect(js.match(/filterPrios\.clear\(\); filterTags\.clear\(\); filterQuery = ''; filterSprint = ''/g)?.length).toBe(2)
    // the filter never mutates assignments: no fetch/PATCH rides the change handler
    expect(js).not.toMatch(/ctx\.on\('change'[\s\S]{0,300}patchTask/)
  })

  it('project-page.js: the embedded board carries the SAME sprint filter (the parity decision)', () => {
    const js = readPublic('js/project-page.js')
    for (const marker of [
      "let pdFilterSprint = ''",
      "data-pd-filter-sprint",
      "pdFilterSprint === '__none' ? sid !== '' : sid !== pdFilterSprint",
      "|| pdFilterSprint !== ''",
    ]) {
      expect(js.includes(marker), `project-page.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // the wraps carry data-pd-sprint (the server twin stamps it — detail-helpers.ts)
    expect(readPublic('js/project-page.js')).toContain('wrap.dataset.pdSprint')
  })

  it('the SELECT rides the shared devboard.css classes on both surfaces (is-on tint, compact scale)', () => {
    const css = readPublic('css/devboard.css')
    for (const marker of ['.db-filter-sprint {', '.db-filter-sprint.is-on {', '.db-sprintq { z-index: 95; }', '.pd-task-body > .db-sprint-badge {']) {
      expect(css.includes(marker), `devboard.css must carry ${JSON.stringify(marker)}`).toBe(true)
    }
  })
})

describe('S242 — the card sprint identity row (client twin)', () => {
  it('board-page.js: the badge renders as its own row (emoji else ◆ + name), after the preview, before tags/meta', () => {
    const js = readPublic('js/board-page.js')
    expect(js).toMatch(/const sprintRowHtml = sprint\n[\s\S]{0,200}'<span class="db-sprint-badge">' \+ B\(\)\.esc\(\(sprint\.emoji \? sprint\.emoji \+ ' ' : '◆ '\) \+ sprint\.name\)/)
    // the card order: preview → readMore → SPRINT ROW → tags → meta (Screen A).
    // S244 (Phase 5): the DEADLINE ROW + bar joined the seam between the sprint
    // row and the tags — the pin moves with it (intent preserved: the badge
    // stays its own row above the tags/meta area).
    // S246 (Phase 7): the dep badge row joined after the deadline row — the pin
    // moves with it again (same intent).
    expect(js).toContain('previewHtml(task.title) +\n                        readMoreBtn(task.title) +\n                        sprintRowHtml +\n                        deadlineHtml +\n                        depHtml +\n                        chipsHtml +\n                        metaHtml +')
    // the glyph-blind badge shape is gone EVERYWHERE in the file (the card AND
    // the read-only task view both render the emoji-aware glyph)
    expect(js).not.toContain("'<span class=\"db-sprint-badge\">◆ ' + B().esc(sprint.name)")
    // the card's tags row is tags-only: the chips block that follows sprintRowHtml
    // opens on tags.length alone (no `|| sprint` crutch)
    expect(js).toContain('const chipsHtml = (tags.length\n')
  })

  it('detail-helpers.ts: the server twin renders the byte-identical badge shape', () => {
    const ts = readPublic('../src/routes/projects/detail-helpers.ts')
    expect(ts).toContain("return `<span class=\"db-sprint-badge\">${esc((sp.emoji ? sp.emoji + ' ' : '◆ ') + sp.name)}</span>`")
    // placed as its own row between readMore and the tags (S244: the deadline
    // row joined the seam after the badge — the pin moves with it; S246: the
    // dep badge row joined after the deadline row — it moves again, same intent)
    expect(ts).toContain('${readMoreBtn(t.title)}\n                    ${sprintBadgeHtml(t.sprint_id)}\n                    ${deadlineRowHtml(t)}\n                    ${depBadgeHtml(t)}\n                    ${taskTagChips(t.id)}')
  })
})

describe('S242 — i18n EN+FA parity for every new string', () => {
  /** Loads a dictionary file in a VM sandbox (the check-i18n-parity loader, scoped). */
  function loadDict(file: string, varName: string): Record<string, unknown> {
    const src = readFileSync(join(process.cwd(), 'public/js', file), 'utf8')
    const sandbox: Record<string, unknown> = { window: {} }
    runInNewContext(src, sandbox, { filename: file, timeout: 5000 })
    const dict = (sandbox.window as Record<string, Record<string, unknown>>)[varName]
    if (!dict || typeof dict !== 'object') throw new Error(`could not load ${varName}`)
    return dict
  }

  const NEW_KEYS = [
    'db.filterSprint', 'db.filterSprintAll',
    'db.sq.namePh', 'db.sq.emoji', 'db.sq.chooseEmoji', 'db.sq.changeEmoji', 'db.sq.clearEmoji',
    'db.sq.addDesc', 'db.sq.descPh', 'db.sq.setDue', 'db.sq.create', 'db.sq.creating',
    'db.sq.nameRequired', 'db.sq.dupErr', 'db.sq.failed',
  ]

  it('every new key exists in BOTH dictionaries (written FA copy, not placeholders)', () => {
    // the dicts are nested per-namespace in some builds — scan the raw source as
    // the parity gate's loader does, then assert on the flattened keys.
    const en = loadDict('i18n-en.js', '__hibanaDictEN')
    const fa = loadDict('i18n-fa.js', '__hibanaDictFA')
    const flat = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const out: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flat(v as Record<string, unknown>, key))
        else out.push(key)
      }
      return out
    }
    const enKeys = new Set(flat(en))
    const faKeys = new Set(flat(fa))
    for (const key of NEW_KEYS) {
      expect(enKeys.has(key), `i18n-en.js must carry ${key}`).toBe(true)
      expect(faKeys.has(key), `i18n-fa.js must carry ${key}`).toBe(true)
    }
    // the FA copy is real Persian (carries Arabic-script characters), not EN echoes
    const faRaw = readPublic('js/i18n-fa.js')
    expect(faRaw).toMatch(/'db\.filterSprintAll': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.sq\.create': '[^']*[؀-ۿ][^']*'/)
  })
})

describe('S242 — the desktop seam tripwires (the Phase 9 re-pin inventory)', () => {
  it('board-page.js keeps EXACTLY the THREE seam-patched fetch sites (zero new ones — S258\'s FE-11 retired the clear-done DELETE fan-out for the ONE bulk api() call)', () => {
    const js = readPublic('js/board-page.js')
    expect((js.match(/\bfetch\(/g) || []).length).toBe(3)
  })

  it('devboard.js keeps its 7 fetch sites (the quick-create POSTs through the shared api() wrapper)', () => {
    const js = readPublic('js/devboard.js')
    expect((js.match(/\bfetch\(/g) || []).length).toBe(7)
  })

  it('the emoji picker rides board.html + sprint.html (the task modal serves both surfaces)', () => {
    for (const page of ['board.html', 'sprint.html']) {
      const html = readPublic(page)
      expect(html).toMatch(/\/js\/emoji-picker\.js\?v=\d+/)
      // S258 moved devboard.js to v40 (the UI/UX polish round) — the pin moves
      // with it (was v39, moved by S255's payload round; S256 left v39 alone)
      expect(html).toMatch(/\/js\/devboard\.js\?v=40/)
      // S244: the shared date control rides both modal-serving pages (D6); S254 → v2,
      // S256 (FE-13's esc twin consolidation) → v3
      expect(html).toMatch(/\/js\/due-control\.js\?v=3/)
    }
  })
})
