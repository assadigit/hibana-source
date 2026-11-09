import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// S237 (Focus Mode) — the decision core's suite. Same harness doctrine as
// sync-state.test.ts: vitest runs in node and nothing imports public/js, so
// this suite evaluates the REAL public/js/focus-core.js byte-for-byte (no
// reimplementation) against a fake `window` — the only browser global the
// module touches. The DOM half (board-page.js) is pinned by the wiring
// assertions at the bottom, the way the island's verifyDist pins its copies.

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

describe('S237 focus-core — the toggle parsing (default OFF, forever)', () => {
  it("parseToggle: 'on' is the ONLY truthy spelling — 'off', null, undefined, '' , 'ON', numbers and garbage all read OFF", () => {
    const { parseToggle } = loadCore() as { parseToggle: (v: unknown) => boolean }
    expect(parseToggle('on')).toBe(true)
    for (const v of ['off', null, undefined, '', 'ON', 'On', 'true', '1', 1, 0, {}, 'on ']) {
      // (vitest's toBe here takes no message param — the value rides the assertion diff)
      expect(parseToggle(v), 'parseToggle(' + JSON.stringify(v) + ') must read OFF').toBe(false)
    }
  })

  it('the persistence keys are the spec §1.5 pair — hibana-focus-mode / hibana-focus-last', () => {
    const core = loadCore() as { TOGGLE_KEY: string; LAST_KEY: string }
    expect(core.TOGGLE_KEY).toBe('hibana-focus-mode')
    expect(core.LAST_KEY).toBe('hibana-focus-last')
  })
})

describe('S237 focus-core — the [/] lane cycling (wrap-around, DOM order)', () => {
  it('] advances in DOM order and wraps done → idea', () => {
    const { cycleLane } = loadCore() as { cycleLane: (st: string, dir: number) => string }
    expect(cycleLane('idea', 1)).toBe('bug')
    expect(cycleLane('bug', 1)).toBe('planned')
    expect(cycleLane('planned', 1)).toBe('in_progress')
    expect(cycleLane('in_progress', 1)).toBe('done')
    expect(cycleLane('done', 1)).toBe('idea') // the wrap
  })

  it('[ retreats in DOM order and wraps idea → done', () => {
    const { cycleLane } = loadCore() as { cycleLane: (st: string, dir: number) => string }
    expect(cycleLane('done', -1)).toBe('in_progress')
    expect(cycleLane('planned', -1)).toBe('bug')
    expect(cycleLane('idea', -1)).toBe('done') // the wrap
  })

  it('a stale/unknown status falls back to the first lane — the cycle can never deadlock', () => {
    const { cycleLane } = loadCore() as { cycleLane: (st: string, dir: number) => string }
    expect(cycleLane('bogus', 1)).toBe('idea')
    expect(cycleLane(null as unknown as string, -1)).toBe('idea')
    expect(cycleLane('', 1)).toBe('idea')
  })

  it('STATUSES matches devboard.js\'s five lanes, same order (the drift tripwire)', () => {
    const { STATUSES } = loadCore() as { STATUSES: string[] }
    expect([...STATUSES]).toEqual(['idea', 'bug', 'planned', 'in_progress', 'done'])
    const devboard = readPublic('js/devboard.js')
    const m = devboard.match(/const STATUSES = \[([^\]]+)\]/)
    expect(m, 'devboard.js STATUSES array not found').toBeTruthy()
    const devStat = m![1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
    expect([...STATUSES]).toEqual(devStat)
  })
})

