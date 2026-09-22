/* hib-init.js — DOMContentLoaded event handlers (extracted from app.js Phase 3)
   Session 25 Phase 3: app.js IIFE split. This file contains the init wiring that
   runs on page load. All functions are defined in app.js and exposed via window.__hib.
   Loads AFTER app.js (defer preserves order). */
(() => {
  const { toast, toggleTheme, paintThemeButton, applyNoteView, applyNoteSize, applyNoteControlsOpen, autosizeNote, markClampedNotes, buildQuickNoteAdd, injectNoteMenus, closeNoteMenus, buildNoteReader } = window.__hib

  // S111: the login round-trip preserves WHERE the user was. Every 401 bounce (app.js
  // handle401, the htmx error path below, the boot guard below, sw.js's navigate
  // handler) now lands on /login.html?next=<path+query>; after a successful sign-in the
  // validated next wins over the server's default dashboard redirect. Same-origin only:
  // must start with a single '/' (no protocol-relative '//', no off-site URLs) and must
  // not loop back into the login page itself.
  const safeNext = () => {
    const n = new URLSearchParams(location.search).get('next')
    if (!n) return null
    if (!n.startsWith('/') || n.startsWith('//')) return null
    if (n.startsWith('/login')) return null
    return n
  }
  const nextOr = (fallback) => safeNext() || fallback

  document.addEventListener('DOMContentLoaded', () => {
    applyNoteView()
    applyNoteSize()
    applyNoteControlsOpen()
    requestAnimationFrame(() => document.querySelectorAll('.note-text').forEach(autosizeNote))
    requestAnimationFrame(markClampedNotes)
  })

  // ---- Sign-in form (2026-08-26): explicit submit handler. The htmx HX-Redirect flow
  // kept leaving the button stuck in its loading state, so this owns every branch:
  // loading on submit → redirect on success → reset + visible error on failure/timeout.
  document.querySelectorAll('form[data-auth-form]').forEach((form) => {
    const btn = form.querySelector('button[type="submit"]')
    const spinner = form.querySelector('[data-auth-spinner]')
    const err = form.querySelector('[data-auth-error]')
    const btnLabel = btn?.textContent || 'Sign in'
    const setLoading = (loading) => {
      if (btn) {
        btn.disabled = loading
        btn.textContent = loading ? 'Signing in…' : btnLabel
      }
      if (spinner) spinner.classList.toggle('htmx-request', loading)
    }
    const showError = (msg) => {
      if (err) {
        err.textContent = msg
        err.className = 'error'
      }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      showError('')
      if (!form.reportValidity()) return
      setLoading(true)
      // Bilingual messages for this public page (no session → no language pref; best-effort
      // detect from the browser locale, English otherwise).
      const fa = (navigator.language || '').toLowerCase().startsWith('fa')
      const netErr = fa
        ? 'اتصال به سرور برقرار نشد — اینترنت یا VPN را بررسی و دوباره تلاش کنید.'
        : "Can't reach the server — check your connection (VPN?) and try again."
      const timeoutErr = fa
        ? 'سرور دیر پاسخ داد — دوباره تلاش کنید.'
        : 'The server took too long to respond — try again.'
      const genericErr = fa ? 'ورود ناموفق بود، دوباره تلاش کنید.' : 'Sign-in failed, try again.'
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 12000)
      try {
        // HX-Request header makes the server answer with HX-Redirect (dashboard, or the
        // email-confirm gate) so this handler navigates to the exact same routes htmx did.
        const res = await fetch(form.action || '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true' },
          body: new URLSearchParams(new FormData(form)).toString(),
          signal: ctrl.signal,
        })
        clearTimeout(timer)
        const redirect = res.headers.get('HX-Redirect')
        if (redirect) {
          // S111: an honored ?next= returns the user to the exact place the 401 bounce
          // came from (including a PWA share-target capture's query — the idea is not
          // lost to an expired session).
          window.location.href = nextOr(redirect)
          return
        }
        // Server errors for htmx requests come back as 200 with an HTML <p class="error">
        // (invalid credentials, missing fields) — strip tags and surface the message.
        const text = await res.text()
        const msg = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        showError(msg || genericErr)
      } catch (err) {
        // fetch throws ONLY when the request never completed: offline, DNS/VPN failure,
        // connection reset, or the 12s abort. Say so explicitly instead of a vague
        // "try again" — wrong credentials look totally different ("Wrong email/username…").
        showError(err && err.name === 'AbortError' ? timeoutErr : netErr)
      } finally {
        setLoading(false)
      }
    })
  })

  // ---- boot: nav, auth guard, PWA, trigger wiring ----
  let userChecked = false

  // F2 (session 9): the offline banner — the queue-badge pattern (queue.js paints
  // [data-syncbadge] the same way): a small fixed pill, i18n'd via data-i18n so a
  // language toggle re-translates it, removed when the browser fires 'online' (the
  // same cue the queue uses to re-flush). The auth guard shows it instead of
  // redirecting to login when /api/auth/me can't be reached.
  function showOfflineBanner() {
    if (document.querySelector('[data-offline-banner]')) return
    const banner = document.createElement('div')
    banner.className = 'offline-banner'
    banner.setAttribute('data-offline-banner', '')
    banner.setAttribute('data-i18n', 'offline.banner')
    banner.setAttribute('role', 'status')
    banner.textContent = window.hibanaI18n?.t('offline.banner') || 'Offline — your work is saved locally and will sync when you reconnect'
    document.body.appendChild(banner)
    window.addEventListener('online', () => banner.remove(), { once: true })
  }

  // S72: the pending-sync badge — js/queue.js's onCount listener existed since
  // spec §3.4 with no shell consumer; queued captures (offline quick-adds, canvas
  // batches) were invisible outside canvas/whiteboard's own save badge. The badge is
  // a quiet amber chip that appears whenever the queue holds items and disappears when
  // it drains; click retries the flush immediately. JS-rendered labels follow the S71
  // i18n-race rule: paint with _t() and re-render on hibana:i18n.
  // S89: the badge LEFT the chrome (rail + brand bar) — Settings → Preferences owns
  // the UX now: the [data-sync-badge] retry chip + the always-honest [data-sync-status]
  // line (settings.html). Zero badges elsewhere → this no-ops cheaply; the paint loop
  // serves both contracts (hidden-when-idle button + live status text).
  function wireSyncBadge() {
    const wire = () => {
      const btns = Array.from(document.querySelectorAll('[data-sync-badge]'))
      const statusEls = Array.from(document.querySelectorAll('[data-sync-status]'))
      const q = window.hibanaQueue
      if ((!btns.length && !statusEls.length) || !q) return
      if (btns.every((b) => b.dataset.wired === '1') && statusEls.every((s) => s.dataset.wired === '1')) return
      for (const b of btns) b.dataset.wired = '1'
      for (const s of statusEls) s.dataset.wired = '1'
      const _t = (k, fb) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : fb }
      const isFA = () => window.hibanaI18n?.lang?.() === 'fa' || document.documentElement.lang === 'fa'
      const faNum = (v) => String(v).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
      const paint = (n) => {
        n = Number(n) || 0
        for (const b of btns) {
          if (n > 0) {
            b.hidden = false
            const label = _t('nav.syncPending', '{n} pending').split('{n}').join(isFA() ? faNum(n) : String(n))
            const labelEl = b.querySelector('.topbar-sync-label')
            if (labelEl) labelEl.textContent = label
            b.setAttribute('aria-label', _t('nav.syncHint', 'Waiting to sync — click to try now'))
            b.title = b.getAttribute('aria-label')
          } else {
            b.hidden = true
          }
        }
        // S89: the Settings status line — the queue count as plain text; idle carries
        // its own "all synced" copy. paint() owns this element's text (no data-i18n
        // attr — the translate pass must not race the live count).
        for (const s of statusEls) {
          if (n > 0) {
            s.textContent = _t('nav.syncPending', '{n} pending').split('{n}').join(isFA() ? faNum(n) : String(n))
            s.classList.add('is-waiting')
          } else {
            s.textContent = _t('settings.syncIdle', 'All changes synced')
            s.classList.remove('is-waiting')
          }
        }
      }
      paint(q.pendingCount || 0)
      q.onCount(paint)
      for (const b of btns) b.addEventListener('click', async () => {
        try {
          await q.flush()
          // onCount repaints; a success toast confirms the drain even if the badge
          // was already hidden (flush also fires from 'online' events elsewhere).
          if ((q.pendingCount || 0) === 0) window.hibana?.toast(_t('nav.syncSent', 'Synced your offline changes'), 'ok', 4000)
        } catch { /* flush failures keep the badge; retry on next click/online */ }
      })
      // Language switch while items are queued: re-localize the label + status.
      document.addEventListener('hibana:i18n', () => paint(q.pendingCount || 0))
    }
    if (window.hibanaQueue) { wire(); return }
    // app.js injects queue.js async on pages without a direct <script> — poll briefly.
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (window.hibanaQueue) { clearInterval(iv); wire() }
      else if (Date.now() - t0 > 5000) clearInterval(iv)
    }, 150)
  }

  // F8 (session 9): GLOBAL htmx error surface. Only project.html registered an
  // htmx:responseError handler — every other page left failed swaps SILENT (audit
  // finding: offline/500 fragments leave the zone stale with no cue). Policy:
  //   - htmx already leaves the existing content in place on error — we keep that
  //     (never blank a zone on failure), we only ADD a toast explaining what happened.
  //   - 401 = the session died: redirect to login (the app-wide auth contract, same
  //     as handle401) — a "couldn't load" toast would mislead.
  //   - 404 = semantic "gone": page-specific handlers own it (project.html renders
  //     its own friendly box; delete flows treat 404 as already-gone) — no toast.
  //   - anything else (SW offline 503, network 0, 5xx, 429…): status-aware toast.
  document.addEventListener('htmx:responseError', (e) => {
    const status = e.detail?.xhr?.status
    if (status === 401) {
      // S111: preserve the destination for the post-login bounce (see safeNext above).
      if (location.pathname !== '/login.html') window.location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search))
      return
    }
    if (status === 404) return
    const _t = (k, fb) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : fb }
    let msg
    if (status === 0 || status === 503) {
      // 0 = request never completed (offline, no SW catch); 503 = the SW's offline
      // answer or an origin overload — both read as "you may be offline".
      msg = _t('hx.offline', "You're offline — showing saved content")
    } else {
      msg = _t('hx.failed', "Couldn't load the latest — content unchanged")
    }
    toast(msg, 'err', 5000)
  })

  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.type = 'image/svg+xml'
  favicon.href = '/icon.svg'
  document.head.appendChild(favicon)
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = '/manifest.webmanifest'
  document.head.appendChild(link)
  // Fonts: Manrope (Latin) loads statically in every page head; Vazir is injected by
  // i18n.js only when the UI is in fa (keeps English lean).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed:', err))
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Session 19 (cron round 8): password visibility toggle for auth pages (login,
    // signup, reset). Auto-wires any input[type=password] that isn't already wrapped.
    // Wraps the <input> in a .pw-field div + appends a button.pw-toggle that swaps
    // type=password ↔ type=text + the eye/eye-off icon. Runs on every page (the selector
    // is empty on authenticated pages), so the three auth forms get it for free.
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.closest('.pw-field') || input.dataset.pwToggle === 'done') return
      const parent = input.parentElement
      if (!parent || parent.tagName !== 'LABEL') return // only wrap labeled password fields (the auth forms)
      const wrap = document.createElement('div')
      wrap.className = 'pw-field'
      parent.insertBefore(wrap, input)
      wrap.appendChild(input)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'pw-toggle'
      btn.setAttribute('aria-label', 'Show password')
      btn.setAttribute('aria-pressed', 'false')
      btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
      const eyeIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
      const eyeOffIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a13.4 13.4 0 0 1-1.7 2.6M6.6 6.6A13.3 13.3 0 0 0 2 12s3.5 8 10 8a10.9 10.9 0 0 0 5-1.2"/><path d="m2 2 20 20M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
      btn.addEventListener('click', () => {
        const show = input.type === 'password'
        input.type = show ? 'text' : 'password'
        btn.innerHTML = show ? eyeOffIcon : eyeIcon
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
        btn.setAttribute('aria-pressed', String(show))
      })
      wrap.appendChild(btn)
    })

    // Session 19 (user request): Farsi numerals when writing Farsi. Typed Latin digits
    // (0-9) auto-convert to Persian (۰-۹) IF the character before the caret is a Farsi
    // letter, a space, or nothing — so a URL/code run stays Latin. Scoped to <textarea> +
    // contenteditable (the note/box/description fields). Uses DOCUMENT-LEVEL delegation so
    // it survives htmx swaps (the project page loads #project-body via htmx AFTER
    // DOMContentLoaded, so a per-element querySelectorAll at boot finds 0 textareas).
    // Opt-out: data-no-fa-digits on the field.
    const faDigMap = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹']
    const isFaLetter = (ch) => ch && /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(ch)
    // Session 19 (user report): i18n.js apply() is async (awaits /api/auth/me), so
    // document.documentElement.lang is still 'en' at DOMContentLoaded. Check BOTH the
    // live lang + the localStorage cache (written by i18n.js on the previous load).
    const checkFa = () => document.documentElement.lang === 'fa' || localStorage.getItem('hibana-lang') === 'fa'
    const convertDigit = (el) => {
      if (!checkFa()) return
      const pos = el.selectionStart
      const val = el.value
      if (pos < 1) return
      const prev = val[pos - 1]
      if (!/[0-9]/.test(prev)) return
      const fa = faDigMap[+prev]
      el.value = val.slice(0, pos - 1) + fa + val.slice(pos)
      el.setSelectionRange(pos, pos)
    }
    // Textareas: notes, descriptions, task titles, composers
    document.addEventListener('input', (e) => {
      if (e.target?.tagName === 'TEXTAREA' && e.target.dataset.noFaDigits !== '') convertDigit(e.target)
    })
    // Input text fields: task titles, tags, etc.
    document.addEventListener('input', (e) => {
      const inp = e.target
      if (!inp || inp.tagName !== 'INPUT' || inp.dataset.noFaDigits === '') return
      if (inp.type && !['text', 'search', ''].includes(inp.type)) return
      convertDigit(inp)
    })

    const mounts = document.querySelectorAll('[data-nav]')
    if (mounts.length > 0) {
      // S72: the partial comes from /api/nav (a Worker route, no-store) instead of the
      // static /partials/nav.html — the CF edge cached the static URL under a zone
      // Edge-TTL override that ignored max-age=0 AND dropped query strings (?v= busting
      // can't reach the key), so deploys served a stale topbar for hours. The API path
      // always reaches the Worker; sw.js precaches '/api/nav' for offline boots.
      const res = await fetch('/api/nav')
      if (res.ok) {
        const html = await res.text()
        for (const m of mounts) m.innerHTML = html
        // Phase 7 item 13: the skeleton's aria-busy leaves WITH the placeholder content
        for (const m of mounts) m.removeAttribute('aria-busy')
        // Re-run i18n now that nav chrome is in the DOM (data-i18n elements).
        window.hibanaI18n?.apply()
        // S72: wire the pending-sync badge (the queue's onCount API finally has a shell
        // consumer). The topbar survives soft-navs (nav.js swaps only main.shell), so a
        // one-time wire per hard load is enough. queue.js loads BEFORE us on the 10
        // pages that carry it directly; on the rest, app.js injects it async — poll
        // briefly rather than race (progressive enhancement, never blocking boot).
        wireSyncBadge()
        const userEl = document.querySelector('[data-user]')
        // F2 (session 9): offline boot with the SW not yet controlling this page makes
        // fetch() itself throw — an unhandled rejection here would abort the rest of the
        // nav wiring (logout/theme/lang listeners below). Treat it as "no info": the auth
        // guard's offline banner explains the state.
        // S75: rides the shared per-page /api/auth/me memo (window.__hibanaMe) — this
        // was one of FOUR identical fetches firing on every authenticated page load.
        // hib-init.js and app.js load on the same 22-page set (verified), so the memo
        // always exists here.
        let info = null
        try {
          const env = await window.__hibanaMe()
          info = env && env.ok ? env.body : null
        } catch {
          info = null
        }
        // Super-admin panel link (batch r): the nav item ships hidden in the partial;
        // only owners ever see it. The API is the real gate — this is pure UX. The flag +
        // event let late-built chrome (the mobile sheet) catch up.
        if (info?.user?.role === 'owner') {
          window.__hibanaOwner = true
          document.querySelectorAll('[data-admin-link], [data-owner-tools]').forEach((el) => { el.hidden = false })
          document.dispatchEvent(new CustomEvent('hibana:role', { detail: { role: 'owner' } }))
        }
        if (userEl) {
          const name = info ? (info.user.username ?? info.user.email) : ''
          userEl.textContent = ''
          const avatar = document.createElement('span')
          avatar.className = 'avatar'
          if (info?.user?.avatar_path) {
            // profile picture (user request) — served through the worker so the GitHub token
            // never reaches the browser; cache-busted so a fresh upload shows on next load
            const img = document.createElement('img')
            img.src = '/api/settings/avatar/file?v=' + Date.now()
            img.alt = ''
            img.decoding = 'async'
            avatar.appendChild(img)
          } else {
            avatar.textContent = (name[0] || '?').toUpperCase()
          }
          const label = document.createElement('span')
          label.className = 'user-name'
          label.textContent = name
          userEl.append(avatar, label)
        }
        document.querySelector('[data-logout]')?.addEventListener('click', () => {
          fetch('/api/auth/logout', { method: 'POST' }).then(() => (window.location.href = '/login.html'))
        })
        document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
          b.addEventListener('click', () => window.hibana.toggleTheme())
        })
        window.hibana.paintThemeButton()
        // Profile avatar menu (nav partial): quick language toggle + quick-add. The global
        // quick-add wiring above ran before the nav fetch, so nav buttons need their own hookup.
        document.querySelectorAll('[data-lang-toggle]').forEach((b) => {
          b.addEventListener('click', async () => {
            // Explicit target (en/fa row buttons) wins; a bare data-lang-toggle keeps the
            // old toggle semantics (switch to the other language).
            const next = b.dataset.langToggle || ((window.hibanaI18n?.lang() ?? 'en') === 'fa' ? 'en' : 'fa')
            try {
              await fetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language_pref: next }),
              })
            } catch { /* still apply the client dictionary so the toggle works offline */ }
            // S75: the memoized /api/auth/me must not serve the PRE-PATCH user record —
            // force-refresh so apply() reads the new language_pref.
            if (window.__hibanaMe) await window.__hibanaMe(true)
            if (window.hibanaI18n) await window.hibanaI18n.apply()
            // Re-fetch the current page in place — server-rendered fragments re-render in the
            // new language without a hard reload.
            if (window.hibanaNav) window.hibanaNav.reload()
            else window.location.reload()
          })
        })
        // Mark the current page in the nav (aria-current → the rail's filled
        // rounded-square indicator + SR cue). S88: the RAIL's primary icons are the
        // desktop nav — /app IS the dashboard, a project detail page lights Projects,
        // sadhana.html lights To-do (the same normalization nav.js's markNav applies
        // on soft navigations; the old .topbar .nav-links selector stays for safety).
        const norm = (p) => {
          if (p === '/app') return '/dashboard.html'
          if (p === '/project.html' || p === '/project') return '/projects.html'
          if (p === '/sadhana.html') return '/to-do-list'
          return p
        }
        document.querySelectorAll('.rail .rail-primary a').forEach((a) => {
          if (norm(a.getAttribute('href') || '') === norm(location.pathname)) a.setAttribute('aria-current', 'page')
        })
        document.querySelectorAll('.topbar .nav-links a').forEach((a) => {
          if (a.getAttribute('href') === location.pathname) a.setAttribute('aria-current', 'page')
        })
      }
    }
    if (!userChecked) {
      userChecked = true
      // Defense in depth (2026-08-24 /register incident): the assets edge cached an
      // attribute-stripped variant of the signup page, so the body-class check alone
      // bounced guests to login. Public paths are exempted by URL too — a public page
      // must never redirect to login just because a cached variant lost its classes.
      const publicPaths = ['/login', '/login.html', '/signup', '/signup.html', '/confirm', '/confirm.html', '/reset', '/reset.html']
      const isPublic = publicPaths.includes(location.pathname) || (document.body?.classList.contains('public-page') ?? false)
      // F2 (session 9): offline boots used to redirect to login — the guard read ANY
      // failed /api/auth/me as "logged out", but the SW answers API calls with
      // 503 {error:'offline'} when the network is gone, so the PWA offline story
      // (cached shell + queue capture) was dead on arrival. Now: a thrown fetch or
      // the SW's offline 503 keeps you ON the page with the offline banner; ONLY a
      // deterministic 401 redirects. A bare 503/5xx (origin blip) also stays put —
      // bouncing an authed user during a restart was never right either.
      // S75: rides the shared per-page /api/auth/me memo — the guard needs raw STATUS
      // semantics (401 vs 503-offline), so it reads the memo's envelope { ok, status,
      // body }. The body is already consumed inside the memo (the S69
      // hold-the-request-open concern is handled there — json() is always read).
      // hib-init.js and app.js load on the same 22-page set (verified) — the memo
      // always exists when this guard runs.
      let env = null
      let offline = false
      try {
        env = await window.__hibanaMe()
      } catch {
        offline = true // request never completed: no network, DNS/VPN, or no SW catch
      }
      if (!offline && env && env.status === 503) {
        offline = env.body?.error === 'offline'
      }
      if (offline) {
        if (!isPublic) showOfflineBanner()
      } else if (env && env.status === 401 && !isPublic) {
        // S111: preserve the destination for the post-login bounce (see safeNext above).
        window.location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search))
      }
    }
  })

})()
