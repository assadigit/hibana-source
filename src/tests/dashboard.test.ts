import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Dashboard (Phase 5, 2026-09-08): the stat boxes ride a horizontal stage carousel
// (stat-carousel + chevrons + dots) over the 6 ACTIVE stages — PROJECT_STAGES minus
// spark; sparks live on the projects page's Ideas shelf, not here. Each stage box shows
// stage icon + live count + statusLabel, a “View all” link to the stage's cards view, and
// ALL of its projects as compact skc-row cards (open arrow + title + timeAgo — the tag
// chip and latest-note preview are gone). Counts for all 7 statuses stay in the JSON.
// Creation entrypoints live in the single FAB (2026-08-25). The Operational/Halted boxes
// live on Reports. The to-do quadrants carry prog-dots, note chips, the ⋯ task menu, and
// the quick-add FAB (2026-09-06 (k)).

// The carousel's stage order (0060 rename): work stages first, then the paused/terminal pair.
const CAROUSEL = ['planning', 'queued', 'developing', 'awaiting_dev', 'operational'] as const

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function createProject(app: ReturnType<typeof createApp>, auth: Record<string, string>, title: string, status: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title, status }) }))
  const body = (await res.json()) as { id: string }
  return body.id
}

async function createSadhanaTask(db: Db, userId: string, over: { quadrant: number; title: string; pinned?: number; done?: number; note?: string; progress?: string; deleted_at?: string | null; cleared_at?: string | null; updated_at?: string }) {
  const id = crypto.randomUUID()
  const created = '2026-08-01T00:00:00.000Z'
  await db.execute(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, note, progress, pinned, done, deleted_at, cleared_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, '📌', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, over.quadrant, over.title, over.note ?? '', over.progress ?? 'untouched', over.pinned ?? 0, over.done ?? 0, over.deleted_at ?? null, over.cleared_at ?? null, created, over.updated_at ?? created],
  )
  return id
}

