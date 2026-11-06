import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// S238 (the task view modal + the enlarge-sheet polish) — the owner's round:
//   1. the modal backdrops blur + drain to greyscale (backdrop-filter),
//   2. the enlarge sheet reads at ~800×600,
//   3. every sheet row carries a one-tap COPY button,
//   4. the priority labels read REGULAR weight (the banner + the detail pill),
//   5. a card click opens the READ-ONLY task view — the editor ONLY from the
//      ⋯ menu's Edit (the project page's S149 contract, brought to the board).
//
// Same harness doctrine as focus-mode-s237.test.ts: vitest runs in node and
// nothing imports public/js, so this suite evaluates the REAL
// public/js/focus-core.js byte-for-byte (no reimplementation) against a fake
// `window`. The DOM half (board-page.js / the CSS carriers) is pinned by the
// wiring assertions below, the way the island's verifyDist pins its copies.

/** Evaluates the REAL public/js/focus-core.js and returns its exports. */
function loadCore(): Record<string, unknown> {
  const src = readFileSync(join(process.cwd(), 'public/js/focus-core.js'), 'utf8')
  const fakeWindow: Record<string, unknown> = {}
  new Function('window', src)(fakeWindow)
  const core = fakeWindow.HibanaFocusCore
  if (!core || typeof core !== 'object') throw new Error('focus-core.js did not define window.HibanaFocusCore')
  return core as Record<string, unknown>
}

const readPublic = (rel: string) => readFileSync(join(process.cwd(), 'public', rel), 'utf8')

describe('S238 focus-core — the FULL Esc peel (view → sheet → focus)', () => {
  it('the task VIEW is the innermost layer — it peels before the sheet AND the focus, focus mode or not', () => {
    const { escPeel } = loadCore() as { escPeel: (s: unknown) => string | null }
    expect(escPeel({ viewOpen: true, sheetStatus: 'planned', focusedStatus: 'idea' })).toBe('view')
    expect(escPeel({ viewOpen: true, sheetStatus: 'done', focusedStatus: null })).toBe('view')
    expect(escPeel({ viewOpen: true, sheetStatus: null, focusedStatus: null })).toBe('view')
  })

  it('with the view closed the S237 order holds unchanged (sheet → focus → null)', () => {
    const { escPeel } = loadCore() as { escPeel: (s: unknown) => string | null }
    expect(escPeel({ viewOpen: false, sheetStatus: 'done', focusedStatus: 'bug' })).toBe('sheet')
    expect(escPeel({ viewOpen: false, sheetStatus: null, focusedStatus: 'planned' })).toBe('focus')
    expect(escPeel({ viewOpen: false, sheetStatus: null, focusedStatus: null })).toBeNull()
    expect(escPeel(null)).toBeNull()
    expect(escPeel(undefined)).toBeNull()
  })

  it('escLayer stays byte-compatible — the S237 contract is untouched by the S238 addition', () => {
    const { escLayer } = loadCore() as { escLayer: (s: unknown) => string | null }
    expect(escLayer({ sheetStatus: 'planned', focusedStatus: 'idea' })).toBe('sheet')
    expect(escLayer({ sheetStatus: null, focusedStatus: 'planned' })).toBe('focus')
    expect(escLayer({ sheetStatus: null, focusedStatus: null })).toBeNull()
    expect(escLayer(null)).toBeNull()
  })
})

