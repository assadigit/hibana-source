// public/js/magic-wand.js — Magic Button (idea §1, green-lit) — HOVER-triggered wand.
//
// A wand icon appears at the top-end corner of any element marked [data-magic] when the
// user hovers it. Clicking opens a small popover: Polish (default) + Translate. On Apply,
// the transformed text is saved via the element's data-magic-save URL (PATCH) with the
// data-magic-field, OR — for textareas without a save URL — by setting .value + dispatching
// 'input' so the surface's own autosave persists.
//
// Original is NEVER modified until Apply in the preview. Discard / Esc / error = zero writes.
//
// Backend: POST /api/ai/text { text, action, model?, customPrompt? } → { text }
// Model + customPrompt come from localStorage (Settings).
//
// Supported surfaces (marked [data-magic] in server templates + injected client-side):
//   - Project/spark card titles (.pc-title) — PATCH /api/projects/:id { title }
//   - Dev task titles (.db-card-title) — PATCH /api/dev/tasks/:id { title } (injected)
//   - Note textareas (.note-text) — dispatch input (existing autosave)
//   - Quick-note composer (#quicknote-text) — dispatch input
//   - Project description (#pd-desc) — dispatch input
//   - Any [contenteditable][data-magic] or textarea[data-magic] — dispatch input
(function () {
  'use strict'

  // Elements the wand attaches to. [data-magic] is the universal opt-in; the specific
  // selectors below catch the existing surfaces that don't yet have the attribute (injected
  // client-side after every htmx swap so they survive re-renders).
  const SELECTOR = [
    '[data-magic]',
    'textarea.note-text',
    'textarea#quicknote-text',
    'textarea#pd-desc',
  ].join(',')

  // --- i18n with EN fallbacks (so the wand is usable before hibanaI18n loads) ----
  const FALLBACK = {
    'magic.tooltip': 'AI: polish or translate',
    'magic.title': 'Magic wand',
    'magic.polish': 'Polish',
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

  const MODEL_KEY = 'hibana-ai-model'
  const PROMPT_KEY = 'hibana-ai-custom-prompt'
  function chosenModel() {
    try { return localStorage.getItem(MODEL_KEY) || undefined } catch { return undefined }
  }
  function chosenPrompt() {
    try { return localStorage.getItem(PROMPT_KEY) || undefined } catch { return undefined }
  }

  const WAND_SVG =
    '<svg class="mw-idle" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M15 4V2M15 10V8M19 6h2M9 6h2"/>' +
    '<path d="M13.5 6.5 4 16l-1.5 4.5L7 19l9.5-9.5a2.12 2.12 0 0 0-3-3z"/>' +
    '</svg>' +
    '<svg class="mw-spin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
    '<path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>'

  // --- singleton UI -------------------------------------------------------------
  let wand, popover, backdrop, activeEl
  let running = false

  function ensureUI() {
    if (wand) return
    wand = document.createElement('button')
    wand.type = 'button'
    wand.className = 'magic-wand'
    wand.hidden = true
    wand.innerHTML = WAND_SVG
    wand.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); togglePopover() })
    document.body.appendChild(wand)
  }

  // Read the text from an element: textarea → .value; other → .textContent (stripped)
  function fieldText(el) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value ?? ''
    if (el.isContentEditable) return el.innerText
    return (el.textContent || '').trim()
  }
  // Write text back: textarea → .value + dispatch input (autosave); rendered → textContent
  // + PATCH the save URL if present.
  function applyText(el, text) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.value = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
    if (el.isContentEditable) {
      el.innerText = text
      el.dispatchEvent(new InputEvent('input', { bubbles: true }))
      return
    }
    // Rendered text — update the DOM + PATCH the save URL.
    el.textContent = text
    const saveUrl = el.getAttribute('data-magic-save')
    const field = el.getAttribute('data-magic-field') || 'title'
    if (saveUrl) {
      fetch(saveUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: text }),
      }).catch(() => toast(t('magic.failed')))
    }
  }

  function positionWand(el) {
    const r = el.getBoundingClientRect()
    const rtl = isFa()
    // Anchor at the end corner of the element's first line (for long text, this is near
    // the start). Clamp inside the viewport.
    const x = rtl ? Math.max(8, r.left - 34) : Math.min(window.innerWidth - 38, r.right + 4)
    const y = Math.max(8, Math.min(window.innerHeight - 34, r.top + 2))
    wand.style.left = x + 'px'
    wand.style.top = y + 'px'
  }

  function showWand(el) {
    ensureUI()
    activeEl = el
    wand.setAttribute('aria-label', t('magic.tooltip'))
    wand.title = t('magic.tooltip')
    positionWand(el)
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
    if (backdrop) backdrop.hidden = true
    running = false
    if (wand) wand.setAttribute('aria-busy', 'false')
  }

  // The hover popover: Polish (default) + Translate. Compact — two actions, no Rewrite
  // (the user asked for "polish by default, also can translate").
  function actionsRow(disabled) {
    const acts = [['polish', t('magic.polish')], ['translate', t('magic.translate')]]
    return acts.map(([a, label]) =>
      `<button type="button" data-action="${a}" ${disabled ? 'disabled' : ''}>${label}</button>`
    ).join('')
  }

  function togglePopover() {
    if (popover) { closePopover(); return }
    if (!activeEl) return
    ensureUI()
    if (!backdrop) {
      backdrop = document.createElement('div')
      backdrop.className = 'magic-backdrop'
      backdrop.addEventListener('click', closePopover)
      document.body.appendChild(backdrop)
    }
    backdrop.hidden = false
    const m = chosenModel() || '@cf/mistralai/mistral-small-3.1-24b-instruct'
    const short = m.split('/').pop() || m
    popover = document.createElement('div')
    popover.className = 'magic-popover'
    popover.setAttribute('role', 'dialog')
    popover.setAttribute('aria-label', t('magic.title'))
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
    if (!popover || !activeEl) return
    const wr = wand.getBoundingClientRect()
    const pw = popover.offsetWidth, ph = popover.offsetHeight
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
      if (activeEl) applyText(activeEl, suggestion)
      toast(t('magic.applied'), 'info')
      closePopover()
      hideWand()
    })
    popover.querySelector('[data-act="discard"]').addEventListener('click', closePopover)
    positionPopover()
  }

  function renderActionsAgain() {
    if (!popover) return
    const m = chosenModel() || '@cf/mistralai/mistral-small-3.1-24b-instruct'
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
    if (!activeEl) return
    const text = fieldText(activeEl)
    if (!text.trim()) { toast(t('magic.empty'), 'info'); return }
    if ([...text].length > 4000) { toast(t('magic.tooLong')); return }
    running = true
    if (wand) wand.setAttribute('aria-busy', 'true')
    popover.querySelectorAll('[data-action]').forEach((b) => (b.disabled = true))
    const actionsEl = popover.querySelector('.magic-actions')
    if (actionsEl) actionsEl.insertAdjacentHTML('beforeend',
      '<span class="magic-working" role="status">' + t('magic.working') + '</span>')

    let res
    try {
      const payload = { text, action }
      const model = chosenModel()
      if (model) payload.model = model
      const customPrompt = chosenPrompt()
      if (customPrompt) payload.customPrompt = customPrompt
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
      let msg = t('magic.failed')
      if (res && res.status === 503) msg = t('magic.workersOnly')
      else if (res && res.status === 400) msg = t('magic.tooLong')
      toast(msg, 'err')
      renderActionsAgain()
      return
    }
    const body = await res.json().catch(() => null)
    const out = body?.text
    if (typeof out !== 'string' || out.trim() === '') { toast(t('magic.empty')); renderActionsAgain(); return }
    renderPreview(text, out)
  }

  // --- discovery + lifecycle: HOVER-triggered -----------------------------------
  // The wand appears when the pointer enters a qualifying element. It stays visible while
  // the pointer is over the element OR the wand/popover. On mouseleave (to non-wand), it
  // hides — unless the popover is open (then it stays until closed).
  function matchesSelector(el) {
    try { return el && el.matches && el.matches(SELECTOR) } catch { return false }
  }

  let hideTimer = null
  function clearHideTimer() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null } }

  // mouseover bubbles — catch it at the document level. If the target (or its ancestor)
  // matches SELECTOR, show the wand for that element. If hovering the wand or popover,
  // keep the wand shown (clear any hide timer). Only start a hide timer when hovering
  // something that is NOT magic/wand/popover.
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest(SELECTOR)
    if (el) {
      clearHideTimer()
      showWand(el)
      return
    }
    // Hovering the wand itself or the popover → keep shown.
    if (wand && (e.target === wand || wand.contains(e.target))) { clearHideTimer(); return }
    if (popover && popover.contains(e.target)) { clearHideTimer(); return }
    // Hovering anything else → hide after a short delay (cancellable).
    if (popover) return // popover open → keep wand until popover closes
    clearHideTimer()
    hideTimer = setTimeout(hideWand, 400)
  }, true)

  // Re-position on scroll/resize.
  window.addEventListener('scroll', () => { if (wand && !wand.hidden && activeEl) positionWand(activeEl); if (popover) positionPopover() }, { passive: true })
  window.addEventListener('resize', () => { if (wand && !wand.hidden && activeEl) positionWand(activeEl); if (popover) positionPopover() })

  // htmx swaps recreate elements — if activeEl is gone, reset.
  document.addEventListener('htmx:afterSwap', () => {
    if (activeEl && !document.body.contains(activeEl)) { activeEl = null; hideWand(); closePopover() }
  })

  // Esc closes the popover.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popover) closePopover() })

  // Inject [data-magic] onto dev task titles (.db-card-title) client-side — they're
  // rendered in board.html/sprint.html JS, so the attribute can't go in the server template.
  // Each task card has [data-task-card="id"]; the title is .db-card-title inside it.
  function injectDevTaskMagic() {
    document.querySelectorAll('[data-task-card] .db-card-title:not([data-magic])').forEach((title) => {
      const card = title.closest('[data-task-card]')
      const id = card?.getAttribute('data-task-card')
      if (!id) return
      title.setAttribute('data-magic', '')
      title.setAttribute('data-magic-save', '/api/dev/tasks/' + id)
      title.setAttribute('data-magic-field', 'title')
    })
  }
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, injectDevTaskMagic)
  }
  if (document.readyState !== 'loading') injectDevTaskMagic()
})()
