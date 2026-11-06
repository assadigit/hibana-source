import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

// S243 — the spec pack's Phase 4 client round (sprint management, overview and
// lifecycle). The API surface this UI rides was pinned server-side in Phases
// 1+2 (sprint-deadline-deps-domain + api-surface-s241) with the Phase 3 UI on
// top (sprint-ui-s242); this suite pins the Phase 4 CLIENT contracts, the same
// source-evaluation doctrine as sprint-ui-s242 (vitest runs in node; nothing
// imports public/js — the real files are read byte-for-byte):
//   1. The pause/resume client wrappers (the S240 endpoints finally get them)
//      + api() carrying the WHOLE 409 body (err.body — the H1 modal reads
//      active_id from the server, never a stale local guess).
//   2. The H1 one-active conflict modal (spec §5.2 + Screen H1): both
//      identities, three EXPLICIT actions (pause&start / finish&start with the
//      archive-count note / cancel), sequential pause→start / finish→start,
//      a lost race SURFACED — never a silent retry.
//   3. The H2 finish confirmation (spec §5.3 + Screen H2): the client-fold
//      Implemented count + the unfinished-stay-put count + "No tasks will be
//      deleted." → the toast quotes the SERVER's additive archived count.
//   4. The Screen-I delete confirmation (spec §6): completed answers inline,
//      active answers inline (pause/finish first), planned/paused through a
//      modal with EXACT impact counts incl. the archived-with-snapshot rows
//      (the lazy archives list's additive sprint_id — the S243 server twin).
//   5. The Sprints page extension (D5 — Screens E/F): the lifecycle-grouped
//      list, the Settings/Tasks detail panel, the completed-history archive
//      section, the ?sprint= deep link, the paused timeline render.
//   6. The compact Kanban overview (Screen G) on BOTH board surfaces (the
//      embedded-board parity decision: SHIPPED) — the §12.5 client fold, five
//      lanes + total only, ZERO new fetches.
//   7. The desktop seam tripwires (the Phase 9 re-pin inventory): the fetch
//      counts NEVER moved (every new call rides the shared api() wrapper).

const readPublic = (rel: string) => readFileSync(join(process.cwd(), 'public', rel), 'utf8')

describe('S243 — the pause/resume wrappers + the api() body-carry', () => {
  it('devboard.js: pauseSprint/resumeSprint POST the S240 endpoints through the shared api() wrapper', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain("const pauseSprint = (id) => api('/api/sprints/' + id + '/pause', { method: 'POST' })")
    expect(js).toContain("const resumeSprint = (id) => api('/api/sprints/' + id + '/resume', { method: 'POST' })")
    // exported on window.HibanaBoard beside the others
    expect(js).toMatch(/pauseSprint, resumeSprint,/)
  })

  it('the lifecycle fold + status helpers: one implementation, exported for every surface (spec §18)', () => {
    const js = readPublic('js/devboard.js')
    // sprintStatusOf: status authoritative, the legacy is_draft/ended_at belt (the D1 twin)
    expect(js).toMatch(/const sprintStatusOf = \(s\) => \{[\s\S]{0,260}if \(s\.status\) return s\.status[\s\S]{0,200}return s\.is_draft \? 'planned' : 'active'\n\s+\}/)
    // sprintLaneCounts: the §12.5 client-derived fold — five lanes + total, nothing else
    expect(js).toMatch(/const sprintLaneCounts = \(sprintId, taskRows\) => \{[\s\S]{0,600}for \(const st of STATUSES\) counts\[st\] = 0[\s\S]{0,400}return \{ counts, total \}/)
    expect(js).toMatch(/sprintStatusOf, sprintLaneCounts,/)
  })

  it('api() carries the whole error body — the 409 active_id is the server\u2019s answer, never a stale guess', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/if \(b && b\.error\) err\.code = b\.error/)
    expect(js).toMatch(/if \(b && typeof b === 'object'\) err\.body = b/)
  })
})

