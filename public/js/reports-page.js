    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'reports',
      mount(ctx) {
        // ---- Recent activity (merged from the former /timeline page, 2026-08-29) ----
        const _t = (k, f) => window.hibanaI18n?.t(k) || f
        // S56: heatmap tooltip touch support — a tap focuses the cell (:focus shows
        // the card, same as keyboard); this dismisses it when the tap lands anywhere
        // else (touch has no blur-on-tap-elsewhere for non-focusable targets) and on
        // Escape. Passive listener — never delays scrolling.
        document.addEventListener('touchstart', (e) => {
          if (e.target instanceof Element && e.target.closest('.heatmap-cell')) return
          const focused = document.querySelector('.heatmap-cell:focus')
          if (focused) focused.blur()
        }, { passive: true })
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape') return
          const focused = document.querySelector('.heatmap-cell:focus')
          if (focused) focused.blur()
        })
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
        const faNum = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
        const timeAgo = (iso) => {
          const isFA = window.hibanaI18n?.lang?.() === 'fa'
          const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
          const fmt = (tpl, n) => (isFA ? faNum(tpl) : tpl).split('{n}').join(isFA ? faNum(String(n)) : String(n))
          if (m < 1) return isFA ? 'همین حالا' : 'just now'
          if (m < 60) return fmt('{n}m ago', m)
          if (m < 1440) return fmt('{n}h ago', Math.floor(m / 60))
          if (m < 43200) return fmt('{n}d ago', Math.floor(m / 1440))
          if (m < 525600) return fmt('{n}mo ago', Math.floor(m / 43200))
          return fmt('{n}y ago', Math.floor(m / 525600))
        }
        let nextCursor = null
        const feed = () => document.getElementById('feed')
        const moreBtn = document.getElementById('feed-more')
        const otd = document.getElementById('on-this-day')
        const otdContent = document.getElementById('otd-content')

        // "On this day" flashback (B4.3) — parallel to the feed.
        fetch('/api/timeline/on-this-day').then((r) => r.ok ? r.json() : null).then((data) => {
          if (!data || !data.windows || !data.windows.length || !otd) return
          otd.hidden = false
          otdContent.innerHTML = data.windows.map((w) => {
            const items = w.items.map((it) => {
              const icon = it.kind === 'project' ? '<svg class="icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>'
                : it.kind === 'sadhana' ? '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'
                : '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/></svg>'
              return `<li class="otd-item"><span class="feed-icon">${icon}</span><a href="${it.href}">${it.done ? '✓ ' : ''}${esc(it.title)}</a></li>`
            }).join('')
            return `<div class="otd-window"><h5>${esc(w.label)}</h5><ul class="otd-list">${items}</ul></div>`
          }).join('')
        }).catch(() => {})

        // Cursor capture from the JSON twin of the htmx feed load.
        fetch('/api/timeline?limit=50').then((r) => r.ok ? r.json() : null).then((data) => {
          if (data && data.nextCursor && moreBtn) { nextCursor = data.nextCursor; moreBtn.hidden = false }
        }).catch(() => {})

        if (moreBtn) {
          const onMore = async () => {
            if (!nextCursor) return
            moreBtn.disabled = true
            moreBtn.textContent = _t('common.loading', 'Loading…')
            try {
              const res = await fetch(`/api/timeline?limit=50&cursor=${encodeURIComponent(nextCursor)}`)
              if (!res.ok) return
              const data = await res.json()
              const isFA = window.hibanaI18n?.lang?.() === 'fa'
              for (const it of (data.items || [])) {
                const kindIcon = it.kind === 'project' ? '<svg class="icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/></svg>'
                  : it.kind === 'sadhana' ? '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/></svg>'
                  : '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/></svg>'
                const kindLabel = it.kind === 'project' ? _t('timeline.kindProject', 'Project')
                  : it.kind === 'sadhana' ? _t('timeline.kindSadhana', 'To-do')
                  : _t('timeline.kindNote', 'Note')
                const li = document.createElement('li')
                li.className = `feed-item feed-${it.kind}`
                li.innerHTML = `<span class="feed-icon">${kindIcon}</span><div class="feed-body"><a href="${it.href}" class="feed-title">${it.done ? '✓ ' : ''}${esc(it.title)}</a><span class="feed-meta muted small">${kindLabel} · ${timeAgo(it.ts)}</span></div>`
                feed()?.appendChild(li)
              }
              nextCursor = data.nextCursor
              if (!nextCursor) moreBtn.hidden = true
            } finally {
              moreBtn.disabled = false
              moreBtn.textContent = _t('timeline.loadMore', 'Load more')
            }
          }
          moreBtn.addEventListener('click', onMore)
          ctx.on('hibana:i18n', () => { moreBtn.textContent = _t('timeline.loadMore', 'Load more') })
        }

        // Alpine.data() registers globally and may be called any time before a component is
        // initialized — safe to re-register on every visit (the last definition wins). nav.js
        // calls this before Alpine.initTree() on soft navigation, so fragments stay interactive.
        window.Alpine?.data('report', () => ({
          summary: null, rows: [], gran: 'day', maxH: 0, maxP: 0,
          heatmap: { rows: [], weeks: [] },
          // S52: streak stats over the heatmap rows — current / longest / active days.
          streak: { current: 0, longest: 0, activeDays: 0, milestone: null },
          i18nTick: 0, // bumped once the user's language resolves — see the *Label methods
          t: (k, f) => window.hibanaI18n?.t(k) || f,
          // Labels via methods (not inline x-text ternaries) so they can depend on
          // i18nTick — Alpine re-renders them after hibanaI18n.ready resolves, landing
          // the labels in Farsi for FA users on first paint instead of the EN fallback.
          statusLabel(s) { void this.i18nTick; return window.hibanaI18n?.t('status.' + s) || s },
          viewAllLabel() { void this.i18nTick; return window.hibanaI18n?.t('reports.viewAll') || 'view all →' },
          nothingLabel() { void this.i18nTick; return window.hibanaI18n?.t('dashboard.nothing') || 'Nothing here yet' },
          // S52: streak labels — same i18nTick pattern as the labels above: plain t()
          // bindings evaluate once at component init (EN) and never re-render when
          // the FA dictionary resolves, landing English pills on an FA page.
          streakLabel(k, f) { void this.i18nTick; return window.hibanaI18n?.t(k) || f },
          // S55: milestone chip label (i18nTick-pattern like the other streak labels).
          milestoneLabel() {
            void this.i18nTick
            const m = this.streak?.milestone
            if (!m) return ''
            return window.hibanaI18n?.t('reports.' + m.key) || ''
          },
          // S55: heatmap cell tooltip — the 4-source breakdown + a localized date. Built
          // as HTML (x-html) with the i18nTick dependency so Alpine re-renders the whole
          // tooltip once the FA dictionary resolves. Jalali conversion rides the shared
          // /js/jalali.js helpers (loaded by reports.html since this batch).
          hmTip(d) {
            void this.i18nTick
            const J = window.__hibJalali
            const isFA = window.hibanaI18n?.lang?.() === 'fa'
            const num = (n) => isFA ? J?.toFa(String(n)) ?? faNum(String(n)) : String(n)
            const [y, m, day] = (d.date || '').split('-').map(Number)
            let dateLabel = d.date ?? ''
            if (y && m && day) {
              const dt = new Date(Date.UTC(y, m - 1, day))
              if (isFA && J) {
                const [jy, jm, jd] = J.g2j(y, m, day)
                dateLabel = `${J.WEEKDAY_FA[dt.getUTCDay()]} ${J.toFa(String(jd))} ${J.J_MONTHS[jm - 1]} ${J.toFa(String(jy))}`
              } else {
                dateLabel = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
              }
            }
            const row = (icon, key, fallback, n) =>
              `<span class="hm-tip-row${n ? '' : ' is-zero'}"><span class="hm-tip-ico" aria-hidden="true">${icon}</span>${esc(_t(key, fallback))}<b>${num(n)}</b></span>`
            return `<b class="hm-tip-date">${esc(dateLabel)}</b>` +
              row('<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>', 'reports.hmHurdles', 'hurdles solved', d.hurdles) +
              row('<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>', 'reports.hmProjects', 'projects created', d.projects) +
              row('<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>', 'reports.hmTodos', 'to-dos completed', d.todos) +
              row('<svg viewBox="0 0 24 24"><path d="M5 3h14v18l-7-4-7 4Z"/></svg>', 'reports.hmNotes', 'notes captured', d.notes) +
              `<b class="hm-tip-total">${num(d.total)} ${esc(_t('reports.events', 'events'))}</b>`
          },
          // The screen-reader label for a cell (replaces the old title attr).
          hmAria(d) {
            void this.i18nTick
            const isFA = window.hibanaI18n?.lang?.() === 'fa'
            const n = isFA ? faNum(String(d.total)) : String(d.total)
            return (isFA ? faNum(d.date) : d.date) + ': ' + n + ' ' + (_t('reports.events', 'events') || '')
          },
          // S55: the month label above a heatmap column (Jalali for FA users).
          hmMonthLabel(w) {
            void this.i18nTick
            const iso = w?.monthISO
            if (!iso) return ''
            const [y, m] = iso.split('-').map(Number)
            const isFA = window.hibanaI18n?.lang?.() === 'fa'
            const J = window.__hibJalali
            if (isFA && J) {
              const [, jm] = J.g2j(y, m, 1)
              return J.J_MONTHS[jm - 1]
            }
            return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
          },
          // S30 batch 3: task analytics helpers — the priority mix, the backlog share
          // bar, and the label chips' tooltip. i18nTick-dependent like the labels above.
          prioLabel(p) {
            void this.i18nTick
            const keys = { urgent: 'db.pr.urgent', high: 'db.pr.high', medium: 'db.pr.medium', low: 'db.pr.low' }
            return window.hibanaI18n?.t(keys[p]) || p
          },
          openCount(p) { const x = this.summary?.tasks?.priority?.[p]; return x ? x.total - x.done : 0 },
          backlogPct(p) { const t = this.summary?.tasks?.total ?? 0; if (!t) return 0; const d = this.summary?.tasks?.done ?? 0; const open = t - d; if (!open) return 0; return Math.round((this.openCount(p) / open) * 100) },
          get shareSegments() {
            const ps = ['urgent', 'high', 'medium', 'low']
            const t = this.summary?.tasks?.total ?? 0
            const d = this.summary?.tasks?.done ?? 0
            const open = t - d
            if (!open) return ps.map((p) => ({ p, pct: p === 'medium' ? 100 : 0 }))
            return ps.map((p) => ({ p, pct: Math.round((this.openCount(p) / open) * 100) }))
          },
          get shareAria() {
            void this.i18nTick
            return ['urgent', 'high', 'medium', 'low']
              .map((p) => this.prioLabel(p) + ': ' + this.openCount(p))
              .join(' · ')
          },
          labelTitle(l) { void this.i18nTick; return (l.n ?? 0) + ' × — ✓' + (l.done ?? 0) + ' · +' + (l.fresh ?? 0) },
          // FA digits for the template's raw numbers (parity with the server's faDigits).
          faNum(v) {
            void this.i18nTick
            const isFA = window.hibanaI18n?.lang?.() === 'fa'
            return isFA ? String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(v)
          },
          async load() {
            const s = await fetch('/api/reports/summary')
            this.summary = s.ok ? await s.json() : null
            try { await window.hibanaI18n?.ready } catch { /* keep EN fallback */ }
            this.i18nTick++
            const a = await fetch(`/api/reports/activity?granularity=${this.gran}`)
            this.rows = a.ok ? (await a.json()).rows ?? [] : []
            // Bar heights are data-driven (they were hardcoded 0.7/1 stubs): each value
            // scales against its own max so the chart always fills the rack.
            this.maxH = Math.max(...this.rows.map((r) => r.hurdlesCompleted), 1)
            this.maxP = Math.max(...this.rows.map((r) => r.projectsCreated), 1)
            // B3.6: heatmap — fetch last 91 days, bucket into weeks, assign levels 0-4.
            // S52: the API now counts four activity sources (hurdles solved, projects
            // created, to-dos completed, notes captured) — the streak math below runs on
            // the same rows, so "a day with activity" means any of the four.
            const h = await fetch('/api/reports/heatmap')
            if (h.ok) {
              const data = await h.json()
              const rows = data.rows || []
              const maxTotal = Math.max(...rows.map((r) => r.total), 1)
              const level = (n) => (n === 0 ? 0 : n <= maxTotal / 4 ? 1 : n <= maxTotal / 2 ? 2 : n <= (3 * maxTotal) / 4 ? 3 : 4)
              // Bucket into 13 weeks of 7 days, padding the first week so columns align by weekday.
              const first = rows.length ? new Date(rows[0].date + 'T00:00:00Z') : new Date()
              const firstDow = first.getUTCDay() // 0=Sun
              const cells = []
              for (let i = 0; i < firstDow; i++) cells.push(null) // pad to Sunday
              // S55: cells carry the 4-source breakdown so the tooltip can itemize them
              // (the API has sent hurdles/projects/todos/notes per row since S52).
              for (const r of rows) cells.push({ date: r.date, total: r.total, level: level(r.total), hurdles: r.hurdles || 0, projects: r.projects || 0, todos: r.todos || 0, notes: r.notes || 0 })
              const weeks = []
              for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
              // S55: month markers (GitHub-style) — a week whose first real day is
              // within the 1st–7th of a month carries that month's ISO, rendered as a
              // small label above the column (Gregorian short / Jalali for FA).
              for (const wk of weeks) {
                const first = wk.find(Boolean)
                if (first && Number(first.date.slice(8, 10)) <= 7) wk.monthISO = first.date.slice(0, 8) + '01'
              }
              this.heatmap = { rows, weeks }
              // Streak math. "Current" stays alive while the last active day is today OR
              // yesterday (today may still happen); it breaks only after a full quiet day.
              // "Longest" is the best run anywhere in the 91-day window.
              const active = rows.map((r) => r.total > 0)
              let end = active.length - 1
              if (end >= 0 && !active[end]) end--
              let current = 0
              for (let i = end; i >= 0 && active[i]; i--) current++
              let longest = 0, run = 0
              for (const a of active) { run = a ? run + 1 : 0; if (run > longest) longest = run }
              // S55: milestone micro-celebration — 3/7/14/30/60/100/365-day streaks get
              // a chip + a flickering flame. Fixed set (not every multiple of 7) so the
              // celebration stays special; only while the streak is ALIVE.
              const MS = { 3: 'streakM3', 7: 'streakM7', 14: 'streakM14', 30: 'streakM30', 60: 'streakM60', 100: 'streakM100', 365: 'streakM365' }
              const milestone = current > 0 && MS[current] ? { key: MS[current], n: current } : null
              this.streak = { current, longest, activeDays: active.filter(Boolean).length, milestone }
            }
            this.$nextTick(() => window.hibanaI18n.apply())
          },

          // ---- Review-round 2 feature: report digest export ----------------------
          // Both exports run purely client-side from the ALREADY-loaded scope (no new
          // API surface): Markdown digest → clipboard, CSV → Blob download. If the data
          // hasn't loaded (summary null), both no-op with a toast instead of exporting
          // an empty shell.
          async copyDigest() {
            if (!this.summary) return window.hibana?.toast(this.t('reports.nothingToExport', 'Nothing to export yet — data is still loading'))
            const today = new Date().toISOString().slice(0, 10)
            const st = this.summary.status || {}
            const lines = []
            lines.push(`# ${this.t('reports.digestHeading', 'Hibana report digest')} — ${today}`)
            lines.push('')
            lines.push(`## ${this.t('reports.snapshot', 'Snapshot')}`)
            lines.push(`- ${this.t('reports.personal', 'Personal')}: ${this.summary.type?.personal ?? 0}`)
            lines.push(`- ${this.t('reports.client', 'Client')}: ${this.summary.type?.client ?? 0}`)
            for (const s of ['spark', 'planning', 'queued', 'developing', 'awaiting_dev', 'operational']) {
              if (st[s]) lines.push(`- ${this.statusLabel(s)}: ${st[s]}`)
            }
            // S30 batch 3: the task analytics ride the digest — priority mix + labels.
            if (this.summary?.tasks?.total) {
              lines.push('')
              lines.push(`## ${this.t('reports.tasksHeading', 'Task analytics')}`)
              for (const p of ['urgent', 'high', 'medium', 'low']) {
                const x = this.summary.tasks.priority?.[p]
                if (x && x.total) lines.push(`- ${this.prioLabel(p)}: ${x.total - x.done} ${this.t('reports.openTasks', 'open')} / ${x.done} ✓`)
              }
              for (const l of (this.summary.labels || []).slice(0, 8)) {
                lines.push(`- #${l.name}: ${l.n} (${l.done} ✓, +${l.fresh})`)
              }
            }
            const activeDays = this.heatmap.rows.filter((r) => r.total > 0).length
            const totalEvents = this.heatmap.rows.reduce((a, r) => a + r.total, 0)
            lines.push('')
            lines.push(`## ${this.t('reports.digestLast13', 'Active days (last 13 weeks)')}`)
            lines.push(`- ${activeDays} ${this.t('reports.digestLast13Note', 'of {n} days with activity').replace('{n}', String(this.heatmap.rows.length || 91))}`)
            lines.push(`- ${this.t('reports.events', 'events')}: ${totalEvents}`)
            // S52: the streak trio rides the digest (same rows as the pills).
            lines.push(`- ${this.t('reports.streakCurrent', 'Current streak')}: ${this.streak.current} ${this.t('reports.streakDays', 'days')}`)
            lines.push(`- ${this.t('reports.streakLongest', 'Longest streak')}: ${this.streak.longest} ${this.t('reports.streakDays', 'days')}`)
            // Top 5 activity periods from the current granularity view.
            const top = [...this.rows].sort((a, b) => (b.hurdlesCompleted + b.projectsCreated) - (a.hurdlesCompleted + a.projectsCreated)).slice(0, 5)
              .filter((r) => r.hurdlesCompleted + r.projectsCreated > 0)
            if (top.length) {
              lines.push('')
              lines.push(`## ${this.t('reports.digestTop', 'Top periods')} (${this.gran})`)
              for (const r of top) {
                lines.push(`- ${r.label}: ${r.hurdlesCompleted} ${this.t('reports.solved', 'solved')}, ${r.projectsCreated} ${this.t('reports.created', 'created')}`)
              }
            }
            const md = lines.join('\n') + '\n'
            try {
              await navigator.clipboard.writeText(md)
              window.hibana?.toast(this.t('reports.digestCopied', 'Summary copied as Markdown'), 'ok')
            } catch {
              window.hibana?.toast(this.t('reports.copyFailed', 'Copy failed — your browser blocked clipboard access'), 'err')
            }
          },
          downloadCsv() {
            if (!this.summary) return window.hibana?.toast(this.t('reports.nothingToExport', 'Nothing to export yet — data is still loading'))
            const today = new Date().toISOString().slice(0, 10)
            const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
            const out = []
            // Section 1: snapshot counts (label,value) — one CSV, two labeled sections,
            // so a spreadsheet import keeps one file per report.
            out.push(['section', 'label', 'value'].map(q).join(','))
            const st = this.summary.status || {}
            out.push(['snapshot', this.t('reports.personal', 'Personal'), this.summary.type?.personal ?? 0].map(q).join(','))
            out.push(['snapshot', this.t('reports.client', 'Client'), this.summary.type?.client ?? 0].map(q).join(','))
            for (const s of ['spark', 'planning', 'queued', 'developing', 'awaiting_dev', 'operational']) {
              out.push(['snapshot', this.statusLabel(s), st[s] ?? 0].map(q).join(','))
            }
            for (const p of ['urgent', 'high', 'medium', 'low']) {
              const x = this.summary?.tasks?.priority?.[p]
              if (x) out.push(['tasks', this.prioLabel(p), `${x.total - x.done} open / ${x.done} done`].map(q).join(','))
            }
            for (const l of (this.summary?.labels || [])) {
              out.push(['labels', l.name, `${l.n} tasks / ${l.done} done / +${l.fresh} fresh`].map(q).join(','))
            }
            for (const r of this.heatmap.rows) {
              if (r.total > 0) out.push(['heatmap', r.date, r.total].map(q).join(','))
            }
            // S52: streak trio rows in the CSV's snapshot section (label,value).
            out.push(['snapshot', this.t('reports.streakCurrent', 'Current streak'), `${this.streak.current} ${this.t('reports.streakDays', 'days')}`].map(q).join(','))
            out.push(['snapshot', this.t('reports.streakLongest', 'Longest streak'), `${this.streak.longest} ${this.t('reports.streakDays', 'days')}`].map(q).join(','))
            out.push(['snapshot', this.t('reports.streakActive', 'Active days'), `${this.streak.activeDays}/${this.heatmap.rows.length || 91}`].map(q).join(','))
            for (const r of this.rows) {
              out.push(['activity', r.label, `${r.hurdlesCompleted}/${r.projectsCreated}`].map(q).join(','))
            }
            // \uFEFF BOM so Excel opens UTF-8 (Farsi labels) without mojibake.
            const blob = new Blob(['\uFEFF' + out.join('\n')], { type: 'text/csv;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `hibana-report-${today}.csv`
            document.body.appendChild(a)
            a.click()
            a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 4000)
            window.hibana?.toast(this.t('reports.csvSaved', 'CSV downloaded'), 'ok')
          },
        }))
      },
    })
