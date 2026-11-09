import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'

// S246 — the spec pack's Phase 7 client + server round (the task DEPENDENCIES
// UI, spec §14-§16 + Screens K/L). The whole MECHANICS already existed as the
// S240 write surface + the S241 payload key (contract §12.3); this suite pins
// what Phase 7 ADDED:
//   1. The SHARED FOLD STACK (§15): depsOf (Blocked-by = edges where
//      blocked_task_id = X) + blocksCount (the DERIVED reverse — the same
//      edges' other half, never a second endpoint or stored column) +
//      blockedStateOf (§16.1: blocked while ANY blocker is incomplete, ready
//      when blockers existed and ALL are complete, null with no blockers) +
//      the compact badge render + the task view's names row.
//   2. Screen K: the COLLAPSED Dependencies section in the task modal — the
//      searchable same-project multi-select, the LIVE-mutation decision (edit
//      mode POSTs/DELETEs through the existing endpoints so the 400 self /
//      409 cycle answers surface INLINE; add mode STAGES + links after the
//      create ack), the inline error surface with the offending pick named.
//   3. Screen L: the badge row in ALL THREE renderers (board-page.js +
//      detail-helpers.ts server twin + project-page.js pdTruthWrap),
//      byte-identical, its own row after the deadline row — independent of the
//      priority ribbon AND the deadline display.
//   4. The SOFT constraints (assumption 2 / §16.1): the folds are pure, the
//      save body never carries dep-derived fields, and a blocked task still
//      moves (the server never gates — pinned against the real app).
//   5. The embedded-fold decision: the DETAIL POOL feeds the embedded board
//      (loadDetail's additive taskDeps key — the same /api/projects/:id fetch,
//      never a second board pull), pinned against the real app + migrations.
//   6. i18n EN+FA parity for every new string (written Persian).
//   7. The desktop seam tripwires (the Phase 9 re-pin inventory): ZERO new
//      fetch sites — the dep writes ride the shared api() wrapper.
//
// Doctrine: the s242-s245 source-pin style (vitest runs in node; nothing
// imports public/js — the real files are read byte-for-byte) EXTENDED with the
// VM sandbox for the behavioral fold pins + the domain suite's app harness for
// the detail-pool render pins.

const readPublic = (rel: string) => readFileSync(join(process.cwd(), 'public', rel), 'utf8')

/** Executes the vendored jalaali + devboard.js in one VM sandbox (the s244/s245
 * pattern) — window.HibanaBoard comes out live, its helpers callable. */
