// S75 (bug fix, pre-existing — surfaced by this round's QA): nav.js's S44 same-page
// re-entry RE-EXECUTES every *-page.js on soft navigation (language toggle →
// nav.reload()). This file's top-level lexical declarations (historically `const
// invitesComponent`, now also the overview cache) collided on the second execution —
// SyntaxError: "Identifier has already been declared" — which killed the ENTIRE
// re-execution, so the fresh settings shell never mounted (dead components after a
// language toggle; verified reproducing on clean HEAD too). The IIFE gives every
// execution a fresh scope: re-entry re-registers cleanly, and the overview cache
// resetting per execution is CORRECT (a fresh shell means fresh data anyway).
(() => {
    // Item 6 fix (2026-09-09), re-deduped 2026-09-12: ONE factory, registered on BOTH
    // paths - alpine:init covers the hard load (settings-page.js loads before
    // alpine.min.js since the 5550991 script-order fix, so the listener fires before
    // the DOM walk), and the mount callback covers the soft nav (alpine:init already
    // fired long ago on the dashboard - removing the mount registration broke
    // invites on soft-nav, caught by e2e/alpine-hard-load.spec.ts #6). Alpine.data
    // last-wins makes the double call safe; the DEFINITION exists exactly once.
    //
    // S75 (§10-F4): the settings OVERVIEW — ONE request composes every read this page
    // needs (prefs / me / invites / ai models / telegram / trash). The page used to
    // fire 8 parallel JSON GETs on load, three of them literal duplicates
    // (/api/settings ×2, /api/auth/me ×2, /api/ai/models ×2 via the soft-nav safety
    // re-run). Module-scope cache: one network hit per hard load; soft-nav re-mounts
    // re-populate the fresh DOM from cache. Every consumer falls back to its legacy
    // single-slice endpoint when the overview is unavailable (offline / old shell),
    // and every post-mutation refresh stays targeted on its own endpoint on purpose.
    let __hibanaOverview = null
    function settingsOverview() {
      if (__hibanaOverview) return __hibanaOverview
      __hibanaOverview = fetch('/api/settings/overview')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((b) => { if (!b) __hibanaOverview = null /* retry on next mount */; return b })
      return __hibanaOverview
    }
    const invitesComponent = () => ({
        inviteEmail: '', sending: false, invites: [], loaded: false,
        async init() { await this.loadInvites() },
        async loadInvites() {
          try {
            const ov = await settingsOverview()
            if (ov && Array.isArray(ov.invites)) {
              this.invites = ov.invites
              this.loaded = true
              return
            }
            // Legacy path (overview unavailable): the single-slice fetch.
            const r = await fetch('/api/auth/invites')
            if (!r.ok) { this.loaded = true; return }
            const data = await r.json()
            this.invites = data.invites || []
            this.loaded = true
          } catch { this.loaded = true }
        },
        async sendInvite() {
          const email = (this.inviteEmail || '').trim()
          if (!email) return window.hibana?.toast(window.hibanaI18n?.t('settings.inviteEmailRequired') || 'Enter an email first', 'err')
          this.sending = true
          try {
            const r = await fetch('/api/auth/invites/email', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email }),
            })
            if (!r.ok) {
              const body = await r.json().catch(() => ({}))
              return window.hibana?.toast(body.detail || body.error || (window.hibanaI18n?.t('settings.inviteFailed') || 'Invite failed'), 'err')
            }
            window.hibana?.toast(`${window.hibanaI18n?.t('settings.inviteSent') || 'Invitation sent to'} ${email}`)
            this.inviteEmail = ''
            await this.loadInvites()
          } catch { window.hibana?.toast(window.hibanaI18n?.t('settings.inviteFailed') || 'Invite failed', 'err') }
          finally { this.sending = false }
        },
        async generate() {
          const r = await fetch('/api/auth/invites', { method: 'POST' })
          if (!r.ok) return window.hibana?.toast(window.hibanaI18n?.t('settings.inviteFailed') || 'Invite creation failed', 'err')
          const { code } = await r.json()
          await navigator.clipboard?.writeText(code)
          window.hibana?.toast(`${window.hibanaI18n?.t('settings.inviteCopied') || 'Copied invite code'}: ${code}`)
          await this.loadInvites()
        },
    })
    document.addEventListener('alpine:init', () => { window.Alpine?.data('invites', invitesComponent) })


    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'settings',
      mount() {
        // Obsidian import picker: the raw <input type=file> is replaced by a styled label
        // button; the summary line shows what's selected, and an empty submit is blocked
        // with a hint (hidden inputs can't carry a working `required`). Capture-phase so the
        // guard runs before htmx's own submit listener.
        const oform = document.getElementById('obsidian-form')
        const oinput = document.getElementById('obsidian-files')
        const oinfo = document.getElementById('obsidian-files-info')
        const oi18n = (k, f) => window.hibanaI18n?.t(k) || f
        const oShort = (name) => (name.length > 40 ? name.slice(0, 37) + '…' : name)
        if (oinput && oinfo) {
          oinput.addEventListener('change', () => {
            const files = [...oinput.files]
            oinfo.textContent = files.length
              ? files.length === 1
                ? oShort(files[0].name)
                : `${files.length} ${oi18n('settings.filesChosen', 'files chosen')}`
              : oi18n('settings.noFiles', 'No file chosen')
          })
        }
        oform?.addEventListener(
          'submit',
          (e) => {
            if (!oinput || oinput.files.length === 0) {
              e.preventDefault()
              e.stopImmediatePropagation()
              window.hibana?.toast(oi18n('settings.chooseFirst', 'Choose the files first'), 'err')
            }
          },
          true,
        )

        // Phase 6 item 12: the page-width select is a PURE client preference (no server
        // round-trip): write localStorage, paint <html data-page-width> immediately.
        // Delegated so it survives htmx/soft-nav re-mounts of this section.
        document.addEventListener('change', (e) => {
          const sel = e.target?.closest?.('#page-width-sel')
          if (!sel) return
          const v = sel.value === 'full' ? 'full' : 'standard'
          try { localStorage.setItem('hibana-page-width', v) } catch { /* private mode */ }
          document.documentElement.dataset.pageWidth = v
          window.hibana?.toast(window.hibanaI18n?.t('settings.prefsSaved') || 'Preferences saved')
        })
        const pwInit = () => {
          const sel = document.getElementById('page-width-sel')
          if (!sel) return
          try { sel.value = localStorage.getItem('hibana-page-width') === 'full' ? 'full' : 'standard' } catch { sel.value = 'standard' }
        }
        pwInit()
        setTimeout(pwInit, 800) // soft-nav into settings re-mounts the section after this script ran

        // Magic Button (idea §1) — free-tier model selector. Pure client pref like page-width:
        // localStorage 'hibana-ai-model', read fresh by magic-wand.js on every request. The
        // option list is fetched from GET /api/ai/models (auth-gated) so it stays in sync
        // with the server’s FREE_TIER_MODELS registry — never hard-coded in the client.
        const AI_MODEL_KEY = 'hibana-ai-model'
        function paintAiModelNote(model) {
          const note = document.getElementById('ai-model-note')
          if (!note || !model) return
          const fa = model.fa === 'weak'
            ? (window.hibanaI18n?.t('settings.aiFaWeak') || 'Persian: weak (EN recommended)')
            : (window.hibanaI18n?.t('settings.aiFaStrong') || 'Persian: strong')
          note.textContent = `${model.label} — ${fa} · ${model.inPerM}/${model.outPerM} neurons/M tok`
        }
        async function loadAiModels() {
          const sel = document.getElementById('ai-model-sel')
          if (!sel) return
          // S75: the soft-nav safety re-run (setTimeout below) targets a FRESH element
          // after a re-mount — populate it from the overview CACHE (zero network). On a
          // hard load the same element is already populated → no-op guard. This kills
          // the duplicate /api/ai/models fetch that fired on EVERY settings visit.
          if (sel.dataset.hibanaLoaded === '1' && sel.options.length) return
          let registry = null, def = null
          try {
            const ov = await settingsOverview()
            if (ov && ov.ai) { registry = ov.ai.models; def = ov.ai.default }
            else {
              const r = await fetch('/api/ai/models')
              if (r.ok) { const b = await r.json(); registry = b.models; def = b.default }
            }
          } catch { /* offline / Node path — leave the select empty, the wand still works (server default) */ }
          if (!registry || registry.length === 0) {
            // Workers-only path: show a single disabled option so the field isn’t blank.
            sel.innerHTML = '<option value="" disabled selected>Cloudflare Workers only</option>'
            return
          }
          sel.dataset.hibanaLoaded = '1'
          __hibanaAiRegistry = registry
          let saved = null
          try { saved = localStorage.getItem(AI_MODEL_KEY) } catch { /* private mode */ }
          const current = (saved && registry.some((m) => m.model === saved)) ? saved : def
          sel.innerHTML = registry.map((m) =>
            `<option value="${m.model}"${m.model === current ? ' selected' : ''}>${m.label}</option>`
          ).join('')
          paintAiModelNote(registry.find((m) => m.model === current) || registry[0])
        }
        // S75: the registry rides the overview cache — the change handler repaints
        // the model note from it instead of re-fetching /api/ai/models.
        let __hibanaAiRegistry = null
        document.addEventListener('change', (e) => {
          const sel = e.target?.closest?.('#ai-model-sel')
          if (!sel) return
          try { localStorage.setItem(AI_MODEL_KEY, sel.value) } catch { /* private mode */ }
          window.hibana?.toast(window.hibanaI18n?.t('settings.aiSaved') || 'AI model saved')
          // Repaint the note (fa flag + cost) for the new selection — cached registry.
          if (__hibanaAiRegistry) paintAiModelNote(__hibanaAiRegistry.find((m) => m.model === sel.value))
        })
        loadAiModels()
        setTimeout(loadAiModels, 800) // soft-nav re-mount safety, same as page-width

        // Auto-polish toggle (experimental) — localStorage 'hibana-ai-autopolish' = 'on'|'off'.
        // Off by default. The toggle is a pure client pref; ai-autopolish.js reads it.
        const AUTOPOLISH_KEY = 'hibana-ai-autopolish'
        function initAutopolishToggle() {
          const cb = document.getElementById('ai-autopolish-toggle')
          if (!cb) return
          try { cb.checked = localStorage.getItem(AUTOPOLISH_KEY) === 'on' } catch { cb.checked = false }
          cb.addEventListener('change', () => {
            try { localStorage.setItem(AUTOPOLISH_KEY, cb.checked ? 'on' : 'off') } catch { /* private mode */ }
            window.hibana?.toast(window.hibanaI18n?.t('settings.aiAutopolish' + (cb.checked ? 'On' : 'Off')) || ('Auto-polish ' + (cb.checked ? 'on' : 'off')))
          })
        }
        initAutopolishToggle()
        setTimeout(initAutopolishToggle, 800)

        // Custom AI system prompt — localStorage 'hibana-ai-custom-prompt'. Empty → defaults.
        // Debounced save on input (no save button needed — same UX as the page-width select).
        const PROMPT_KEY = 'hibana-ai-custom-prompt'
        let promptTimer = null
        function initCustomPrompt() {
          const ta = document.getElementById('ai-custom-prompt')
          if (!ta) return
          try { ta.value = localStorage.getItem(PROMPT_KEY) || '' } catch { ta.value = '' }
          ta.addEventListener('input', () => {
            clearTimeout(promptTimer)
            promptTimer = setTimeout(() => {
              try { localStorage.setItem(PROMPT_KEY, ta.value) } catch { /* private mode */ }
              window.hibana?.toast(window.hibanaI18n?.t('settings.aiCustomPromptSaved') || 'AI instructions saved')
            }, 600)
          })
        }
        initCustomPrompt()
        setTimeout(initCustomPrompt, 800)

        // Alpine.data() registers globally; re-registering on each visit is safe (last wins) and
        // required on soft navigation — nav.js calls these before Alpine.initTree().
        // invites: same factory as the alpine:init registration above (soft-nav path).
        window.Alpine?.data('invites', invitesComponent)
        window.Alpine?.data('prefs', () => ({
          language_pref: 'en', timezone: 'UTC', calendar_pref: 'gregorian',
          async load() {
            // S75: overview first (one request for the whole page), legacy slice second.
            const ov = await settingsOverview().catch(() => null)
            const prefs = ov?.prefs || (await fetch('/api/settings').then((r) => r.json()).then((b) => b.prefs).catch(() => null))
            if (prefs) Object.assign(this, prefs)
          },
          async save() {
            // calendar_pref is derived from language on the server (fa→shamsi, en→gregorian)
            await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language_pref: this.language_pref, timezone: this.timezone }) })
            // S75: force-refresh the memoized /api/auth/me — apply() must read the
            // just-PATCHed language_pref, not the pre-save record.
            if (window.__hibanaMe) { try { await window.__hibanaMe(true) } catch { /* offline */ } }
            window.hibana?.toast(window.hibanaI18n?.t('settings.prefsSaved') || 'Preferences saved')
            window.hibanaI18n?.apply()
          },
          init() { this.load() },
        }))
        // Dashboard view options (user request 2026-08-26): which sections show + their order.
        // Order changes via ↑/↓ buttons or HTML5 drag (the global touch long-press fallback in
        // app.js makes the handle work on touch too). Every change PATCHes /api/settings.
        window.Alpine?.data('views', () => ({
          loaded: false,
          order: [],
          // NOTE: state lives in shownMap — a `shown` data property would clobber the
          // shown(id) method below when load() assigns it (pre-existing bug 2026-08-29:
          // "shown is not a function" — the Show/Hide buttons rendered blank).
          shownMap: {},
          ALL: ['header', 'todo', 'projects', 'notebook', 'activity'],
          dragFrom: null,
          i18nTick: 0, // bumped once the user's language resolves — see toggleLabel
          t: (k, f) => window.hibanaI18n?.t(k) || f,
          // Reactive on i18nTick (same pattern as toggleLabel below) — Alpine only
          // re-renders this binding when load() bumps i18nTick after the async
          // language fetch resolves; without the dependency the section names
          // stayed on the English fallback for FA users (2026-08-29 re-verify).
          label(id) {
            void this.i18nTick
            const labels = {
              header: this.t('settings.sectionHeader', 'Dashboard header'),
              todo: this.t('settings.sectionTodo', 'To-Do list preview'),
              projects: this.t('settings.sectionProjects', 'Projects kanban'),
              notebook: this.t('settings.sectionNotebook', 'Quick Notebook'),
              activity: this.t('settings.sectionActivity', 'Recent activity'),
            }
            return labels[id] || id
          },
          shown(id) { return !!this.shownMap[id] },
          // Label via a method (not an inline ternary) so it can also depend on
          // i18nTick — Alpine re-renders when load() bumps it after hibanaI18n.ready,
          // which lands the Show/Hide labels in Farsi for FA users on first paint.
          toggleLabel(id) {
            void this.i18nTick
            const isShown = !!this.shownMap[id]
            return this.t(isShown ? 'settings.hide' : 'settings.show', isShown ? 'Hide' : 'Show')
          },
          async load() {
            // S75: overview first — same payload as the old /api/settings fetch.
            const ov = await settingsOverview().catch(() => null)
            let prefs = ov?.prefs || null
            if (!prefs) {
              try {
                const r = await fetch('/api/settings')
                prefs = (await r.json()).prefs
              } catch { prefs = null }
            }
            if (!prefs) return
            this.shownMap = {
              header: !!prefs.dash_show_header,
              todo: prefs.dash_show_todo !== 0,
              projects: !!prefs.dash_show_projects,
              notebook: !!prefs.dash_show_notebook,
              activity: !!prefs.dash_show_activity,
            }
            this.order = String(prefs.dash_order || this.ALL.join(','))
              .split(',')
              .map((s) => s.trim())
              .filter((s, i, a) => this.ALL.includes(s) && a.indexOf(s) === i)
            for (const id of this.ALL) if (!this.order.includes(id)) this.order.push(id)
            this.loaded = true
            // Re-render the labels once the language has actually resolved.
            try { await window.hibanaI18n?.ready } catch { /* keep EN fallback */ }
            this.i18nTick++
          },
          move(i, dir) {
            const j = i + dir
            if (j < 0 || j >= this.order.length) return
            const next = this.order.slice()
            const [x] = next.splice(i, 1)
            next.splice(j, 0, x)
            this.order = next
            this.save()
          },
          toggle(id) {
            this.shownMap[id] = !this.shownMap[id]
            this.save()
          },
          dragStart(e, i) { this.dragFrom = i; e.dataTransfer.effectAllowed = 'move' },
          dragOver() {},
          drop(e, j) {
            const from = this.dragFrom
            if (from === null || from === undefined || from === j) return
            const next = this.order.slice()
            const [x] = next.splice(from, 1)
            next.splice(j, 0, x)
            this.order = next
            this.dragFrom = null
            this.save()
          },
          async save() {
            await fetch('/api/settings', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dash_show_header: this.shownMap.header ? 1 : 0,
                dash_show_projects: this.shownMap.projects ? 1 : 0,
                dash_show_todo: this.shownMap.todo ? 1 : 0,
                dash_show_notebook: this.shownMap.notebook ? 1 : 0,
                dash_show_activity: this.shownMap.activity ? 1 : 0,
                dash_order: this.order.join(','),
              }),
            })
            window.hibana?.toast(this.t('settings.viewsSaved', 'Dashboard view saved'))
          },
          init() { this.load() },
        }))
        // S87: two looks only — light + claude-dark (THE dark mode; legacy 'dark'
        // migrates). 'system' stays stored but always applies a RESOLVED explicit
        // theme (the old code wrote data-theme='system', a value with no CSS rules).
        window.Alpine?.data('theme', () => ({
          t: (() => {
            const v = localStorage.getItem('hibana-theme')
            if (v === 'dark') { try { localStorage.setItem('hibana-theme', 'claude-dark') } catch {} ; return 'claude-dark' }
            return v === 'light' || v === 'claude-dark' || v === 'system' ? v : 'system'
          })(),
          resolve(t) {
            if (t === 'light') return 'light'
            if (t === 'claude-dark' || t === 'dark') return 'claude-dark'
            return matchMedia('(prefers-color-scheme: dark)').matches ? 'claude-dark' : 'light'
          },
          set(t) {
            this.t = t
            try { localStorage.setItem('hibana-theme', t) } catch {}
            document.documentElement.dataset.theme = this.resolve(t)
            window.hibana?.paintThemeButton?.()
          },
          init() { document.documentElement.dataset.theme = this.resolve(this.t) },
        }))
        window.Alpine?.data('telegram', () => ({
          ready: false,
          linked: false,
          code: '',
          bot: '@Hibana_PM_bot',
          botUrl: 'https://t.me/Hibana_PM_bot',
          connectUrl: 'https://t.me/Hibana_PM_bot',
          i18nTick: 0,
          t: (k, f) => window.hibanaI18n?.t(k) || f,
          linkLabel() {
            void this.i18nTick
            return this.linked
              ? this.t('settings.telegramLinked', 'Linked to Telegram')
              : this.t('settings.telegramNotLinked', 'Not linked yet')
          },
          async load() {
            // S75: overview first (one request for the whole page), legacy slice second.
            const ov = await settingsOverview().catch(() => null)
            let body = ov?.telegram || null
            if (!body) {
              try {
                const r = await fetch('/api/telegram/status')
                body = r.ok ? await r.json() : null
              } catch { body = null }
            }
            if (!body) return
            this.bot = body.bot || this.bot
            this.botUrl = body.botUrl || this.botUrl
            this.connectUrl = body.botUrl || this.botUrl
            this.linked = !!body.linked
            this.ready = true
            try { await window.hibanaI18n?.ready } catch {}
            this.i18nTick++
          },
          // Generate a link code + immediately open Telegram with ?start=<code>.
          // The deep link https://t.me/<bot>?start=<code> opens the Telegram app,
          // navigates to the bot, and pre-fills /start <code> — the user just taps Start.
          async generateAndOpen(ev) {
            // Generate the code first (server-side)
            const r = await fetch('/api/telegram/link-code', { method: 'POST' })
            if (!r.ok) {
              window.hibana?.toast(this.t('settings.codeFailed', 'Link code generation failed'), 'err')
              ev.preventDefault()
              return
            }
            const body = await r.json()
            this.code = body.code
            // Build the deep link: t.me/Hibana_PM_bot?start=<code>
            // Telegram's ?start= param sends /start <code> to the bot automatically.
            const botHandle = (this.botUrl || 'https://t.me/Hibana_PM_bot').replace(/^https?:\/\/t\.me\//, '')
            this.connectUrl = `https://t.me/${botHandle}?start=${body.code}`
            // The <a :href="connectUrl"> already has the new URL by now (Alpine reactivity).
            // Let the default <a> click proceed (don't preventDefault) so Telegram opens.
            await navigator.clipboard?.writeText(body.code).catch(() => {})
          },
          async unlink() {
            const r = await fetch('/api/telegram/link', { method: 'DELETE' })
            if (!r.ok) return window.hibana?.toast(this.t('settings.unlinkFailed', 'Unlink failed — try again'), 'err')
            this.linked = false
            this.code = ''
            this.connectUrl = this.botUrl
            window.hibana?.toast(this.t('settings.unlinked', 'Telegram unlinked'))
          },
          init() { this.load() },
        }))
        window.Alpine?.data('account', () => ({
          email: '',
          currentPassword: '', newPassword: '', confirmPassword: '',
          busy: false,
          async load() {
            // S75: overview first — the me slice (same shape as /api/auth/me).
            const ov = await settingsOverview().catch(() => null)
            let user = ov?.me?.user || null
            if (!user) {
              try {
                const r = await fetch('/api/auth/me')
                if (r.ok) user = (await r.json()).user
              } catch { user = null }
            }
            if (user) this.email = user.email || (window.hibanaI18n?.t('settings.emailMissing') || '(no email — username login)')
          },
          async changePassword() {
            if (this.newPassword !== this.confirmPassword) return window.hibana?.toast(window.hibanaI18n?.t('settings.passwordsNoMatch') || 'New passwords do not match', 'err')
            if (this.newPassword.length < 8) return window.hibana?.toast(window.hibanaI18n?.t('settings.passwordShort') || 'New password must be at least 8 characters', 'err')
            this.busy = true
            try {
              const r = await fetch('/api/auth/password', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password: this.currentPassword, new_password: this.newPassword }),
              })
              const body = await r.json().catch(() => ({}))
              if (!r.ok) {
                window.hibana?.toast(body.error === 'invalid_current_password' ? (window.hibanaI18n?.t('settings.passwordWrong') || 'Current password is incorrect') : (window.hibanaI18n?.t('settings.passwordFailed') || 'Password change failed'), 'err')
                return
              }
              window.hibana?.toast(window.hibanaI18n?.t('settings.passwordChanged') || 'Password changed — other devices signed out')
              this.currentPassword = this.newPassword = this.confirmPassword = ''
            } finally {
              this.busy = false
            }
          },
          init() { this.load() },
        }))
        // Profile picture: crop the chosen image to a centered 256×256 square + convert to WebP
        // on the client (cover-fit), then PUT it — tiny payload, no server-side image tooling.
        // Uses the shared image-resize.js utility (window.hibanaImageResize.resizeSquare).
        const fileToSquarePng = async (file) => {
          const { dataBase64, mimeType } = await window.hibanaImageResize.resizeSquare(file, 256, { mimeType: 'image/webp', quality: 0.85 })
          return { dataBase64, mimeType }
        }
        window.Alpine?.data('avatar', () => ({
          pic: false,
          url: '',
          initial: '?',
          async load() {
            // S75: overview first — the me slice (avatar fields included).
            const ov = await settingsOverview().catch(() => null)
            let user = ov?.me?.user || null
            if (!user) {
              try {
                const r = await fetch('/api/auth/me')
                if (r.ok) user = (await r.json()).user
              } catch { user = null }
            }
            if (!user) return
            const name = user.username || user.email || '?'
            this.initial = (name[0] || '?').toUpperCase()
            this.pic = !!user.avatar_path
            this.url = user.avatar_path ? '/api/settings/avatar/file?v=' + Date.now() : ''
          },
          onErr() { this.pic = false },
          async upload(ev) {
            const file = ev.target.files && ev.target.files[0]
            if (!file) return
            if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type || '')) {
              return window.hibana?.toast(window.hibanaI18n?.t('settings.avatarBadType') || 'Please choose an image file', 'err')
            }
            try {
              const { dataBase64, mimeType } = await fileToSquarePng(file)
              const r = await fetch('/api/settings/avatar', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mimeType, dataBase64 }),
              })
              if (!r.ok) throw new Error('upload failed')
              await this.load()
              window.hibana?.toast(window.hibanaI18n?.t('settings.avatarSaved') || 'Profile picture saved')
            } catch {
              window.hibana?.toast(window.hibanaI18n?.t('settings.avatarFailed') || 'Upload failed', 'err')
            } finally {
              ev.target.value = ''
            }
          },
          async remove() {
            await fetch('/api/settings/avatar', { method: 'DELETE' })
            await this.load()
            window.hibana?.toast(window.hibanaI18n?.t('settings.avatarRemoved') || 'Profile picture removed')
          },
          init() { this.load() },
        }))

        // B3.5: Settings tabs — scroll to the section + mark active. Progressive enhancement;
        // without JS the page is still a single scroll with every section visible.
        const tabTargets = {
          prefs: 'settings-prefs',
          appearance: 'settings-appearance',
          account: 'settings-account',
          telegram: 'settings-telegram',
          data: 'settings-data',
        }
        document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = tabTargets[btn.dataset.settingsTab]
            if (!id) return
            document.querySelectorAll('[data-settings-tab]').forEach((b) => b.classList.toggle('is-active', b === btn))
            const el = document.getElementById(id)
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
        })
        // Mark the active tab on scroll (IntersectionObserver on each section)
        const sections = Object.values(tabTargets).map((id) => document.getElementById(id)).filter(Boolean)
        if (sections.length && 'IntersectionObserver' in window) {
          const obs = new IntersectionObserver((entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                const tab = Object.keys(tabTargets).find((k) => tabTargets[k] === e.target.id)
                if (tab) {
                  document.querySelectorAll('[data-settings-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.settingsTab === tab))
                }
              }
            }
          }, { rootMargin: '-30% 0px -60% 0px' })
          sections.forEach((s) => obs.observe(s))
        }

        // R6.2: "Show onboarding tour" button → reset the localStorage flag + navigate to
        // the dashboard, which triggers the tour on load (the tour.js auto-starts when the
        // flag is absent + we're on /app).
        document.getElementById('show-tour-btn')?.addEventListener('click', () => {
          window.hibanaTour?.reset?.()
          if (window.hibanaNav) window.hibanaNav.go('/app')
          else window.location.href = '/app'
        })

        // R7.2: "Install app" button — only visible if the browser fired beforeinstallprompt.
        // install-prompt.js captures the event; here we just show the button + wire the click.
        const installBtn = document.getElementById('install-app-btn')
        if (installBtn && window.hibanaInstall?.canInstall?.()) {
          installBtn.hidden = false
          installBtn.addEventListener('click', () => window.hibanaInstall.trigger())
        }

        // Session 19 (cron round 2): web-clipper bookmarklet. The href uses a JS-resolved
        // absolute origin (hibana.ir in prod, localhost:3000 locally) so the bookmarklet
        // works when dragged to the bookmarks bar and clicked from ANY page. CSP allows
        // inline scripts on settings.html (unsafe-inline is in the script-src).
        const clipLink = document.getElementById('clipper-bookmarklet')
        if (clipLink) {
          const origin = location.origin
          const href = `javascript:void(window.open('${origin}/clip.html?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(window.getSelection().toString()),'hibana-clip','width=480,height=440,noopener'))`
          clipLink.setAttribute('href', href)
        }

        // S50: the Trash panel — GET /api/settings/trash (read-only, user-scoped). The
        // per-item Restore buttons POST the EXISTING restore endpoints (notes/sadhana/
        // projects) — this panel owns no write path of its own. Titles come from the
        // server: escape EVERYTHING before it touches innerHTML (the H2 rule).
        const trashList = document.getElementById('trash-list')
        if (trashList) {
          const tT = (k, f) => window.hibanaI18n?.t(k) || f
          const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
          // FA is the primary language: digits render as Persian when fa is active.
          const dig = (n) => (document.documentElement.lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : String(n))
          const KIND_META = {
            project: { label: () => tT('trash.kind.project', 'Project'), endpoint: (id) => `/api/projects/${encodeURIComponent(id)}/restore`, ico: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>' },
            note: { label: () => tT('trash.kind.note', 'Note'), endpoint: (id) => `/api/notes/${encodeURIComponent(id)}/restore`, ico: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h9l5 5v13H5Z"/><path d="M14 3v5h5M8 13h8M8 17h5"/></svg>' },
            todo: { label: () => tT('trash.kind.todo', 'To-do'), endpoint: (id) => `/api/sadhana/tasks/${encodeURIComponent(id)}/restore`, ico: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>' },
          }
          const purgeLabel = (daysLeft) =>
            daysLeft <= 0
              ? tT('trash.purgeToday', 'purges today')
              : tT('trash.purgeIn', 'purges in {n}d').replace('{n}', dig(daysLeft))

          // S71: two-click confirm for destructive buttons — the first click ARMS the
          // button (label flips to "Sure?"), the second within 4s fires; anything else
          // disarms. No modal needed for a row-level action; the arm state is obvious
          // in place and self-dismisses.
          const armButton = (btn, armedLabel) => {
            if (btn.dataset.armed === '1') return true
            btn.dataset.armed = '1'
            btn.dataset.origLabel = btn.textContent
            btn.textContent = armedLabel
            btn.classList.add('is-armed')
            btn._disarm = setTimeout(() => {
              btn.dataset.armed = ''
              btn.classList.remove('is-armed')
              btn.textContent = btn.dataset.origLabel
            }, 6000)
            return false
          }
          const disarmButton = (btn) => {
            clearTimeout(btn._disarm)
            btn.dataset.armed = ''
            btn.classList.remove('is-armed')
            if (btn.dataset.origLabel) btn.textContent = btn.dataset.origLabel
          }

          // S75: the i18n re-render repaints from cache — no refetch. The cache is
          // maintained INSIDE renderTrash so every mutation path (restore / purge /
          // empty) keeps it in lockstep with the DOM — a language flip can never
          // resurrect a row the user just removed.
          let lastTrashItems = null
          const renderTrash = (items) => {
            lastTrashItems = items
            trashList.textContent = ''
            const emptyBtn = document.getElementById('trash-empty-btn')
            if (!items.length) {
              const li = document.createElement('li')
              li.className = 'trash-empty muted'
              li.textContent = tT('settings.trashEmpty', 'Nothing here — deleted items wait for 7 days, then purge forever.')
              trashList.appendChild(li)
              if (emptyBtn) emptyBtn.hidden = true
              return
            }
            if (emptyBtn) {
              emptyBtn.hidden = false
              emptyBtn.textContent = tT('trash.emptyBtn', 'Empty trash') + ' (' + dig(items.length) + ')'
              disarmButton(emptyBtn)
            }
            for (const it of items) {
              const meta = KIND_META[it.kind] || KIND_META.note
              const li = document.createElement('li')
              li.className = 'trash-item'
              li.dataset.trashId = it.id
              li.innerHTML =
                `<span class="trash-ico" aria-hidden="true">${meta.ico}</span>` +
                `<div class="trash-body">` +
                  `<div class="trash-title" dir="auto">${escHtml(it.title)}</div>` +
                  `<div class="trash-meta muted small${it.days_left <= 1 ? ' is-urgent' : ''}"><span>${escHtml(meta.label())} · ${escHtml(purgeLabel(it.days_left))}</span></div>` +
                `</div>` +
                `<span class="trash-actions">` +
                  `<button type="button" class="btn ghost small trash-restore">${escHtml(tT('trash.restore', 'Restore'))}</button>` +
                  `<button type="button" class="btn ghost small trash-purge" title="${escHtml(tT('trash.deleteForever', 'Delete forever'))}">${escHtml(tT('trash.deleteForever', 'Delete forever'))}</button>` +
                `</span>`
              if (it.snippet && it.snippet !== it.title) {
                li.querySelector('.trash-title')?.setAttribute('title', it.snippet)
              }
              li.querySelector('.trash-restore')?.addEventListener('click', async (ev) => {
                const btn = ev.currentTarget
                btn.disabled = true
                try {
                  const r = await fetch(meta.endpoint(it.id), { method: 'POST' })
                  if (!r.ok) throw new Error('restore failed')
                  window.hibana?.toast(tT('trash.restored', 'Restored'))
                  li.classList.add('is-restoring')
                  setTimeout(() => { li.remove(); if (!trashList.children.length) renderTrash([]); else if (lastTrashItems) lastTrashItems = lastTrashItems.filter((x) => x.id !== it.id) }, 260)
                } catch {
                  btn.disabled = false
                  window.hibana?.toast(tT('trash.restoreFailed', "Couldn't restore — try again"), 'err')
                }
              })
              // S71: "delete forever" — bypasses the 7-day wait for THIS row only.
              li.querySelector('.trash-purge')?.addEventListener('click', async (ev) => {
                const btn = ev.currentTarget
                if (!armButton(btn, tT('trash.confirmPurge', 'Sure?'))) return
                btn.disabled = true
                try {
                  const r = await fetch('/api/settings/trash/purge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kind: it.kind, id: it.id }),
                  })
                  if (!r.ok) throw new Error('purge failed')
                  window.hibana?.toast(tT('trash.purged', 'Deleted forever'))
                  li.classList.add('is-restoring')
                  setTimeout(() => {
                    li.remove()
                    if (!trashList.children.length) renderTrash([])
                    else { // one fewer item — refresh the Empty button count + the cache
                      if (lastTrashItems) lastTrashItems = lastTrashItems.filter((x) => x.id !== it.id)
                      const n = trashList.querySelectorAll('.trash-item').length
                      const eb = document.getElementById('trash-empty-btn')
                      if (eb && n) eb.textContent = tT('trash.emptyBtn', 'Empty trash') + ' (' + dig(n) + ')'
                      else if (eb) eb.hidden = true
                    }
                  }, 260)
                } catch {
                  btn.disabled = false
                  disarmButton(btn)
                  window.hibana?.toast(tT('trash.purgeFailed', "Couldn't delete — try again"), 'err')
                }
              })
              trashList.appendChild(li)
            }
          }

          const loadTrash = async () => {
            try {
              // S75: overview first (one request for the whole page), legacy slice second.
              const ov = await settingsOverview().catch(() => null)
              let items = ov?.trash?.items || null
              if (!items) {
                const r = await fetch('/api/settings/trash')
                if (!r.ok) throw new Error('trash failed')
                items = (await r.json()).items || []
              }
              renderTrash(items)
            } catch {
              trashList.textContent = ''
              const li = document.createElement('li')
              li.className = 'trash-empty muted'
              li.textContent = tT('trash.loadFailed', "Couldn't load the trash")
              trashList.appendChild(li)
            }
          }
          loadTrash()
          // S71: loadTrash() races i18n.apply() on first paint — the FA dictionary may
          // land AFTER the list rendered, leaving JS-built labels (Delete forever /
          // Restore / Empty) in EN while data-i18n nodes flip to FA. Re-render when
          // i18n applies; idempotent (same list, retranslated). S75: repaints from the
          // cached items — zero network on the language flip.
          document.addEventListener('hibana:i18n', () => { if (lastTrashItems) renderTrash(lastTrashItems) })

          // S71: "Empty trash" — every soft-deleted item of THIS user, right now. Same
          // two-click confirm as the per-row purge (this one frees many items at once).
          const emptyBtnEl = document.getElementById('trash-empty-btn')
          emptyBtnEl?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget
            if (!armButton(btn, tT('trash.confirmPurge', 'Sure?'))) return
            btn.disabled = true
            try {
              const r = await fetch('/api/settings/trash/empty', { method: 'POST' })
              if (!r.ok) throw new Error('empty failed')
              const body = await r.json().catch(() => ({}))
              const n = (body.purgedProjects ?? 0) + (body.purgedNotes ?? 0) + (body.purgedTodos ?? 0)
              window.hibana?.toast(tT('trash.emptied', 'Trash emptied — {n} item(s) freed').replace('{n}', dig(n)))
              renderTrash([])
            } catch {
              btn.disabled = false
              disarmButton(btn)
              window.hibana?.toast(tT('trash.purgeFailed', "Couldn't delete — try again"), 'err')
            }
          })
        }
      },
    })

})()