describe('dashboard stat boxes', () => {
  it('shows the stage carousel over the 6 active stages with skc-row cards; spark has no box, no solved box, no create controls', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const ideaA = await createProject(app, auth, 'Idea A', 'spark')
      await createProject(app, auth, 'Idea B', 'spark')
      const planning = await createProject(app, auth, 'Planning P', 'planning')
      const developing = await createProject(app, auth, 'Developing D', 'developing')
      await createProject(app, auth, 'AwaitingDev A', 'awaiting_dev')
      const operational = await createProject(app, auth, 'Operational O', 'operational')

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      // Scoped to the carousel shell — slice from the carousel wrapper to the notebook
      // section below. S42 (owner: "make handles over them"): the strip spans the full
      // section width inside .stat-stage (the position:relative anchor) and the chevron
      // handles sit AFTER the track as absolute overlays — the old Session-19
      // arrows-BEFORE-the-strip flank layout is gone.
      const strip = html.slice(html.indexOf('stat-carousel'), html.indexOf('class="card notebook'))

      // The carousel shell: stage anchor + track + overlay chevron handles + dots.
      expect(strip).toContain('stat-carousel')
      expect(strip).toContain('stat-stage')
      expect(strip).toContain('data-stat-track')
      expect(strip).toContain('data-stat-prev')
      expect(strip).toContain('data-stat-next')
      expect(strip).toContain('data-stat-dots')
      // Overlay order pin: the stage wraps track + handles, and the handles FOLLOW the
      // track in the DOM (absolute positioning inside .stat-stage, above the cards).
      const stageAt = strip.indexOf('stat-stage')
      const trackAt = strip.indexOf('data-stat-track')
      const prevAt = strip.indexOf('data-stat-prev')
      const nextAt = strip.indexOf('data-stat-next')
      expect(stageAt).toBeGreaterThan(-1)
      expect(trackAt).toBeGreaterThan(stageAt)
      expect(prevAt).toBeGreaterThan(trackAt)
      expect(nextAt).toBeGreaterThan(prevAt)

      // One box per ACTIVE stage, in carousel order; the boxes carry no status badges
      // (icon-chip + stat-count + stat-label replaced them). Session 14: empty stages
      // (queued here) carry .is-empty — app.css hides them on phones.
      // Splitting on the tag PREFIX so both plain and is-empty boxes are captured.
      const boxes = strip.split('<div class="stat stat-box').slice(1)
      expect(boxes.map((b) => (b.match(/data-status="(\w+)"/) ?? [])[1])).toEqual([...CAROUSEL])
      expect((strip.match(/class="stat stat-box is-empty"/g) ?? []).length).toBe(1)
      expect(strip).toContain('class="stat stat-box is-empty" data-status="queued"')
      expect(strip).not.toContain('data-status="spark"')
      expect(strip).toContain('class="icon-chip board-col-ico"')
      // 2026-09-09: the stat-count now carries a title="N projects" tooltip; the test
      // matches the opening tag prefix so it survives the added attribute.
      // S85: the count is now a shared board pill (stat-count board-count) placed
      // AFTER the label — the unified icon+label+count header convention.
      expect(strip).toContain('<b class="stat-count board-count"')
      expect(strip).toContain('class="stat-label board-col-label"')
      for (const label of ['Planning', 'Queued', 'Developing', 'Awaiting Development', 'Operational']) {
        expect(strip).toContain(`>${label}<`)
      }
      expect(strip).not.toContain('badge-')

      // Cards are compact skc-rows: open arrow + title, timeAgo only (no tag chips, no
      // latest-note preview) — and they link to the project page.
      expect(strip).toContain('class="row skc-row"')
      expect(strip).toContain('class="skc-open"')
      expect(strip).toContain('class="skc-title"')
      expect(strip).toContain('skc-updated')
      expect(strip).toContain(`/project.html?id=${planning}`)
      expect(strip).toContain(`/project.html?id=${developing}`)
      expect(strip).toContain(`/project.html?id=${operational}`)

      // Sparks never render here — they live on the projects page's shelf.
      expect(strip).not.toContain('Idea A')
      expect(strip).not.toContain(`/project.html?id=${ideaA}`)
      expect((strip.match(/class="card kanban-card stat-kanban-card"/g) ?? []).length).toBe(4)

      // Each merged box keeps only its “view all” link — the per-status quick-add buttons
      // were removed in favour of the single creation FAB (user request 2026-08-25), so no
      // box carries a create control anymore.
      expect(strip).not.toContain('data-quickadd-open')
      expect(strip).not.toContain('data-projectquickadd')
      expect((strip.match(/View all </g) ?? []).length).toBe(5)
      for (const s of CAROUSEL) expect(strip).toContain(`/projects.html?status=${s}&view=cards`)

      // Order: to-do → stat boxes → notebook → recent activity. The Ideas shelf is gone.
      expect(html.indexOf('dash-todo-section')).toBeLessThan(html.indexOf('stat-strip stat-boxes'))
      expect(html.indexOf('stat-strip stat-boxes')).toBeLessThan(html.indexOf('class="card notebook'))
      expect(html.indexOf('class="card notebook')).toBeLessThan(html.indexOf('Recent activity'))
      expect(html).not.toContain('Ideas shelf')
      expect(html).not.toContain('spark-chip')

      // The obsolete solved-this-week stat box is gone (nothing solved here, so not even
      // the to-do strip chip renders) — the metric survives only in the JSON for API
      // compatibility.
      expect(html).not.toContain('dash-solved')
      expect(html).not.toContain('this week')

      // The section heading carries the same go-to pattern as the to-do list (Phase 5).
      expect(html).toContain('<h2>Projects</h2>')
      expect(html).toContain('href="/projects.html"')
      expect(html).toContain('Go to projects')

      // JSON branch: counts cover ALL 6 statuses (spark included), `recents` is the
      // active-stages query (sparks excluded), solvedThisWeek rides along for API compat.
      const json = await app.fetch(new Request('http://local/api/dashboard', { headers: auth }))
      const data = (await json.json()) as { counts: Record<string, number>; recents: { status: string }[]; solvedThisWeek: number }
      expect(data.counts).toEqual({ spark: 2, planning: 1, queued: 0, developing: 1, awaiting_dev: 1, operational: 1 })
      expect(data.recents.every((p) => p.status !== 'spark')).toBe(true)
      expect(data.recents).toHaveLength(4)
      expect(data.solvedThisWeek).toBe(0)
    } finally {
      close()
    }
  })

  it('columns list ALL their projects — no "3 recent" cap (2026-08-25), one column per carousel stage', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      for (let i = 0; i < 6; i++) await createProject(app, auth, `Research ${i}`, 'planning')
      for (let i = 0; i < 5; i++) await createProject(app, auth, `Build ${i}`, 'developing')

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      const strip = html.slice(html.indexOf('stat-strip stat-boxes'), html.indexOf('class="card notebook'))
      // One stage column per carousel stage, in order; each lists ALL its projects.
      const cols = strip.split('<div class="stat-kanban">').slice(1)
      expect(cols.length).toBe(5)
      const cards = (s: string) => (s.match(/class="card kanban-card stat-kanban-card"/g) ?? []).length
      expect(cards(cols[0])).toBe(6) // Planning lists all six
      expect(cards(cols[1])).toBe(0) // Queued is empty
      expect(cards(cols[2])).toBe(5) // Developing lists them all
      expect(cards(cols[3])).toBe(0)
      expect(cards(cols[4])).toBe(0)
      expect(strip).toContain('Research 5') // the 6th item — no cap
      expect(strip).toContain('Build 4')
      // empty stages show the muted empty state, not a drop target
      expect(cols[1]).toContain('kanban-empty')
    } finally {
      close()
    }
  })

  it('merge: one box per stage with view-all; no per-box create buttons; every project listed exactly once, no kanban markup', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await createProject(app, auth, 'Solo Planning', 'planning')
      await createProject(app, auth, 'Solo Developing', 'developing')
      await createProject(app, auth, 'Solo Operational', 'operational')

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      const strip = html.slice(html.indexOf('stat-strip stat-boxes'), html.indexOf('class="card notebook'))

      // Exactly one box per active stage, each with a view-all link and NO create button
      // (creation lives in the single FAB — user request 2026-08-25). Session 14: the two
      // stages without projects (queued/awaiting_dev) are marked .is-empty.
      expect((strip.match(/class="stat stat-box[^"]*" data-status="/g) ?? []).length).toBe(5)
      expect((strip.match(/class="stat stat-box is-empty" data-status="/g) ?? []).length).toBe(2)
      expect(strip).not.toContain('data-quickadd-open')
      expect(strip).not.toContain('data-projectquickadd')
      expect(strip).toContain('View all ')
      expect(strip).toContain('/projects.html?status=planning&view=cards')
      expect(strip).toContain('/projects.html?status=developing&view=cards')
      expect(strip).toContain('/projects.html?status=operational&view=cards')

      // Every project appears exactly once — no more stat-box + kanban duplication.
      expect((strip.match(/class="card kanban-card stat-kanban-card"/g) ?? []).length).toBe(3)
      expect(html).not.toContain('mini-kanban')
      expect(html).not.toContain('kanban-col')

      // The row keeps its place-marker — the compact Phase 5 card shows time ago only.
      expect(strip).toContain('class="muted small skc-updated"')
    } finally {
      close()
    }
  })
})

