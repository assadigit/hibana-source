import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAT_PAIRS } from '../lib/categories'

// S181 — the /color-palette-advisor hex pass, pinned into the suite.
//
// Two palettes are audited here, numerically, the way qa/s181-ident-palette.mjs
// audits them (the same math, in-test, so CI is the teeth):
//
//   A. The PROJECT IDENTITY family — the twelve --ident-* tokens a project's stable
//      hash-of-id dot wears (S179 block 13 → S181's dedicated family). Five laws:
//      (1) contrast ≥3:1 on BOTH theme cards (WCAG 1.4.11 non-text, the dot is a
//          meaningful 8px graphic — light card #FFFFFF, claude-dark card #1f1e1c),
//      (2) no red/orange/yellow family hue (identity never reads as a state),
//      (3) pairwise CIEDE2000 ≥10 (two projects never read as one identity),
//      (4) ≥10 from the brand teal (a dot never reads as "selected/current"),
//      (5) ≥8 from every --st-* status token (a dot never reads as a task state).
//   B. The SIXTEEN curated category swatch pairs (S152) — every ink ≥4.5:1 on its
//      own fill (the pairs are theme-independent: claude-dark does NOT override
//      --cat-sw-*, pinned here so a future dark flip can't silently void the audit).
//
// The drift pins keep the three homes of the identity family in lockstep:
// variables.css (the tokens), PROJECT_HUE_TOKENS (the hash's lookup table), and
// this test's audited hex table.

const css = readFileSync(join(process.cwd(), 'public', 'css', 'variables.css'), 'utf8')
const darkCss = readFileSync(join(process.cwd(), 'public', 'css', 'claude-dark-theme.css'), 'utf8')
const helpersTs = readFileSync(join(process.cwd(), 'src', 'routes', 'projects', 'helpers.ts'), 'utf8')

const LIGHT_CARD = '#FFFFFF'
const DARK_CARD = '#1f1e1c'
const BRAND = '#4A9FA3'

// ---------- color math (the qa script's math, verbatim in spirit) ----------
const lin = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const contrast = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
const toLab = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
const hueOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60 + 360) % 360
}
// CIEDE2000 (compact, standard formulation)
function de2000(hex1: string, hex2: string): number {
  const [L1, a1, b1] = toLab(hex1)
  const [L2, a2, b2] = toLab(hex2)
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))))
  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = (Math.atan2(b1, a1p) * 180) / Math.PI + 360
  const h2p = (Math.atan2(b2, a2p) * 180) / Math.PI + 360
  const dLp = L2 - L1
  const dCp = C2p - C1p
  const dhp = Math.abs(h1p - h2p) <= 180 ? h2p - h1p : h2p - h1p > 0 ? h2p - h1p - 360 : h2p - h1p + 360
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(((dhp / 2) * Math.PI) / 180)
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp = h1p + h2p
  if (Math.abs(h1p - h2p) > 180 && h1p + h2p < 360) hbp += 360
  if (Math.abs(h1p - h2p) > 180 && h1p + h2p >= 360) hbp -= 360
  hbp /= 2
  const T =
    1 -
    0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * hbp) * Math.PI) / 180) +
    0.32 * Math.cos((((3 * hbp + 6) * Math.PI) / 180)) -
    0.2 * Math.cos((((4 * hbp - 63) * Math.PI) / 180))
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const Sc = 1 + 0.045 * Cbp
  const Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  )
}

// ---------- the audited identity table (the qa script's table, one home) ----------
const IDENT: Record<string, string> = {
  'ident-leaf': '#61702E',
  'ident-fern': '#709E51',
  'ident-moss': '#337731',
  'ident-jade': '#31775E',
  'ident-ocean': '#5C96BC',
  'ident-azure': '#4E66B7',
  'ident-cornflower': '#8C88CE',
  'ident-iris': '#8055B9',
  'ident-orchid': '#B679C8',
  'ident-mulberry': '#A7449D',
  'ident-rose': '#C775A4',
  'ident-blush': '#AE475F',
}

