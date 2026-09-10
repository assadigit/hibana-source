    function showRegisterNote(text) {
      var err = document.getElementById('register-error')
      if (err) err.innerHTML = '<p class="error">' + text + '</p>'
    }
    var captchaBroken = false // load-failure note is the ONLY note loadCaptcha may clear
    function loadCaptcha() {
      var q = document.getElementById('captcha-q')
      var tok = document.getElementById('captcha-token')
      var ans = document.getElementById('captcha-answer')
      if (q) q.textContent = '…'
      if (tok) tok.value = ''
      fetch('/api/auth/captcha', { headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
        .then(function (j) {
          if (q) q.textContent = j.q
          if (tok) tok.value = j.token
          if (ans) ans.value = ''
          // Only a load-FAILURE note is ours to clear — never wipe a server message
          // (the register response lands BEFORE this fetch resolves; clearing here
          // raced the fragment into invisibility — caught by the 2026-08-30 (e) sweep).
          if (captchaBroken) {
            captchaBroken = false
            var note = document.getElementById('register-error')
            if (note) note.innerHTML = ''
          }
        })
        .catch(function () {
          captchaBroken = true
          showRegisterNote('The human check could not load — check your connection and press ↻ to retry.')
        })
    }
    // Fresh challenge after EVERY refused attempt (wrong answer / expired / duplicate
    // email…): htmx swaps the server's fragment into #register-error, and unless the
    // response carried HX-Redirect (success → verification modal), the old question is
    // stale UX. This also auto-recovers an expired challenge for slow typists.
    // (Registered on `document` — this script lives in <head>, before <body> exists.)
    document.addEventListener('htmx:afterRequest', function (e) {
      var f = e.target
      if (!(f instanceof HTMLFormElement) || f.getAttribute('hx-post') !== '/api/auth/register') return
      var xhr = e.detail && e.detail.xhr
      var redirected = xhr && xhr.getResponseHeader && xhr.getResponseHeader('HX-Redirect')
      if (!redirected) loadCaptcha()
    })
    // Cancel the request (not the form) if the challenge never loaded: the server would
    // otherwise answer 400, which htmx deliberately does not display. An empty ANSWER
    // never reaches here — the input's `required` stops the submit natively.
    document.addEventListener('htmx:configRequest', function (e) {
      var f = e.target
      if (!(f instanceof HTMLFormElement) || f.getAttribute('hx-post') !== '/api/auth/register') return
      var tok = f.querySelector('[name=captcha_token]')
      if (!tok || !tok.value) {
        e.preventDefault()
        showRegisterNote('The human check is still loading — one moment, then try again.')
      }
    })
    document.addEventListener('DOMContentLoaded', loadCaptcha)

    // Verification modal logic — plain fetch (no htmx needed for a one-shot dialog).
    ;(function () {
      var params = new URLSearchParams(location.search)
      var email = params.get('email') || ''
      var dlg = document.getElementById('verify-dialog')
      var boxes = Array.from(document.querySelectorAll('#verify-boxes input'))
      var msg = document.getElementById('verify-msg')
      var submitting = false
      if (!dlg || !boxes.length) return

      function showMsg(html) { msg.innerHTML = html }
      function code() { return boxes.map(function (b) { return b.value }).join('') }

      document.getElementById('verify-boxes').addEventListener('input', function (e) {
        var t = e.target
        t.value = t.value.replace(/\D/g, '').slice(0, 1)
        var i = boxes.indexOf(t)
        if (t.value && i < boxes.length - 1) boxes[i + 1].focus()
      })
      document.getElementById('verify-boxes').addEventListener('keydown', function (e) {
        var t = e.target
        if (e.key === 'Backspace' && !t.value && t !== boxes[0]) {
          e.preventDefault()
          boxes[boxes.indexOf(t) - 1].focus()
        }
        if (e.key === 'Enter') e.preventDefault() // submit via the form handler
      })

      document.getElementById('verify-form').addEventListener('submit', async function (e) {
        e.preventDefault()
        if (submitting) return
        if (code().length < 4) { showMsg('<p class="error">Enter the 4-digit code from your email.</p>'); return }
        submitting = true
        var btn = document.getElementById('verify-submit')
        btn.disabled = true
        showMsg('<p class="muted small">Checking…</p>')
        try {
          var res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, code: code() }),
          })
          var j = await res.json().catch(function () { return {} })
          if (res.ok && j.ok) {
            showMsg('<p class="muted">Verified! Opening your dashboard…</p>')
            location.href = '/app'
            return
          }
          showMsg(
            { invalid_code: '<p class="error">That code doesn&#39;t match — check it and try again.</p>',
              invalid_or_expired_code: '<p class="error">That code expired — hit Resend for a fresh one.</p>',
              code_invalidated: '<p class="error">Too many wrong attempts — hit Resend for a new code.</p>',
              already_verified: '<p class="error">This account is already verified — sign in instead.</p>' }[j.error] ||
            '<p class="error">Could not verify — try again.</p>')
          boxes.forEach(function (b) { b.value = '' })
          boxes[0].focus()
        } catch {
          showMsg('<p class="error">Could not reach the server — check your connection.</p>')
        } finally {
          submitting = false
          btn.disabled = false
        }
      })

      document.getElementById('verify-resend').addEventListener('click', async function () {
        var btn = this
        btn.disabled = true
        try {
          var res = await fetch('/api/auth/verify/resend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email }),
          })
          var j = await res.json().catch(function () { return {} })
          showMsg(j.error === 'resend_cooldown'
            ? '<p class="muted small">Wait a minute between resends.</p>'
            : j.error
              ? '<p class="error">Could not resend — try again in a minute.</p>'
              : '<p class="muted small">Code sent — check your inbox.</p>')
        } catch {
          showMsg('<p class="error">Could not reach the server.</p>')
        } finally {
          btn.disabled = false
        }
      })

      if (params.get('verify') === '1') {
        document.getElementById('verify-email-label').textContent = email || (window.hibanaI18n?.t('auth.yourInbox') ?? 'your inbox')
        dlg.showModal()
        boxes[0].focus()
      }
    })()