describe('dashboard to-do preview', () => {
  it('renders shared active tasks with custom names, pinned/recent ordering, prog-dots, note chips, and the per-card preview limit', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Pinned old', pinned: 1, updated_at: '2026-08-01T01:00:00.000Z' })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Newest open', updated_at: '2026-08-02T01:00:00.000Z' })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Older open', updated_at: '2026-08-01T02:00:00.000Z' })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Fourth open', updated_at: '2026-08-01T01:30:00.000Z' })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Fifth preview', updated_at: '2026-08-01T01:15:00.000Z' })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Sixth hidden', updated_at: '2026-08-01T01:10:00.000Z' })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Task with note', note: 'Remember the supporting detail', progress: 'in_progress' })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Completed', done: 1 })
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Deleted', deleted_at: '2026-08-03T00:00:00.000Z' })
      await createSadhanaTask(db, other, { quadrant: 1, title: 'Foreign task' })
      await app.fetch(new Request('http://local/api/sadhana/quadrants/1', { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'My focus' }) }))
      const styleRes = await app.fetch(new Request('http://local/api/sadhana/quadrants/1', { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'My focus', icon_id: '🎯', accent_color: 'accent-purple' }) }))
      expect(styleRes.status).toBe(200)
      await app.fetch(new Request('http://local/api/sadhana/quadrants/reorder', { method: 'POST', headers: auth, body: JSON.stringify({ ids: [4, 2, 1, 3] }) }))

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html.indexOf('dash-todo-section')).toBeLessThan(html.indexOf('stat-strip stat-boxes'))
      expect(html).toContain('To-Do List')
      expect(html).toContain('Go to to-do list')
      expect(html).toContain('My focus')
      // 2026-09 neutral quadrants: a user-PICKED accent still renders (the accentAttr)…
      expect(html).toContain('style="--dash-q-accent: var(--accent-purple)"')
      // S93 (owner round, item 6): the 16 pastel swatches are BACK in the dashboard
      // popover (data-dash-accent rides every swatch button) — the minimalist-era
      // 'no accent anywhere' assertion retired with them. The emoji symbol
      // rides the Phase 7 item 1 picker button's data-current.
      expect(html).toContain('data-current="🎯"')
      // S101 (QA-found regression pin): the swatch map once shipped as a PLAIN string
      // inside html`` — every button escaped, the popover rendered a wall of
      // &lt;button&gt; text and the dashboard's 16-color picker was UNUSABLE (live
      // since S93; the sadhana board's client-built picker was the working one).
      // 17 real swatch buttons per quadrant (16 colors + the ∅ clear) × 4 quadrants,
      // the picked accent-purple swatch rides ' is-selected', NEVER an escaped tag.
      expect((html.match(/<button type="button" class="dash-style-swatch[ "]/g) ?? []).length).toBe(68)
      expect(html).toContain('class="dash-style-swatch is-selected" data-dash-accent="accent-purple"')
      // The bug signature: the swatch row's own content starting with an ESCAPED tag
      // (user content elsewhere may legitimately escape — this pin is scoped).
      expect(html).not.toMatch(/dash-style-swatches"[^>]*>&lt;/)
      // S85: the "Active N" text counter is the shared board-count PILL now — bare
      // digits + title/aria meaning, same convention as the stage columns' counts.
      expect(html).toContain('data-dash-quadrant-count="1"')
      expect(html).toMatch(/class="dash-todo-counter board-count"[^>]*title="Active count"[^>]*>7</)
      const dashboardQuadrants = [...html.matchAll(/data-dash-quadrant="(\d)"/g)].map((match) => Number(match[1]))
      expect(dashboardQuadrants).toEqual([4, 2, 1, 3])
      expect(html).toContain('data-dash-see-more="1"')
      // 2026-09-06 (k): the quick-add moved out of the customize popover into a circular
      // + FAB on the quadrant's corner + its hidden inline form.
      expect(html).toContain('data-dash-quickadd-fab="1"')
      expect(html).toContain('data-dash-quickadd-form="1"')
      expect((html.match(/<li class="dash-todo-task[^>]*draggable="true"/g) ?? []).length).toBe(7)
      expect((html.match(/<li class="dash-todo-task[^>]*hidden>/g) ?? []).length).toBe(2)
      expect(html).toContain('Fifth preview')
      expect(html).toContain('Sixth hidden')

      // Phase 5: the progress control is the same 3-dot prog-track as the board page —
      // one dot per state (current one p-active) + the state label; 'Task with note'
      // is in_progress.
      expect((html.match(/class="prog-track /g) ?? []).length).toBe(7)
      expect((html.match(/class="prog-dot /g) ?? []).length).toBe(21)
      expect(html).toContain('prog-dot p-inprog p-active')
      expect(html).toContain('<span class="prog-lbl">In progress</span>')

      // Phase 5: the latest task note rides the row as a chip (data-note/count) — the
      // client's note panel opens from it without another fetch. 'Task with note'
      // carries exactly one (its legacy note column).
      expect((html.match(/class="dash-note-chip"/g) ?? []).length).toBe(1)
      expect(html).toContain('data-note="Remember the supporting detail"')
      expect(html).toContain('data-note-count="1"')

      // Phase 5: the per-task ⋯ menu (edit / notes / delete) + the inline edit form.
      expect((html.match(/class="dash-todo-menu"/g) ?? []).length).toBe(7)
      expect((html.match(/data-dash-edit-open="/g) ?? []).length).toBe(7)
      expect((html.match(/data-dash-note-panel="/g) ?? []).length).toBe(7)
      expect((html.match(/data-dash-delete="/g) ?? []).length).toBe(7)
      expect((html.match(/data-dash-edit-form="/g) ?? []).length).toBe(7)

      // One customize popover per quadrant; the icon button AND the hover pen
      // (2026-09-02 rename affordance) are both triggers for it → 2 per quadrant.
      expect((html.match(/data-dash-style-pop="\d"/g) ?? []).length).toBe(4)
      expect((html.match(/data-dash-style="\d"/g) ?? []).length).toBe(8)
      expect((html.match(/class="dash-todo-pen"/g) ?? []).length).toBe(4)
      expect(html.indexOf('Pinned old')).toBeLessThan(html.indexOf('Newest open'))
      expect(html.indexOf('Newest open')).toBeLessThan(html.indexOf('Older open'))
      expect(html).not.toContain('Foreign task')
      expect(html).not.toContain('Completed')
      expect(html).not.toContain('Deleted')
    } finally {
      close()
    }
  })

  // S97 (the quadrant deep links): the over-cap "+N more" link lands ON THE
  // QUADRANT it overflows (/to-do-list#Q<id>, the board's arrival system) instead
  // of the board top. 10 quadrant-2 tasks → 8 rendered + 2 over → the link pins
  // its href + tooltip + copy; exactly ONE link rides (the other quadrants are
  // empty → placeholder rows, never the link).
  // S100 (the goto-chip language): the link carries the ↗ chip glyph inline (the
  // →/← text-arrow ::after pair retired) — the same SVG path the rail panel's
  // goto chips speak.
  it('renders the over-cap link deep-linked to its quadrant, with the ↗ chip glyph', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      for (let i = 1; i <= 10; i++) await createSadhanaTask(db, user, { quadrant: 2, title: `Strategic ${i}` })

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html).toContain('href="/to-do-list#Q2"')
      expect(html).toContain('title="Open this box on the board"')
      expect(html).toContain('+2 more on the board')
      expect((html.match(/class="dash-todo-more dash-todo-more-link"/g) ?? []).length).toBe(1)
      expect(html).toContain('<path d="M7 7h10v10M7 17 17 7"/>')
    } finally {
      close()
    }
  })

  // S94 (owner item 10): an empty quadrant shows the CENTERED placeholder row — the
  // server ships it (before, an empty quadrant rendered a literally empty <ul>; the
  // :empty::before fallback read attr(data-empty-hint), which nothing ever set).
  it('renders the empty-quadrant placeholder copy for quadrants with zero tasks', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await createSadhanaTask(db, user, { quadrant: 1, title: 'Only task' })

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      // Quadrant 1 has its task; the other three quadrants carry the placeholder.
      expect((html.match(/class="dash-todo-empty muted"/g) ?? []).length).toBe(3)
      // (the copy's apostrophe ships HTML-escaped — esc() turns ' into &#39;)
      expect(html).toContain('You haven&#39;t added any task yet')
      // The placeholder rides INSIDE the quadrant's list (the :has() centering anchor).
      expect(html).toMatch(/<ul class="dash-todo-list">\s*<li class="dash-todo-empty muted">/)
    } finally {
      close()
    }
  })
})

describe('dashboard view options (2026-08-26)', () => {
  it('reorders sections per dash_order (notebook can be first)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await createProject(app, auth, 'P', 'spark')
      await app.fetch(
        new Request('http://local/api/settings', { method: 'PATCH', headers: auth, body: JSON.stringify({ dash_order: 'notebook,header,projects,activity' }) }),
      )

      // PATCH persists; GET round-trips the new column.
      const got = await app.fetch(new Request('http://local/api/settings', { headers: auth }))
      const { prefs } = (await got.json()) as { prefs: { dash_order: string } }
      expect(prefs.dash_order).toBe('notebook,header,projects,activity')

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html.indexOf('class="card notebook')).toBeLessThan(html.indexOf('stat-strip stat-boxes'))
      expect(html.indexOf('stat-strip stat-boxes')).toBeLessThan(html.indexOf('Recent activity'))
    } finally {
      close()
    }
  })

  it('hides sections whose dash_show_* is 0', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await createProject(app, auth, 'P', 'spark')
      await app.fetch(
        new Request('http://local/api/settings', { method: 'PATCH', headers: auth, body: JSON.stringify({ dash_show_activity: 0, dash_show_notebook: 0 }) }),
      )

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html).not.toContain('Recent activity')
      expect(html).not.toContain('class="card notebook')
      expect(html).toContain('stat-strip stat-boxes')
    } finally {
      close()
    }
  })

  it('shows an empty state when every section is hidden', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await app.fetch(
        new Request('http://local/api/settings', {
          method: 'PATCH',
          headers: auth,
          body: JSON.stringify({ dash_show_header: 0, dash_show_projects: 0, dash_show_todo: 0, dash_show_notebook: 0, dash_show_activity: 0 }),
        }),
      )

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html).toContain('dash-empty')
    } finally {
      close()
    }
  })
})
describe('dashboard merged "Continue where you left off" component (S85)', () => {
  // S85 (owner redesign instruction #1): the server "Resume work" card was REMOVED —
  // it and the client "Pick up where you left off" strip used to both surface the
  // same project with two different timestamps (updated_at vs open-time) and no
  // explanation of the difference. The ONE surface left is the client component
  // (js/resume.js — hero + chips from the hibana-resume localStorage store, the
  // single "last touched = last OPENED" definition). These tests pin the server
  // contract: no duplicate resume card renders, whatever the data.
  it('never renders the old dash-resume card — even with a fresh doing project', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await createProject(app, auth, "Older developing", "developing")
      // a tiny delay so the second one has a newer updated_at (the query orders by updated_at DESC)
      await new Promise((r) => setTimeout(r, 20))
      const doing2 = await createProject(app, auth, 'Latest developing', 'developing')
      await createProject(app, auth, 'A spark', 'spark')
      await createProject(app, auth, 'A awaiting_dev', 'awaiting_dev')

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      // The server card is gone — no "Resume work" surface, no updated_at timestamp
      // competing with the client's last-opened one.
      expect(html).not.toContain('dash-resume')
      expect(html).not.toContain('Resume work')
      // The dashboard shell itself still renders (the doing projects appear in the
      // stage carousel as before — nothing else regressed with the card's removal).
      expect(html).toContain(`/project.html?id=${doing2}`)
      expect(html).toContain('Latest developing')
      // No other "resume" surface rides the fragment either (the client component
      // injects itself from localStorage at runtime — never server HTML).
    } finally {
      close()
    }
  })

  it('renders no resume card markup at all when there is no developing project', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await createProject(app, auth, 'Just an idea', 'spark')
      await createProject(app, auth, 'Planning', 'planning')
      await createProject(app, auth, 'AwaitingDev', 'awaiting_dev')

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html).not.toContain('dash-resume')
    } finally {
      close()
    }
  })

  it('is user-scoped: another user\'s developing project never appears in the dashboard html', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      // Another user's doing project (created directly in the DB, never via the authed app)
      const other = await makeUser(db, { email: 'other@x.local', username: 'other' })
      await db.execute(
        "INSERT INTO projects (id, user_id, title, status, type, sort_order, created_at, updated_at) VALUES (?, ?, 'Other user secret', 'developing', 'personal', 0, ?, ?)",
        [crypto.randomUUID(), other, new Date().toISOString(), new Date().toISOString()],
      )
      // user has no doing project → no resume card
      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html).not.toContain('dash-resume')
      expect(html).not.toContain('Other user secret')
    } finally {
      close()
    }
  })
})