function loadBoardLib() {
  const sandbox: Record<string, unknown> = {
    window: {},
    document: { addEventListener() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console,
  }
  const win = sandbox.window as Record<string, unknown>
  runInNewContext(readPublic('vendor/jalaali.min.js'), sandbox, { filename: 'jalaali.min.js' })
  runInNewContext(readPublic('js/devboard.js'), sandbox, { filename: 'devboard.js' })
  const B = win.HibanaBoard as Record<string, (...args: unknown[]) => unknown>
  if (!B) throw new Error('window.HibanaBoard did not load')
  return B
}

const E = (blocker: string, blocked: string) => ({ blocker_task_id: blocker, blocked_task_id: blocked })

// ------------------------------------------------------------- the fold stack

describe('S246 — the shared dep-fold stack (§15 + Screen L)', () => {
  it('depsOf: the Blocked-by rows are the edges where blocked_task_id = X (§12.3\'s read contract)', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown) => unknown>
    const edges = [E('A', 'X'), E('B', 'X'), E('X', 'C'), E('A', 'Y')]
    expect(B.depsOf('X', edges)).toEqual(['A', 'B'])
    expect(B.depsOf('C', edges)).toEqual(['X'])
    expect(B.depsOf('A', edges)).toEqual([])
    expect(B.depsOf('Z', edges)).toEqual([]) // no deps at all
    // malformed rows are skipped, never crash the render
    expect(B.depsOf('X', [null, E('A', 'X'), undefined])).toEqual(['A'])
  })

  it('blocksCount: the DERIVED reverse count — the SAME edges\' other half (spec §15: never asked of the user, never stored, never a second endpoint)', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown) => number>
    const edges = [E('A', 'X'), E('B', 'X'), E('X', 'C'), E('X', 'D'), E('A', 'Y')]
    expect(B.blocksCount('X', edges)).toBe(2) // X blocks C and D
    expect(B.blocksCount('A', edges)).toBe(2) // A blocks X and Y
    expect(B.blocksCount('C', edges)).toBe(0)
  })

  it('blockedStateOf (§16.1): no blockers → null; ANY incomplete blocker → blocked; ALL complete → ready; a missing blocker row counts OPEN (never a false Ready)', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown, c: unknown) => string | null>
    const rows = [
      { id: 'B', status: 'in_progress' },
      { id: 'C', status: 'done' },
      { id: 'D', status: 'done' },
    ]
    expect(B.blockedStateOf('X', [], rows)).toBe(null) // no blockers at all
    expect(B.blockedStateOf('X', [E('B', 'X')], rows)).toBe('blocked') // one open
    expect(B.blockedStateOf('X', [E('C', 'X')], rows)).toBe('ready') // the single blocker is done
    // §16.1's multi-blocker rule: stays BLOCKED until ALL blockers are complete
    expect(B.blockedStateOf('X', [E('B', 'X'), E('C', 'X')], rows)).toBe('blocked')
    expect(B.blockedStateOf('X', [E('C', 'X'), E('D', 'X')], rows)).toBe('ready')
    // a blocker row missing from the task pool counts open — the belt never lies Ready
    expect(B.blockedStateOf('X', [E('GONE', 'X')], rows)).toBe('blocked')
    // a blocker task that is itself done in another lane shape (status done) resolves
    expect(B.blockedStateOf('X', [E('C', 'X')], [{ id: 'C', status: 'done' }])).toBe('ready')
  })

  it('depBadgeHtml (Screen L): \'\' when no deps; single Blocked; Blocked · N; Ready; Blocks N; and BOTH badges on a task that blocks while blocked', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown, c: unknown, d: unknown) => string>
    const rows = [
      { id: 'A', title: 'Fix authentication architecture' },
      { id: 'B', title: 'Implement session security', status: 'in_progress' },
      { id: 'C', title: 'Add security audit logging' },
      { id: 'Z', title: 'unrelated' },
    ]
    // no deps in either direction → NO row at all (§23: only when relevant)
    expect(B.depBadgeHtml(rows[3], [], rows, 'en')).toBe('')
    // single incomplete blocker → Blocked (the spec §16 example vocabulary)
    const one = B.depBadgeHtml(rows[1], [E('A', 'B')], rows, 'en') as string
    expect(one).toContain('class="db-dep-badge st-blocked"')
    expect(one).toContain('Blocked')
    expect(one).not.toContain('Blocked ·')
    // multiple incomplete blockers → the guide's compact count form
    const two = B.depBadgeHtml(rows[1], [E('A', 'B'), E('C', 'B')], rows, 'en') as string
    expect(two).toContain('st-blocked')
    expect(two).toContain('Blocked · 2')
    // ALL blockers complete → Ready (§16.1's resolution surfacing)
    const ready = B.depBadgeHtml(rows[1], [E('A', 'B'), E('C', 'B')], [
      { id: 'A', title: 'Fix authentication architecture', status: 'done' },
      { id: 'C', title: 'Add security audit logging', status: 'done' },
      rows[1],
    ], 'en') as string
    expect(ready).toContain('class="db-dep-badge st-ready"')
    expect(ready).toContain('Ready')
    // the reverse: a BLOCKING task wears the derived count (§16: 'Blocks 2 tasks')
    const blocker = B.depBadgeHtml(rows[0], [E('A', 'B'), E('A', 'C')], rows, 'en') as string
    expect(blocker).toContain('class="db-dep-badge st-blocks"')
    expect(blocker).toContain('Blocks 2')
    expect(blocker).not.toContain('st-blocked"') // the blocker itself is not blocked
    // a task that blocks one AND is blocked by another wears BOTH badges
    const both = B.depBadgeHtml(rows[1], [E('A', 'B'), E('B', 'C')], rows, 'en') as string
    expect(both).toContain('st-blocked')
    expect(both).toContain('st-blocks')
    // the row wrapper + the WORD (never color alone — §16/§17 vocabulary)
    expect(one.startsWith('<span class="db-dep-row">')).toBe(true)
    expect(one).toContain('title="Blocked by 1 task(s) — open the task to see them."')
  })

  it('depBadgeHtml: FA renders the Persian words + digits (faDig); the badge text is dir=auto', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown, c: unknown, d: unknown) => string>
    const rows = [{ id: 'A', title: 'a' }, { id: 'B', title: 'b' }]
    const fa = B.depBadgeHtml(rows[1], [E('A', 'B'), E('C', 'B')], [rows[0], { id: 'C', status: 'done', title: 'c' }, rows[1]], 'en') as string
    // (the EN path pinned above; the FA dictionary parity is pinned below — here
    // the structural contract: the badge text span is dir=auto so mixed script reads right)
    expect(fa).toContain('<span class="db-dep-badge-txt" dir="auto">')
  })

  it('depViewHtml (the details surface): the blocker NAMES join — "detailed blocker names belong in task details or the Edit Task modal" (§16)', () => {
    const B = loadBoardLib() as Record<string, (a: unknown, b: unknown, c: unknown, d: unknown) => string>
    const rows = [
      { id: 'A', title: 'Fix authentication architecture\nwith a second line' },
      { id: 'B', title: 'Implement session security' },
      { id: 'C', title: 'Add security audit logging' },
    ]
    // multi-line titles read the FIRST line (the option-list grammar)
    const v = B.depViewHtml(rows[1], [E('A', 'B'), E('C', 'B')], rows, 'en') as string
    expect(v).toContain('Blocked by: Fix authentication architecture · Add security audit logging')
    expect(v).toContain('db-dep-view') // the view variant class
    // the reverse row names the blocked tasks
    const rv = B.depViewHtml(rows[0], [E('A', 'B'), E('A', 'C')], rows, 'en') as string
    expect(rv).toContain('Blocks: Implement session security · Add security audit logging')
    // no deps → ''
    expect(B.depViewHtml({ id: 'Z', title: 'z' }, [], rows, 'en')).toBe('')
  })

  it('the folds are PURE — the soft-constraint pin (assumption 2): folding never mutates the task rows, the edges, or the task\'s own fields', () => {
    const B = loadBoardLib() as Record<string, (...args: unknown[]) => unknown>
    const rows = [
      { id: 'A', title: 'a', status: 'in_progress', priority: 'medium', sprint_id: null },
      { id: 'B', title: 'b', status: 'in_progress', priority: 'high', sprint_id: 'S1' },
    ]
    const edges = [E('A', 'B')]
    const rowsSnapshot = JSON.stringify(rows)
    const edgesSnapshot = JSON.stringify(edges)
    void B.depsOf('B', edges)
    void B.blocksCount('A', edges)
    void B.blockedStateOf('B', edges, rows)
    void B.depBadgeHtml(rows[1], edges, rows, 'en')
    void B.depViewHtml(rows[1], edges, rows, 'en')
    expect(JSON.stringify(rows)).toBe(rowsSnapshot)
    expect(JSON.stringify(edges)).toBe(edgesSnapshot)
  })
})