describe('S237 focus-core — the Esc layering (exactly ONE layer, inside-out)', () => {
  it('an open enlarge sheet is peeled FIRST — even while a blur focus is also active', () => {
    const { escLayer } = loadCore() as { escLayer: (s: unknown) => string | null }
    expect(escLayer({ sheetStatus: 'planned', focusedStatus: 'idea' })).toBe('sheet')
    expect(escLayer({ sheetStatus: 'done', focusedStatus: null })).toBe('sheet')
  })

  it('with no sheet, the blur focus is the layer; with neither, the Esc is not ours (null)', () => {
    const { escLayer } = loadCore() as { escLayer: (s: unknown) => string | null }
    expect(escLayer({ sheetStatus: null, focusedStatus: 'planned' })).toBe('focus')
    expect(escLayer({ sheetStatus: null, focusedStatus: null })).toBeNull()
    expect(escLayer(null)).toBeNull()
    expect(escLayer(undefined)).toBeNull()
  })
})

describe('S237 focus-core — the auto-restore rule (spec §1.5)', () => {
  it('restores ONLY when the toggle is on AND the remembered lane is one of the five', () => {
    const { autoRestore } = loadCore() as { autoRestore: (e: boolean, last: unknown) => string | null }
    expect(autoRestore(true, 'planned')).toBe('planned')
    expect(autoRestore(true, 'in_progress')).toBe('in_progress')
    expect(autoRestore(true, 'bogus')).toBeNull()
    expect(autoRestore(true, null)).toBeNull()
    expect(autoRestore(false, 'planned')).toBeNull() // off ⇒ never restore
    expect(autoRestore(false, null)).toBeNull()
  })

  it('every one of the five lanes is a restorable value', () => {
    const { autoRestore, STATUSES } = loadCore() as { autoRestore: (e: boolean, last: string) => string | null; STATUSES: string[] }
    for (const st of STATUSES) expect(autoRestore(true, st)).toBe(st)
  })
})

describe('S237 focus-core — the F-target resolution (hover → last → nothing)', () => {
  it('the hovered lane wins over the last-focused lane', () => {
    const { resolveFKey } = loadCore() as { resolveFKey: (h: unknown, l: unknown) => string | null }
    expect(resolveFKey('done', 'planned')).toBe('done')
    expect(resolveFKey('idea', null)).toBe('idea')
  })

  it('without a hover the last lane carries F; without either, F is a no-op (never a guess)', () => {
    const { resolveFKey } = loadCore() as { resolveFKey: (h: unknown, l: unknown) => string | null }
    expect(resolveFKey(null, 'planned')).toBe('planned')
    expect(resolveFKey(null, null)).toBeNull()
    expect(resolveFKey(undefined, undefined)).toBeNull()
    // an INVALID hover falls through to the last lane, never to a guess
    expect(resolveFKey('nope', 'bug')).toBe('bug')
    expect(resolveFKey('nope', 'nope')).toBeNull()
    expect(resolveFKey(null, 'nope')).toBeNull()
  })
})

