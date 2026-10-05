    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'notifications',
      mount(ctx) {
        const _t = (k, f) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : f }
        const isFA = () => window.hibanaI18n?.lang?.() === 'fa' || document.documentElement.lang === 'fa'
        const faNum = (v) => String(v).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
        const num = (v) => (isFA() ? faNum(v) : String(v))
        const summary = document.getElementById('notif-summary')
        const body = document.getElementById('notif-body')
        if (!summary || !body) return

        // S191: the summary chips are FILTER TOGGLES now (they were a static readout).
        // The htmx fragment (hx-get on #notif-body) arrives with severity GROUPS
        // (section.notif-group[data-sev] + sticky heads); the counts are read from the
        // DOM — one source of truth, no second JSON fetch (the old parallel fetch is
        // retired). Progressive enhancement stays honest: without this JS the page
        // renders every group in severity order, fully readable.
        let active = 'all'
        const SEVS = [
          { sev: 'urgent', key: 'notif.urgent', fb: 'Urgent', cls: 'notif-urgent' },
          { sev: 'warning', key: 'notif.warning', fb: 'Soon', cls: 'notif-warning' },
          { sev: 'info', key: 'notif.info', fb: 'Heads up', cls: 'notif-info' },
        ]

        const buildChips = () => {
          const groups = Array.from(body.querySelectorAll('.notif-group[data-sev]'))
          const counts = { all: 0 }
          for (const g of groups) {
            const n = g.querySelectorAll('.notif-item').length
            counts[g.dataset.sev] = n
            counts.all += n
          }
          if (!groups.length) { summary.hidden = true; return }
          summary.hidden = false
          summary.setAttribute('role', 'group')
          summary.setAttribute('aria-label', _t('notif.filterHint', 'Filter by urgency'))
          const chip = (sev, label, count, cls) =>
            `<button type="button" class="notif-chip notif-chip-btn${cls ? ' ' + cls : ''}" data-filter="${sev}"` +
            ` aria-pressed="${active === sev ? 'true' : 'false'}">` +
            `${label}${count != null ? ` <span class="notif-chip-count">${num(count)}</span>` : ''}</button>`
          summary.innerHTML = [
            chip('all', _t('notif.filterAll', 'All'), counts.all, null),
            ...SEVS.filter((s) => counts[s.sev]).map((s) =>
              chip(s.sev, _t(s.key, s.fb), counts[s.sev], s.cls)),
          ].join('')
        }

        const applyFilter = (sev) => {
          active = sev
          for (const g of body.querySelectorAll('.notif-group[data-sev]')) {
            g.hidden = sev !== 'all' && g.dataset.sev !== sev
          }
          for (const b of summary.querySelectorAll('[data-filter]')) {
            b.setAttribute('aria-pressed', active === b.dataset.filter ? 'true' : 'false')
          }
        }

        summary.addEventListener('click', (e) => {
          const btn = (e.target instanceof Element) ? e.target.closest('[data-filter]') : null
          if (!btn) return
          applyFilter(btn.dataset.filter)
          // Keep the URL honest (deep-linkable) without a history entry per click.
          const want = active === 'all' ? '' : '#' + active
          if (location.hash !== want) history.replaceState(null, '', want || location.pathname)
        })

        // Hash deep-link: #urgent|#warning|#info activates that filter on arrival
        // (and on hashchange — e.g. the browser's back/forward between filters).
        const fromHash = () => {
          const h = location.hash.replace('#', '')
          return (h === 'urgent' || h === 'warning' || h === 'info') ? h : 'all'
        }
        const syncFromHash = () => { applyFilter(fromHash()) }
        window.addEventListener('hashchange', syncFromHash)

        // The fragment lands via htmx (afterSwap) — rebuild the chips + re-apply the
        // active filter so a language switch / refresh keeps its selection.
        body.addEventListener('htmx:afterSwap', () => {
          buildChips()
          syncFromHash()
        })
        // Fallback when htmx is unavailable (offline shell): poll briefly for the
        // fragment's groups, then stop — same as the queue.js wire pattern.
        const t0 = Date.now()
        const iv = setInterval(() => {
          if (body.querySelector('.notif-group, .empty-state')) { clearInterval(iv); buildChips(); syncFromHash() }
          else if (Date.now() - t0 > 10000) clearInterval(iv)
        }, 200)
        if (body.querySelector('.notif-group, .empty-state')) { clearInterval(iv); buildChips(); syncFromHash() }

        // Language switch: re-localize the chips (counts ride along from the DOM).
        document.addEventListener('hibana:i18n', () => { buildChips(); syncFromHash() })
      },
    })