// The --st-* status tokens parsed from variables.css (the real shipped values — a
// token change re-runs the law against the NEW truth instead of a frozen copy).
const STATUS_TOKENS: Record<string, string> = {}
for (const m of css.matchAll(/--(st-[a-z_]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) STATUS_TOKENS[m[1]] = m[2].toUpperCase()

describe('S181 identity palette — the /color-palette-advisor hex pass (five laws)', () => {
  it('law 1 — every hue clears 3:1 on BOTH theme cards (WCAG 1.4.11 non-text)', () => {
    for (const [name, hex] of Object.entries(IDENT)) {
      const cw = contrast(hex, LIGHT_CARD)
      const cd = contrast(hex, DARK_CARD)
      expect(cw, `${name} ${hex} on white`).toBeGreaterThanOrEqual(3)
      expect(cd, `${name} ${hex} on the claude-dark card`).toBeGreaterThanOrEqual(3)
    }
  })

  it('law 2 — no hue sits in the red/orange/yellow family (identity never reads as a state)', () => {
    for (const [name, hex] of Object.entries(IDENT)) {
      const h = hueOf(hex)
      expect(h, `${name} ${hex} hue ${h}°`).toBeGreaterThanOrEqual(70)
      expect(h, `${name} ${hex} hue ${h}°`).toBeLessThanOrEqual(355)
    }
  })

  it('law 3 — pairwise CIEDE2000 ≥10 (two projects never read as one identity)', () => {
    const names = Object.keys(IDENT)
    let min = Infinity
    let minPair = ''
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const d = de2000(IDENT[names[i]], IDENT[names[j]])
        if (d < min) { min = d; minPair = `${names[i]}↔${names[j]}` }
        expect(d, `${names[i]} ↔ ${names[j]}`).toBeGreaterThanOrEqual(10)
      }
    }
    // The old borrowed set's known floor was 6.0 (accent-1 ↔ accent-teal).
    expect(min, `closest pair ${minPair}`).toBeGreaterThan(6.0)
  })

  it('law 4 — every hue clears 10 ΔE from the brand teal (never "selected/current")', () => {
    for (const [name, hex] of Object.entries(IDENT)) {
      expect(de2000(hex, BRAND), `${name} vs brand`).toBeGreaterThanOrEqual(10)
    }
  })

  it('law 5 — every hue clears 8 ΔE from every --st-* status token (never a task state)', () => {
    expect(Object.keys(STATUS_TOKENS).length).toBeGreaterThanOrEqual(7)
    for (const [name, hex] of Object.entries(IDENT)) {
      for (const [st, stHex] of Object.entries(STATUS_TOKENS)) {
        expect(de2000(hex, stHex), `${name} vs ${st}`).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('drift pin — variables.css carries exactly the audited 12 --ident-* tokens', () => {
    for (const [name, hex] of Object.entries(IDENT)) {
      expect(css).toMatch(new RegExp(`${name}:\\s*${hex}\\s*;`))
    }
    // and no 13th identity token can drift in unaudited
    const count = [...css.matchAll(/--ident-[a-z]+:/g)].length
    expect(count).toBe(12)
  })

  it('drift pin — PROJECT_HUE_TOKENS is exactly the twelve audited names, in the ladder order', () => {
    const block = helpersTs.match(/const PROJECT_HUE_TOKENS = \[([^\]]+)\]/)?.[1] ?? ''
    const tokens = [...block.matchAll(/'(ident-[a-z]+)'/g)].map((m) => m[1])
    expect(tokens).toEqual(Object.keys(IDENT))
  })

  it('the claude-dark sheet does not override --ident-* (one family, both themes)', () => {
    expect(darkCss).not.toMatch(/--ident-/)
  })
})

describe('S152 category swatches — every pair clears AA text contrast on its own fill', () => {
  it('all 16 inks are ≥4.5:1 on their fills (the pairs are the user-facing chips)', () => {
    expect(CAT_PAIRS).toHaveLength(16)
    for (const p of CAT_PAIRS) {
      expect(contrast(p.ink, p.fill), `${p.ink} on ${p.fill}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('claude-dark does not override --cat-sw-* (the audited pairs ARE the dark pairs)', () => {
    expect(darkCss).not.toMatch(/--cat-sw-/)
  })

  it('variables.css carries the same 16 pairs as the server constant (the S152 drift pin holds)', () => {
    for (let i = 0; i < CAT_PAIRS.length; i++) {
      expect(css).toMatch(new RegExp(`--cat-sw-${i + 1}-fill:\\s*${CAT_PAIRS[i].fill}\\s*;`))
      expect(css).toMatch(new RegExp(`--cat-sw-${i + 1}-ink:\\s*${CAT_PAIRS[i].ink}\\s*;`))
    }
  })
})

// ---------- the sidebar color block (S181 — the S178 leftover, delivered) ----------
// The advisor's deferred "shade of the tint is a separate color decision", made
// and measured: the selected row keeps the accent-soft WASH (the S178 quiet-pill
// recipe, unchanged), and the current-location BAR ink steps to the --brand-hover
// rung — one step further from the surface than --brand, the direction the rung
// already points per theme (light #3D8D91 darker, dark #e28f6c lighter). The
// bare brand missed the app's own 3:1 non-text floor (the S179 block-15 law) on
// the tinted wash in light (2.73:1); the rung clears it on every surface the
// bar can sit on, in both themes. The row TEXT on the wash stays far past AA.
const tokenOf = (sheet: string, name: string): string | undefined => {
  const m = sheet.match(new RegExp(`${name}:\\s*([^;]+);`))
  return m?.[1]?.trim()
}
const rgbaBlend = (rgba: string, ground: string): string => {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  if (!m) throw new Error(`not an rgba: ${rgba}`)
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), parseFloat(m[4])]
  const gr = parseInt(ground.slice(1), 16)
  const mix = (c: number, gc: number) => Math.round(a * c + (1 - a) * gc)
  return (
    '#' +
    [mix(r, (gr >> 16) & 255), mix(g, (gr >> 8) & 255), mix(b, gr & 255)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

describe('S181 sidebar color block — the current-location bar clears 3:1 everywhere', () => {
  it('light: the --brand-hover bar ink clears 3:1 on BOTH the rail card and the selected-row wash', () => {
    const card = tokenOf(css, '--card') ?? '#FFFFFF'
    const wash = rgbaBlend(tokenOf(css, '--accent-soft') ?? '', card)
    const barInk = tokenOf(css, '--brand-hover') ?? ''
    expect(barInk).toBe('#3D8D91')
    expect(contrast(barInk, card), 'the rail bar on the card').toBeGreaterThanOrEqual(3)
    expect(contrast(barInk, wash), 'the sidebar bar on the wash').toBeGreaterThanOrEqual(3)
    // the bare brand was the miss this block retires (2.73:1 on the wash)
    expect(contrast(tokenOf(css, '--brand') ?? '', wash)).toBeLessThan(3)
    // the row text on the wash stays far past AA
    expect(contrast(tokenOf(css, '--text') ?? '', wash)).toBeGreaterThanOrEqual(4.5)
  })

  it('dark: the --brand-hover rung clears 3:1 on both surfaces too (the rung already points away from the dark surface)', () => {
    const card = tokenOf(darkCss, '--card') ?? '#1f1e1c'
    const wash = rgbaBlend(tokenOf(darkCss, '--accent-soft') ?? '', card)
    const barInk = tokenOf(darkCss, '--brand-hover') ?? ''
    expect(barInk).toBe('#e28f6c')
    expect(contrast(barInk, card), 'the rail bar on the dark card').toBeGreaterThanOrEqual(3)
    expect(contrast(barInk, wash), 'the sidebar bar on the dark wash').toBeGreaterThanOrEqual(3)
    expect(contrast(tokenOf(darkCss, '--text') ?? '', wash)).toBeGreaterThanOrEqual(4.5)
  })

  it('the bars actually paint the rung: every current-location ::before rule rides var(--brand-hover)', () => {
    const layoutCss = readFileSync(join(process.cwd(), 'public', 'css', 'layout.css'), 'utf8')
    // S188 (CHANGE 5): the .is-panel-open override is RETIRED with its whole rule —
    // the base [aria-current='page']::before paints the rung alone now (the
    // override painted the identical --brand-hover, so its removal changes nothing).
    for (const sel of [
      '.rail-btn[aria-current=\'page\']::before',
      '.rail-project-group.is-here > .rail-group-headrow::before',
      '.rail-item.is-row-active::before',
    ]) {
      const block = layoutCss.slice(layoutCss.indexOf(sel))
      const body = block.slice(0, block.indexOf('}') + 1)
      expect(body, `${sel} paints the rung`).toMatch(/background:\s*var\(--brand-hover\)/)
    }
    // and the WASH is untouched (the S178 quiet-pill recipe stands)
    expect(layoutCss).toMatch(/\.rail-item\.is-row-active\s*\{[^}]*--accent-soft/s)
  })
})
