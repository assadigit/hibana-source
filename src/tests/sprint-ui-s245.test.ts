import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

// S245 — the spec pack's Phase 6 client + server round (the deadline EXTENSION
// flows). The whole mechanics already existed as PATCH orchestration over the
// Phase 1+2 write surface (contract §12.1/§12.4); this suite pins what Phase 6
// ADDED:
//   1. The PRESET MATH (§13.1): +24/+48/+72 ADD TO THE EXISTING deadline —
//      never to the current moment (behavioral, with a frozen `now`).
//   2. The IMPACT FOLD (§13.2): sprint tasks with due_at == null INHERIT and
//      follow; due_at != null are PROTECTED — the §12.5-style payload fold.
//   3. The ROUTING (task 4): a personal deadline → J2's picker; a sprint-sourced
//      row → J3's CHOICE modal; no effective deadline → nothing.
//   4. The ORIGIN PRESERVATION on all three flows (§13.2/§13.3/§13.4): J1 and J2
//      ride value→value PATCHes (the server preserves due_origin_at by rule);
//      J3's task-only arm rides the ADDITIVE due_origin_at body field — the
//      kickoff's recorded decision — honored by the server ONLY on the null→value
//      transition it creates (the S245 server round; pinned here against the
//      real app + the real migrations).
//   5. i18n EN+FA parity for every new string (written Persian).
//   6. The desktop seam tripwires (the Phase 9 re-pin inventory): ZERO new
//      fetch sites — the extension flows ride patchSprint/patchTask.
//
// Doctrine: the s242/s243/s244 source-pin style (vitest runs in node; nothing
// imports public/js — the real files are read byte-for-byte) EXTENDED with the
// s244 VM sandbox for the behavioral preset/fold pins + the domain suite's app
// harness for the server ride-along.

const readPublic = (rel: string) => readFileSync(join(process.cwd(), 'public', rel), 'utf8')

/** Executes the vendored jalaali + devboard.js in one VM sandbox (the s244
 * pattern) — window.HibanaBoard comes out live, its helpers callable with
 * deterministic `now` values. */
function loadBoardLib(stubI18n?: { t?: (k: string) => string; lang?: () => string }) {
  const sandbox: Record<string, unknown> = {
    window: {},
    document: { addEventListener() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console,
  }
  const win = sandbox.window as Record<string, unknown>
  runInNewContext(readPublic('vendor/jalaali.min.js'), sandbox, { filename: 'jalaali.min.js' })
  runInNewContext(readPublic('js/devboard.js'), sandbox, { filename: 'devboard.js' })
  if (stubI18n) {
    win.hibanaI18n = stubI18n
    if (!stubI18n.t) win.hibanaI18n = { t: (k: string) => k, lang: stubI18n.lang ?? (() => 'en') }
  }
  const B = win.HibanaBoard as Record<string, (...args: unknown[]) => unknown>
  if (!B) throw new Error('window.HibanaBoard did not load')
  return B
}

// ---------------------------------------------------------------- §13.1 presets

describe('S245 — the extension preset math (§13.1: add to the EXISTING deadline)', () => {
  it('a preset ADDS TO THE EXISTING deadline — never to the current moment (frozen now proves it)', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown) => string | null>
    const base = '2026-11-10T23:59:59.999Z' // an arbitrary stored deadline
    // +48h on the base = the base + exactly 48 hours, byte-stable ISO
    expect(B.extendPresetDue(base, 48)).toBe('2026-11-12T23:59:59.999Z')
    // +24h and +72h likewise — hour-exact arithmetic, no day-rounding
    expect(B.extendPresetDue(base, 24)).toBe('2026-11-11T23:59:59.999Z')
    expect(B.extendPresetDue(base, 72)).toBe('2026-11-13T23:59:59.999Z')
    // the now-proof: the same base extended at two DIFFERENT current moments
    // (6h apart) yields the SAME result — a now-based math would differ
    const realNow = Date.now
    try {
      Date.now = () => Date.parse('2026-11-06T00:00:00.000Z')
      const a = B.extendPresetDue(base, 48)
      Date.now = () => Date.parse('2026-11-06T06:00:00.000Z')
      const b = B.extendPresetDue(base, 48)
      expect(a).toBe(b)
      expect(a).toBe('2026-11-12T23:59:59.999Z')
    } finally {
      Date.now = realNow
    }
  })

  it('degenerate inputs answer null (no base, no hours, negative hours) — the callers belt', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown) => string | null>
    expect(B.extendPresetDue(null, 48)).toBe(null)
    expect(B.extendPresetDue('not-a-date', 48)).toBe(null)
    expect(B.extendPresetDue('2026-11-10T23:59:59.999Z', 0)).toBe(null)
    expect(B.extendPresetDue('2026-11-10T23:59:59.999Z', -24)).toBe(null)
  })

  it('the source pins the hour scale (the same arithmetic the S244 control\'s own presets use)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain('return new Date(base + hours * 3600000).toISOString()')
  })
})

