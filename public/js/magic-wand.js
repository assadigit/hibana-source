// public/js/magic-wand.js — Magic Button (idea §1, green-lit).
//
// A focus-triggered floating wand + popover. When a qualifying editable field is focused,
// a small wand icon appears at its top-end corner; clicking it opens a popover with
// Polish / Rewrite / Translate. The original is NEVER modified until the user clicks
// Apply in a side-by-side preview; Discard or Esc at any stage = zero writes. Errors and
// the daily-cap surface as a toast and leave the original intact (Mission #1).
//
// Backend: POST /api/ai/text { text, action } → { text } (Workers AI binding, qwen3-30b).
// Apply writes the transformed text back into the field and dispatches `input` + `change`
// so the surface's OWN autosave (note input, project description debounce, …) persists it.
// The wand itself never writes to the DB — it only fills the field the user already owns.
//
// i18n: reads window.hibanaI18n.t(key) with EN fallbacks baked in, so it works before the
// dict loads. RTL-safe: the wand anchors to the field's end corner; the popover flips to
// stay on-screen. Theme-aware via data-theme (see magic-wand.css).
(function () {
  'use strict'

  // Editable surfaces the wand attaches to. The first three cover the green-lit scope
  // (notes, the quick-note composer, the project description). `data-magic` is the opt-in
  // escape hatch for any future editable text field (a textarea or contenteditable).
  const SELECTOR = [
    'textarea[data-magic]',
    '[contenteditable="true"][data-magic]',
    'textarea.note-text',
    'textarea#quicknote-text',
    'textarea#pd-desc',
  ].join(',')

  // --- i18n with EN fallbacks (so the wand is usable before hibanaI18n loads) ----
  const FALLBACK = {
    'magic.tooltip': 'AI: polish, rewrite, or translate',
    'magic.title': 'Magic wand',
    'magic.polish': 'Polish',
    'magic.rewrite': 'Rewrite',
    'magic.translate': 'Translate',
    'magic.working': 'Working…',
    'magic.original': 'Original',
    'magic.suggestion': 'Suggestion',
    'magic.apply': 'Apply',
    'magic.discard': 'Discard',
    'magic.applied': 'Applied — review and save',
    'magic.failed': 'The AI request failed. Your text was not changed.',
    'magic.tooLong': 'Text is too long (max 4000 characters).',
    'magic.workersOnly': 'This feature runs on the Cloudflare Workers deployment only.',
    'magic.empty': 'Nothing came back — try again.',
    'magic.modelBadge': 'Model',
  }
  const t = (k) => window.hibanaI18n?.t(k) ?? FALLBACK[k] ?? k
  const toast = (msg, kind) => window.hibana?.toast?.(msg, kind ?? 'err')
  const isFa = () => window.hibanaI18n?.lang === 'fa' || document.documentElement.lang === 'fa'

  // The user's chosen free-tier model (Settings → AI model). Stored in localStorage under
  // the same key the settings page writes; read fresh on every request so a mid-session
  // change takes effect immediately. Missing/invalid → undefined → server defaults to
  // @cf/qwen/qwen3-30b-a3b-fp8 (resolveModel on the backend is the source of truth).
  const MODEL_KEY = 'hibana-ai-model'
  function chosenModel() {
    try { return localStorage.getItem(MODEL_KEY) || undefined } catch { return undefined }
  }

  const WAND_SVG =
    '<svg class="mw-idle" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M15 4V2M15 10V8M19 6h2M9 6h2"/>' +
    '<path d="M13.5 6.5 4 16l-1.5 4.5L7 19l9.5-9.5a2.12 2.12 0 0 0-3-3z"/>' +
    '</svg>' +
    '<svg class="mw-spin" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
    '<path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>'

  // --- singleton UI -------------------------------------------------------------
  let wand, popover, backdrop, activeField
  let running = false // repeated clicks disabled during a run (idea §1)

  function ensureUI() {
    if (wand) return
    wand = document.createElement('button')
    wand.type = 'button'
    wand.className = 'magic-wand'
    wand.hidden = true
    wand.setAttribute('aria-label', t('magic.tooltip'))
    wand.title = t('magic.tooltip')
    wand.innerHTML = WAND_SVG
    wand.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); togglePopover() })
    document.body.appendChild(wand)

    backdrop = document.createElement('div')
    backdrop.className = 'magic-backdrop'
    backdrop.hidden = true
    backdrop.addEventListener('click', closePopover)
    document.body.appendChild(backdrop)
  }

  function fieldText(field) {
    if (field.isContentEditable) return field.innerText
    return field.value ?? ''
  }
  function setFieldText(field, text) {
    if (field.isContentEditable) {
      field.innerText = text
    } else if ('value' in field) {
      field.value = text
    }
    // Reuse the surface's own save path (note autosave / project-desc debounce) by
    // dispatching the same events a keystroke would. The wand never calls a write route.
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function positionWand(field) {
    const r = field.getBoundingClientRect()
    const rtl = isFa()
    // Anchor to the end corner; clamp inside the viewport so it never scrolls off-screen.
    const x = rtl ? Math.max(8, r.left - 34) : Math.min(window.innerWidth - 38, r.right + 4)
    const y = Math.max(8, Math.min(window.innerHeight - 34, r.top + 2))
    wand.style.left = x + 'px'
    wand.style.top = y + 'px'
  }

  function showWand(field) {
    ensureUI()
    activeField = field
    wand.setAttribute('aria-label', t('magic.tooltip'))
    wand.title = t('magic.tooltip')
    positionWand(field)
    wand.hidden = false
  }
  function hideWand() {
    if (!wand) return
    wand.hidden = true
  }

  function closePopover() {
    if (!popover) return
    popover.remove()
    popover = null
    backdrop.hidden = true
    running = false
    if (wand) wand.setAttribute('aria-busy', 'false')
    if (activeField) activeField.focus?.()
  }

  function actionsRow(disabled) {
    const acts = [['polish', t('magic.polish')], ['rewrite', t('magic.rewrite')], ['translate', t('magic.translate')]]
    return acts.map(([a, label]) =>
      `<button type="button" data-action="${a}" ${disabled ? 'disabled' : ''}>${label}</button>`
    ).join('')
  }

  function togglePopover() {
    if (popover) { closePopover(); return }
    if (!activeField) return
    ensureUI()
    backdrop.hidden = false
    popover = document.createElement('div')
    popover.className = 'magic-popover'
    popover.setAttribute('role', 'dialog')
    popover.setAttribute('aria-label', t('magic.title'))
    // Show which model is active so the user knows what the wand will call. The badge is
    // a short label only — the full registry + picker lives in Settings.
    const m = chosenModel() || '@cf/qwen/qwen3-30b-a3b-fp8'
    const short = m.split('/').pop() || m
    popover.innerHTML =
      '<h3>' + t('magic.title') + '</h3>' +
      '<div class="magic-model-badge"><span class="magic-model-label">' + t('magic.modelBadge') + ':</span> <code>' + short + '</code></div>' +
      '<div class="magic-actions">' + actionsRow(false) + '</div>'
    document.body.appendChild(popover)
    positionPopover()
    popover.querySelectorAll('[data-action]').forEach((b) =>
      b.addEventListener('click', () => runAction(b.getAttribute('data-action')))
    )
    popover.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover() })
    popover.querySelector('[data-action]')?.focus()
  }

  function positionPopover() {
    if (!popover || !activeField) return
    const wr = wand.getBoundingClientRect()
    const pw = popover.offsetWidth, ph = popover.offsetHeight
    // Prefer below the wand, end-aligned; flip above / clamp if it would overflow.
    let x = Math.min(window.innerWidth - pw - 8, Math.max(8, wr.left))
    let y = wr.bottom + 6
    if (y + ph > window.innerHeight - 8) y = Math.max(8, wr.top - ph - 6)
    popover.style.left = x + 'px'
    popover.style.top = y + 'px'
  }

  function renderPreview(original, suggestion) {
    if (!popover) return
    popover.innerHTML =
      '<h3>' + t('magic.title') + '</h3>' +
      '<div class="magic-preview">' +
        '<div class="magic-pane magic-pane-original"><span class="magic-pane-label">' + t('magic.original') + '</span>' +
          '<div class="magic-pane-body"></div></div>' +
        '<div class="magic-pane magic-pane-suggestion"><span class="magic-pane-label">' + t('magic.suggestion') + '</span>' +
          '<div class="magic-pane-body"></div></div>' +
      '</div>' +
      '<div class="magic-foot">' +
        '<button type="button" class="magic-discard" data-act="discard">' + t('magic.discard') + '</button>' +
        '<button type="button" class="magic-apply" data-act="apply">' + t('magic.apply') + '</button>' +
      '</div>'
    popover.querySelector('.magic-pane-original .magic-pane-body').textContent = original
    popover.querySelector('.magic-pane-suggestion .magic-pane-body').textContent = suggestion
    popover.querySelector('[data-act="apply"]').addEventListener('click', () => {
      setFieldText(activeField, suggestion)
      toast(t('magic.applied'), 'info')
      closePopover()
      hideWand()
    })
    popover.querySelector('[data-act="discard"]').addEventListener('click', closePopover)
    positionPopover()
  }

  function renderActionsAgain() {
    if (!popover) return
    const m = chosenModel() || '@cf/qwen/qwen3-30b-a3b-fp8'
    const short = m.split('/').pop() || m
    popover.innerHTML =
      '<h3>' + t('magic.title') + '</h3>' +
      '<div class="magic-model-badge"><span class="magic-model-label">' + t('magic.modelBadge') + ':</span> <code>' + short + '</code></div>' +
      '<div class="magic-actions">' + actionsRow(false) + '</div>'
    popover.querySelectorAll('[data-action]').forEach((b) =>
      b.addEventListener('click', () => runAction(b.getAttribute('data-action')))
    )
    positionPopover()
  }

  async function runAction(action) {
    if (running) return
    if (!activeField) return
    const text = fieldText(activeField)
    if (!text.trim()) { toast(t('magic.empty'), 'info'); return }
    if ([...text].length > 4000) { toast(t('magic.tooLong')); return }
    running = true
    if (wand) wand.setAttribute('aria-busy', 'true')
    // Disable the action buttons + show working state; original untouched.
    popover.querySelectorAll('[data-action]').forEach((b) => (b.disabled = true))
    const actionsEl = popover.querySelector('.magic-actions')
    if (actionsEl) actionsEl.insertAdjacentHTML('beforeend',
      '<span class="magic-working" role="status">' + t('magic.working') + '</span>')

    let res
    try {
      const payload = { text, action }
      const model = chosenModel()
      if (model) payload.model = model
      res = await fetch('/api/ai/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      res = null
    }

    running = false
    if (wand) wand.setAttribute('aria-busy', 'false')

    if (!res || !res.ok) {
      // Map the route’s statuses to a visible toast. The original is never modified.
      let msg = t('magic.failed')
      if (res && res.status === 503) msg = t('magic.workersOnly')
      else if (res && res.status === 400) msg = t('magic.tooLong')
      toast(msg, 'err')
      renderActionsAgain() // let the user retry or pick another action
      return
    }
    const body = await res.json().catch(() => null)
    const out = body?.text
    if (typeof out !== 'string' || out.trim() === '') { toast(t('magic.empty')); renderActionsAgain(); return }
    renderPreview(text, out)
  }

  // --- discovery + lifecycle ----------------------------------------------------
  function matchesSelector(el) {
    try { return el && el.matches && el.matches(SELECTOR) } catch { return false }
  }

  document.addEventListener('focusin', (e) => {
    const t = e.target
    if (t && (t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) && matchesSelector(t)) {
      showWand(t)
    }
  }, true)

  document.addEventListener('focusout', () => {
    // Defer so a click on the wand (which blurs the field) doesn't drop activeField
    // before the click handler runs. If focus moved to the wand/popover, keep it shown.
    setTimeout(() => {
      const a = document.activeElement
      if (a === wand || (popover && popover.contains(a))) return
      if (!popover) hideWand()
    }, 120)
  }, true)

  // Re-position the wand if the focused field scrolls or resizes.
  window.addEventListener('scroll', () => { if (wand && !wand.hidden && activeField) positionWand(activeField) }, { passive: true })
  window.addEventListener('resize', () => { if (popover) positionPopover(); if (wand && !wand.hidden && activeField) positionWand(activeField) })

  // htmx swaps recreate editable surfaces server-side — re-arm on every swap so the wand
  // still attaches to the freshly-rendered note/description without a reload.
  document.addEventListener('htmx:afterSwap', () => { if (activeField && !document.body.contains(activeField)) { activeField = null; hideWand(); closePopover() } })

  // Esc closes the popover (Discard semantics — zero writes) when the wand/popover is open.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popover) closePopover() })

  // Expose a tiny API so the test harness / future code can drive it (and so a page can
  // re-scan after injecting a new editable field manually).
  window.hibanaMagic = { rescan: () => { /* focus-driven — nothing to scan eagerly */ } }
})()
