// public/js/chip-render.js — S30 batch 5 (the W3 first slice, user request
// 2026-09-12): the ONE shared title-clamp + tag-chip renderer.
//
// Before this module the EXACT same title renderer (fenced ``` code blocks, **bold**,
// 150-char clamp + hidden .pd-title-rest + read-more button) lived copy-pasted in
// board-page.js AND project-page.js (the server keeps its own detail-helpers.ts twin —
// htmx fragments re-render server-side, that copy is load-bearing there), and the label
// chip had two near-twins (project .pd-tag span vs board .db-mini-chip button).
// sticky.js set the consolidation pattern (Session 28): a tiny IIFE global, both pages
// delegate, zero behavior change — the e2e net (read-more toggles, label filters,
// copy/export reading textContent) pins the contract.
//
// Contract details that MUST stay byte-compatible (pages + tests depend on them):
//   · titleHtml: first TITLE_CLAMP chars visible, the rest inside a hidden
//     .pd-title-rest span WITHIN the title element — textContent keeps reading the
//     FULL title (copy/export/delete-confirm/the magic wand all consume it).
//   · renderTitle: fence LINES open/close a <code class="t-code" dir="ltr"> container
//     with the fence lines kept in <span hidden class="t-fence"> markers INSIDE it —
//     textContent round-trips the RAW title exactly. Unclosed fences render as code
//     till end (self-healing). Prose lines get **pair** → <strong>.
//   · readMoreBtn: [data-task-read-more] button, aria-expanded sync — both pages'
//     delegated togglers query exactly this.
//   · chips: .pd-tag (span, filter-clickable via the pages' .pd-tag delegation) and
//     .db-mini-chip (button, data-tag-name lowercase — the board's filter key).
/* global window */
(function () {
  'use strict'

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const t = (k, f) => (window.hibanaI18n && window.hibanaI18n.t(k)) || f

  const TITLE_CLAMP = 150

  // Session 23 renderer (user request): titles may carry fenced ``` CODE blocks,
  // **bold** spans, - / * BULLET lists and manual line breaks.
  // S46.8 (owner: "The bullet point is not tied to text items. fix it"): `- ` / `* `
  // prefixed lines now render as <ul><li> with proper list-style (bullets sit NEXT to
  // the text via padding-inline-start, not detached on the far edge). The \n between
  // list items is suppressed (the <ul> layout is structural — pre-line would add
  // blank lines between items).
  // S48d (owner: "fullscreen editor needs underline/strikethrough/ordered-list/
  // alignment"): added __underline__ → <u>, ~~strikethrough~~ → <s>, 1. ordered list
  // → <ol><li>, and {:left}/{:center}/{:right}/{:justify} paragraph-alignment markers
  // → <div style="text-align:…">. The inline transforms (bold/underline/strike) run
  // on every prose line (not inside code fences or list items, which keep their own
  // structure). Alignment markers wrap the whole paragraph in a styled div.
  function renderTitle(raw) {
    const escd = esc(raw)
    const hasFence = /(^|\n)\s*```/.test(escd)
    const hasBold = /\*\*[^*\n]+\*\*/.test(escd)
    const hasUnderline = /__[^_\n]+__/.test(escd)
    const hasStrike = /~~[^~\n]+~~/.test(escd)
    const hasBullet = /(^|\n)\s*[-*]\s+/.test(escd)
    const hasOrdered = /(^|\n)\s*\d+\.\s+/.test(escd)
    const hasAlign = /(^|\n)\s*\{:(?:left|center|right|justify)\}/.test(escd)
    if (!hasFence && !hasBold && !hasUnderline && !hasStrike && !hasBullet && !hasOrdered && !hasAlign) return escd
    // inline transforms shared by prose + list items (NOT code)
    const inline = (s) => s
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<u>$1</u>')
      .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    const lines = escd.split('\n')
    let out = ''
    let inCode = false, inUl = false, inOl = false
    const closeUl = () => { if (inUl) { out += '</ul>'; inUl = false } }
    const closeOl = () => { if (inOl) { out += '</ol>'; inOl = false } }
    const closeLists = () => { closeUl(); closeOl() }
    // group consecutive alignment-marked lines into one <div> per paragraph
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const nl = i < lines.length - 1 ? '\n' : ''
      if (!inCode && /^\s*```/.test(line)) {
        closeLists()
        inCode = true
        const codeLang = line.trim().slice(3).trim()
        out += '<code class="t-code"' + (codeLang ? ' data-lang="' + codeLang + '"' : '') + ' dir="ltr"><span hidden class="t-fence">' + line + '</span>'
      } else if (inCode && line.trim() === '```') {
        inCode = false
        out += '<span hidden class="t-fence">' + line + '</span></code>' + nl
      } else if (inCode) {
        out += line + nl
      } else {
        // alignment marker — wrap the paragraph in a styled div (toggled off at the next blank line / non-aligned line)
        const am = line.match(/^(\s*)\{:(left|center|right|justify)\}(.*)$/)
        if (am) {
          closeLists()
          out += '<div style="text-align:' + am[2] + '">' + inline(am[3]) + '</div>'
          // no nl — the div is structural
        } else {
          const bm = line.match(/^(\s*)(?:[-*])\s+(.*)$/)
          const om = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
          if (bm) {
            closeOl()
            if (!inUl) { out += '<ul>'; inUl = true }
            out += '<li>' + inline(bm[2]) + '</li>'
          } else if (om) {
            closeUl()
            if (!inOl) { out += '<ol>'; inOl = true }
            out += '<li>' + inline(om[3]) + '</li>'
          } else {
            closeLists()
            out += inline(line) + nl
          }
        }
      }
    }
    closeLists()
    if (inCode) out += '</code>'
    return out
  }

  // Session 22 (user request): unlimited titles clamp at TITLE_CLAMP CHARS.
  function titleHtml(title) {
    const s = String(title == null ? '' : title)
    if (s.length <= TITLE_CLAMP) return renderTitle(s)
    return renderTitle(s.slice(0, TITLE_CLAMP)) + '<span class="pd-title-rest" hidden>' + renderTitle(s.slice(TITLE_CLAMP)) + '</span>'
  }

  const titleAttrs = (title) => (String(title || '').length > TITLE_CLAMP ? ' data-clamped=""' : '')

  const readMoreBtn = (title) => (String(title || '').length > TITLE_CLAMP
    ? '<button type="button" class="pd-read-more" data-task-read-more aria-expanded="false">' + esc(t('pd.readMore', 'read more')) + '</button>'
    : '')

  // Label chips. kind 'pd' (project page — span; the page's delegation makes it a
  // filter toggle) or 'db' (board — button carrying the lowercase filter key).
  function tagChip(name, color, kind) {
    const n = String(name == null ? '' : name)
    const c = String(color || '#8AB8F0')
    if (kind === 'db') {
      return '<button type="button" dir="auto" class="db-mini-chip" data-tag-name="' + esc(n.toLowerCase()) + '" style="background:' + esc(c) + '26" title="' + esc(t('db.filterTagHint', 'Click to filter by this label')) + '"><span style="color:' + esc(c) + '">●</span> ' + esc(n) + '</button>'
    }
    // dir="auto" (S32 — the general bidi law at chip level): the leading dot must LEAD
    // the label on both sides — flex order follows the element's dir, so a Latin label
    // flips the whole chip LTR (dot left) while a Farsi one keeps dot-right. The chip
    // text itself is covered by the .pd-tag/.db-mini-chip plaintext rule (polish-batch).
    return '<span dir="auto" class="pd-tag" data-pd-tag-name="' + esc(n) + '"><i class="pd-tag-dot" style="background:' + esc(c) + '"></i>' + esc(n) + '</span>'
  }
  // The project page's chip ROW (list = [{name, color}]).
  function tagChipsRow(list) {
    if (!list || !list.length) return ''
    return '<span class="pd-task-tags">' + list.map((tg) => tagChip(tg.name, tg.color, 'pd')).join('') + '</span>'
  }

  // Re-clamp an existing title element in place (after edits / wand writes).
  function applyTitle(el, text) {
    if (!el) return
    el.innerHTML = titleHtml(text)
    if (String(text || '').length > TITLE_CLAMP) el.setAttribute('data-clamped', '')
    else el.removeAttribute('data-clamped')
    const btn = el.parentElement ? el.parentElement.querySelector('[data-task-read-more]') : null
    if (btn) {
      if (String(text || '').length > TITLE_CLAMP) {
        btn.hidden = false
        btn.textContent = t('pd.readMore', 'read more')
        btn.setAttribute('aria-expanded', 'false')
      } else {
        btn.hidden = true
      }
    }
  }

  window.HibanaChips = {
    esc, t, TITLE_CLAMP,
    renderTitle, titleHtml, titleAttrs, readMoreBtn, applyTitle,
    tagChip, tagChipsRow,
  }
})()