// ---------------------------------------------------------------- §13.2 the fold

describe('S245 — the impact fold (§13.2: inheritors follow, overrides protected)', () => {
  it('sprint tasks with due_at == null INHERIT; due_at != null are PROTECTED; other sprints + no-sprint rows never count', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown) => { inheritors: number; overrides: number }>
    const S1 = 'sprint-1'
    const rows = [
      { id: 'a', sprint_id: S1, due_at: null, status: 'idea' },      // inheritor
      { id: 'b', sprint_id: S1, due_at: null, status: 'done' },      // inheritor (any lane — the association is the count)
      { id: 'c', sprint_id: S1, due_at: '2026-11-20T00:00:00.000Z' }, // protected (personal override)
      { id: 'd', sprint_id: 'sprint-2', due_at: null },               // another sprint — never counts
      { id: 'e', sprint_id: null, due_at: null },                     // no sprint — never counts
    ]
    const impact = B.sprintDeadlineImpact(S1, rows)
    expect(impact.inheritors).toBe(2)
    expect(impact.overrides).toBe(1)
  })

  it('the fold defaults to the loaded payload (state.tasks — the /kanban twin)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain('const sprintDeadlineImpact = (sprintId, taskRows) => {')
    expect(js).toContain('const rows = taskRows || state.tasks')
  })

  it('the embedded twin folds the FETCHED truth — pdOvRows carries due_at (the S243b doctrine, never the 5-capped DOM)', () => {
    const js = readPublic('js/project-page.js')
    expect(js).toContain('return pdTaskTruth.map((t) => ({ sprint_id: t.sprint_id ?? null, status: domStatus.get(t.id) || t.status || \'idea\', due_at: t.due_at ?? null }))')
    // the fetched truth carries the due fields + the effective triple (J2/J3's routing)
    expect(js).toContain('title: t.title || \'\', due_at: t.due_at ?? null,')
    expect(js).toContain('effective_due_source: t.effective_due_source ?? null,')
  })
})

// ------------------------------------------------------- the routing + the flows