describe('S237 wiring — the DOM half is pinned to the core (the island-style tripwires)', () => {
  it('board.html loads focus-core.js (defer, BEFORE devboard.js) at v2', () => {
    const html = readPublic('board.html')
    const coreTag = html.match(/<script src="\/js\/focus-core\.js\?v=(\d+)" defer><\/script>/)
    expect(coreTag, 'board.html must carry the focus-core.js tag').toBeTruthy()
    expect(Number(coreTag![1])).toBe(2) // S238: the escPeel round bumped the core v1 → v2
    expect(html.indexOf('/js/focus-core.js?v=')).toBeLessThan(html.indexOf('/js/devboard.js?v='))
  })

  it('board-page.js consumes the core: capture-phase keydown + stopImmediatePropagation + the sheet dialog roles + the toggle-gated head buttons', () => {
    const js = readPublic('js/board-page.js')
    for (const marker of [
      'window.HibanaFocusCore',
      'hibana:focus-mode',
      'focusStorage',
      'TOGGLE_KEY',
      'LAST_KEY',
      'data-db-focus',
      'data-db-focus-sheet',
      'aria-pressed',
      'role="dialog"',
      'aria-modal="true"',
      'stopImmediatePropagation',
      'db-focus-overlay',
      'focusState',
    ]) {
      expect(js.includes(marker), 'board-page.js must carry ' + JSON.stringify(marker)).toBe(true)
    }
    // the Esc listener is registered on the CAPTURE phase (the zen-mode shield)
    expect(js.includes("}, true) // CAPTURE")).toBe(true)
    // the quick-add rides the SAME creation call the editor uses — no duplicated POST
    expect(js.includes('B().createTask({ title, status: focus.sheetStatus')).toBe(true)
    // the controller keeps EXACTLY the THREE seam-patched fetch sites (the island
    // rewrites those to hibanaFetch; the S237 block adds zero new ones — S258's
    // FE-11 retired the clear-done DELETE fan-out for the ONE bulk api() call)
    expect((js.match(/\bfetch\(/g) || []).length).toBe(3)
  })

  it('devboard.css carries the S237 recipe: the dim class, the <800px hide, the reduced-motion kill', () => {
    const css = readPublic('css/devboard.css')
    for (const marker of [
      '.db-cols[data-focus-active] .pd-col.db-dim',
      'filter: blur(3px) saturate(.5)',
      'pointer-events: none',
      'user-select: none',
      '@media (max-width: 799px)',
      '@media (prefers-reduced-motion: reduce)',
      '.db-focus-overlay',
      '.db-focus-sheet',
      '.db-focus-cards.db-cols',
    ]) {
      expect(css.includes(marker), 'devboard.css must carry ' + JSON.stringify(marker)).toBe(true)
    }
  })

  it('the settings surfaces: settings-page.js writes the key + dispatches the event; settings.html carries the toggle row', () => {
    const js = readPublic('js/settings-page.js')
    expect(js.includes("'hibana-focus-mode'")).toBe(true)
    expect(js.includes('hibana:focus-mode')).toBe(true)
    const html = readPublic('settings.html')
    expect(html.includes('id="db-focus-mode-toggle"')).toBe(true)
    expect(html.includes('data-i18n="db.focus.mode"')).toBe(true)
  })

  it('the i18n pair: every db.focus.* key ships in BOTH dictionaries with inline EN fallbacks at the call sites', () => {
    const en = readPublic('js/i18n-en.js')
    const fa = readPublic('js/i18n-fa.js')
    const keys = ['db.focus.mode', 'db.focus.hint', 'db.focus.toggle', 'db.focus.exit', 'db.focus.enlarge', 'db.focus.sheetAdd', 'db.focus.sheetTitle', 'db.focus.on', 'db.focus.off']
    for (const k of keys) {
      expect(en.includes("'" + k + "':"), 'EN dictionary missing ' + k).toBe(true)
      expect(fa.includes("'" + k + "':"), 'FA dictionary missing ' + k).toBe(true)
    }
    const bp = readPublic('js/board-page.js')
    for (const pair of [
      ["'db.focus.toggle', 'Focus this column'"],
      ["'db.focus.exit', 'Exit focus (Esc)'"],
      ["'db.focus.enlarge', 'Enlarge this column'"],
      ["'db.focus.sheetAdd', 'Add a task to this column…'"],
      ["'db.focus.sheetTitle', '{lane} — {n} tasks'"],
    ]) {
      expect(bp.includes(pair[0]), 'board-page.js _t call missing fallback ' + pair[0]).toBe(true)
    }
  })

  it('sw.js is at hibana-v465 and the round notes the carrier bumps (S260 moved the ladder — the S259-finding micro-fix round; the pin intent is preserved, the ladder moved with the carriers)', () => {
    const sw = readPublic('sw.js')
    expect(sw.includes('const VERSION = "hibana-v465"')).toBe(true)
    expect(sw.includes('// v465 (S260)')).toBe(true)
    // the S237 note stays in the history block (the discipline: every prior entry
    // is recoverable; the history block carries the last rounds)
    expect(sw.includes('// v451 (S237): FOCUS MODE')).toBe(true)
  })
})