describe('S238 wiring — the DOM half (the island-style tripwires)', () => {
  it('board.html carries the bumped carriers: board-page v33, focus-core v2 (BEFORE devboard), devboard.css v45, polish-batch v30, quicknotes v51, i18n-en v110, i18n.js v163 (S247 moved the ladder — the Phase-8 a11y/contrast round moved devboard.css to v45; the rest are the S246 carriers; the pin intent is preserved, the versions moved with the carriers)', () => {
    const html = readPublic('board.html')
    expect(html.includes('/js/board-page.js?v=33')).toBe(true)
    expect(html.includes('/js/focus-core.js?v=2"')).toBe(true)
    expect(html.indexOf('/js/focus-core.js?v=')).toBeLessThan(html.indexOf('/js/devboard.js?v='))
    expect(html.includes('/css/devboard.css?v=45')).toBe(true)
    expect(html.includes('/css/polish-batch.css?v=30')).toBe(true)
    expect(html.includes('/css/quicknotes.css?v=51')).toBe(true)
    expect(html.includes('/js/i18n-en.js?v=110')).toBe(true)
    expect(html.includes('/js/i18n.js?v=163')).toBe(true)
    // S244: the shared date control joins (after the jalaali vendor, before devboard.js)
    expect(html.indexOf('/vendor/jalaali.min.js')).toBeGreaterThan(-1)
    expect(html.indexOf('/vendor/jalaali.min.js')).toBeLessThan(html.indexOf('/js/due-control.js?v=1'))
    expect(html.indexOf('/js/due-control.js?v=1')).toBeLessThan(html.indexOf('/js/devboard.js?v='))
  })

  it('board-page.js: the view modal exists, the card click / Enter / deep link open the VIEW, and the ⋯ Edit still opens the editor', () => {
    const js = readPublic('js/board-page.js')
    for (const marker of [
      'openTaskView',
      'db-view-overlay',
      'db-view-card',
      'data-db-view-x',
      'data-db-view-edit',
      'data-db-view-copy',
      'data-db-sheet-copy',
      'escPeel',
      'viewIsOpen',
      'injectSheetCopyRows',
      'db.view.gone',
      'db.view.copyTask',
    ]) {
      expect(js.includes(marker), 'board-page.js must carry ' + JSON.stringify(marker)).toBe(true)
    }
    // the three open paths re-route to the VIEW…
    expect(js.includes('openTaskView(card.dataset.taskCard')).toBe(true)
    expect(js.includes('openTaskView(wrap.dataset.taskCard')).toBe(true)
    expect(js.includes('openTaskView(openTask)')).toBe(true)
    // …and NONE of them opens the editor directly anymore
    expect(js.includes('B().openEditor(card.dataset.taskCard')).toBe(false)
    expect(js.includes('B().openEditor(wrap.dataset.taskCard')).toBe(false)
    expect(js.includes('B().openEditor(openTask, { onSaved: reload })')).toBe(false)
    // the ⋯ menu's Edit STILL opens the editor (the owner's split: menu = edit)
    expect(js.includes('B().openEditor(tid, { onSaved: reload })')).toBe(true)
    // the view's own Edit hands off through the same call
    expect(js.includes('B().openEditor(id, { onSaved: reload })')).toBe(true)
    // the sheet's cloned ⋯ menus are re-armed (the data-ok strip)
    expect(js.includes("querySelectorAll('.db-card-menu[data-ok]')")).toBe(true)
    // the controller keeps EXACTLY the four seam-patched fetch sites (the island
    // rewrites those to hibanaFetch; the S238 block adds ZERO new ones)
    expect((js.match(/\bfetch\(/g) || []).length).toBe(4)
  })

  it('devboard.css: the blurred+greyscale backdrop, the ~800×600 sheet, the view card, the one-tap sheet copy', () => {
    const css = readPublic('css/devboard.css')
    for (const marker of [
      'backdrop-filter: blur(4px) grayscale(1)',
      '-webkit-backdrop-filter: blur(4px) grayscale(1)',
      '.db-view-overlay',
      '.db-view-card',
      '.db-view-foot',
      '.db-sheet-copy',
      'inline-size: min(50rem, 100%)',
      'block-size: min(37.5rem, 100%)',
      'max-block-size: min(37.5rem, 100%)',
    ]) {
      expect(css.includes(marker), 'devboard.css must carry ' + JSON.stringify(marker)).toBe(true)
    }
    // the sheet is the FIXED ~800×600 rectangle; the view caps at the same height
    const sheet = css.match(/\.db-focus-sheet \{[^}]+\}/)
    expect(sheet, 'the .db-focus-sheet rule not found').toBeTruthy()
    expect(sheet![0].includes('inline-size: min(50rem, 100%)')).toBe(true)
    expect(sheet![0].includes('block-size: min(37.5rem, 100%)')).toBe(true)
    const view = css.match(/\.db-view-card \{[^}]+\}/)
    expect(view, 'the .db-view-card rule not found').toBeTruthy()
    expect(view![0].includes('max-block-size: min(37.5rem, 100%)')).toBe(true)
    const overlay = css.match(/\.db-focus-overlay \{[^}]+\}/)
    expect(overlay, 'the .db-focus-overlay rule not found').toBeTruthy()
    expect(overlay![0].includes('backdrop-filter: blur(4px) grayscale(1)')).toBe(true)
  })

  it('the priority labels read REGULAR — the banner + the detail pill drop the 700', () => {
    const pb = readPublic('css/polish-batch.css')
    const banner = pb.match(/\.prio-banner \{[^}]+\}/)
    expect(banner, 'the .prio-banner rule not found').toBeTruthy()
    expect(banner![0].includes('font-weight: 400'), 'the banner must read font-weight: 400').toBe(true)
    expect(banner![0].includes('font-weight: 700')).toBe(false)
    const qn = readPublic('css/quicknotes.css')
    const pill = qn.match(/\.pd-detail-prio \{[^}]+\}/)
    expect(pill, 'the .pd-detail-prio rule not found').toBeTruthy()
    expect(pill![0].includes('font-weight: 400'), 'the detail pill must read font-weight: 400').toBe(true)
    expect(pill![0].includes('font-weight: 700')).toBe(false)
  })

  it('the i18n pair: every db.view.* key ships in BOTH dictionaries with inline EN fallbacks at the call sites', () => {
    const en = readPublic('js/i18n-en.js')
    const fa = readPublic('js/i18n-fa.js')
    const keys = ['db.view.title', 'db.view.gone', 'db.view.copyTask', 'db.view.created', 'db.view.updated', 'db.view.doneAt']
    for (const k of keys) {
      expect(en.includes("'" + k + "':"), 'EN dictionary missing ' + k).toBe(true)
      expect(fa.includes("'" + k + "':"), 'FA dictionary missing ' + k).toBe(true)
    }
    const bp = readPublic('js/board-page.js')
    for (const pair of [
      ["'db.view.title', 'Task details'"],
      ["'db.view.gone', 'This task no longer exists.'"],
      ["'db.view.copyTask', 'Copy task'"],
      ["'db.view.created', 'Created'"],
      ["'db.view.updated', 'Updated'"],
      ["'db.view.doneAt', 'Done'"],
    ]) {
      expect(bp.includes(pair[0]), 'board-page.js _t call missing fallback ' + pair[0]).toBe(true)
    }
    // the lazy FA injector literal moved to v104 (S246 — the dependencies round)
    expect(readPublic('js/i18n.js').includes('/js/i18n-fa.js?v=104')).toBe(true)
  })

  it('sw.js is at hibana-v459 and the round notes the carrier bumps (S247 moved the ladder — the Phase-8 a11y/contrast round; the pin intent is preserved)', () => {
    const sw = readPublic('sw.js')
    expect(sw.includes('const VERSION = "hibana-v459"')).toBe(true)
    expect(sw.includes('// v459 (S247)')).toBe(true)
    // the S238 note stays in the history block (the discipline: every prior entry
    // is recoverable; the history block carries the last rounds)
    expect(sw.includes('// v452 (S238)')).toBe(true)
  })

  it('the carrier bumps are uniform — NO page still pins the pre-S238 versions', () => {
    const dir = join(process.cwd(), 'public')
    const pages = readdirSync(dir).filter((f) => f.endsWith('.html'))
    expect(pages.length).toBeGreaterThan(20)
    const stale: string[] = []
    for (const page of pages) {
      const html = readFileSync(join(dir, page), 'utf8')
      if (html.includes('devboard.css?v=39')) stale.push(page + ': devboard.css v39')
      if (html.includes('polish-batch.css?v=29')) stale.push(page + ': polish-batch.css v29')
      if (html.includes('quicknotes.css?v=50')) stale.push(page + ': quicknotes.css v50')
      if (html.includes('i18n-en.js?v=105')) stale.push(page + ': i18n-en.js v105')
      if (html.includes('i18n.js?v=158')) stale.push(page + ': i18n.js v158')
      if (html.includes('board-page.js?v=28')) stale.push(page + ': board-page.js v28')
      if (html.includes('focus-core.js?v=1"')) stale.push(page + ': focus-core.js v1')
    }
    expect(stale, 'stale carrier pins: ' + stale.join('; ')).toEqual([])
  })
})