describe('S245 — the affordance routing + the three flows (Screens J1/J2/J3)', () => {
  it('the router: personal (due_at set) → J2\'s picker; sprint-sourced → J3\'s CHOICE modal; no effective deadline → nothing', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain('if (task.due_at != null) { openTaskExtendDialog(task, opts); return }')
    expect(js).toContain("if (task.effective_due_source === 'sprint' && task.effective_due_at) { openInheritedExtendChoice(task, opts); return }")
    // the router's body holds EXACTLY the two guards — a no-deadline task opens
    // NOTHING (extracted to the next top-level section marker)
    const start = js.indexOf('function openTaskDeadlineExtend')
    const end = js.indexOf('label manager', start)
    const router = js.slice(start, end)
    const guardCount = (router.match(/\bif \(task\./g) || []).length
    expect(guardCount).toBe(2)
  })

  it('J1 (§13.2): the sprint dialog PATCHes {due_at} ONLY — value→value, the server preserves due_origin_at by rule', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain("await patchSprint(s.id, { due_at: newIso }) // value→value — due_origin_at preserved (§13.2)")
    // never a ride-along on the sprint arm (the sprint HAS an origin to preserve)
    expect(js).not.toContain('patchSprint(s.id, { due_at: newIso, due_origin_at')
  })

  it('J2 (§13.3): the personal picker PATCHes {due_at} ONLY — value→value preserves the task\'s own origin', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain("await patchTask(task.id, { due_at: newIso }) // value→value — origin preserved (§13.3)")
  })

  it('J3 task-only (§13.4): the override creation rides the SPRINT\'S effective_due_origin_at — the additive ride-along, never a reset', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain('const body = { due_at: newIso }')
    expect(js).toContain('if (task.effective_due_origin_at) body.due_origin_at = task.effective_due_origin_at')
    expect(js).toContain('await patchTask(task.id, body)')
  })

  it('J3\'s choice modal: two clearly distinct arms with the scope visible (the counts in the sprint arm\'s sub-line), reusing J1 for sprint-wide', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain("openSprintDeadlineExtend(sprint, o) // the J1 dialog with its full impact preview")
    expect(js).toContain('data-ext-arm-sprint')
    expect(js).toContain('data-ext-arm-task')
    // the scope sub-lines quote the fold's counts
    expect(js).toContain("t('db.ext.choiceSprintSub', 'Moves every task inheriting it — {n} follow, {m} protected.')")
    expect(js).toContain("t('db.ext.choiceTaskSub', 'Creates a personal deadline for this task, based on the inherited one. Other tasks stay unchanged.')")
  })

  it('J1\'s dialog shows the impact counts BEFORE the Confirm (§13.2) + the origin note (§13.2/§13.3/§13.4)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain("t('db.ext.inherit', '{n} tasks inherit this deadline and follow the extension.')")
    expect(js).toContain("t('db.ext.protected', '{n} tasks are protected by personal deadlines and stay unchanged.')")
    expect(js).toContain("t('db.ext.originNote', 'The progress start point is preserved.')")
  })

  it('the four choices ship (+24/+48/+72/Custom) and Custom mounts the SHARED control pre-loaded with the current value (D6)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain("chip('24', t('db.ext.p24', '+24 hours'))")
    expect(js).toContain("chip('48', t('db.ext.p48', '+48 hours'))")
    expect(js).toContain("chip('72', t('db.ext.p72', '+72 hours'))")
    expect(js).toContain("chip('custom', t('db.ext.custom', 'Custom date'))")
    expect(js).toContain('window.HibanaDueControl.create({ value: cfg.baseIso })')
    // the wiring contract: the choices container MUST carry data-ext-choices (the
    // delegated onclick binds to it — the e2e-debugged regression this pins: a
    // class-only div left the wiring null-crashed and the confirm dead)
    expect(js).toContain('<div class="db-ext-choices" data-ext-choices role="group"')
    expect(js).toContain("el.querySelector('[data-ext-choices]').onclick")
  })

  it('the deadline row + the task view row carry the Extend affordance (data-db-extend) in the SHARED stack', () => {
    const js = readPublic('js/devboard.js')
    expect((js.match(/class="db-due-ext" data-db-extend="/g) || []).length).toBe(2) // deadlineRowHtml + deadlineViewHtml
  })

  it('the anchors: the popover rewires to J1 (the prompt flow is GONE), the overview + settings + modal link ship', () => {
    const sp = readPublic('js/sprint-page.js')
    expect(sp).toContain('B().openSprintDeadlineExtend(s, { onDone: reload })')
    expect(sp).not.toContain('window.prompt(_t(\'db.extendPrompt\'')
    expect(sp).toContain('data-sd-extend')
    const bp = readPublic('js/board-page.js')
    expect(bp).toContain("e.target.closest('[data-db-ov-extend]')")
    expect(bp).toContain("e.target.closest('[data-db-extend]')")
    const pp = readPublic('js/project-page.js')
    expect(pp).toContain('[data-pd-ov-extend]')
    expect(pp).toContain('openTaskDeadlineExtend(task, { sprints: pdSprintTruth, taskRows: pdOvRows(), projectId: id, onDone: bodyRefresh })')
    // the Edit modal's due-field link
    expect(readPublic('js/devboard.js')).toContain('data-db-due-extend-link')
  })

  it('the dialogs\' current-deadline line reuses the S244 render stack\'s wording (never a re-derivation)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain('const deadlineSummary = (iso, lang, nowMs) => {')
    expect(js).toContain('return deadlineLabel(row, deadlineStateOf(row, nowMs), nowMs, lang)')
  })
})

// --------------------------------------------- the server ride-along (§13.4, S245)

describe('S245 — the due_origin_at ride-along on the task PATCH (the real app + migrations)', () => {
  // the domain suite's harness, verbatim (helpers + createApp + session cookie)
  async function makeAppFixture() {
    const { makeTestDb, makeUser } = await import('./helpers')
    const { createSession } = await import('../auth/sessions')
    const { createApp } = await import('../app')
    const { db, close } = makeTestDb()
    const userId = await makeUser(db) // makeUser returns the id
    const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
    const token = await createSession(db, userId)
    const headers = { 'Content-Type': 'application/json', Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' }
    return { app, headers, close }
  }

  it('null→value WITH the ride-along stamps the CLIENT origin (the J3 task-only arm — the sprint\'s start point rides)', async () => {
    const { app, headers, close } = await makeAppFixture()
    try {
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'P' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const task = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify({ title: 'T' }) }))
      const tid = ((await task.json()) as { id: string }).id
      const sprintOrigin = '2026-11-01T10:00:00.000Z' // the sprint's due_origin_at
      const res = await app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify({ due_at: '2026-11-20T23:59:59.999Z', due_origin_at: sprintOrigin }) }))
      expect(res.status).toBe(200)
      const board = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { tasks: { id: string; due_at: string | null; due_origin_at: string | null }[] }
      const row = board.tasks.find((t) => t.id === tid)!
      expect(row.due_at).toBe('2026-11-20T23:59:59.999Z')
      expect(row.due_origin_at).toBe(sprintOrigin) // THE §13.4 INVARIANT: the bar does not reset
    } finally { close() }
  })

  it('null→value WITHOUT the ride-along stamps now (the pre-S245 behavior, unchanged)', async () => {
    const { app, headers, close } = await makeAppFixture()
    try {
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'P' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const task = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify({ title: 'T' }) }))
      const tid = ((await task.json()) as { id: string }).id
      const before = Date.now()
      const res = await app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify({ due_at: '2026-11-20T23:59:59.999Z' }) }))
      expect(res.status).toBe(200)
      const board = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { tasks: { id: string; due_origin_at: string | null }[] }
      const row = board.tasks.find((t) => t.id === tid)!
      expect(row.due_origin_at).toBeTruthy()
      expect(Date.parse(row.due_origin_at!)).toBeGreaterThanOrEqual(before - 5000)
    } finally { close() }
  })

  it('value→value IGNORES the ride-along (an extension is not a re-assignment — the stored origin wins)', async () => {
    const { app, headers, close } = await makeAppFixture()
    try {
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'P' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const task = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify({ title: 'T', due_at: '2026-11-15T23:59:59.999Z' }) }))
      const tid = ((await task.json()) as { id: string }).id
      const board0 = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { tasks: { id: string; due_origin_at: string | null }[] }
      const origin0 = board0.tasks.find((t) => t.id === tid)!.due_origin_at
      // the J2 flow never sends the ride-along; a rogue client sending one is IGNORED
      const res = await app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify({ due_at: '2026-11-18T23:59:59.999Z', due_origin_at: '2020-01-01T00:00:00.000Z' }) }))
      expect(res.status).toBe(200)
      const board = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { tasks: { id: string; due_at: string | null; due_origin_at: string | null }[] }
      const row = board.tasks.find((t) => t.id === tid)!
      expect(row.due_at).toBe('2026-11-18T23:59:59.999Z')       // the extension landed
      expect(row.due_origin_at).toBe(origin0)                     // the origin SURVIVED (not 2020)
    } finally { close() }
  })

  it('value→null clears BOTH (the ride-along ignored); a ride-along alone is a no-op (never a column leak)', async () => {
    const { app, headers, close } = await makeAppFixture()
    try {
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'P' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const task = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify({ title: 'T', due_at: '2026-11-15T23:59:59.999Z' }) }))
      const tid = ((await task.json()) as { id: string }).id
      const res = await app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify({ due_at: null, due_origin_at: '2020-01-01T00:00:00.000Z' }) }))
      expect(res.status).toBe(200)
      const board = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { tasks: { id: string; due_at: string | null; due_origin_at: string | null }[] }
      const row = board.tasks.find((t) => t.id === tid)!
      expect(row.due_at).toBe(null)
      expect(row.due_origin_at).toBe(null)
      // the ride-along alone: a clean 200, no due change, no column leak
      const res2 = await app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify({ due_origin_at: '2021-06-01T00:00:00.000Z' }) }))
      expect(res2.status).toBe(200)
      const board2 = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { tasks: { id: string; due_origin_at: string | null }[] }
      expect(board2.tasks.find((t) => t.id === tid)!.due_origin_at).toBe(null)
    } finally { close() }
  })

  it('the sprint-wide arm (J1) preserves the sprint\'s own origin across a value→value PATCH — §13.2 end-to-end', async () => {
    const { app, headers, close } = await makeAppFixture()
    try {
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'P' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const sprint = await app.fetch(new Request(`http://local/api/projects/${pid}/sprints`, { method: 'POST', headers, body: JSON.stringify({ name: 'S', started_at: new Date().toISOString(), ended_at: new Date(Date.now() + 7 * 86400000).toISOString(), due_at: '2026-11-15T23:59:59.999Z' }) }))
      const sid = ((await sprint.json()) as { id: string }).id
      const board0 = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { sprints: { id: string; due_origin_at: string | null }[] }
      const origin0 = board0.sprints.find((s) => s.id === sid)!.due_origin_at
      expect(origin0).toBeTruthy()
      // J1's exact call: PATCH {due_at} only — the +48h preset math client-side
      const newDue = new Date(Date.parse('2026-11-15T23:59:59.999Z') + 48 * 3600000).toISOString()
      const res = await app.fetch(new Request(`http://local/api/sprints/${sid}`, { method: 'PATCH', headers, body: JSON.stringify({ due_at: newDue }) }))
      expect(res.status).toBe(200)
      const board = await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json() as { sprints: { id: string; due_at: string | null; due_origin_at: string | null }[] }
      const row = board.sprints.find((s) => s.id === sid)!
      expect(row.due_at).toBe(newDue)
      expect(row.due_origin_at).toBe(origin0) // §13.2: the progress start point is NOT reset
    } finally { close() }
  })
})

