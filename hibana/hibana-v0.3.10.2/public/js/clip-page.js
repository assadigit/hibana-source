    (async () => {
      const params = new URLSearchParams(location.search)
      const title = params.get('title') || ''
      const url = params.get('url') || ''
      const sel = params.get('text') || ''
      const source = document.getElementById('clip-source')
      const form = document.getElementById('clip-form')
      const errEl = document.getElementById('clip-error')
      const successEl = document.getElementById('clip-success')
      const cancelBtn = document.getElementById('clip-cancel')

      // 1. Auth check — if not logged in, redirect to login with a return-to here.
      try {
        const me = await fetch('/api/auth/me', { headers: { 'Accept': 'application/json' } })
        if (!me.ok) {
          location.replace('/login.html?return=' + encodeURIComponent(location.pathname + location.search))
          return
        }
      } catch {
        location.replace('/login.html?return=' + encodeURIComponent(location.pathname + location.search))
        return
      }

      // 2. Show the source link.
      if (url) {
        source.hidden = false
        source.innerHTML = '🔗 <a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(title || url) + '</a>'
      }

      // 3. Pre-fill the textarea: selected text first (if any), then title + url.
      const prefill = [sel, title && url ? `[${title}](${url})` : title].filter(Boolean).join('\n\n')
      document.getElementById('clip-text').value = prefill
      document.getElementById('clip-text').focus()
      document.getElementById('clip-text').setSelectionRange(0, 0)

      // 4. Save → POST to the existing quick-notes API (kind=note).
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        errEl.hidden = true
        const content = document.getElementById('clip-text').value.trim()
        // Always include the title + url in the note — even if the user cleared the textarea.
        const body = (content || (title && url ? `${title}\n${url}` : title)).slice(0, 20000)
        if (!body) {
          errEl.textContent = 'Nothing to capture.'
          errEl.hidden = false
          return
        }
        const saveBtn = document.getElementById('clip-save')
        saveBtn.disabled = true
        saveBtn.textContent = '…'
        try {
          const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'note', content: body, title: title.slice(0, 120) || '' }),
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          form.hidden = true
          successEl.hidden = false
          setTimeout(() => window.close(), 1500)
        } catch (err) {
          saveBtn.disabled = false
          saveBtn.textContent = 'Save idea'
          errEl.textContent = 'Could not save — ' + (err.message || 'try again')
          errEl.hidden = false
        }
      })

      cancelBtn.addEventListener('click', () => window.close())

      function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      }

      // Apply i18n once loaded (FA users get FA labels).
      try { await window.hibanaI18n?.ready } catch {}
      window.hibanaI18n?.apply?.()
    })()