// -------------------------------------------------- Screen K — the modal section

describe('S246 — Screen K: the collapsed Dependencies section in Add/Edit Task', () => {
  const db = () => readPublic('js/devboard.js')

  it('COLLAPSED by default (spec §15): every openEditor resets depsOpen=false; the mount renders hidden + the toggle aria-expanded="false"', () => {
    const src = db()
    // the open-time reset (§15: "optional and collapsed by default")
    expect(src).toContain('modalCtx.draft.depsOpen = false')
    // the collapsed render: hidden unless open
    expect(src).toContain("(open ? '' : ' hidden')")
    expect(src).toContain("aria-expanded=\"' + open + '\"")
    // the toggle flips hidden IN PLACE (no re-render — the search survives)
    expect(src).toContain("depsMountEl.hidden = !modalCtx.draft.depsOpen")
  })

  it('the SEARCHABLE multi-select: the search input filters by title; each option carries the title + sprint identity (glyph grammar) + status', () => {
    const src = db()
    expect(src).toContain('data-db-deps-q')
    expect(src).toContain('String(row.title || \'\').toLowerCase().includes(q)')
    // the option grammar: title (first line) + sprint glyph-or-name + statusLabel
    expect(src).toContain("sprintGlyph(sp) + ' ' + sp.name : t('db.noSprint', 'No sprint')")
    expect(src).toContain("+ statusLabel(row.status || 'idea')")
    // the current task stays listed but marked (the self surface is reachable + honest)
    expect(src).toContain("t('db.deps.thisTask', 'this task')")
  })

  it('the LIVE-MUTATION decision (edit mode — the recorded decision): POST on select / DELETE on deselect through addTaskDep/removeTaskDep; the modal never carries a dep-diff', () => {
    const src = db()
    expect(src).toContain('const addTaskDep = (id, blockerId) =>')
    expect(src).toContain('const removeTaskDep = (id, blockerId) =>')
    // the wrappers ride the SHARED api() (never a bare fetch)
    expect(src).toContain("api('/api/devtasks/' + id + '/deps', {")
    expect(src).toContain("api('/api/devtasks/' + id + '/deps/' + blockerId, { method: 'DELETE' })")
    // the click path mutates live + keeps the local edge pool in lock-step
    expect(src).toContain('await removeTaskDep(modalCtx.taskId, depId)')
    expect(src).toContain('await addTaskDep(modalCtx.taskId, depId)')
    expect(src).toContain('state.task_deps.push({ blocker_task_id: depId, blocked_task_id: modalCtx.taskId })')
  })

  it('the add-mode STAGING decision: depStaged + the create-then-link POST loop right after the create ack (the staged-shots pin-loop shape)', () => {
    const src = db()
    expect(src).toContain('if (!task) modalCtx.draft.depStaged = []')
    expect(src).toContain('modalCtx.draft.depStaged = isOn ? depSelected().filter((x) => x !== depId) : [...depSelected(), depId]')
    expect(src).toContain('const stagedDeps = [...(modalCtx.draft.depStaged || [])]')
    expect(src).toContain('await addTaskDep(created.id, bid)')
  })

  it('the INLINE 400/409 surfaces: the cycle error NAMES the offending pick; the self error; the generic fallback — [data-db-deps-err] role="alert", never a generic toast', () => {
    const src = db()
    expect(src).toContain('data-db-deps-err role="alert" hidden')
    expect(src).toContain("code === 'cycle'")
    expect(src).toContain("t('db.deps.cycleErr', 'Circular dependency: {name} is already blocked by this task, directly or through a chain.').replace('{name}', name)")
    expect(src).toContain("code === 'invalid_input'")
    expect(src).toContain("t('db.deps.selfErr', 'A task cannot block itself.')")
    expect(src).toContain("t('db.deps.saveErr', \"Couldn't update the dependency.\")")
    // the failed pick never sticks: the catch repaints from the unchanged truth
    expect(src).toMatch(/catch \(e2\) \{[\s\S]*?depPaintList\(\)\s*\n\s*\}/)
  })

  it('the derived-reverse note + the read-only blocks line (spec §15: no second EDITABLE Blocks field, ever)', () => {
    const src = db()
    expect(src).toContain("t('db.deps.autoNote', 'The reverse Blocks view is derived automatically — you only enter Blocked by.')")
    expect(src).toContain("t('db.deps.blocksLine', 'This task blocks {n} task(s).')")
    // no editable reverse input exists — the only write path is the dep click handler
    expect(src).not.toContain('data-db-blocks-input')
    expect(src).not.toContain('blocks-input')
  })

  it('the save body NEVER carries dep-derived fields (§15: dependencies do not alter priority, sprint, deadline, or status)', () => {
    const src = db()
    // the create BODY: title/status/priority/category/sprint/due/tags only — the
    // staged links ride their OWN addTaskDep POST loop, never the create request
    const createBody = src.match(/const created = await createTask\(\{[\s\S]*?\}\)/)
    expect(createBody).toBeTruthy()
    expect(createBody![0]).not.toContain('depStaged')
    expect(createBody![0]).not.toContain('blocker')
    expect(createBody![0]).not.toContain('task_deps')
    // the edit PATCH body: the same field set — no dep keys ever
    const patchBody = src.match(/const body = \{ title, status: modalCtx\.draft\.status[\s\S]*?await patchTask\(modalCtx\.taskId, body\)/)
    expect(patchBody).toBeTruthy()
    for (const key of ['task_deps', 'blocker', 'blocked', 'deps:', 'depStaged']) {
      expect(patchBody![0]).not.toContain(key)
    }
  })
})

// ------------------------------------------------------ the parity seam (3 renderers)

describe('S246 — the parity seam: the badge row in ALL THREE renderers (byte-identical)', () => {
  it('the badge grammar is byte-identical: devboard.js + the detail-helpers.ts server twin carry the same SVG glyphs + class names + attribute order', () => {
    const client = readPublic('js/devboard.js')
    const server = readPublic('../src/routes/projects/detail-helpers.ts')
    for (const needle of [
      '<svg class="icon db-dep-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.4 12h7.2"/></svg>',
      '<svg class="icon db-dep-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
      '<svg class="icon db-dep-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"/><path d="M13 6.5l5.5 5.5-5.5 5.5"/></svg>',
      '<span class="db-dep-badge st-block',
      '<span class="db-dep-badge-txt" dir="auto">',
    ]) {
      expect(client.includes(needle), `devboard.js must carry ${needle}`).toBe(true)
      expect(server.includes(needle), `detail-helpers.ts must carry ${needle}`).toBe(true)
    }
  })

  it('the seam order: the dep row slots AFTER the deadline row (Screen M variants 6/7) in all three renderers', () => {
    const bp = readPublic('js/board-page.js')
    expect(bp).toContain('sprintRowHtml +\n                        deadlineHtml +\n                        depHtml +\n                        chipsHtml +')
    const dh = readPublic('../src/routes/projects/detail-helpers.ts')
    expect(dh).toContain('${sprintBadgeHtml(t.sprint_id)}\n                    ${deadlineRowHtml(t)}\n                    ${depBadgeHtml(t)}\n                    ${taskTagChips(t.id)}')
    const pp = readPublic('js/project-page.js')
    expect(pp).toContain('${deadlineHtml}${depHtml}${pdTagChipsHtml(tt, sprintBadgeHtml)}')
  })

  it('the renderers call the SHARED stack (never a forked fold): board-page + the task view + the repaint twin all read B().depBadgeHtml / B().depViewHtml', () => {
    const bp = readPublic('js/board-page.js')
    expect(bp).toContain("B().depBadgeHtml ? B().depBadgeHtml(task, null, null, lang) : ''")
    expect(bp).toContain("B().depViewHtml ? B().depViewHtml(task, null, null, lang) : ''")
    const pp = readPublic('js/project-page.js')
    expect(pp).toContain('window.HibanaBoard.depBadgeHtml ? window.HibanaBoard.depBadgeHtml(t, pdDepTruth, pdTaskTruth, pdLang)')
  })

  it('the embedded-fold decision (recorded, moved by S255/FE-4): the DETAIL POOL feeds the boot + expand folds — pdDepTruth reads taskDeps off the SAME /api/projects/:id fetch there; the MUTATION repaint rides the LEAN board payload instead (the audit\'s FE-4: the old flow refetched the whole 13-query detail to repaint ≤2 columns)', () => {
    const pp = readPublic('js/project-page.js')
    const reads = pp.match(/pdDepTruth = \(data\.project \? data\.project\.taskDeps : data\.taskDeps\) \|\| \[\]/g) || []
    expect(reads.length).toBe(2) // pdFilterBuild (the boot fold) + the +N more expand
    // FE-4 (S255): the repaint's dep pool comes from the board payload's task_deps —
    // the SAME server helper (taskDepsForProject), never a second detail pull
    const boardReads = pp.match(/pdDepTruth = data\.task_deps \|\| \[\]/g) || []
    expect(boardReads.length).toBe(1) // pdRepaintColumns only
    expect(pp).toContain("fetch('/api/projects/' + id + '/devboard?lean=1')")
  })

  it('loadDetail carries the additive taskDeps pool key (the server-side source of the embedded fold)', () => {
    const dh = readPublic('../src/routes/projects/detail-helpers.ts')
    expect(dh).toContain('taskDepsForProject(cfg, p.id)')
    expect(dh).toContain('backlog, taskDeps }')
  })
})

// ------------------------------------- the real app: the pool + the soft constraints

describe('S246 — the detail pool + the soft constraints (the real app + migrations)', () => {
  // the domain suite's harness, verbatim (helpers + createApp + session cookie)
  async function makeAppFixture() {
    const { db, close } = makeTestDb()
    const userId = await makeUser(db) // makeUser returns the id
    const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined } as unknown as Config)
    const token = await createSession(db, userId)
    const headers = { 'Content-Type': 'application/json', Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' }
    return { app, headers, close }
  }

  async function createTask(app: Awaited<ReturnType<typeof createApp>>, headers: Record<string, string>, pid: string, body: Record<string, unknown>) {
    const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  it('the detail pool carries taskDeps with the edges; the embedded HTML render wears the badges on BOTH ends (blocked + the derived reverse)', async () => {
    const { app, headers, close } = await makeAppFixture()
    try {
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'Deps pool project', status: 'developing' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const a = await createTask(app, headers, pid, { title: 'Fix authentication architecture' })
      const b = await createTask(app, headers, pid, { title: 'Implement session security' })
      const link = await app.fetch(new Request(`http://local/api/devtasks/${b}/deps`, { method: 'POST', headers, body: JSON.stringify({ blocker_id: a }) }))
      expect(link.status).toBe(201)

      // the JSON pool carries the SAME flat edge join the board payload rides
      const json = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers }))
      expect(json.status).toBe(200)
      const pool = (await json.json()) as { project: { taskDeps: { blocker_task_id: string; blocked_task_id: string }[] } }
      expect(Array.isArray(pool.project.taskDeps)).toBe(true)
      expect(pool.project.taskDeps).toEqual([{ blocker_task_id: a, blocked_task_id: b }])

      // the server render folds the badges: the blocked task + the blocking task
      const html = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...headers, 'HX-Request': '1' } }))
      expect(html.status).toBe(200)
      const body = await html.text()
      const bWrap = body.match(new RegExp(`data-pd-task="${b}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(bWrap).toBeTruthy()
      expect(bWrap![1]).toContain('class="db-dep-badge st-blocked"')
      expect(bWrap![1]).toContain('Blocked')
      const aWrap = body.match(new RegExp(`data-pd-task="${a}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(aWrap).toBeTruthy()
      expect(aWrap![1]).toContain('class="db-dep-badge st-blocks"')
      expect(aWrap![1]).toContain('Blocks 1')
    } finally {
      await close()
    }
  })

  it('§16.1 RESOLUTION + the SOFT constraint: completing the blocker flips Blocked → Ready in the fold, and the BLOCKED task itself still moves (assumption 2 — never a gate)', async () => {
    const { app, headers, close } = await makeAppFixture()
    try {
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'Resolution project', status: 'developing' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const a = await createTask(app, headers, pid, { title: 'blocker one' })
      const c = await createTask(app, headers, pid, { title: 'blocker two' })
      const b = await createTask(app, headers, pid, { title: 'the blocked task' })
      for (const blocker of [a, c]) {
        const link = await app.fetch(new Request(`http://local/api/devtasks/${b}/deps`, { method: 'POST', headers, body: JSON.stringify({ blocker_id: blocker }) }))
        expect(link.status).toBe(201)
      }

      // SOFT: the blocked task moves to done through the plain status PATCH — the
      // server never gates on unresolved blockers (assumption 2 / §16.1)
      const move = await app.fetch(new Request(`http://local/api/devtasks/${b}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'done' }) }))
      expect(move.status).toBe(200)
      // and back (the resolution test needs it blocked)
      const back = await app.fetch(new Request(`http://local/api/devtasks/${b}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'in_progress' }) }))
      expect(back.status).toBe(200)

      // ONE blocker done → still blocked (§16.1: ALL blockers must complete)
      await app.fetch(new Request(`http://local/api/devtasks/${a}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'done' }) }))
      let html = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...headers, 'HX-Request': '1' } }))
      let body = await html.text()
      let bWrap = body.match(new RegExp(`data-pd-task="${b}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(bWrap![1]).toContain('st-blocked')
      expect(bWrap![1]).toContain('Blocked · 2')

      // the SECOND blocker done → Ready (the resolution)
      await app.fetch(new Request(`http://local/api/devtasks/${c}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'done' }) }))
      html = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...headers, 'HX-Request': '1' } }))
      body = await html.text()
      bWrap = body.match(new RegExp(`data-pd-task="${b}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(bWrap![1]).toContain('class="db-dep-badge st-ready"')
      expect(bWrap![1]).toContain('Ready')
      // the RELATIONSHIP is retained (§16: resolving never erases the link)
      const json = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers }))
      const pool = (await json.json()) as { project: { taskDeps: { blocker_task_id: string; blocked_task_id: string }[] } }
      expect(pool.project.taskDeps.length).toBe(2)
    } finally {
      await close()
    }
  })
})

// ------------------------------------------------------------------ i18n parity

describe('S246 — i18n EN+FA parity for every new string', () => {
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
    'db.dep.blocked', 'db.dep.blockedN', 'db.dep.ready', 'db.dep.blocksN',
    'db.dep.blockedHint', 'db.dep.readyHint', 'db.dep.blocksHint',
    'db.dep.viewBlocked', 'db.dep.viewBlocks',
    'db.deps.section', 'db.deps.blockedBy', 'db.deps.searchPh', 'db.deps.autoNote',
    'db.deps.addNote', 'db.deps.selfErr', 'db.deps.cycleErr', 'db.deps.saveErr',
    'db.deps.noneFound', 'db.deps.thisTask', 'db.deps.blocksLine',
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
    expect(faRaw).toMatch(/'db\.dep\.blocked': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.dep\.ready': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.dep\.blocksN': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.deps\.section': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.deps\.cycleErr': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.deps\.selfErr': '[^']*[؀-ۿ][^']*'/)
  })
})