// ------------------------------------------------------------------- i18n parity

describe('S245 — i18n EN+FA parity for every new string', () => {
  function loadDict(file: string, varName: string): Record<string, unknown> {
    const src = readFileSync(join(process.cwd(), 'public/js', file), 'utf8')
    const sandbox: Record<string, unknown> = { window: {} }
    runInNewContext(src, sandbox, { filename: file, timeout: 5000 })
    const dict = (sandbox.window as Record<string, Record<string, unknown>>)[varName]
    if (!dict || typeof dict !== 'object') throw new Error(`could not load ${varName}`)
    return dict
  }

  const NEW_KEYS = [
    'db.ext.extendHint', 'db.ext.sprintTitle', 'db.ext.taskTitle', 'db.ext.choiceTitle',
    'db.ext.current', 'db.ext.newDeadline', 'db.ext.choicesLabel',
    'db.ext.p24', 'db.ext.p48', 'db.ext.p72', 'db.ext.custom',
    'db.ext.pickHint', 'db.ext.pickCustom',
    'db.ext.inherit', 'db.ext.protected', 'db.ext.onlyTask', 'db.ext.originNote',
    'db.ext.confirm', 'db.ext.done', 'db.ext.noDue',
    'db.ext.inherits', 'db.ext.inheritedBase',
    'db.ext.choiceSprint', 'db.ext.choiceSprintSub', 'db.ext.choiceTask', 'db.ext.choiceTaskSub',
  ]

  it('every new key exists in BOTH dictionaries (written FA copy, not placeholders); the retired prompt key is GONE from both', () => {
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
    expect(enKeys.has('db.extendPrompt')).toBe(false)
    expect(faKeys.has('db.extendPrompt')).toBe(false)
    // the FA copy is real Persian (Arabic-script characters), not EN echoes
    const faRaw = readPublic('js/i18n-fa.js')
    expect(faRaw).toMatch(/'db\.ext\.sprintTitle': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.ext\.onlyTask': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.ext\.originNote': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.ext\.choiceSprintSub': '[^']*[؀-ۿ][^']*'/)
  })
})

// ------------------------------------------------------- the seam + ladder pins

describe('S245 — the desktop seam tripwires + the ladder (the Phase 9 re-pin inventory)', () => {
  it('the fetch counts NEVER moved — the extension flows ride patchSprint/patchTask (ZERO new fetch sites)', () => {
    expect((readPublic('js/devboard.js').match(/\bfetch\(/g) || []).length).toBe(7)
    expect((readPublic('js/board-page.js').match(/\bfetch\(/g) || []).length).toBe(3) // S258 (FE-11): the clear-done fan-out retired — the bulk api() call replaced it
  })

  it('sw.js is at hibana-v465 with the S260 carrier note (the S259-finding micro-fix moved the ladder; the S245 pin intent is preserved, the carriers moved with it)', () => {
    const sw = readPublic('sw.js')
    expect(sw.includes('const VERSION = "hibana-v465"')).toBe(true)
    expect(sw.includes('// v465 (S260)')).toBe(true)
    expect(sw).toMatch(/devboard\.js v36/)
    expect(sw).toMatch(/board-page\.js v33/)
    expect(sw).toMatch(/project-page\.js v84/)
    expect(sw).toMatch(/sprint-page\.js v28/)
    expect(sw).toMatch(/devboard\.css v46/)
    expect(sw).toMatch(/i18n-en\.js v111 \+ i18n\.js v164/)
    expect(sw).toMatch(/i18n-fa\.js\?v=105/)
  })

  it('the lazy devboard injector literals moved to v41 (the s242v33 lesson: the check reads them — S260 moved them from v40)', () => {
    expect(readPublic('js/board-page.js').includes('/js/devboard.js?v=41')).toBe(true)
    expect(readPublic('js/sprint-page.js').includes('/js/devboard.js?v=41')).toBe(true)
    expect(readPublic('js/project-page.js').includes('/js/devboard.js?v=41')).toBe(true)
  })

  it('the Extend affordance is byte-identical across the client stack + the detail-helpers server twin (the S209 parity seam)', () => {
    const client = readPublic('js/devboard.js')
    const server = readPublic('../src/routes/projects/detail-helpers.ts')
    const needle = 'class="db-due-ext" data-db-extend="'
    expect(client.includes(needle)).toBe(true)
    expect(server.includes(needle)).toBe(true)
    // the glyph markup matches (the same outward-arrow svg)
    expect(client).toContain('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>')
    expect(server).toContain('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>')
  })
})
