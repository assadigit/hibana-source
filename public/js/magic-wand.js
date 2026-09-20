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
//   - Notes-vault markdown editor (.vault-src) — dispatch input (S78)
//   - Any [contenteditable][data-magic] or textarea[data-magic] — dispatch input
// Reveal paths (S78): HOVER (desktop) and FOCUS (touch/keyboard — the wand used to be
// unreachable on devices without hover).
(function () {
  'use strict'

  // Elements the wand attaches to. [data-magic] is the universal opt-in; the specific
  // selectors below catch the existing surfaces that don't yet have the attribute (injected
  // client-side after every htmx swap so they survive re-renders).
  // S78: textarea.vault-src joins — the notes-vault markdown editor is a prime polish/
  // translate surface and notes.html now loads this script.
  const SELECTOR = [
    '[data-magic]',
    'textarea.note-text',
    'textarea#quicknote-text',
    'textarea#pd-desc',
    'textarea.vault-src',
  ].join(',')

  // --- i18n with EN fallbacks (so the wand is usable before hibanaI18n loads) ----
  const FALLBACK = {
    'magic.tooltip': 'AI: polish or translate',
    'magic.title': 'Magic wand',
    'magic.polish': 'Polish',
    'magic.translate': 'Translate',
    // S86 (owner request): the Ask-AI panel — a FREE-FORM instruction the model applies
    // to the text ("classify these books into categories", "extract the deadlines"…).
    'magic.custom': 'Ask AI…',
    'magic.customTitle': 'Ask the AI',
    'magic.customPh': 'Tell the AI what to do with this text — e.g. “Classify these books into categories”, “Summarize in 5 bullets”, “Extract the deadlines”…',
    'magic.customRun': 'Run',
    'magic.customBack': 'Back',
    'magic.customRequired': 'Write your instruction first.',
    'magic.customHint': 'The note text is sent with your instruction. Nothing is saved until you Apply the result.',
    'magic.result': 'Result',
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

  // S77 (owner rule, verbatim): “WHEN TEXT IS FARSI > TRANSLATE > ENGLISH WHEN TEXT IS
  // ENGLISH > TRANSLATE > FARSI”. The model's own language self-detection proved
  // unreliable (a live FA input came back as a FA paraphrase — “the text stays farsi”),
  // so the CLIENT detects the input's script and names the TARGET; the server builds a
  // one-way prompt and verifies the output script. Farsi wins ties: a mixed note with
  // real Farsi prose counts as Farsi (→ English). Code/URLs are Latin but the prose decides.
  function detectLang(text) {
    let fa = 0, en = 0
    for (const ch of text) {
      const cp = ch.codePointAt(0) || 0
      if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) fa++
      else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) en++
    }
    return fa > 0 && fa >= en ? 'fa' : 'en'
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
  // S88 (owner: the popover "opens in the wrong position" when triggered from the
  // editor toolbar's icon): an EXPLICIT trigger element (openFor's 2nd arg) anchors
  // the popover to that icon — below it, wherever it lives — instead of the floating
  // hover-wand's corner. Null (the hover/focus path) keeps the wand-anchored layout.
  let triggerEl = null

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
  // S48p: for .pd-task-title (which now shows only the first line), read the TITLE LINE
  // from textContent — the AI translates just the title, not the full content.
  function fieldText(el) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value ?? ''
    if (el.isContentEditable) return el.innerText
    return (el.textContent || '').trim()
  }
  // Write text back: textarea → .value + dispatch input (autosave); rendered → textContent
  // + PATCH the save URL if present.
  // S48p: for .pd-task-title with data-raw-title (title\ncontent), the AI translates
  // only the TITLE line (what's visible on the card). When applying, preserve the
  // ORIGINAL CONTENT (everything after the first \n in data-raw-title) by PATCHing
  // title = translated_title + '\n' + original_content. Without this, the PATCH
  // would overwrite the entire field with just the translated title, LOSING the content.
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
    // Session 22: task titles carry a 150-char clamp structure (hidden .pd-title-rest
    // span INSIDE the title element — textContent reads the full title, which is why
    // fieldText above still works). Writing textContent wipes that structure, so tell
    // the page to re-clamp (project.html listens + rebuilds the split + read-more).
    el.dispatchEvent(new CustomEvent('hibana:title-written', { bubbles: true }))
    const saveUrl = el.getAttribute('data-magic-save')
    const field = el.getAttribute('data-magic-field') || 'title'
    if (saveUrl) {
      // S48p: if the element has data-raw-title (title\ncontent), preserve the content.
      // The AI translated only the TITLE line. PATCH back: translated_title + '\n' + original_content.
      let patchValue = text
      const rawTitle = el.getAttribute('data-raw-title')
      if (rawTitle) {
        const nlIdx = rawTitle.indexOf('\n')
        if (nlIdx >= 0) {
          // Preserve the content (everything after the first \n)
          patchValue = text + '\n' + rawTitle.slice(nlIdx + 1)
        }
        // Update data-raw-title so the editor loads the correct value next time
        el.setAttribute('data-raw-title', patchValue)
      }
      fetch(saveUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: patchValue }),
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
    // Session 24e (user report: wand inconsistent): if the target is inside an open
    // <dialog>, mount the wand + popover + backdrop INSIDE that dialog. A dialog opened
    // via showModal() renders in the browser's top layer (above ALL z-indexes); a wand
    // left on document.body is trapped under the dialog's backdrop → invisible. Moving
    // the wand into the dialog makes it inherit the top-layer positioning.
    const dlg = el.closest('dialog[open]')
    const mount = dlg || document.body
    if (wand && wand.parentElement !== mount) mount.appendChild(wand)
    if (backdrop && backdrop.parentElement !== mount) mount.appendChild(backdrop)
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
    triggerEl = null // S88: the anchor leaves with the popover
    if (backdrop) backdrop.hidden = true
    running = false
    if (wand) wand.setAttribute('aria-busy', 'false')
  }

  // The hover popover: Polish (default) + Translate + Ask AI (S86 — the custom-prompt
  // panel). Compact — three actions; Ask AI swaps the popover into the instruction form.
  function actionsRow(disabled) {
    const acts = [
      ['polish', t('magic.polish')],
      ['translate', t('magic.translate')],
      ['custom', t('magic.custom'), 'magic-ask'],
    ]
    return acts.map(([a, label, cls]) =>
      `<button type="button" data-action="${a}"${cls ? ` class="${cls}"` : ''} ${disabled ? 'disabled' : ''}>${label}</button>`
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
      // Session 24e: don't append to body here — showWand() moves the backdrop into
      // the open dialog (if any) so it renders in the top layer with the wand.
    }
    backdrop.hidden = false
    // Session 24e: ensure backdrop is mounted in the same dialog as the wand (if any).
    if (!backdrop.parentElement) {
      const dlg = activeEl?.closest('dialog[open]')
      ;(dlg || document.body).appendChild(backdrop)
    }
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
    // Session 24e: mount popover inside the same dialog as the wand (if any).
    const dlg = activeEl?.closest('dialog[open]')
    ;(dlg || document.body).appendChild(popover)
    positionPopover()
    popover.querySelectorAll('[data-action]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.getAttribute('data-action')
        // S86: 'custom' opens the instruction panel INSTEAD of firing the request —
        // the user writes the prompt first, then Run sends it.
        if (a === 'custom') renderPromptPanel()
        else runAction(a)
      })
    )
    popover.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover() })
    popover.querySelector('[data-action]')?.focus()
  }

  // S86: the Ask-AI instruction panel — a textarea (≤2000 chars, the server's
  // MAX_CUSTOM_PROMPT_CHARS) + char counter + Run/Back. Cmd/Ctrl+Enter runs; Esc
  // closes the whole popover (the global listener). The panel keeps the same
  // popover node so positioning/dialog-mounting rules all stay intact.
  function renderPromptPanel(prefill) {
    if (!popover) return
    popover.classList.add('is-prompt')
    popover.innerHTML =
      '<h3>' + t('magic.customTitle') + '</h3>' +
      '<div class="magic-model-badge"><span class="magic-model-label">' + t('magic.modelBadge') + ':</span> <code>' + (chosenModel() || '@cf/mistralai/mistral-small-3.1-24b-instruct').split('/').pop() + '</code></div>' +
      '<textarea class="magic-prompt-ta" rows="4" maxlength="2000" dir="auto" placeholder="' + t('magic.customPh').replace(/"/g, '&quot;') + '" aria-label="' + t('magic.customTitle') + '"></textarea>' +
      '<div class="magic-prompt-foot">' +
        '<span class="magic-prompt-count" aria-live="polite">0/2000</span>' +
        '<span class="row magic-prompt-btns">' +
          '<button type="button" class="magic-back" data-prompt-back>' + t('magic.customBack') + '</button>' +
          '<button type="button" class="magic-run" data-prompt-run>' + t('magic.customRun') + '</button>' +
        '</span>' +
      '</div>' +
      '<p class="magic-prompt-hint">' + t('magic.customHint') + '</p>'
    const ta = popover.querySelector('.magic-prompt-ta')
    const count = popover.querySelector('.magic-prompt-count')
    if (prefill) ta.value = prefill
    const updateCount = () => { if (count) count.textContent = [...ta.value].length + '/2000' }
    updateCount()
    ta.addEventListener('input', updateCount)
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        popover.querySelector('[data-prompt-run]')?.click()
      }
    })
    popover.querySelector('[data-prompt-back]').addEventListener('click', () => {
      popover.classList.remove('is-prompt')
      renderActionsAgain()
    })
    popover.querySelector('[data-prompt-run]').addEventListener('click', () => {
      const instruction = ta.value.trim()
      if (!instruction) { toast(t('magic.customRequired'), 'info'); ta.focus(); return }
      runAction('custom', instruction)
    })
    positionPopover()
    setTimeout(() => ta.focus(), 30)
  }

  function positionPopover() {
    if (!popover || !activeEl) return
    const pw = popover.offsetWidth, ph = popover.offsetHeight
    // S88: an explicit TRIGGER (the toolbar icon that opened the wand) anchors the
    // popover: directly below the icon, aligned to its inline-start edge, clamped in
    // the viewport; flip above when the bottom doesn't fit. The wand-corner anchor
    // stays the default for the hover/focus discovery path.
    const anchor = triggerEl && triggerEl.isConnected ? triggerEl : wand
    const wr = anchor.getBoundingClientRect()
    let x, y
    if (triggerEl && triggerEl.isConnected) {
      x = Math.min(window.innerWidth - pw - 8, Math.max(8, wr.left - 8))
      y = wr.bottom + 6
      if (y + ph > window.innerHeight - 8) y = Math.max(8, wr.top - ph - 6)
    } else {
      x = Math.min(window.innerWidth - pw - 8, Math.max(8, wr.left))
      y = wr.bottom + 6
      if (y + ph > window.innerHeight - 8) y = Math.max(8, wr.top - ph - 6)
    }
    popover.style.left = x + 'px'
    popover.style.top = y + 'px'
  }

  function renderPreview(original, suggestion, resultLabel) {
    if (!popover) return
    popover.classList.remove('is-prompt')
    popover.innerHTML =
      '<h3>' + t('magic.title') + '</h3>' +
      '<div class="magic-preview">' +
        '<div class="magic-pane magic-pane-original"><span class="magic-pane-label">' + t('magic.original') + '</span>' +
          '<div class="magic-pane-body"></div></div>' +
        '<div class="magic-pane magic-pane-suggestion"><span class="magic-pane-label">' + (resultLabel || t('magic.suggestion')) + '</span>' +
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
    popover.classList.remove('is-prompt')
    const m = chosenModel() || '@cf/mistralai/mistral-small-3.1-24b-instruct'
    const short = m.split('/').pop() || m
    popover.innerHTML =
      '<h3>' + t('magic.title') + '</h3>' +
      '<div class="magic-model-badge"><span class="magic-model-label">' + t('magic.modelBadge') + ':</span> <code>' + short + '</code></div>' +
      '<div class="magic-actions">' + actionsRow(false) + '</div>'
    popover.querySelectorAll('[data-action]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.getAttribute('data-action')
        if (a === 'custom') renderPromptPanel()
        else runAction(a)
      })
    )
    positionPopover()
  }

  async function runAction(action, promptOverride) {
    if (running) return
    if (!activeEl) return
    const text = fieldText(activeEl)
    if (!text.trim()) { toast(t('magic.empty'), 'info'); return }
    if ([...text].length > 4000) { toast(t('magic.tooLong')); return }
    running = true
    if (wand) wand.setAttribute('aria-busy', 'true')
    popover.querySelectorAll('button').forEach((b) => (b.disabled = true))
    const actionsEl = popover.querySelector('.magic-actions')
    if (actionsEl) actionsEl.insertAdjacentHTML('beforeend',
      '<span class="magic-working" role="status">' + t('magic.working') + '</span>')
    else popover.insertAdjacentHTML('beforeend',
      '<span class="magic-working" role="status">' + t('magic.working') + '</span>')

    let res
    try {
      const payload = { text, action }
      if (action === 'translate') payload.target_lang = detectLang(text) === 'fa' ? 'en' : 'fa'
      const model = chosenModel()
      if (model) payload.model = model
      // S86: the Ask-AI panel's instruction is the customPrompt for the 'custom'
      // action — and the SETTINGS prompt is deliberately NOT layered on top (the
      // panel speaks for itself; the server builds the persona from it alone).
      if (action === 'custom') payload.customPrompt = promptOverride
      else {
        const customPrompt = chosenPrompt()
        if (customPrompt) payload.customPrompt = customPrompt
      }
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
      // S77: the server's ApiError body carries a localized, specific `message`
      // (wrong-language, rate-limit, model-failure…). Prefer it over the old status-code
      // guesses — a 503 wrong_language used to show the misleading “Workers only” string.
      let msg = t('magic.failed')
      const body = res ? await res.json().catch(() => null) : null
      if (body && typeof body.message === 'string' && body.message.trim()) msg = body.message
      else if (res && res.status === 503) msg = t('magic.workersOnly')
      else if (res && res.status === 400) msg = t('magic.tooLong')
      toast(msg, 'err')
      // S86: a failed custom run returns to the instruction panel WITH the text
      // intact — losing a typed instruction on a model hiccup is the worst outcome.
      if (action === 'custom' && promptOverride) renderPromptPanel(promptOverride)
      else renderActionsAgain()
      return
    }
    const body = await res.json().catch(() => null)
    const out = body?.text
    if (typeof out !== 'string' || out.trim() === '') { toast(t('magic.empty')); renderActionsAgain(); return }
    renderPreview(text, out, action === 'custom' ? t('magic.result') : undefined)
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

  // S78 (touch/keyboard reach): the wand used to appear on HOVER only — on a phone or
  // tablet there is no hover, so the feature was silently unreachable (and the owner
  // uses it daily). FOCUS now reveals the wand too: tapping into a qualifying textarea
  // (mobile) or tabbing to one (keyboard) anchors the wand at its corner. Focus leaving
  // the surface hides it on the same cancellable delay as the hover path — unless
  // focus is moving INTO the wand or popover (that's the user reaching for it).
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest(SELECTOR)
    if (!el) {
      // Focus moving INTO the wand/popover keeps it mounted (the focusout below
      // scheduled a hide; this cancels it when the destination is ours).
      if (wand && (e.target === wand || wand.contains(e.target))) { clearHideTimer(); return }
      if (popover && popover.contains(e.target)) { clearHideTimer(); return }
      return
    }
    clearHideTimer()
    showWand(el)
  }, true)
  document.addEventListener('focusout', (e) => {
    if (popover) return // popover open → the wand stays until the popover closes
    const rt = e.relatedTarget
    if (rt && ((wand && (rt === wand || wand.contains(rt))) || (popover && popover.contains(rt)))) { clearHideTimer(); return }
    clearHideTimer()
    hideTimer = setTimeout(hideWand, 500)
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
    // S46.2 (owner report: "wand still not on newly-added tasks without refresh"):
    // also stamp the PROJECT-PAGE task titles (.pd-task-wrap .pd-task-title) so the
    // wand is the single source of truth — project-page.js's injectPdTaskMenus still
    // does the ⋯ menu + stamps on insertTaskChip (the immediate path), but this makes
    // the wand robust to any future change + covers htmx-swapped cards too. Idempotent:
    // :not([data-magic]) skips already-stamped titles.
    document.querySelectorAll('.pd-task-wrap:not([data-magic-ok]) .pd-task-title:not([data-magic])').forEach((title) => {
      const wrap = title.closest('.pd-task-wrap')
      const tid = wrap?.dataset.pdTask
      if (!tid) return
      title.setAttribute('data-magic', '')
      title.setAttribute('data-magic-save', '/api/devtasks/' + tid)
      title.setAttribute('data-magic-field', 'title')
    })
  }
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, injectDevTaskMagic)
  }
  if (document.readyState !== 'loading') injectDevTaskMagic()

  // S86: a PUBLIC handle for toolbars that want an explicit wand trigger (the notes
  // editor's Ask-AI button) — hover/focus discovery stays as-is; this makes the
  // feature reachable with ONE click on surfaces that ask for it.
  window.hibanaMagicWand = {
    openFor(el, trigger) {
      if (!el || !el.isConnected) return
      ensureUI()
      showWand(el)
      if (popover) closePopover()
      triggerEl = trigger && trigger.isConnected ? trigger : null // S88: anchor to the icon
      togglePopover()
    },
  }
})()
