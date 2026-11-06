import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config, Db } from '../types'

// S209 (kanban 1:1 parity — the owner: "the kanban in the hibana is 1:1 the same
// as the kanban at projects.hibana.ir/kanban"): the EMBEDDED board fragment
// (project.html's #pd-board, detail-helpers.ts detailHtml) pins:
//   1. the MOTHER CONTAINER — the section wears .pd-board.db-frame with the
//      toolbar as the frame's .db-toolbar header row (NOT the old `card pd-board`
//      chrome); the CSS keeps the card outline for the embedded context and the
//      100dvh floor is scoped to the page-owning board (devboard.css).
//   2. the LABEL MANAGER button ([data-pd-labels]) in the head — the same shared
//      devboard.js dialog /kanban's toolbar opens.
//   3. the ◆ SPRINT BADGE on a sprinted task's card + data-pd-sprint on the wrap —
//      the /kanban card contract.

afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeProject(db: Db, userId: string, title = 'Parity project'): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    [id, userId, title, 'desc', 'personal', 'developing', '', new Date().toISOString(), new Date().toISOString()],
  )
  return id
}

function h(token: string) {
  return { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }
}

async function makeTask(db: Db, pid: string, title: string, sprintId: string | null = null): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at, sprint_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    [id, pid, title, 'in_progress', 'medium', new Date().toISOString(), sprintId],
  )
  return id
}

async function makeSprint(db: Db, pid: string, name: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO sprints (id, project_id, name, started_at, created_at, is_draft) VALUES (?, ?, ?, ?, ?, 1)',
    [id, pid, name, new Date().toISOString(), new Date().toISOString()],
  )
  return id
}

// S244 (spec pack Phase 5): a task with a deadline — the raw due_at + origin stamp
// (the S240 write surface). due_origin_at rides along so the bar's elapsed ratio
// has a real span (the server coalesces a missing stamp to due_at).
async function makeDueTask(db: Db, pid: string, title: string, opts: {
  sprintId?: string | null
  dueAt?: string
  dueOriginAt?: string
  status?: string
} = {}): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at, sprint_id, due_at, due_origin_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
    [id, pid, title, opts.status ?? 'in_progress', 'medium', new Date().toISOString(), opts.sprintId ?? null, opts.dueAt ?? null, opts.dueOriginAt ?? null],
  )
  return id
}

