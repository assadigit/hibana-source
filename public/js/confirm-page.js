      const email = new URLSearchParams(location.search).get('email') ?? ''
      document.getElementById('email-input').value = email
      if (email) document.getElementById('email-label').textContent = email
      ;(() => {
        const input = document.getElementById('code-input')
        const boxes = [...document.querySelectorAll('[data-otp-box]')]
        const field = document.querySelector('[data-otp]')
        if (!input || !boxes.length || !field) return
        const faDig = (s) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        const render = () => {
          const val = input.value || ''
          boxes.forEach((b, i) => {
            const d = val[i] ?? ''
            b.textContent = d
            b.classList.toggle('is-filled', !!d)
            b.classList.toggle('is-active', i === (val.length || 0))
          })
        }
        input.addEventListener('input', () => {
          try {
            input.value = faDig(input.value || '').replace(/[^\d]/g, '').slice(0, 4)
            render()
            if (input.value.length === 4) {
              setTimeout(() => { try { input.form && input.form.requestSubmit() } catch {} }, 150)
            }
          } catch (e) { console.error('OTP input handler error:', e) }
        })
        input.addEventListener('paste', (e) => {
          e.preventDefault()
          const txt = faDig((e.clipboardData || window.clipboardData).getData('text') || '')
          input.value = txt.replace(/[^\d]/g, '').slice(0, 4)
          render()
          if (input.value.length === 4) setTimeout(() => { try { input.form && input.form.requestSubmit() } catch {} }, 150)
        })
        field.addEventListener('click', (e) => {
          if (e.target === input) return
          input.focus()
          const len = input.value.length
          input.setSelectionRange(len, len)
        })
        render()
        requestAnimationFrame(() => { try { input.focus() } catch {} })
      })()

      document.getElementById('resend-btn').addEventListener('click', async () => {
        const e = document.getElementById('email-input').value.trim()
        if (!e) return
        const btn = document.getElementById('resend-btn')
        btn.disabled = true
        const msg = document.getElementById('resend-msg')
        try {
          const res = await fetch('/api/auth/verify/resend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: e }),
          })
          const json = await res.json().catch(() => ({}))
          msg.textContent = json.error === 'resend_cooldown'
            ? 'Wait a minute between resends.'
            : json.error
              ? 'Could not resend — please try again in a minute.'
              : 'Code sent — check your inbox.'
        } catch {
          msg.textContent = 'Could not reach the server — check your connection.'
        } finally {
          btn.disabled = false
        }
      })
