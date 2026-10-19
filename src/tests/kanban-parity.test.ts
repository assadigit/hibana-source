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
})
