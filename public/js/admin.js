// Super-admin panel (batch r) — client logic. Plain JS + fetch, no build step.
// Every action hits /api/admin/* (owner-only server-side; this UI merely hides itself
// for non-owners — the API is the actual gate). Escapes ALL user-generated strings.
(() => {
  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const t = (key, fallback) => {
    const s = window.hibanaI18n?.t(key)
    return s && s !== key ? s : (fallback ?? key)
  }
  const lang = () => window.hibanaI18n?.lang() ?? 'en'
  const fa = () => lang() === 'fa'
  const faNum = (s) => (fa() ? String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(s))
  const toast = (msg, kind) => window.hibana?.toast?.(msg, kind || 'info')
  // esc() is defined above (line 7) — the window.hibana.esc fallback was redundant.
  // H2 fix (2026-09-10): the local esc() already escapes all 5 HTML special chars.

  const state = { me: null, users: [], summary: null, log: [], quota: null, backup: null, filter: '', usage: null }
  let timer = null
  let booted = false

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.error || `${res.status} ${res.statusText}`)
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  }

  // ---- formatting -------------------------------------------------------------------
  function fmtDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (fa() && window.jalaali) {
      const j = window.jalaali.toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
      return faNum(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`)
    }
    return iso.slice(0, 10)
  }
  function fmtTime(iso) {
    if (!iso) return ''
    return fa() ? faNum(iso.slice(11, 16)) : iso.slice(11, 16) + ' UTC'
  }
  function relTime(iso) {
    if (!iso) return null
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
    if (s < 60) return t('admin.relNow', 'just now')
    const m = Math.floor(s / 60)
    if (m < 60) return fa() ? `${faNum(m)} دقیقه پیش` : `${m} min ago`
    const h = Math.floor(m / 60)
    if (h < 24) return fa() ? `${faNum(h)} ساعت پیش` : `${h} h ago`
    const d = Math.floor(h / 24)
    return fa() ? `${faNum(d)} روز پیش` : `${d} d ago`
  }
  function bannedLabel(u) {
    if (!u.suspended) return null
    // L8 fix: permanent bans now arrive as a far-future date (9999-12-31...) OR the legacy
    // 'forever' sentinel. Treat both as permanent.
    if (u.banned_until === 'forever' || (u.banned_until && u.banned_until.startsWith('9999'))) return t('admin.stForever', 'banned — permanent')
    return `${t('admin.stBannedUntil', 'banned until')} ${fmtDate(u.banned_until)} · ${fmtTime(u.banned_until)}`
  }

  // ---- data refresh ------------------------------------------------------------------
  async function refreshUsers() {
    const data = await api('GET', '/api/admin/users')
    state.users = data.users
    state.summary = data.summary
    renderUsers()
    renderOverview()
  }
  async function refreshEmails() {
    const data = await api('GET', '/api/admin/emails')
    state.quota = data.quota
    state.log = data.log
    renderEmails()
    renderOverview()
  }
  async function refreshBackup() {
    try {
      state.backup = await api('GET', '/api/admin/backup/status')
    } catch {
      state.backup = { configured: false }
    }
    renderBackup()
    renderOverview()
  }
  // 0045 error observability: lazy-loaded the first time the Errors tab opens (and
  // re-fetched on every later activation — it is one indexed SELECT, cheap enough).
  async function refreshErrors() {
    try {
      state.errors = await api('GET', '/api/admin/errors?limit=50')
    } catch {
      state.errors = { rows: [], counts_7d: [] }
    }
    renderErrors()
  }
  async function refreshAll() {
    await Promise.all([refreshUsers(), refreshEmails(), refreshBackup()])
  }

  // ---- rendering --------------------------------------------------------------------
  function kpi(value, label, cls) {
    return `<div class="adm-kpi ${cls || ''}"><strong>${value}</strong><span class="muted small">${esc(label)}</span></div>`
  }
  function renderOverview() {
    const el = $('#adm-kpis')
    if (!el || !state.summary) return
    const s = state.summary
    const q = state.quota
    const b = state.backup
    el.innerHTML =
      kpi(faNum(s.total), t('admin.kpiUsers', 'Users')) +
      kpi(faNum(s.verified), t('admin.kpiVerified', 'Verified'), 'ok') +
      kpi(faNum(s.unverified), t('admin.kpiUnverified', 'Unverified'), 'warn') +
      kpi(faNum(s.banned), t('admin.kpiBanned', 'Banned'), 'err') +
      kpi(faNum(s.online), t('admin.kpiOnline', 'Online now'), 'ok') +
      kpi(faNum(s.owners), t('admin.kpiOwners', 'Super-admins')) +
      kpi(q ? `${faNum(q.sent_today)} / ${faNum(q.limit)}` : '…', t('admin.kpiEmails', 'Emails today')) +
      kpi(b?.newest ? fmtDate(b.newest.slice(8, 18)) : t('admin.never', 'Never'), t('admin.kpiBackup', 'Last backup'))
    // recent signups (newest 5)
    const rec = [...state.users].sort((a, b2) => b2.created_at.localeCompare(a.created_at)).slice(0, 5)
    $('#adm-recent').innerHTML =
      rec.map((u) => `<li class="row spread"><span>${esc(u.username ?? u.email)}</span><span class="muted small">${fmtDate(u.created_at)}${u.email_verified_at ? '' : ' · ' + esc(t('admin.stUnverified', 'unverified'))}</span></li>`).join('') ||
      `<li class="muted small">—</li>`
  }

  function statusBadge(u) {
    if (u.suspended) return `<span class="badge adm-badge-banned">${esc(bannedLabel(u))}</span>`
    if (!u.email_verified_at) return `<span class="badge adm-badge-unverified">${esc(t('admin.stUnverified', 'unverified'))}</span>`
    return `<span class="badge adm-badge-verified">${esc(t('admin.stVerified', 'verified'))}</span>`
  }
  function userCard(u) {
    return `<article class="card adm-user${u.online ? ' is-online' : ''}" data-uid="${esc(u.id)}" tabindex="0" role="button" aria-label="${esc(u.username ?? u.email)}">
      <div class="row spread adm-user-head">
        <strong class="adm-user-name">${esc(u.username ?? u.email)}${u.is_self ? ` <span class="adm-self">${esc(t('admin.self', 'you'))}</span>` : ''}</strong>
        <span class="row gap adm-user-badges">
          ${u.role === 'owner' ? `<span class="badge adm-badge-owner">${esc(t('admin.roleOwner', 'super-admin'))}</span>` : ''}
          ${statusBadge(u)}
          ${u.online ? `<span class="adm-online-dot" title="${esc(t('admin.onlineNow', 'online'))}" aria-label="${esc(t('admin.onlineNow', 'online'))}"></span>` : ''}
        </span>
      </div>
      <div class="muted small adm-user-mail">${esc(u.email)}</div>
      <div class="muted small adm-user-meta">
        <span>${esc(t('admin.colActivity', 'Last activity'))}: ${u.last_seen_at ? esc(relTime(u.last_seen_at)) : esc(t('admin.never', 'never'))}</span>
        <span>${esc(t('admin.joined', 'Joined'))} ${fmtDate(u.created_at)}</span>
        <span>${faNum(u.projects)} ${esc(t('admin.projects', 'projects'))} · ${faNum(u.notes)} ${esc(t('admin.notes', 'notes'))}</span>
      </div>
      ${u.suspended && u.ban_reason ? `<div class="adm-ban-reason muted small">«${esc(u.ban_reason)}»</div>` : ''}
    </article>`
  }
  function renderUsers() {
    const list = $('#adm-userlist')
    if (!list) return
    const f = state.filter.trim().toLowerCase()
    const users = f
      ? state.users.filter((u) => (u.username ?? '').toLowerCase().includes(f) || u.email.toLowerCase().includes(f))
      : state.users
    list.innerHTML = users.map(userCard).join('') || `<p class="muted small">${esc(t('admin.noMatch', 'No users match.'))}</p>`
    const count = $('#adm-users-count')
    if (count) count.textContent = f ? `${users.length} / ${state.users.length}` : `${state.users.length}`
    $$('.adm-user', list).forEach((card) => {
      const open = () => {
        const u = state.users.find((x) => x.id === card.dataset.uid)
        if (u) openUserModal(u)
      }
      card.addEventListener('click', open)
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
    })
  }

  function renderEmails() {
    // quota meter
    const fill = $('#adm-quota-fill')
    const text = $('#adm-quota-text')
    if (fill && state.quota) {
      const pct = Math.min(100, Math.round((state.quota.sent_today / state.quota.limit) * 100))
      fill.style.width = pct + '%'
      fill.classList.toggle('is-high', pct >= 80)
      text.textContent = `${faNum(state.quota.sent_today)} / ${faNum(state.quota.limit)}`
    }
    // recipient dropdown
    const sel = $('#adm-mail-to')
    if (sel && state.users.length) {
      const prev = sel.value
      sel.innerHTML = state.users
        .map((u) => `<option value="${esc(u.id)}">${esc(u.username ?? u.email)} — ${esc(u.email)}</option>`)
        .join('')
      if (prev && state.users.some((u) => u.id === prev)) sel.value = prev
    }
    // log
    const logEl = $('#adm-maillog')
    if (logEl) {
      logEl.innerHTML =
        state.log
          .map((r) => {
            const status = r.status === 'sent'
              ? `<span class="badge adm-badge-verified">${esc(t('admin.logSent', 'sent'))}</span>`
              : `<span class="badge adm-badge-banned">${esc(t('admin.logFailed', 'failed'))}</span>`
            return `<li class="row spread adm-log-row">
              <span class="small">${esc(r.to_email)}</span>
              <span class="row gap">${status}<span class="muted small">${fmtDate(r.sent_at)} ${fmtTime(r.sent_at)}</span></span>
            </li>`
          })
          .join('') || `<li class="muted small">—</li>`
    }
  }

  function renderBackup() {
    const el = $('#adm-backup-status')
    if (!el || !state.backup) return
    if (!state.backup.configured) {
      el.textContent = t('admin.backupNoRepo', 'GitHub backup is not configured (GITHUB_TOKEN secret missing).')
      return
    }
    if (state.backup.error) {
      el.textContent = `${t('admin.backupRepoError', 'Could not list the repo:')} ${state.backup.error}`
      return
    }
    const b = state.backup
    el.textContent =
      (b.count ? `${faNum(b.count)} ${t('admin.backupSnapshots', 'snapshots')} · ` : '') +
      (b.newest ? `${t('admin.backupNewest', 'newest:')} ${esc(b.newest)} · ` : t('admin.backupNone', 'No snapshots yet') + ' · ') +
      `${faNum(b.retention)} ${t('admin.backupRetention', 'kept (auto-pruned)')}`
  }

  function renderErrors() {
    if (!state.errors) return
    const countsEl = $('#adm-errors-counts')
    const listEl = $('#adm-errors-log')
    if (!countsEl || !listEl) return
    const counts = state.errors.counts_7d || []
    countsEl.textContent = counts.length
      ? counts.map((c) => `${faNum(c.n)} × ${c.status}`).join(' · ')
      : t('admin.errorsNone', 'No errors logged in the last 7 days.')
    const rows = state.errors.rows || []
    listEl.innerHTML =
      rows
        .map((r) => {
          const badge = r.status >= 500 ? 'adm-badge-banned' : 'adm-badge-unverified'
          return `<li class="row spread">
            <span class="small">
              <span class="badge ${badge}">${esc(String(r.status))}</span>
              <strong>${esc(r.code || 'error')}</strong>
              <span class="muted">${esc(r.path || '')}</span>
              ${r.message ? `<span class="muted small">${esc(String(r.message).slice(0, 160))}</span>` : ''}
            </span>
            <span class="muted small">${r.req_id ? esc(r.req_id.slice(0, 8)) + ' · ' : ''}${esc(relTime(r.created_at) || '')}</span>
          </li>`
        })
        .join('') || `<li class="muted small">—</li>`
  }

  // ---- usage analytics (2026-09-12, §6 open item) -------------------------------------
  // Feature labels live here (not in the API) so the endpoint ships stable keys and
  // the panel stays fully i18n'd. Order matches the API's USAGE_SURFACES order.
  const USAGE_FEAT_LABELS = {
    projects: ['admin.usageFeatProjects', 'Projects'],
    sparkFolders: ['admin.usageFeatFolders', 'Spark folders'],
    canvas: ['admin.usageFeatCanvas', 'Canvas elements'],
    notebook: ['admin.usageFeatNotebook', 'Notebook elements'],
    quickNotes: ['admin.usageFeatNotes', 'Quick notes'],
    sadhanaTasks: ['admin.usageFeatSadhana', 'To-do tasks'],
    sadhanaUpdates: ['admin.usageFeatJournal', 'Task journal'],
    devTasks: ['admin.usageFeatDev', 'Dev tasks'],
    hurdles: ['admin.usageFeatHurdles', 'Hurdles'],
    sprints: ['admin.usageFeatSprints', 'Sprints'],
    backlogDocs: ['admin.usageFeatBacklog', 'Backlog docs'],
    links: ['admin.usageFeatLinks', 'Links'],
    payments: ['admin.usageFeatPayments', 'Payments'],
    telegramCaptures: ['admin.usageFeatTelegram', 'Telegram captures'],
    screenshots: ['admin.usageFeatAI', 'AI screenshots'],
    archives: ['admin.usageFeatArchives', 'Archives'],
    invites: ['admin.usageFeatInvites', 'Invites'],
  }
  const USAGE_PART_LABELS = {
    projects: ['admin.usagePartProjects', 'projects'],
    canvas: ['admin.usagePartCanvas', 'canvas'],
    notebook: ['admin.usagePartNotebook', 'notebook'],
    notes: ['admin.usagePartNotes', 'notes'],
    sadhana: ['admin.usagePartSadhana', 'to-dos'],
    updates: ['admin.usagePartUpdates', 'journal'],
    devtasks: ['admin.usagePartDev', 'dev tasks'],
    backlog: ['admin.usagePartBacklog', 'backlog'],
    telegram: ['admin.usagePartTelegram', 'telegram'],
    screenshots: ['admin.usagePartAI', 'AI'],
  }

  async function refreshUsage() {
    state.usage = await api('GET', '/api/admin/usage')
    renderUsage()
  }

  function renderUsage() {
    if (!state.usage) return
    renderUsageFeats()
    renderUsageTop()
    renderUsageDaily()
  }

  function renderUsageFeats() {
    const el = $('#adm-usage-feats')
    if (!el) return
    const feats = state.usage.features || []
    const max = Math.max(1, ...feats.map((f) => f.count))
    el.innerHTML =
      feats
        .map((f) => {
          const label = USAGE_FEAT_LABELS[f.key] || [null, f.key]
          const pct = Math.round((f.count / max) * 100)
          return `<li class="adm-usage-feat${f.count ? '' : ' is-zero'}">
            <span class="adm-usage-feat-name">${esc(t(label[0], label[1]))}</span>
            <span class="adm-usage-feat-bar" aria-hidden="true"><i style="inline-size:${pct}%"></i></span>
            <span class="adm-usage-feat-count">${faNum(f.count)}</span>
            <span class="adm-usage-feat-last muted small">${f.last_at ? esc(relTime(f.last_at) || '') : '&mdash;'}</span>
          </li>`
        })
        .join('') || `<li class="muted small">—</li>`
  }

  function renderUsageTop() {
    const el = $('#adm-usage-top')
    if (!el) return
    const users = state.usage.top_users || []
    const max = Math.max(1, ...users.map((u) => u.score))
    el.innerHTML =
      users
        .map((u, i) => {
          const pct = Math.round((u.score / max) * 100)
          const parts = Object.entries(u.parts || {})
            .map(([k, n]) => {
              const label = USAGE_PART_LABELS[k] || [null, k]
              return `<span class="adm-usage-part">${faNum(n)} ${esc(t(label[0], label[1]))}</span>`
            })
            .join('')
          return `<li class="adm-usage-row">
            <span class="adm-usage-rank${i === 0 ? ' is-first' : ''}">${faNum(i + 1)}</span>
            <span class="adm-usage-user">
              <strong>${esc(u.username ?? u.email)}</strong>
              <span class="adm-usage-bar" aria-hidden="true"><i style="inline-size:${pct}%"></i></span>
              <span class="muted small">${parts}</span>
            </span>
            <span class="adm-usage-score">${faNum(u.score)}</span>
          </li>`
        })
        .join('') || `<li class="muted small">${esc(t('admin.usageNone', 'No activity yet.'))}</li>`
  }

  function renderUsageDaily() {
    const el = $('#adm-usage-daily')
    if (!el) return
    const days = state.usage.daily || []
    const max = Math.max(1, ...days.map((d) => d.count))
    // Bar chart as flex columns; each carries its count as title text (native tooltip,
    // works for keyboard+touch too). Labels: first + last day + every 3rd, FA digits in fa.
    el.innerHTML = days
      .map((d) => {
        const pct = Math.round((d.count / max) * 100)
        const showLabel = days.indexOf(d) === 0 || days.indexOf(d) === days.length - 1 || days.indexOf(d) % 3 === 0
        const label = showLabel ? `<span class="adm-usage-daylbl">${faNum(d.day.slice(5))}</span>` : '<span class="adm-usage-daylbl" aria-hidden="true"></span>'
        return `<span class="adm-usage-day" title="${esc(d.day)} · ${faNum(d.count)}">
          <span class="adm-usage-col" aria-hidden="true"><i style="block-size:${Math.max(pct, d.count ? 6 : 2)}%"></i></span>
          ${label}
        </span>`
      })
      .join('')
    const total = days.reduce((n, d) => n + d.count, 0)
    el.setAttribute('aria-label', `${t('admin.usageDailyTitle', 'Creations — last 14 days')}: ${faNum(total)}`)
  }

  // ---- modal (one dialog, content per user) -----------------------------------------
  function closeModal() {
    const d = $('#adm-modal')
    if (d && d.open) d.close()
  }
  function openModal(html) {
    const d = $('#adm-modal')
    if (!d) return
    d.innerHTML = html
    if (!d.open) d.showModal()
    d.onclick = (e) => {
      if (e.target === d) d.close() // backdrop click
    }
  }

  function openUserModal(u) {
    const isOwner = u.role === 'owner'
    const banBlock =
      u.suspended
        ? `<div class="adm-modal-row">
             <button type="button" class="ghost" data-act="unban"><span data-i18n="admin.actUnban">Lift suspension</span></button>
             <span class="muted small">${esc(bannedLabel(u))}</span>
           </div>`
        : isOwner
          ? `<p class="muted small">${esc(t('admin.ownerProtected', 'Super-admins are protected — demote first.'))}</p>`
          : `<div class="adm-modal-block">
              <h4 data-i18n="admin.banTitle">Suspend user</h4>
              <div class="row wrap adm-presets" role="group" aria-label="Ban duration">
                ${['1d', '3d', '7d', '30d', 'forever'].map((p) => `<button type="button" class="adm-preset" data-preset="${p}">${esc(t('admin.ban' + p, p))}</button>`).join('')}
              </div>
              <label><span data-i18n="admin.banCustom">Custom date &amp; time</span> <input type="datetime-local" id="adm-ban-until"></label>
              <label><span data-i18n="admin.banReason">Reason (shown to the user)</span> <textarea id="adm-ban-reason" rows="2" maxlength="500"></textarea></label>
              <button type="button" class="adm-primary" data-act="ban" disabled><span data-i18n="admin.banConfirm">Suspend</span></button>
              <p class="muted small" data-i18n="admin.banNote">All sessions are signed out immediately.</p>
            </div>`
    const roleBlock =
      u.is_self
        ? `<p class="muted small">${esc(t('admin.ownRoleNote', 'You cannot change your own role — use another super-admin.'))}</p>`
        : `<div class="adm-modal-row">
             ${u.role === 'member'
               ? `<button type="button" class="ghost" data-act="promote"><span data-i18n="admin.actPromote">Promote to super-admin</span></button>`
               : `<button type="button" class="ghost" data-act="demote"><span data-i18n="admin.actDemote">Demote to member</span></button>`}
           </div>`
    const removeBlock = isOwner
      ? ''
      : `<div class="adm-modal-block adm-danger">
          <h4 data-i18n="admin.removeTitle">Remove account</h4>
          <p class="muted small" data-i18n="admin.removeWarn">Permanent. Deletes ALL of this user's projects, notes, to-dos and history.</p>
          <label><span data-i18n="admin.removeConfirm">Type the username to confirm</span> <input id="adm-rm-confirm" autocomplete="off"></label>
          <button type="button" class="adm-danger-btn" data-act="remove" disabled><span data-i18n="admin.removeBtn">Delete forever</span></button>
        </div>`

    openModal(`
      <header class="adm-modal-head">
        <strong>${esc(u.username ?? u.email)}</strong>
        ${u.role === 'owner' ? `<span class="badge adm-badge-owner">${esc(t('admin.roleOwner', 'super-admin'))}</span>` : ''}
        ${statusBadge(u)}
      </header>
      <p class="muted small">${esc(u.email)} · ${esc(t('admin.joined', 'Joined'))} ${fmtDate(u.created_at)} · ${esc(t('admin.colActivity', 'Last activity'))}: ${u.last_seen_at ? esc(relTime(u.last_seen_at)) : esc(t('admin.never', 'never'))}</p>
      <div class="adm-modal-row">
        <button type="button" class="ghost" data-act="send-reset"><span data-i18n="admin.actReset">Send password-reset email</span></button>
      </div>
      ${banBlock}
      ${roleBlock}
      <div class="adm-modal-block">
        <h4 data-i18n="admin.mailTitle">Email user</h4>
        <label><span data-i18n="admin.mailSubject">Subject</span> <input id="adm-modal-subject" maxlength="200"></label>
        <label><span data-i18n="admin.mailBody">Message</span> <textarea id="adm-modal-body" rows="4" maxlength="20000"></textarea></label>
        <button type="button" class="adm-primary" data-act="mail"><span data-i18n="admin.mailSend">Send</span></button>
      </div>
      ${removeBlock}
      <footer class="adm-modal-foot"><button type="button" class="ghost" data-act="close"><span data-i18n="admin.close">Close</span></button></footer>
    `)

    const d = $('#adm-modal')
    // ban preset chips
    let chosen = null
    $$('.adm-preset', d).forEach((b) =>
      b.addEventListener('click', () => {
        chosen = b.dataset.preset
        $$('.adm-preset', d).forEach((x) => x.classList.toggle('is-active', x === b))
        $('[data-act="ban"]', d).disabled = false
      }),
    )
    const untilInput = $('#adm-ban-until', d)
    if (untilInput) {
      untilInput.addEventListener('input', () => {
        if (untilInput.value) {
          chosen = 'custom'
          $$('.adm-preset', d).forEach((x) => x.classList.remove('is-active'))
          $('[data-act="ban"]', d).disabled = false
        }
      })
    }
    const rmInput = $('#adm-rm-confirm', d)
    if (rmInput) {
      const expect = u.username ?? u.email
      const rmBtn = $('[data-act="remove"]', d)
      rmInput.addEventListener('input', () => {
        rmBtn.disabled = rmInput.value.trim() !== expect
      })
    }

    $$('[data-act]', d).forEach((btn) =>
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act
        try {
          if (act === 'close') return closeModal()
          if (act === 'unban') {
            await api('POST', `/api/admin/users/${u.id}/unban`)
            toast(t('admin.doneUnban', 'Suspension lifted'))
          } else if (act === 'ban') {
            const reason = $('#adm-ban-reason', d)?.value.trim() || undefined
            let body
            if (chosen === 'custom') body = { until: new Date(untilInput.value).toISOString(), reason }
            else body = { preset: chosen, reason }
            const r = await api('PATCH', `/api/admin/users/${u.id}/ban`, body)
            // L8 fix: permanent bans arrive as a far-future date (9999...) or legacy 'forever'
            const isPermanent = r.banned_until === 'forever' || (r.banned_until && r.banned_until.startsWith('9999'))
            toast(`${t('admin.doneBan', 'Suspended')} — ${isPermanent ? t('admin.stForever', 'permanent') : esc(r.banned_until)}`)
          } else if (act === 'promote') {
            if (!confirm(t('admin.confirmPromote', 'Promote this account to super-admin?'))) return
            await api('POST', `/api/admin/users/${u.id}/role`, { role: 'owner' })
            toast(t('admin.donePromote', 'Promoted to super-admin'))
          } else if (act === 'demote') {
            if (!confirm(t('admin.confirmDemote', 'Demote this super-admin to member?'))) return
            await api('POST', `/api/admin/users/${u.id}/role`, { role: 'member' })
            toast(t('admin.doneDemote', 'Demoted to member'))
          } else if (act === 'send-reset') {
            btn.disabled = true
            const r = await api('POST', `/api/admin/users/${u.id}/send-reset`)
            toast(`${t('admin.doneReset', 'Reset email sent to')} ${esc(r.sent_to)}`)
          } else if (act === 'mail') {
            const subject = $('#adm-modal-subject', d)?.value.trim()
            const body2 = $('#adm-modal-body', d)?.value.trim()
            if (!subject || !body2) return toast(t('admin.errMailEmpty', 'Subject and message are required.'), 'err')
            btn.disabled = true
            const r = await api('POST', '/api/admin/email', { to: u.id, subject, body: body2 })
            toast(`${t('admin.doneMail', 'Email sent to')} ${esc(r.sent_to)}`)
          } else if (act === 'remove') {
            const r = await api('DELETE', `/api/admin/users/${u.id}`, { confirm: rmInput.value.trim() })
            toast(`${t('admin.doneRemove', 'Removed')} ${esc(r.removed)}`)
          }
          closeModal()
          refreshAll().catch(() => {})
        } catch (err) {
          btn.disabled = false
          toast(errMessage(err), 'err')
        }
      }),
    )
    window.hibanaI18n?.apply?.()
  }

  function errMessage(err) {
    const d = err?.data ?? {}
    if (err?.status === 429 || d.error === 'quota_exhausted') return t('admin.errQuota', 'Daily email quota (100) is exhausted — try tomorrow.')
    if (d.error === 'owner_protected') return t('admin.ownerProtected', 'Super-admins are protected — demote first.')
    if (d.error === 'last_owner') return t('admin.errLastOwner', 'The last super-admin cannot be demoted.')
    if (d.error === 'cannot_change_own_role') return t('admin.ownRoleNote', 'You cannot change your own role.')
    if (d.error === 'confirm_mismatch') return t('admin.errConfirm', 'The typed username does not match.')
    if (d.error === 'email_failed' || err?.status === 502) return `${t('admin.errMail', 'Email send failed:')} ${d.detail ?? err.message}`
    if (d.error === 'forbidden') return t('admin.deny', 'This area is owner-only.')
    return `${t('admin.errGeneric', 'Action failed:')} ${d.error ?? err.message}`
  }

  // ---- email tab forms ---------------------------------------------------------------
  async function sendCustom(e) {
    e.preventDefault()
    const to = $('#adm-mail-to').value
    const subject = $('#adm-mail-subject').value.trim()
    const body = $('#adm-mail-body').value.trim()
    if (!to || !subject || !body) return
    try {
      const r = await api('POST', '/api/admin/email', { to, subject, body })
      toast(`${t('admin.doneMail', 'Email sent to')} ${esc(r.sent_to)}`)
      $('#adm-mail-subject').value = ''
      $('#adm-mail-body').value = ''
    } catch (err) {
      toast(errMessage(err), 'err')
    } finally {
      // success AND failure land in email_log — always re-render the log/quota
      refreshEmails().catch(() => {})
    }
  }

  async function sendBroadcast(e) {
    e.preventDefault()
    const subject = $('#adm-bc-subject').value.trim()
    const body = $('#adm-bc-body').value.trim()
    if (!subject || !body) return
    const btn = $('#adm-bc-send')
    const prog = $('#adm-bc-progress')
    btn.disabled = true
    let offset = 0
    let sent = 0
    let failed = 0
    let total = 0
    try {
      // chunked loop: each call sends ≤40 recipients and ≤ the remaining daily quota
      for (;;) {
        const r = await api('POST', '/api/admin/email/broadcast', { subject, body, offset })
        sent += r.sent
        failed += r.failed.length
        total = r.total
        offset += r.attempted
        prog.textContent = `${faNum(sent)} / ${faNum(total)}…`
        if (r.done) break
      }
      toast(
        `${t('admin.bcDone', 'Broadcast finished:')} ${faNum(sent)}${failed ? ` · ${faNum(failed)} ${t('admin.bcFailed', 'failed')}` : ''}`,
      )
      $('#adm-bc-subject').value = ''
      $('#adm-bc-body').value = ''
      refreshEmails().catch(() => {})
    } catch (err) {
      toast(errMessage(err), 'err')
    } finally {
      prog.textContent = ''
      btn.disabled = false
      // partial/failed chunks are part of the honest log — always refresh
      refreshEmails().catch(() => {})
    }
  }

  // ---- boot / mount -----------------------------------------------------------------
  function bindStatic() {
    $$('.adm-tabs [data-adm-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.adm-tabs [data-adm-tab]').forEach((b) => b.classList.toggle('is-active', b === btn))
        $$('.adm-panel').forEach((p) => (p.hidden = p.id !== `adm-panel-${btn.dataset.admTab}`))
        // 0045: the Errors panel fetches on activation — no need to hit the endpoint on
        // every console visit for a log that is usually empty.
        if (btn.dataset.admTab === 'errors') refreshErrors().catch(() => {})
        // Same lazy-load contract for the Usage analytics (aggregates over every
        // content table — never pay for it unless the tab is opened).
        if (btn.dataset.admTab === 'usage') refreshUsage().catch(() => {})
      })
    })
    const search = $('#adm-search')
    if (search) search.addEventListener('input', () => { state.filter = search.value; renderUsers() })
    const mailForm = $('#adm-mail-form')
    if (mailForm) mailForm.addEventListener('submit', sendCustom)
    const bcForm = $('#adm-bc-form')
    if (bcForm) bcForm.addEventListener('submit', sendBroadcast)
    const backupNow = $('#adm-backup-now')
    if (backupNow)
      backupNow.addEventListener('click', async () => {
        backupNow.disabled = true
        try {
          const r = await api('POST', '/api/admin/backup')
          toast(`${t('admin.doneBackup', 'Backup committed:')} ${esc(r.path)}`)
          refreshBackup().catch(() => {})
        } catch (err) {
          toast(errMessage(err), 'err')
        } finally {
          backupNow.disabled = false
        }
      })
  }

  async function boot() {
    const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!me || me.user.role !== 'owner') {
      const deny = $('#adm-deny')
      if (deny) deny.hidden = false
      return
    }
    state.me = me.user
    const root = $('#adm-root')
    if (root) root.hidden = false
    bindStatic()
    await refreshAll().catch(() => {})
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      if (!document.hidden && $('#adm-root') && !$('#adm-root').hidden) refreshUsers().catch(() => {})
    }, 60000)
  }

  function mount() {
    if (!booted) {
      booted = true
      boot().catch(() => {})
    } else {
      // soft re-entry: the <main> was replaced — rebind + refresh (state stays warm)
      if (state.me) {
        const root = $('#adm-root')
        if (root) root.hidden = false
      }
      bindStatic()
      refreshAll().catch(() => {})
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        if (!document.hidden && $('#adm-root') && !$('#adm-root').hidden) refreshUsers().catch(() => {})
      }, 60000)
    }
  }
  function unmount() {
    if (timer) clearInterval(timer)
    timer = null
    closeModal()
  }

  window.hibanaAdmin = { mount, unmount }
})()