describe('S243 — the H1 one-active conflict modal (spec §5.2 + Screen H1)', () => {
  it('devboard.js: the modal exists with BOTH identities + the three explicit actions', () => {
    const js = readPublic('js/devboard.js')
    for (const marker of [
      'function openSprintConflict(active, selected, opts)',
      // the one-active explain + the identity rows
      "t('db.h1.explain', 'Only one sprint can be active in this project at a time.')",
      "t('db.h1.current', 'Currently active')",
      "t('db.h1.starting', 'You are starting')",
      // the three actions
      'data-sm-pause-start',
      'data-sm-finish-start',
      "t('db.h1.pauseStart', 'Pause {a} & Start {b}')",
      "t('db.h1.finishStart', 'Finish {a} & Start {b}')",
      // the finish arm shows the archive count BEFORE confirming
      "t('db.h1.finishNote', 'Finishing archives only tasks in Implemented — {n} will be archived.')",
    ]) {
      expect(js.includes(marker), `devboard.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
  })

  it('the arms run sequentially (pause→start / finish→start) and a lost race is SURFACED, never retried', () => {
    const js = readPublic('js/devboard.js')
    // the pause arm: pauseSprint(active) then startSprint(selected)
    expect(js).toMatch(/if \(arm === 'pause'\) \{\n\s+await pauseSprint\(active\.id\)\n/)
    // the finish arm: finishSprint(active) — its archived count toasts — then the
    // S235 day-window TRIM (the create-with-dates auto-close convention) — then startSprint(selected)
    expect(js).toMatch(/const r = await finishSprint\(active\.id\)\n\s+if \(r && r\.archived != null && r\.archived > 0\)/)
    // the trim: /finish stamps ended_at=now (today) and /start stamps started_at=now
    // (the same day) — assertSprintWindowOk keeps one sprint per day, so the finish
    // arm trims the finished band edge to max(now-1day, started+1ms) exactly like the
    // create-with-dates auto-close (closeMs = max(start-1day, sibling.started_at)).
    expect(js).toMatch(/const trimMs = Math\.max\(nowMs - 86400000, startedMs \+ 1\)/)
    expect(js).toMatch(/await patchSprint\(active\.id, \{ ended_at: new Date\(trimMs\)\.toISOString\(\) \}\)/)
    expect(js).toMatch(/await startSprint\(selected\.id\) \/\/ planned \+ paused both promote through \/start/)
    // the catch: sprint_active_exists toasts + closes + onDone reloads — no retry call in the catch
    expect(js).toMatch(/if \(err && err\.code === 'sprint_active_exists'\) \{\n\s+window\.hibana && window\.hibana\.toast\(t\('db\.h1\.stale'/)
    // the day-window 400 answers with its OWN honest message (the S235 seam)
    expect(js).toMatch(/err && err\.code === 'invalid_input'\) \{[\s\S]{0,400}db\.h1\.dayBlocked/)
    const armCatch = js.slice(js.indexOf('function openSprintConflict'))
    const catchBlock = armCatch.slice(armCatch.indexOf('} catch (err) {'), armCatch.indexOf("el.querySelector('[data-sm-pause-start]')"))
    expect(catchBlock).toBeTruthy()
    expect(catchBlock).not.toMatch(/startSprint\(|pauseSprint\(|finishSprint\(/) // never a silent retry inside the catch
  })

  it('the shared start flow: the client pre-check opens the modal, and the 409 belt reads err.body.active_id', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/async function startSprintWithConflict\(id, opts\)/)
    // the pre-check: an active sibling in the pool opens the conflict BEFORE any call
    expect(js).toMatch(/if \(active && active\.id !== id\) \{ openSprintConflict\(active, selected, o\); return \}/)
    // paused resumes through /resume; planned starts through /start
    expect(js).toMatch(/if \(status === 'paused'\) await resumeSprint\(id\)\n\s+else await startSprint\(id\)/)
    // the 409 belt resolves the server's active_id from the body
    expect(js).toMatch(/const activeId = err\.body && err\.body\.active_id/)
  })
})

describe('S243 — the H2 finish confirmation (spec §5.3 + Screen H2)', () => {
  it('devboard.js: identity + the client-fold Implemented count + unfinished-stay-put + no-deletes', () => {
    const js = readPublic('js/devboard.js')
    for (const marker of [
      'function openSprintFinish(s, opts)',
      "t('db.h2.title', 'Finish sprint?')",
      // the counts come from the §12.5 client fold
      /const fold = sprintLaneCounts\(s\.id, o\.taskRows\)\n\s+const doneN = fold\.counts\.done \|\| 0\n\s+const unfinished = fold\.total - doneN/,
      "t('db.h2.willArchive', '{n} tasks in Implemented will be archived.')",
      "t('db.h2.unfinished', '{n} unfinished tasks stay in their columns and keep this sprint.')",
      "t('db.h2.noDelete', 'No tasks will be deleted.')",
      "t('db.h2.confirm', 'Finish Sprint')",
    ]) {
      expect(typeof marker === 'string' ? js.includes(marker) : marker.test(js), `devboard.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
  })

  it('the toast quotes the SERVER\u2019s additive archived count (the exact number, not the preview)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/const r = await finishSprint\(s\.id\) \/\/ 200 \{ok, archived:n\} — the server's exact count/)
    expect(js).toMatch(/t\('db\.h2\.done', 'Sprint finished — \{n\} tasks archived'\)\.replace\('\{n\}', faDig\(r && r\.archived != null \? r\.archived : doneN\)\)/)
  })
})