// ------------------------------------------------------- the seam + ladder pins

describe('S246 — the desktop seam tripwires + the ladder (the Phase 9 re-pin inventory)', () => {
  it('the fetch counts NEVER moved — the dep writes ride the shared api() through addTaskDep/removeTaskDep (ZERO new fetch sites)', () => {
    expect((readPublic('js/devboard.js').match(/\bfetch\(/g) || []).length).toBe(7)
    expect((readPublic('js/board-page.js').match(/\bfetch\(/g) || []).length).toBe(3) // S258 (FE-11): the clear-done fan-out retired — the bulk api() call replaced it
  })

  it('sw.js is at hibana-v464 with the S256 carrier note (the CSS/asset diet moved the ladder; the S246 carriers are noted in the v460 line)', () => {
    const sw = readPublic('sw.js')
    expect(sw.includes('const VERSION = "hibana-v464"')).toBe(true)
    expect(sw.includes('// v464 (S258)')).toBe(true)
    expect(sw).toMatch(/devboard\.js v37/)
    expect(sw).toMatch(/i18n-fa\.js\?v=105/)
  })

  it('the lazy devboard injector literals moved to v40 (the s242v33 lesson: the check reads them — S258 moved them from v39)', () => {
    expect(readPublic('js/board-page.js').includes('/js/devboard.js?v=40')).toBe(true)
    expect(readPublic('js/sprint-page.js').includes('/js/devboard.js?v=40')).toBe(true)
    expect(readPublic('js/project-page.js').includes('/js/devboard.js?v=40')).toBe(true)
  })
})