describe('kanban 1:1 parity — the embedded board fragment (S209)', () => {
  it('the #pd-board section wears the mother container (.pd-board.db-frame + the .db-toolbar header row) + the Labels button', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      await makeTask(db, pid, 'parity fragment task')

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      expect(detail.status).toBe(200)
      const html = await detail.text()

      // the mother container: .db-frame on the board section, the head row is the
      // frame's .db-toolbar (the hairline header), the old card chrome is GONE
      expect(html).toMatch(/<section class="pd-board db-frame" id="pd-board"/)
      expect(html).toMatch(/<div class="row spread db-toolbar pd-board-head">/)
      expect(html).not.toMatch(/<section class="card pd-board"/)

      // the LABEL MANAGER button joins the head (the shared devboard.js dialog)
      expect(html).toContain('data-pd-labels')

      // the classic neighbors survive (the embedded context's own affordances)
      expect(html).toContain('data-pd-new-sprint')
      expect(html).toContain('data-pd-cats')
      expect(html).toContain(`href="/board.html?project=${pid}"`)
      expect(html).toContain(`href="/sprint.html?project=${pid}"`)
    } finally {
      close()
    }
  })

  it('a sprinted task carries the ◆ sprint badge + data-pd-sprint (the /kanban card contract)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      const sprintId = await makeSprint(db, pid, 'Parity Sprint')
      await makeTask(db, pid, 'sprinted task', sprintId)
      await makeTask(db, pid, 'unsprinted task', null)

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      const html = await detail.text()

      // the badge — the same markup the /kanban cards render (board-page.js)
      expect(html).toContain('<span class="db-sprint-badge">◆ Parity Sprint</span>')
      // the wrap carries data-pd-sprint (the client truth builders read it)
      expect(html).toMatch(new RegExp(`data-pd-sprint="${sprintId}"`))
      // the unsprinted task renders NO badge
      const unsprintedWrap = html.match(/data-pd-task="[a-f0-9-]+"[^>]*data-pd-sprint=""[^>]*>\s*<button[^>]*aria-label="Priority: [^"]*"[^>]*>.*?unsprinted task/s)
      expect(unsprintedWrap).toBeTruthy()
      expect(unsprintedWrap![0]).not.toContain('db-sprint-badge')
    } finally {
      close()
    }
  })

  // S242 (spec pack §3.2/§4.2 + Screen A — card sprint identity): the badge is its
  // OWN compact row directly under the description/preview (a direct child of
  // .pd-task-body, BEFORE the label chips + the meta row — the Phase 5 deadline
  // seam follows it) and carries the sprint's EMOJI when one is set, else the
  // default ◆ glyph — byte-identical markup to board-page.js's sprintRowHtml.
  it('S242: the sprint identity renders as its own row under the description, with the emoji (else ◆) — the /kanban twin shape', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      const plainId = await makeSprint(db, pid, 'Plain Sprint')
      const emojiId = crypto.randomUUID()
      await db.execute(
        'INSERT INTO sprints (id, project_id, name, started_at, created_at, is_draft, emoji) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [emojiId, pid, 'Emoji Sprint', new Date().toISOString(), new Date().toISOString(), '🚀'],
      )
      await makeTask(db, pid, 'plain sprint task', plainId)
      const emojiTaskId = await makeTask(db, pid, 'emoji sprint task', emojiId)

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      const html = await detail.text()

      // the default glyph keeps the exact legacy shape (◆ name)
      expect(html).toContain('<span class="db-sprint-badge">◆ Plain Sprint</span>')
      // the emoji replaces the glyph when one is set (spec §4.2)
      expect(html).toContain('<span class="db-sprint-badge">🚀 Emoji Sprint</span>')
      // OWN ROW (Screen A order): inside this card's .pd-task-body, the badge
      // sits after the title row and before the meta row, NOT inside a
      // .pd-task-tags chips row (the tags row is tags-only now).
      const wrap = html.match(new RegExp(`data-pd-task="${emojiTaskId}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(wrap).toBeTruthy()
      const body = wrap![1]
      expect(body).toContain('db-sprint-badge')
      expect(body).not.toMatch(/pd-task-tags[\s\S]*?db-sprint-badge/) // not inside the chips row
      const titleAt = body.indexOf('pd-task-title-row')
      const badgeAt = body.indexOf('db-sprint-badge')
      const metaAt = body.indexOf('pd-task-meta')
      expect(titleAt).toBeGreaterThan(-1)
      expect(badgeAt).toBeGreaterThan(titleAt) // under the description area…
      expect(metaAt).toBeGreaterThan(badgeAt) // …above the timestamp area (Phase 5 seam)
    } finally {
      close()
    }
  })

  it('the pin badge keeps rendering on the embedded cards (the server path — pinsByTask)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      const taskId = await makeTask(db, pid, 'pinned task')
      const shotId = crypto.randomUUID()
      await db.execute(
        'INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 100, ?)',
        [shotId, pid, `u/${shotId}.png`, 'image/png', '', taskId, new Date().toISOString()],
      )

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      const html = await detail.text()
      expect(html).toContain(`data-pd-shots="${taskId}"`)
      expect(html).toMatch(new RegExp(`data-pd-shots="${taskId}"[^>]*>.*?pin.*?\\s*1.*?</button>`, 's'))
    } finally {
      close()
    }
  })

  // hibana-sync-status-spec §16.1: EVERY kanban card type shows the badge in the
  // meta row, at the inline-end side, without changing card height. The embedded
  // board is server-rendered, so its cards are SYNCED by definition (spec §2 —
  // the server confirmed the data it just rendered); the badge markup here is the
  // server twin of chip-render.js's syncBadgeHtml (keep them byte-compatible).
  it('every embedded card wears the synced badge as the LAST child of its meta row', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      await makeTask(db, pid, 'synced badge task')

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      expect(detail.status).toBe(200)
      const html = await detail.text()

      // the badge exists, wears the synced state, and carries its accessible name
      expect(html).toMatch(/<span class="pd-sync s-synced" data-sync-badge="[a-f0-9-]+" data-label="Synced" role="img" aria-label="Synced">/)
      // the cloud-check glyph — the same path data chip-render's client twin inlines
      expect(html).toContain('<path d="m9.5 12.5 2 2 3.5-3.5"/>')
      // placement: the badge is the LAST child of .pd-task-meta (after the date,
      // after any pin chip) — pinned by margin-inline-start:auto in CSS so RTL
      // mirrors it. The meta row must close immediately after the badge.
      expect(html).toMatch(/<span class="pd-task-meta">[^]*?<\/span><\/span>\s*<\/span>\s*<\/div>\s*<\/div>/)
      expect(html).toMatch(new RegExp('data-sync-badge="[a-f0-9-]+"[^>]*>[^]*?</span></span>\\s*</span>\\s*</div>\\s*</div>', 's'))
    } finally {
      close()
    }
  })

  // S244 (spec pack Phase 5 — §12 + Screen A): the DEADLINE ROW + the thin bar on
  // the embedded board — the server twin of board-page.js's deadlineHtml, placed
  // in the Phase 3 seam (after the sprint badge, before the tags/meta area). The
  // detail pool computes the effective triple through the SAME effectiveDeadlineOf
  // helper the board payload rides (assumption 9's exported-for-exactly-this seam).
  it('S244: a personal deadline renders the row + the thin bar in the seam; a sprint deadline inherits; a no-deadline task renders neither', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      const now = Date.now()
      const dueSoon = new Date(now + 36 * 3600000).toISOString() // ~36h out → urgent
      const dueFar = new Date(now + 20 * 86400000).toISOString() // 20d out → comfortable
      const personalId = await makeDueTask(db, pid, 'personal deadline task', { dueAt: dueSoon, dueOriginAt: new Date(now - 86400000).toISOString() })
      const plainId = await makeDueTask(db, pid, 'no deadline task', {})
      const sprintId = await makeSprint(db, pid, 'Due Sprint')
      await db.execute('UPDATE sprints SET due_at = ?, due_origin_at = ?, is_draft = 0 WHERE id = ?', [dueFar, new Date(now - 4 * 86400000).toISOString(), sprintId])
      const inheritedId = await makeDueTask(db, pid, 'inherited deadline task', { sprintId })

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      expect(detail.status).toBe(200)
      const html = await detail.text()

      // the personal row + bar: the grammar byte-identical to devboard.js's
      // deadlineRowHtml (the icon + the threshold word + the LTR-locked bar)
      const personalWrap = html.match(new RegExp(`data-pd-task="${personalId}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(personalWrap).toBeTruthy()
      const pBody = personalWrap![1]
      expect(pBody).toMatch(/<span class="db-due-row st-urgent"><svg class="icon db-due-ic"/)
      expect(pBody).toMatch(/<span class="db-due-bar" aria-hidden="true"><span class="db-due-fill st-urgent" style="width:\d+%"><\/span><\/span>/)

      // the inherited row identifies the SOURCE (§10.1: 'Sprint deadline · …')
      const inheritedWrap = html.match(new RegExp(`data-pd-task="${inheritedId}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(inheritedWrap).toBeTruthy()
      const iBody = inheritedWrap![1]
      expect(iBody).toContain('<span class="db-due-row st-comfortable">')
      expect(iBody).toContain('Sprint deadline · ')
      expect(iBody).toMatch(/<span class="db-due-bar"/)

      // the seam order (Screen A): sprint badge → DEADLINE ROW → BAR → tags → meta
      const badgeAt = iBody.indexOf('db-sprint-badge')
      const rowAt = iBody.indexOf('db-due-row')
      const barAt = iBody.indexOf('db-due-bar')
      const metaAt = iBody.indexOf('pd-task-meta')
      expect(badgeAt).toBeGreaterThan(-1)
      expect(rowAt).toBeGreaterThan(badgeAt)
      expect(barAt).toBeGreaterThan(rowAt)
      expect(metaAt).toBeGreaterThan(barAt)

      // S245 (spec pack Phase 6 — §13 + Screens J2/J3): the deadline row carries
      // the compact EXTEND AFFORDANCE at its inline end — the byte-identical
      // button both renderers ship (data-db-extend routes through the page's
      // delegated handler: personal → J2, sprint-sourced → J3's choice modal).
      // The button sits INSIDE the row, before the bar (the parity pin: same
      // grammar, same glyph, same routing attribute).
      expect(pBody).toMatch(new RegExp(`<button type="button" class="db-due-ext" data-db-extend="${personalId}" title="Extend deadline" aria-label="Extend deadline"><svg class="icon db-due-ext-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg></button>`))
      expect(iBody).toMatch(new RegExp(`class="db-due-ext" data-db-extend="${inheritedId}"`))

      // a task without a deadline renders NEITHER the row nor the bar (§10)
      const plainWrap = html.match(new RegExp(`data-pd-task="${plainId}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(plainWrap).toBeTruthy()
      expect(plainWrap![1]).not.toContain('db-due-row')
      expect(plainWrap![1]).not.toContain('db-due-bar')
      expect(plainWrap![1]).not.toContain('db-due-ext') // S245: no deadline, no extend affordance either
    } finally {
      close()
    }
  })

  // S244 (§12.4 + §10.3): a DONE task renders the neutral Done indication (no live
  // countdown, no urgency wording); a task relying only on a COMPLETED sprint's
  // deadline renders NO row at all (the server's §10.3 neutrality nulled the
  // triple — the client just renders null).
  it('S244: a done task reads st-done + the Done word; a completed sprint\'s task renders no countdown', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      const now = Date.now()
      const doneId = await makeDueTask(db, pid, 'done deadline task', { dueAt: new Date(now + 3600000).toISOString(), dueOriginAt: new Date(now - 86400000).toISOString(), status: 'done' })
      const finishedSprintId = await makeSprint(db, pid, 'Finished Sprint')
      await db.execute("UPDATE sprints SET due_at = ?, due_origin_at = ?, is_draft = 0, ended_at = ?, status = 'completed' WHERE id = ?", [new Date(now + 5 * 86400000).toISOString(), new Date(now - 86400000).toISOString(), new Date(now - 86400000).toISOString(), finishedSprintId])
      const heirId = await makeDueTask(db, pid, 'heir of finished sprint', { sprintId: finishedSprintId })

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      expect(detail.status).toBe(200)
      const html = await detail.text()

      // the done task: neutral gray + the Done indication, the bar still rides
      // (the elapsed timeline) in the neutral fill — but NO urgency wording
      const doneWrap = html.match(new RegExp(`data-pd-task="${doneId}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(doneWrap).toBeTruthy()
      expect(doneWrap![1]).toContain('<span class="db-due-row st-done">')
      expect(doneWrap![1]).toContain('✓ Done · Due')
      expect(doneWrap![1]).not.toContain('st-urgent')
      expect(doneWrap![1]).not.toContain('Due today')

      // the completed sprint's task: NO deadline row, NO bar (the triple is null)
      const heirWrap = html.match(new RegExp(`data-pd-task="${heirId}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(heirWrap).toBeTruthy()
      expect(heirWrap![1]).not.toContain('db-due-row')
      expect(heirWrap![1]).not.toContain('db-due-bar')
    } finally {
      close()
    }
  })

  // S244 (§10.2): the personal-over-sprint precedence — both set, the task's own
  // wins (effective_due_source 'task'); the JSON pool carries the additive triple
  // for the embedded board's client repaint twin (project-page.js pdTruthWrap).
  it('S244: personal > sprint precedence in the server-computed triple + the JSON pool carries the triple for the repaint twin', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const pid = await makeProject(db, userId)
      const now = Date.now()
      const sprintId = await makeSprint(db, pid, 'Overridden Sprint')
      await db.execute('UPDATE sprints SET due_at = ?, due_origin_at = ?, is_draft = 0 WHERE id = ?', [new Date(now + 20 * 86400000).toISOString(), new Date(now - 86400000).toISOString(), sprintId])
      const bothId = await makeDueTask(db, pid, 'both set task', { sprintId, dueAt: new Date(now + 36 * 3600000).toISOString(), dueOriginAt: new Date(now - 3600000).toISOString() })

      // the HTML render: the task's OWN deadline wins (the urgent row, not the
      // sprint's comfortable one)
      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...h(token), 'HX-Request': '1' } }))
      const html = await detail.text()
      const bothWrap = html.match(new RegExp(`data-pd-task="${bothId}"[\\s\\S]*?<span class="pd-task-body">([\\s\\S]*?)</span>\\s*</div>\\s*</div>`))
      expect(bothWrap).toBeTruthy()
      expect(bothWrap![1]).toContain('<span class="db-due-row st-urgent">')

      // the JSON pool (the repaint twin's source): the additive triple rides the
      // devTasks rows — same helper, same precedence, never forked
      const pool = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: h(token) }))
      const body = (await pool.json()) as { project: { devTasks: { id: string; effective_due_at: string | null; effective_due_source: string | null; effective_due_origin_at: string | null }[] } }
      const row = body.project.devTasks.find((t) => t.id === bothId)
      expect(row).toBeTruthy()
      expect(row!.effective_due_source).toBe('task')
      expect(row!.effective_due_at).toBeTruthy()
      expect(row!.effective_due_origin_at).toBeTruthy()
    } finally {
      close()
    }
  })
})
