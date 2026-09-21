    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'clients',
      mount(ctx) {
        // Client quick-add — native <dialog>, same reliability as the Spark modal (app.js).
        const _t = (k, f) => window.hibanaI18n?.t(k) || f
        let dialog = null
        function buildClientDialog() {
          if (dialog) return dialog
          const dlg = document.createElement('dialog')
          dlg.className = 'dialog'
          dlg.innerHTML = `
        <form class="modal" id="client-form">
          <h3>${_t('clients.dialog.title', 'New Client Project')}</h3>
          <label>${_t('clients.dialog.clientName', 'Client name')} <input id="c-client" required maxlength="100"></label>
          <label>${_t('clients.dialog.projectTitle', 'Project title')} <input id="c-title" required maxlength="200"></label>
          <p class="muted small" id="c-dup" hidden></p>
          <label>${_t('clients.dialog.dueDate', 'Due date')} <input id="c-due" type="date"></label>
          <label>${_t('qa.oneLiner', 'One-liner')} <textarea id="c-desc" rows="2" maxlength="2000"></textarea></label>
          <p class="error" id="c-error"></p>
          <div class="row">
            <button type="submit">${_t('common.save', 'Save')}</button>
            <button type="button" class="ghost" id="c-cancel">${_t('common.cancel', 'Cancel')}</button>
          </div>
        </form>`
          document.body.appendChild(dlg)
          dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close() })
          dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
          dlg.querySelector('#c-cancel').addEventListener('click', () => dlg.close())
          // Duplicate-title soft warning (spec §5.3) — same debounced, non-blocking check as the Spark modal.
          const dupEl = dlg.querySelector('#c-dup')
          let dupTimer = null
          dlg.querySelector('#c-title').addEventListener('input', () => {
            clearTimeout(dupTimer)
            dupEl.hidden = true
            const title = dlg.querySelector('#c-title').value.trim()
            if (!title) return
            dupTimer = setTimeout(async () => {
              try {
                const res = await fetch(`/api/projects/duplicate-check?title=${encodeURIComponent(title)}`)
                const body = await res.json()
                dupEl.textContent = body.duplicate ? _t('qa.duplicate', 'A project with this title already exists') : ''
                dupEl.hidden = !body.duplicate
              } catch { /* the soft warning must never block creation */ }
            }, 350)
          })
          dlg.querySelector('#client-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const client = document.getElementById('c-client').value.trim()
            const title = document.getElementById('c-title').value.trim()
            if (!client || !title) return
            const err = document.getElementById('c-error')
            err.textContent = ''
            try {
              const body = { title, client_name: client, due_date: document.getElementById('c-due').value || null, description: document.getElementById('c-desc').value, type: 'client', status: 'pending' }
              const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
              if (!res.ok) throw new Error('create failed')
              const { id } = await res.json()
              dlg.close()
              if (window.hibanaNav) window.hibanaNav.go(`/project.html?id=${id}`)
              else window.location.href = `/project.html?id=${id}`
            } catch (err2) {
              err.textContent = _t('clients.dialog.failed', 'Failed to create client project — ') + (err2 instanceof Error ? err2.message : _t('clients.dialog.networkError', 'network error'))
            }
          })
          dialog = dlg
          return dlg
        }
        // Event delegation so the handler also covers the empty-state CTA injected later
        // by htmx into #client-body (Session 19: clients empty state now has its own CTA).
        const onQuickAdd = (e) => {
          const b = e.target.closest('[data-clientquickadd]')
          if (b) { e.preventDefault(); buildClientDialog().showModal() }
        }
        document.addEventListener('click', onQuickAdd)
        // S100 (the deep-link system): a #task-<id> hash opens THE checklist row —
        // the rail's Coming-up list + the calendar page link here. The checklist
        // rides inside a COLLAPSED <details> whose body arrives via the
        // #client-body htmx sweep, so the hash stays PENDING until the first
        // afterSwap that lands the row (the project-page pdConsumeHash recipe);
        // ONCE per navigation — later htmx re-renders (a tick) never re-flash the
        // mark. The row opens its <details>, wears the .q-arrived mark (accent
        // frame + 1.6s ring flash, layout.css .hurdle.q-arrived) and scrolls in
        // (the 4.5rem scroll-margin clears the topbar).
        let taskHashPending = /^#task-/.test(location.hash)
        const consumeTaskHash = () => {
          if (!taskHashPending) return
          const el = document.getElementById(decodeURIComponent(location.hash.slice(1)))
          if (!el || !el.isConnected) return // the sweep hasn't landed this row yet
          taskHashPending = false
          const details = el.closest('details')
          if (details) details.open = true
          el.classList.add('q-arrived')
          requestAnimationFrame(() => { if (el.isConnected) el.scrollIntoView() })
        }
        for (const evt of ['htmx:afterSwap', 'afterSwap']) {
          ctx.on(evt, (e) => {
            if (e.target?.id === 'client-body' || e.detail?.target?.id === 'client-body') consumeTaskHash()
          })
        }
        consumeTaskHash()
        // Drop the lazily-built dialog from the body on unmount.
        return () => { document.removeEventListener('click', onQuickAdd); if (dialog) dialog.remove(); dialog = null }
      },
    })
