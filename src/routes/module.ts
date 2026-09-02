import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, jsonBody } from '../lib/http'
import { getOwnedProject, icon, STATUS_LABEL_FA, timeAgo } from '../lib/html'
import { localeOf, trL } from '../lib/i18n'
import { uuid } from '../lib/ids'
import { clientProgress, elapsedFraction } from '../services/progress'
import type { Config, PaymentRow, ProjectRow, TaskRow, UserRow } from '../types'

// Client-work module (spec §6): tasks, payments, and the separate client dashboard.
// This is deliberately a separate world from the personal side (spec §1 + §5.9).

const taskSchema = z.object({ id: z.string().uuid().optional(), title: z.string().min(1).max(300), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })
const taskPatchSchema = z.object({ title: z.string().min(1).max(300).optional(), done: z.union([z.literal(0), z.literal(1)]).optional() })
const paymentSchema = z.object({ id: z.string().uuid().optional(), label: z.string().min(1).max(100), amount: z.number().nonnegative(), currency: z.string().max(10).optional().default('USD'), status: z.enum(['pending', 'paid']).optional().default('pending') })

export function moduleRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // ---- client dashboard (spec §5.9) ----------------------------------------
  app.get('/api/clients', async (c) => {
    const lang = localeOf(c)
    const user = c.get('user')
    const projects = await cfg.db.query<ProjectRow>(
      "SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND type = 'client' ORDER BY due_date, updated_at DESC",
      [user.id],
    )
    const rows = await Promise.all(
      projects.map(async (p) => {
        const [tasks, payments] = await Promise.all([
          cfg.db.query<TaskRow>('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at', [p.id]),
          cfg.db.query<PaymentRow>('SELECT * FROM payments WHERE project_id = ? ORDER BY created_at', [p.id]),
        ])
        const pct = p.progress_percent ?? clientProgress({ total: tasks.length, done: tasks.filter((t) => t.done === 1).length })
        return { project: p, tasks, payments, progress: pct, elapsed: p.due_date ? elapsedFraction(p.due_date) : null }
      }),
    )
    if (c.req.header('HX-Request')) {
      const html = rows.map((r) => {
        const tasks = r.tasks.map((t) => `<li class="hurdle ${t.done ? 'done' : ''}" id="task-${t.id}">
          <button class="ghost toggle" hx-patch="/api/tasks/${t.id}" hx-vals='{"done":${t.done === 1 ? 0 : 1}}' hx-target="#client-body" hx-trigger="click" hx-swap="innerHTML">${icon(t.done ? 'check' : 'unchecked')}</button>
          <span>${esc(t.title)}</span></li>`).join('') || `<li class="muted">${trL(lang, 'No tasks yet.', 'هنوز وظیفهای نیست')}</li>`
        const pays = r.payments.map((p) => `<li class="row spread">
          <span>${esc(p.label)} — <b>${p.amount} ${esc(p.currency)}</b></span>
          <span class="badge ${p.status === 'paid' ? 'badge-working' : 'badge-pending'}">${trL(lang, p.status, p.status === 'paid' ? 'پرداختشده' : 'در انتظار')}</span>
          <button class="ghost" hx-patch="/api/payments/${p.id}" hx-vals='{"status":"${p.status === 'paid' ? 'pending' : 'paid'}"}' hx-target="#client-body" hx-trigger="click" hx-swap="innerHTML">${trL(lang, 'toggle', 'تغییر وضعیت')}</button>
        </li>`).join('') || `<li class="muted">${trL(lang, 'No payment milestones yet.', 'هنوز هیچ مرحلهٔ پرداختی نیست.')}</li>`
        return `<section class="card project-card" id="project-${r.project.id}">
          <div class="row title-meta spread">
            <a class="project-title" href="/project.html?id=${r.project.id}">${esc(r.project.title)}</a>
            <span class="row">
              <button class="ghost small" hx-post="/api/projects/${r.project.id}/reminders" hx-vals='{"enabled":${r.project.reminders_enabled ? 0 : 1}}' hx-target="#client-body" hx-trigger="click" hx-swap="innerHTML" title="${trL(lang, 'Deadline reminders: off/on (email + your linked Telegram)', 'یادآوری سررسید: خاموش/روشن (ایمیل + تلگرام پیوندشده)')}">${r.project.reminders_enabled ? '🔔 ' + trL(lang, 'Reminders on', 'یادآوری روشن') : trL(lang, 'Reminders off', 'یادآوری خاموش')}</button>
              <span class="badge badge-${r.project.status}">${trL(lang, r.project.status, STATUS_LABEL_FA[r.project.status])}</span>
            </span>
          </div>
          <div class="row spread small muted">
            <span>${esc(r.project.client_name ?? '—')} · ${trL(lang, 'due', 'سررسید')} ${r.project.due_date ?? '—'}</span>
            <span><b>${r.progress}%</b> · ${Math.round((r.elapsed ?? 0) * 100)}% ${trL(lang, 'of time used', 'از زمان استفادهشده')}</span>
          </div>
          <div class="progress" style="--pct:${r.progress}%"><span style="inline-size:${r.progress}%"></span></div>
          <details><summary>${trL(lang, 'Tasks ({n})', 'وظایف ({n})', { n: r.tasks.length })}</summary><ul>${tasks}</ul>
            <form class="row" hx-post="/api/projects/${r.project.id}/tasks" hx-target="#client-body" hx-trigger="submit" hx-swap="innerHTML">
              <input name="title" placeholder="${trL(lang, 'New task…', 'وظیفه جدید…')}" required maxlength="300"><button>${trL(lang, 'Add', 'افزودن')}</button>
            </form>
          </details>
          <details><summary>${trL(lang, 'Payments', 'پرداختها')}</summary><ul>${pays}</ul>
            <form class="row" hx-post="/api/projects/${r.project.id}/payments" hx-target="#client-body" hx-trigger="submit" hx-swap="innerHTML">
              <input name="label" placeholder="${trL(lang, 'Label (Deposit…)', 'برچسب (پیشپرداخت…)')}" required><input name="amount" type="number" placeholder="${trL(lang, 'Amount', 'مبلغ')}" min="0" step="0.01" required><button>${trL(lang, 'Add', 'افزودن')}</button>
            </form>
          </details>
        </section>`
      }).join('') || `<div class="empty">${trL(lang, 'No client projects yet — create one with type "client" from the ＋ button (Settings or the project screen).', 'هنوز هیچ پروژهٔ مشتریای نیست — با دکمه ＋ یک پروژه با نوع «مشتری» بساز (از صفحهٔ تنظیمات یا پروژه).')}</div>`
      return c.html(`<div id="client-body">${html}</div>`)
    }
    return c.json({ rows })
  })

  // ---- tasks ----------------------------------------------------------------
  app.post('/api/projects/:projectId/tasks', async (c) => {
    const body = await jsonBody<z.infer<typeof taskSchema>>(c, taskSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const id = body.id ?? uuid()
    await cfg.db.execute('INSERT INTO tasks (id, project_id, title, done, due_date, created_at) VALUES (?, ?, ?, 0, ?, ?)', [
      id, p.id, body.title, body.due_date ?? null, new Date().toISOString(),
    ])
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', '/api/clients')
      return c.html('')
    }
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/tasks/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof taskPatchSchema>>(c, taskPatchSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const rows = await cfg.db.query<{ project_id: string }>(
      'SELECT project_id FROM tasks WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
      [c.req.param('id'), user.id],
    )
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    if (body.done !== undefined) {
      await cfg.db.execute('UPDATE tasks SET done = ?, completed_at = ? WHERE id = ?', [body.done, body.done === 1 ? now : null, c.req.param('id')])
      await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, rows[0].project_id])
    }
    if (body.title) await cfg.db.execute('UPDATE tasks SET title = ? WHERE id = ?', [body.title, c.req.param('id')])
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', '/api/clients')
      return c.html('')
    }
    return c.json({ ok: true })
  })

  app.delete('/api/tasks/:id', async (c) => {
    const user = c.get('user')
    await cfg.db.execute('DELETE FROM tasks WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [
      c.req.param('id'), user.id,
    ])
    return c.json({ ok: true })
  })

  // ---- payments --------------------------------------------------------------
  app.post('/api/projects/:projectId/payments', async (c) => {
    const body = await jsonBody<z.infer<typeof paymentSchema>>(c, paymentSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const id = body.id ?? uuid()
    await cfg.db.execute('INSERT INTO payments (id, project_id, label, amount, currency, status) VALUES (?, ?, ?, ?, ?, ?)', [
      id, p.id, body.label, body.amount, body.currency, body.status,
    ])
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', '/api/clients')
      return c.html('')
    }
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/payments/:id', async (c) => {
    const body = await jsonBody<{ status?: 'pending' | 'paid' }>(c, z.object({ status: z.enum(['pending', 'paid']).optional() }))
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const rows = await cfg.db.query<{ project_id: string }>(
      'SELECT project_id FROM payments WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
      [c.req.param('id'), user.id],
    )
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    if (body.status) {
      await cfg.db.execute('UPDATE payments SET status = ?, paid_at = ? WHERE id = ?', [body.status, body.status === 'paid' ? now : null, c.req.param('id')])
      await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, rows[0].project_id])
    }
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', '/api/clients')
      return c.html('')
    }
    return c.json({ ok: true })
  })

  app.delete('/api/payments/:id', async (c) => {
    const user = c.get('user')
    await cfg.db.execute('DELETE FROM payments WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [
      c.req.param('id'), user.id,
    ])
    return c.json({ ok: true })
  })

  // ---- reminder control (opt-in per project, spec §6.3) ----------------------
  app.post('/api/projects/:projectId/reminders', async (c) => {
    const body = await jsonBody<{ enabled: 0 | 1 }>(c, z.object({ enabled: z.union([z.literal(0), z.literal(1)]) }))
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM projects WHERE id = ? AND user_id = ?',
      [c.req.param('projectId'), user.id],
    )
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('UPDATE projects SET reminders_enabled = ?, updated_at = ? WHERE id = ?', [body.enabled, new Date().toISOString(), rows[0].id])
    if (c.req.header('HX-Request')) {
      // Re-render the client body so the toggle reflects the new state (same pattern
      // as tasks/payments: the button lives inside #client-body).
      c.header('HX-Redirect', '/api/clients')
      return c.html('')
    }
    return c.json({ ok: true })
  })

  return app
}