describe('S243 — the Screen-I delete confirmation (spec §6 + Screen I)', () => {
  it('completed + active answer INLINE (the 409 twins); planned/paused pass into the modal', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/async function openSprintDelete\(s, opts\)/)
    expect(js).toMatch(/if \(status === 'completed'\) \{\n\s+window\.hibana && window\.hibana\.toast\(t\('db\.del\.completed'/)
    expect(js).toMatch(/if \(status === 'active'\) \{\n\s+window\.hibana && window\.hibana\.toast\(t\('db\.del\.active', 'Pause or finish this sprint before deleting it\.'\)/)
    // the server's twin 409s surface inline too (a race between load + click)
    expect(js).toMatch(/err\.code === 'sprint_active'\) window\.hibana && window\.hibana\.toast\(t\('db\.del\.active'/)
    expect(js).toMatch(/err\.code === 'sprint_completed'\) window\.hibana && window\.hibana\.toast\(t\('db\.del\.completed'/)
  })

  it('EXACT impact counts: total, non-archived-unassigned, archived-with-snapshot, no-deletes', () => {
    const js = readPublic('js/devboard.js')
    // the archived count comes from the lazy archives list through the shared api() wrapper
    expect(js).toMatch(/await api\('\/api\/projects\/' \+ pid \+ '\/archives'\)/)
    expect(js).toMatch(/archivedN = \(\(r && r\.archives\) \|\| \[\]\)\.filter\(\(a\) => a && a\.sprint_id === s\.id\)\.length/)
    for (const marker of [
      "t('db.del.total', '{n} tasks are associated with this sprint.')",
      "t('db.del.unassign', '{n} non-archived tasks will become unassigned (No sprint).')",
      // the snapshot label: "Sprint: <name> (deleted)" — spec §6's exact semantics
      /t\('db\.del\.archived', '\{n\} archived tasks stay archived, labeled "Sprint: \{name\} \(deleted\)"\.'\)/,
      "t('db.del.noDelete', 'No tasks will be deleted.')",
      "t('db.del.confirm', 'Delete Sprint')",
    ]) {
      expect(typeof marker === 'string' ? js.includes(marker) : marker.test(js), `devboard.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // total = the dev-task fold + the archived rows (the spec's 12 = 10 + 2 shape)
    expect(js).toContain('const total = fold.total + archivedN')
  })
})

describe('S243 — the H3 pause confirm (Screen H3) + the reopen flow', () => {
  it('pause stays the LIGHTWEIGHT hibana.confirm card with the stay-put message', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/async function confirmSprintPause\(s, opts\)/)
    expect(js).toMatch(/t\('db\.pauseConfirm', 'Pause \{name\}\? Tasks stay where they are and keep this sprint\.'\)/)
    expect(js).toMatch(/window\.hibana\.confirm\(msg, \{ title: label, confirmLabel: label \}\)/)
    expect(js).toMatch(/await pauseSprint\(s\.id\)\n\s+window\.hibana && window\.hibana\.toast\(t\('db\.sprintPaused', 'Sprint paused'\)/)
  })

  it('reopen rides the one-active guard too — the 409 resolves through the same conflict modal', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toMatch(/async function reopenSprintFlow\(id, opts\)/)
    expect(js).toMatch(/await reopenSprint\(id\)\n\s+window\.hibana && window\.hibana\.toast\(t\('db\.sprintReopened', 'Sprint reopened'\)/)
  })
})

describe('S243 — the Sprints page extension (D5 — Screens E/F)', () => {
  it('the lifecycle-grouped list: Active / Planned / Paused / Completed history, rows open the detail panel', () => {
    const js = readPublic('js/sprint-page.js')
    for (const marker of [
      "sp.sectionActive', 'Active'",
      "sp.sectionPlanned', 'Planned'",
      "sp.sectionPaused', 'Paused'",
      "sp.sectionCompleted', 'Completed history'",
      'data-sp-group="\' + g.key + \'"',
      // the row: glyph + name + lifecycle badge + count + due; opens the DETAIL panel
      `'<div class="sp-list-row" data-sp-open="' + esc(s.id) + '" role="button"`,
      // the ⋯ keeps the popover grammar (data-sprint-menu — the timeline chip's twin)
      `data-sprint-menu="' + esc(s.id) + '" aria-label="`,
      // the s206 pin survives: the REAL task count rides the row
      "S.tasks.filter((t) => t.sprint_id === s.id).length",
    ]) {
      expect(js.includes(marker), `sprint-page.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // the timeline STAYS (spec §7.3: the list is an addition) — renderTimeline survives
    expect(js).toContain('function renderTimeline()')
  })

  it('the detail panel: Settings + Tasks tabs, the settings PATCH, the archived history, the ?sprint= deep link', () => {
    const js = readPublic('js/sprint-page.js')
    for (const marker of [
      'function openSprintDetail(id, tab)',
      'data-sd-tab-settings',
      'data-sd-tab-tasks',
      // Settings: name + version + emoji picker + the read-only due date (Phase 5 owns the control)
      'data-sd-name',
      'data-sd-version',
      'data-sd-emoji-btn',
      'sp-detail-due',
      // the save PATCH carries name + version + emoji (explicit nulls clear)
      /patchBody = \{ name: nameVal, version: verVal \? verVal : null, emoji: emoji \? emoji : null \}/,
      // the rich description stays with the S33/S34 editor (extend, never duplicate)
      'sp-detail-plan',
      // Tasks: the five-lane fold + total + the per-lane rows
      'function laneTable(s)',
      "t('db.ov.total', 'Total')",
      // the completed sprint's archived history (the lazy archives list)
      'function archivedSection(s)',
      // the ?sprint= deep link (Screen G's Settings entry targets it)
      'const deep = qs.get(\'sprint\')',
    ]) {
      expect(typeof marker === 'string' ? js.includes(marker) : marker.test(js), `sprint-page.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // the footer lifecycle actions are status-gated (planned→Start, active→Pause+Finish,
    // paused→Resume, completed→Reopen; Delete only for the deletable set)
    expect(js).toMatch(/\(stx === 'planned' \? .*data-sd-start/)
    expect(js).toMatch(/\(stx === 'active' \? .*data-sd-pause/)
    expect(js).toMatch(/\(\(stx === 'planned' \|\| stx === 'paused'\) \? .*data-sd-del/)
  })

  it('the wiring: the draft Start is conflict-aware, Delete is the exact-counts modal, the toolbar Finish opens H2', () => {
    const js = readPublic('js/sprint-page.js')
    // the draft card
    expect(js).toMatch(/startSprintWithConflict\(draft\.id, \{ onDone: \(\) => \{ dayOffset = 0; reload\(\) \} \}\)/)
    expect(js).toMatch(/openSprintDelete\(draft, \{ projectId: projectId, onDone: reload \}\)/)
    // the toolbar Finish button
    expect(js).toMatch(/openSprintFinish\(open, \{ onDone: reload \}\)/)
    // the popover: status-aware actions (Pause/Resume join Finish/Reopen/Delete)
    expect(js).toContain('data-sp-pause')
    expect(js).toContain('data-sp-resume')
    expect(js).toMatch(/spBtn\.matches\('\[data-sp-finish\]'\)\) \{\n\s+const s = B\(\)\.findSprint\(id\)\n\s+closeSprintPop\(\)\n\s+if \(s\) B\(\)\.openSprintFinish\(s, \{ onDone: reload \}\)/)
    // the plain db.delSprintConfirm confirm is RETIRED on both surfaces
    expect(js).not.toContain("window.hibana.confirm(_t('db.delSprintConfirm'")
  })

  it('the DISTINCT paused timeline render (spec §5.5): the hatched band + the ⏸ chip', () => {
    const js = readPublic('js/sprint-page.js')
    expect(js).toContain("B().sprintStatusOf(g.s) === 'paused' // S243: the distinct paused render")
    expect(js).toContain("is-paused-band'")
    expect(js).toContain("(paused ? ' is-paused' : '')")
    expect(js).toContain("(paused ? '⏸ · ' : '')")
    const css = readPublic('css/devboard.css')
    expect(css).toContain('.sp-band.is-paused-band {')
    expect(css).toContain('.sp-sprint.is-paused .sp-sprint-chip {')
  })
})

describe('S243 — the compact Kanban overview (Screen G) on BOTH board surfaces', () => {
  it('board-page.js: the panel mounts from the LOADED payload — identity + state + five lanes + total + actions', () => {
    const js = readPublic('js/board-page.js')
    for (const marker of [
      'data-db-sprint-ov',
      "const ovSprint = filterSprint && filterSprint !== '__none' ? B().findSprint(filterSprint) : null",
      // the §12.5 client fold — ZERO new fetches
      'const fold = B().sprintLaneCounts(ovSprint.id)',
      // the actions the state permits + the Settings deep link
      'data-db-ov-start',
      'data-db-ov-resume',
      'data-db-ov-pause',
      'data-db-ov-finish',
      'data-db-ov-settings',
    ]) {
      expect(js.includes(marker), `board-page.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // the actions hand over to the SHARED stack with the page's own reload
    expect(js).toMatch(/B\(\)\.startSprintWithConflict\(s\.id, \{ onDone: reload \}\); return/)
    expect(js).toMatch(/B\(\)\.openSprintFinish\(s, \{ onDone: reload \}\); return/)
    // five lanes + total only — the statuses come from the shared STATUSES set,
    // never a percentage/burndown/workload value inside the overview block itself
    expect(js.match(/fold\.counts\[st\] \|\| 0/g)?.length).toBeGreaterThan(0)
    const ovBlock = js.slice(js.indexOf('let sprintOvHtml'), js.indexOf("'<div class=\"db-cols\"'"))
    expect(ovBlock).toBeTruthy()
    expect(ovBlock).not.toMatch(/percent|burndown|workload/)
  })

  it('project-page.js: the embedded board ships the SAME overview (the parity decision) — the ACCURATE fold (S243b: the fetched truth, never the 5-capped DOM)', () => {
    const js = readPublic('js/project-page.js')
    for (const marker of [
      'function pdRenderSprintOv()',
      'data-pd-sprint-ov',
      'data-pd-ov-start',
      'data-pd-ov-resume',
      'data-pd-ov-pause',
      'data-pd-ov-finish',
      'data-pd-ov-settings',
      // S243b: the fold's rows come from pdOvRows() — the FETCHED truth (accurate
      // past the MAX_VISIBLE=5-per-column render cap) with the DOM wraps' live
      // statuses overriding (a drag patches data-pd-status in place, no refresh)
      'const pdOvRows = () => {',
      // S245 moved the fold's row shape: due_at joined sprint_id + status (the J1
      // impact preview reads it) — the pin moves with it, the intent unchanged:
      // the rows are still the FETCHED truth + the DOM's live statuses
      "return pdTaskTruth.map((t) => ({ sprint_id: t.sprint_id ?? null, status: domStatus.get(t.id) || t.status || 'idea', due_at: t.due_at ?? null }))",
      // the fetched truth carries sprint_id + status (the fold's source)
      "sprint_id: t.sprint_id ?? null, status: t.status || 'idea',",
      // the shared stack carries the sprints pool + rows + projectId (state is NOT loaded here)
      'const opts = { sprints: pdSprintTruth, taskRows: pdOvRows(), projectId: id, onDone: bodyRefresh }',
      // the panel refreshes with the filter state on every apply
      'pdRenderSprintOv()',
    ]) {
      expect(js.includes(marker), `project-page.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
    // the DOM-only fold is GONE (it undercounted lanes past the 5-per-column cap)
    expect(js).not.toContain('taskRows: domRows')
    // the repaint reconciles status + sprint assignment onto the truth rows
    expect(js).toMatch(/truth\.status = t\.status \|\| 'idea'; truth\.sprint_id = t\.sprint_id \?\? null/)
  })

  it('the shared overview CSS exists (one sheet, both surfaces)', () => {
    const css = readPublic('css/devboard.css')
    for (const marker of ['.db-sprint-ov {', '.db-sprint-ov-counts {', '.db-sprint-ov-total {', '.db-sprintmod { z-index: 96; }', '.db-sprintdetail { z-index: 95; }']) {
      expect(css.includes(marker), `devboard.css must carry ${JSON.stringify(marker)}`).toBe(true)
    }
  })
})

describe('S243 — the archives list server twin (the delete preview\u2019s data source)', () => {
  it('GET /api/projects/:id/archives carries sprint_id + sprint_name_snapshot (additive) with a lagging-D1 belt', () => {
    const ts = readPublic('../src/routes/devboard.ts')
    expect(ts).toContain('SELECT id, title, priority, done_at, original_created_at, archived_at, tags, sprint_id, sprint_name_snapshot FROM project_archives')
    expect(ts).toContain('sprint_id: r.sprint_id, sprint_name_snapshot: r.sprint_name_snapshot')
    // the lagging-D1 belt (the taskDepsForProject precedent): a pre-0065 DB degrades, never 500s
    expect(ts).toMatch(/catch \{\n\s+rows = \(await cfg\.db\.query<Omit<ArchRow, 'sprint_name_snapshot'>>\(/)
  })
})

describe('S243 — i18n EN+FA parity for every new string', () => {
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
    'db.pauseSprint', 'db.resumeSprint', 'db.sprintPaused', 'db.sprintReopened',
    'db.sprintSt.active', 'db.sprintSt.planned', 'db.sprintSt.paused', 'db.sprintSt.completed',
    'db.pauseConfirm',
    'db.h1.title', 'db.h1.explain', 'db.h1.current', 'db.h1.starting',
    'db.h1.pauseStart', 'db.h1.finishStart', 'db.h1.finishNote', 'db.h1.stale', 'db.h1.dayBlocked',
    'db.h2.title', 'db.h2.willArchive', 'db.h2.unfinished', 'db.h2.noDelete', 'db.h2.confirm', 'db.h2.done',
    'db.del.title', 'db.del.total', 'db.del.unassign', 'db.del.archived', 'db.del.noDelete', 'db.del.confirm', 'db.del.done', 'db.del.active', 'db.del.completed',
    'db.ov.total', 'db.ov.settings', 'db.ov.due', 'db.ov.counts', 'db.dueDate',
    'sp.sectionActive', 'sp.sectionPlanned', 'sp.sectionPaused', 'sp.sectionCompleted',
    'sp.settingsTab', 'sp.tasksTab', 'sp.version', 'sp.openSettings', 'sp.quickActions',
    'sp.noDue', 'sp.archivedWhenFinished', 'sp.settingsSaved', 'sp.openPlanEditor', 'sp.planNote',
  ]

  it('every new key exists in BOTH dictionaries (written FA copy, not placeholders)', () => {
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
    // the FA copy is real Persian (Arabic-script characters), not EN echoes
    const faRaw = readPublic('js/i18n-fa.js')
    expect(faRaw).toMatch(/'db\.h1\.pauseStart': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.del\.archived': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.h2\.noDelete': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'sp\.sectionCompleted': '[^']*[؀-ۿ][^']*'/)
  })
})

describe('S243 — the desktop seam tripwires (the Phase 9 re-pin inventory)', () => {
  it('the fetch counts NEVER moved — every lifecycle call rides the shared api() wrapper', () => {
    expect((readPublic('js/devboard.js').match(/\bfetch\(/g) || []).length).toBe(7)
    expect((readPublic('js/board-page.js').match(/\bfetch\(/g) || []).length).toBe(4)
  })

  it('sw.js is at hibana-v458 with the S246 carrier note (the dependencies round moved the ladder; the pin intent is preserved, the carriers moved with it)', () => {
    const sw = readPublic('sw.js')
    expect(sw.includes('const VERSION = "hibana-v458"')).toBe(true)
    expect(sw.includes('// v458 (S246)')).toBe(true)
    // the carrier bumps the note records (S246's round: devboard v36, board-page v33,
    // project-page v84, sprint-page v27, the i18n-fa v104 injector literal)
    expect(sw).toMatch(/devboard\.js v36/)
    expect(sw).toMatch(/i18n-fa\.js\?v=104/)
  })
})
