// public/js/ai-autopolish.js — experimental AI auto-polish on note capture (user request 2026-09).
//
// SAFETY CONTRACT (the idea doc explicitly rejected "background auto-polish on capture"
// because it "violates the whiteboard-fast capture rule". This implementation is SAFE:
// the note saves FIRST via the normal POST /api/notes path — capture is never blocked,
// never delayed. Only AFTER the htmx swap confirms the save, the AI polish runs in the
// background. If the AI fails, the original stays — Mission #1: never lose an idea.)
//
// Flow:
//   1. User types a note + presses Enter → POST /api/notes → note saved (whiteboard-fast)
//   2. htmx swaps #notebook with the new note card
//   3. This module (on htmx:afterSwap) finds note cards it hasn't seen before
//   4. If auto-polish is ON (localStorage toggle, OFF by default):
//      a. Read the note's raw content from its textarea
//      b. Skip if too short (≤3 chars) or already polished
//      c. Call POST /api/ai/text { text, action:'polish', model, customPrompt }
//      d. If the polished text differs from the original → PATCH /api/notes/:id { content }
//      e. htmx re-renders #notebook with the polished content
//      f. Show an Undo toast (6s) — if clicked, PATCH back the original
//   5. If the AI call fails → original stays, no data lost, no toast (silent — it's background)
//
// Off by default. The user explicitly toggles it on in Settings (experimental).
(function () {
  'use strict'

  const AUTOPOLISH_KEY = 'hibana-ai-autopolish'
  const MODEL_KEY = 'hibana-ai-model'
  const PROMPT_KEY = 'hibana-ai-custom-prompt'
  const MIN_LEN = 4 // skip ultra-short notes (1-3 chars) — not worth an AI call

  const FALLBACK = {
    'magic.autopolished': 'Auto-polished',
    'magic.autopolishUndo': 'Undo',
  }
  const t = (k) => window.hibanaI18n?.t(k) ?? FALLBACK[k] ?? k
  const toast = (msg, kind, ms, actions) => window.hibana?.toast?.(msg, kind ?? 'info', ms, actions)

  function isOn() {
    try { return localStorage.getItem(AUTOPOLISH_KEY) === 'on' } catch { return false }
  }
  function chosenModel() {
    try { return localStorage.getItem(MODEL_KEY) || undefined } catch { return undefined }
  }
  function chosenPrompt() {
    try { return localStorage.getItem(PROMPT_KEY) || undefined } catch { return undefined }
  }

  // Track note IDs we've already processed — so we don't re-polish on every swap (edits,
  // deletes, reorders all trigger htmx:afterSwap). On page load, ALL existing notes are
  // marked "seen" so auto-polish only fires on NEWLY captured notes.
  const seen = new Set()
  let initialized = false

  function markExistingAsSeen() {
    document.querySelectorAll('#notebook .note-card').forEach((c) => {
      seen.add(c.id.replace(/^note-/, ''))
    })
    initialized = true
  }

  async function polishNote(card) {
    const id = card.id.replace(/^note-/, '')
    if (seen.has(id)) return
    seen.add(id)

    // Only auto-polish 'note' kind (lists have a different structure — items as JSON).
    if (card.dataset.kind !== 'note') return

    const ta = card.querySelector('.note-text')
    if (!ta) return
    const original = ta.value
    if (!original || Array.from(original).length < MIN_LEN) return

    // Don't polish if the text looks already-clean (no obvious typos). Heuristic: skip if
    // the first letter is uppercase AND there are no double-spaces or common typo patterns.
    // This is a cheap pre-filter — the AI will handle the real polish for the rest.
    // (Kept simple: the AI call is cheap enough on Mistral ~3n; the filter is optional.)

    try {
      const payload = { text: original, action: 'polish' }
      const model = chosenModel()
      if (model) payload.model = model
      const customPrompt = chosenPrompt()
      if (customPrompt) payload.customPrompt = customPrompt

      const res = await fetch('/api/ai/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return // silent — background feature, never toast on failure
      const body = await res.json()
      const polished = body?.text
      if (typeof polished !== 'string' || !polished.trim() || polished.trim() === original.trim()) return

      // Apply: PATCH the note, then re-render via htmx. The Undo toast recovers the original.
      const patchRes = await fetch('/api/notes/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: polished }),
      })
      if (!patchRes.ok) return

      // Re-render the notebook so the card shows the polished content
      if (window.htmx) window.htmx.ajax('GET', '/api/notes', { target: '#notebook', swap: 'outerHTML' })

      // Undo toast — original is recoverable for 6s
      toast(t('magic.autopolished') + ' — ' + t('magic.autopolishUndo'), 'info', 6000, [{
        label: t('magic.autopolishUndo'),
        onClick: () => {
          fetch('/api/notes/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: original }),
          }).then((r) => {
            if (r.ok && window.htmx) window.htmx.ajax('GET', '/api/notes', { target: '#notebook', swap: 'outerHTML' })
          }).catch(() => {})
        },
      }])
    } catch {
      // Silent — background feature. The original note is safe (it was saved in step 1).
    }
  }

  function scanForNewNotes() {
    if (!isOn()) return
    if (!initialized) markExistingAsSeen()
    const nb = document.getElementById('notebook')
    if (!nb) return
    // Find note cards we haven't seen — these are newly captured
    nb.querySelectorAll('.note-card').forEach((card) => {
      const id = card.id.replace(/^note-/, '')
      if (!seen.has(id)) {
        // Small delay so the htmx swap settles before we read the textarea
        setTimeout(() => polishNote(card), 200)
      }
    })
  }

  // Listen for htmx swaps on the notebook — the primary trigger after note capture
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, scanForNewNotes)
  }
  if (document.readyState !== 'loading') {
    markExistingAsSeen()
  } else {
    document.addEventListener('DOMContentLoaded', markExistingAsSeen)
  }
})()
