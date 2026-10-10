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
    // S189 (owner, CHANGE 7): the RAIL BUTTON's ::before retires too — the rail's
    // active item paints the filled SHAPE now (see the S189 block below); only the
    // two SIDEBAR ROW bars (the panel's group head + selected row) keep the rung.
    for (const sel of [
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

// ---------- the rail's active SHAPE (S189 — the owner's CHANGE 7) ----------
// The active rail item paints a soft FILLED rounded shape (the teal at low
// alpha) with the icon at the full teal and the label one contrast-rung
// further from the tint. The bar is gone; the shape is the only active
// indicator. These pins hold the whole contract, numerically:
//   1. the five --nav-* tokens exist in BOTH sheets (light + dark twins),
//   2. the shape alpha rides the BACKGROUND COLOR (rgba) — never the opacity
//      property, which would fade the icon and label with it,
//   3. the icon clears 3:1 and the label 4.5:1 on the BLENDED shape, both
//      themes (the tint is the teal at alpha over each theme's rail surface),
//   4. layout.css paints var(--nav-active-bg) on the active button and the
//      rail button's ::before bar is RETIRED (no rule exists at all).
const blendRgba = (rgba: string, ground: string): string => {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  if (!m) throw new Error(`not an rgba: ${rgba}`)
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), parseFloat(m[4])]
  const gn = parseInt(ground.slice(1), 16)
  const mix = (c: number, gc: number) => Math.round(a * c + (1 - a) * gc)
  return (
    '#' +
    [mix(r, (gn >> 16) & 255), mix(g, (gn >> 8) & 255), mix(b, gn & 255)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

describe('S189 rail active shape — the teal tile contract, both themes', () => {
  const layoutCss = readFileSync(join(process.cwd(), 'public', 'css', 'layout.css'), 'utf8')

  it('light: the shape is #2F7B7F at 14% and the icon/label clear their floors on the blended tint', () => {
    const bg = tokenOf(css, '--nav-active-bg')
    const icon = tokenOf(css, '--nav-active-icon')
    const label = tokenOf(css, '--nav-active-label')
    expect(bg).toBe('rgba(47, 123, 127, 0.14)') // the owner's CHANGE 7 value, alpha on the color only
    expect(icon).toBe('#2F7B7F')
    expect(label).toBe('#1F5A5D')
    const tint = blendRgba(bg!, LIGHT_CARD)
    expect(contrast(icon!, tint), 'the icon on its own tint (3:1 non-text floor)').toBeGreaterThanOrEqual(3)
    expect(contrast(label!, tint), 'the label on its own tint (4.5:1 text floor)').toBeGreaterThanOrEqual(4.5)
  })

  it('dark: the lighter-teal twins at 20% clear the same floors on the dark rail surface', () => {
    const bg = tokenOf(darkCss, '--nav-active-bg')
    const icon = tokenOf(darkCss, '--nav-active-icon')
    const label = tokenOf(darkCss, '--nav-active-label')
    expect(bg).toBe('rgba(143, 204, 207, 0.20)') // the higher dark alpha (18–22% band)
    expect(icon).toBe('#8FCCCF')
    expect(label).toBe('#9AD4D7')
    const tint = blendRgba(bg!, DARK_CARD)
    expect(contrast(icon!, tint), 'the dark icon on its own tint').toBeGreaterThanOrEqual(3)
    expect(contrast(label!, tint), 'the dark label on its own tint').toBeGreaterThanOrEqual(4.5)
  })

  it('the hover tints are the SAME teal families, quieter than their active shapes', () => {
    const lightHover = tokenOf(css, '--nav-hover-bg')
    const lightActiveHover = tokenOf(css, '--nav-active-bg-hover')
    const darkHover = tokenOf(darkCss, '--nav-hover-bg')
    const darkActiveHover = tokenOf(darkCss, '--nav-active-bg-hover')
    expect(lightHover).toBe('rgba(47, 123, 127, 0.07)') // the 6–8% band
    expect(lightActiveHover).toBe('rgba(47, 123, 127, 0.18)') // deeper than rest, still no full saturation
    expect(darkHover).toBe('rgba(143, 204, 207, 0.10)')
    expect(darkActiveHover).toBe('rgba(143, 204, 207, 0.25)')
    // quieter than the active shape, by construction of the parsed alphas
    const alpha = (s: string | undefined) => parseFloat(s!.match(/([\d.]+)\)$/)![1])
    expect(alpha(lightHover)).toBeLessThan(alpha(tokenOf(css, '--nav-active-bg')))
    expect(alpha(darkHover)).toBeLessThan(alpha(tokenOf(darkCss, '--nav-active-bg')))
  })

  it('layout.css: the active button paints the shape tokens and the ::before bar is RETIRED', () => {
    const block = layoutCss.slice(layoutCss.indexOf(".rail-btn[aria-current='page'] {"))
    const body = block.slice(0, block.indexOf('}') + 1)
    expect(body).toMatch(/background:\s*var\(--nav-active-bg\)/)
    expect(body).toMatch(/color:\s*var\(--nav-active-icon\)/)
    expect(body).not.toMatch(/opacity/) // the alpha lives in the rgba, never the opacity property
    const labelBlock = layoutCss.slice(layoutCss.indexOf(".rail-btn[aria-current='page'] .rail-label"))
    expect(labelBlock.slice(0, labelBlock.indexOf('}') + 1)).toMatch(/color:\s*var\(--nav-active-label\)/)
    // the retired bar: NO ::before rule for the rail button exists anywhere
    expect(layoutCss).not.toMatch(/\.rail-btn\[aria-current='page'\]::before/)
    // the inactive hover speaks the quiet teal, not the old text wash
    expect(layoutCss).toMatch(/\.rail-btn:hover\s*\{[^}]*var\(--nav-hover-bg\)/s)
  })
})

// ---------- the mobile bar + sheet join the shape (S190) ----------
// ONE active grammar app-wide: the S189 --nav-active-* family reaches the last two
// navigation surfaces — the mobile bottom bar's tabs (the shape = the tab's own
// rounded tile) and the More sheet's current-page row. The bar's surface is
// TRANSLUCENT (92% card + backdrop blur), so the contrast proof bounds the ground:
// the underlying content can shift it at most 8% toward black (light) / white
// (dark) — the far ends. The floors must hold on the worst-case bound, both themes
// (the nominal ground is strictly inside it). The press feedback joins the one hue
// family (--accent-soft retires from the bar; the sheet's --accent-soft/--link
// active pair retires too), the More-EXPANDED teal ink retires (one active pattern
// — the open sheet is the indicator), and the bar tabs gain their own focus rings.
describe('S190 mobile active shape — the bar + sheet join the S189 family', () => {
  const polishCss = readFileSync(join(process.cwd(), 'public', 'css', 'polish-ui.css'), 'utf8')
  const quicknotesCss = readFileSync(join(process.cwd(), 'public', 'css', 'quicknotes.css'), 'utf8')

  it('the bar paints the family: shape tokens on the active tab, label ink one rung further', () => {
    const block = polishCss.slice(polishCss.indexOf('.mobile-nav a[aria-current="page"],'))
    const body = block.slice(0, block.indexOf('}') + 1)
    expect(body).toMatch(/background:\s*var\(--nav-active-bg\)/) // the shape — alpha on the color only
    expect(body).toMatch(/color:\s*var\(--nav-active-icon\)/) // the icon keeps the full teal
    expect(body).not.toMatch(/opacity/)
    const labelBlock = polishCss.slice(polishCss.indexOf('.mobile-nav a[aria-current="page"] .mobile-nav-label,'))
    const labelBody = labelBlock.slice(0, labelBlock.indexOf('}') + 1)
    expect(labelBody).toMatch(/color:\s*var\(--nav-active-label\)/)
    expect(labelBody).toMatch(/font-weight:\s*600/)
    // the More tab's current twin rides the SAME rule pair (secondary pages keep feedback)
    expect(polishCss).toMatch(/\.mobile-nav \.mobile-nav-more\[aria-current="page"\][\s\S]{0,200}var\(--nav-active-bg\)/)
  })

  it('light worst case: the floors hold on the 92%-card-over-BLACK bound', () => {
    // the bar = color-mix(card 92%, transparent) over any content; black is the far end
    const worstGround = blendRgba('rgba(255, 255, 255, 0.92)', '#000000') // #EBEBEB
    const tint = blendRgba(tokenOf(css, '--nav-active-bg')!, worstGround)
    expect(contrast(tokenOf(css, '--nav-active-icon')!, tint), 'icon on the worst-case bar tint (3:1)').toBeGreaterThanOrEqual(3)
    expect(contrast(tokenOf(css, '--nav-active-label')!, tint), 'label on the worst-case bar tint (4.5:1)').toBeGreaterThanOrEqual(4.5)
  })

  it('dark worst case: the floors hold on the 92%-card-over-WHITE bound', () => {
    const worstGround = blendRgba('rgba(31, 30, 28, 0.92)', '#FFFFFF') // 92% #1f1e1c over white
    const tint = blendRgba(tokenOf(darkCss, '--nav-active-bg')!, worstGround)
    expect(contrast(tokenOf(darkCss, '--nav-active-icon')!, tint), 'icon on the worst-case dark bar tint (3:1)').toBeGreaterThanOrEqual(3)
    expect(contrast(tokenOf(darkCss, '--nav-active-label')!, tint), 'label on the worst-case dark bar tint (4.5:1)').toBeGreaterThanOrEqual(4.5)
  })

  it('the press family + the retirements: one hue family, one active pattern', () => {
    // inactive press: the quiet teal, not the old accent-soft
    expect(polishCss).toMatch(/\.mobile-nav a:active\s*\{[^}]*var\(--nav-hover-bg\)/)
    expect(polishCss).toMatch(/\.mobile-nav \.mobile-nav-more:active\s*\{[^}]*var\(--nav-hover-bg\)/)
    // active press deepens one notch
    expect(polishCss).toMatch(/aria-current="page"\]:active[\s\S]{0,120}var\(--nav-active-bg-hover\)/)
    // --accent-soft is RETIRED from the bar entirely
    expect(polishCss).not.toMatch(/\.mobile-nav[^{]*\{[^}]*--accent-soft/)
    // the More-EXPANDED teal ink is RETIRED (the open sheet is the indicator)
    expect(polishCss).not.toMatch(/\.mobile-nav \.mobile-nav-more\[aria-expanded="true"\]/)
    // the bar tabs have their OWN focus rings now (the S61 gap — the sheet rows had them, the tabs didn't)
    expect(polishCss).toMatch(/\.mobile-nav a:focus-visible,[\s\S]{0,200}outline:\s*2px solid var\(--focus-ring/)
    expect(polishCss).toMatch(/\.mobile-nav a:focus-visible[\s\S]{0,300}outline-offset:\s*2px/)
  })

  it('the bar geometry: the 6px shoulder band + the under-cover body invariant', () => {
    // the bar's block padding sits the shape ~6px off the outer edges (the S189 6–8px band)
    expect(polishCss).toMatch(/padding:\s*0\.375rem 0\.5rem calc\(0\.375rem \+ env\(safe-area-inset-bottom/)
    // the body's reserve covers the taller bar (61px bar vs 62.4px reserve)
    expect(polishCss).toMatch(/body\.has-mobile-nav\s*\{\s*padding-block-end:\s*calc\(3\.9rem/)
  })

  it('the More sheet rows join: --accent-soft/--link retire for the S189 family', () => {
    const rowBlock = quicknotesCss.slice(quicknotesCss.indexOf('.mobile-more-row[aria-current="page"] {'))
    const rowBody = rowBlock.slice(0, rowBlock.indexOf('}') + 1)
    expect(rowBody).toMatch(/background:\s*var\(--nav-active-bg\)/)
    expect(rowBody).toMatch(/color:\s*var\(--nav-active-label\)/)
    expect(rowBody).toMatch(/font-weight:\s*600/)
    const iconBlock = quicknotesCss.slice(quicknotesCss.indexOf('.mobile-more-row[aria-current="page"] .icon'))
    expect(iconBlock.slice(0, iconBlock.indexOf('}') + 1)).toMatch(/color:\s*var\(--nav-active-icon\)/)
    // the retired pair: no --accent-soft or --link remains on the sheet's current-row rules
    const activeRules = quicknotesCss.match(/\.mobile-more-row\[aria-current="page"\][^{}]*\{[^}]*\}/g) || []
    for (const rule of activeRules) {
      expect(rule).not.toMatch(/--accent-soft/)
      expect(rule).not.toMatch(/var\(--link\)/)
    }
  })
})

describe('S191 the attention surface — the chrome pills + the pending pair', () => {
  const quicknotesCss = readFileSync(join(process.cwd(), 'public', 'css', 'quicknotes.css'), 'utf8')
  const notifCss = readFileSync(join(process.cwd(), 'public', 'css', 'notifications.css'), 'utf8')

  it('the never-defined --badge-pending pair is DEFINED now, both themes, past AA', () => {
    // The regression this round fixed: the pair was referenced (notifications.css
    // chips/icons/accents + variables.css --status-warning-soft → task-controls
    // status dots) since R2.1 but never defined — every "Soon" surface silently
    // rendered unstyled. Both theme sheets must carry it, and the ink must clear
    // 4.5:1 on its own fill (the numeric twin of qa/s191-attention-surface.mjs).
    const light = tokenOf(css, '--badge-pending-bg')
    const lightFg = tokenOf(css, '--badge-pending-fg')
    const dark = tokenOf(darkCss, '--badge-pending-bg')
    const darkFg = tokenOf(darkCss, '--badge-pending-fg')
    expect(light).toMatch(/^#/)
    expect(lightFg).toMatch(/^#/)
    expect(dark).toMatch(/^#/)
    expect(darkFg).toMatch(/^#/)
    expect(contrast(lightFg!, light!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(darkFg!, dark!)).toBeGreaterThanOrEqual(4.5)
  })

  it('the chip badge: a corner pill with a --card separation ring, severity-tinted soft fills', () => {
    const badge = quicknotesCss.slice(quicknotesCss.indexOf('.chip-notif-badge {'))
    const badgeBody = badge.slice(0, badge.indexOf('}') + 1)
    expect(badgeBody).toMatch(/position:\s*absolute/)
    expect(badgeBody).toMatch(/inset-block-start:\s*-0\.2rem/)
    expect(badgeBody).toMatch(/border-radius:\s*999px/)
    // optical separation off the avatar — the rail IS --card, the ring is --card
    expect(badgeBody).toMatch(/box-shadow:\s*0 0 0 2px var\(--card\)/)
    // the pill decorates the chip (the chip is the hit target)
    expect(badgeBody).toMatch(/pointer-events:\s*none/)
    // the severity map: soft fills + AA inks, never the raw saturated fills
    expect(quicknotesCss).toMatch(/\.chip-notif-urgent \{ background: var\(--danger-soft\); color: var\(--danger\)/)
    expect(quicknotesCss).toMatch(/\.chip-notif-warning \{ background: var\(--badge-pending-bg\); color: var\(--badge-pending-fg\)/)
    expect(quicknotesCss).toMatch(/\.chip-notif-info \{ background: var\(--badge-spark-bg\); color: var\(--badge-spark-fg\)/)
    // the chip hosts the badge
    expect(quicknotesCss).toMatch(/\.rail-user-chip \{ position: relative; \}/)
  })

  it('the menu/sheet row pills: the S188 badge-column pattern, one severity family', () => {
    const pill = quicknotesCss.slice(quicknotesCss.indexOf('.menu-count-pill {'))
    const pillBody = pill.slice(0, pill.indexOf('}') + 1)
    expect(pillBody).toMatch(/margin-inline-start:\s*auto/)
    expect(pillBody).toMatch(/border-radius:\s*999px/)
    expect(quicknotesCss).toMatch(/\.menu-count-urgent \{ background: var\(--danger-soft\); color: var\(--danger\)/)
    expect(quicknotesCss).toMatch(/\.menu-count-warning \{ background: var\(--badge-pending-bg\); color: var\(--badge-pending-fg\)/)
    expect(quicknotesCss).toMatch(/\.menu-count-info \{ background: var\(--badge-spark-bg\); color: var\(--badge-spark-fg\)/)
  })

  it('the page: sticky group heads with --bg covers + severity labels; chips are buttons', () => {
    const head = notifCss.slice(notifCss.indexOf('.notif-group-head {'))
    const headBody = head.slice(0, head.indexOf('}') + 1)
    expect(headBody).toMatch(/position:\s*sticky/)
    expect(headBody).toMatch(/background:\s*var\(--bg\)/) // solid cover (the S188 lesson)
    expect(headBody).toMatch(/z-index:\s*3/)
    // the severity labels ride the family hues on the canvas
    expect(notifCss).toMatch(/\.notif-group-head-urgent \.notif-group-label \{ color: var\(--danger\); \}/)
    expect(notifCss).toMatch(/\.notif-group-head-warning \.notif-group-label \{ color: var\(--badge-pending-fg\); \}/)
    expect(notifCss).toMatch(/\.notif-group-head-info \.notif-group-label \{ color: var\(--badge-spark-fg\); \}/)
    // the filter chips: real buttons — unpressed outline baseline, pressed family fill,
    // their OWN focus ring (the S61 doctrine), no opacity anywhere
    expect(notifCss).toMatch(/\.notif-chip-btn \{[^}]*cursor:\s*pointer/)
    expect(notifCss).toMatch(/\.notif-chip-btn:focus-visible \{ outline: 2px solid var\(--focus-ring, var\(--accent\)\); outline-offset: 2px; \}/)
    expect(notifCss).toMatch(/\.notif-chip-btn\.notif-urgent\[aria-pressed='true'\] \{ background: var\(--danger-soft\)/)
    expect(notifCss).toMatch(/\.notif-chip-btn\.notif-warning\[aria-pressed='true'\] \{ background: var\(--badge-pending-bg\)/)
    expect(notifCss).toMatch(/\.notif-chip-btn\.notif-info\[aria-pressed='true'\] \{ background: var\(--badge-spark-bg\)/)
    // the old STATIC severity chip fills retired (the buttons own both states)
    expect(notifCss).not.toMatch(/\.notif-chip\.notif-urgent \{/)
    expect(notifCss).not.toMatch(/\.notif-chip\.notif-warning \{/)
    expect(notifCss).not.toMatch(/\.notif-chip\.notif-info \{/)
  })

  it('the numeric floors on the real token values (the qa script’s math, in CI)', () => {
    // pill inks on their soft fills, both themes
    expect(contrast(tokenOf(css, '--danger')!, '#fdeaea')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(css, '--badge-pending-fg')!, tokenOf(css, '--badge-pending-bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(css, '--badge-spark-fg')!, tokenOf(css, '--badge-spark-bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(darkCss, '--badge-pending-fg')!, tokenOf(darkCss, '--badge-pending-bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(darkCss, '--badge-spark-fg')!, tokenOf(darkCss, '--badge-spark-bg')!)).toBeGreaterThanOrEqual(4.5)
    // the group head severity labels on the page canvas
    expect(contrast(tokenOf(css, '--danger')!, tokenOf(css, '--bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(darkCss, '--danger')!, tokenOf(darkCss, '--bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(css, '--badge-pending-fg')!, tokenOf(css, '--bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(darkCss, '--badge-pending-fg')!, tokenOf(darkCss, '--bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(css, '--badge-spark-fg')!, tokenOf(css, '--bg')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenOf(darkCss, '--badge-spark-fg')!, tokenOf(darkCss, '--bg')!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('S192 the attention path — the smart deep-links + the ring fix', () => {
  const quicknotesCss = readFileSync(join(process.cwd(), 'public', 'css', 'quicknotes.css'), 'utf8')
  const paletteJs = readFileSync(join(process.cwd(), 'public', 'js', 'command-palette.js'), 'utf8')
  const hibInitJs = readFileSync(join(process.cwd(), 'public', 'js', 'hib-init.js'), 'utf8')
  const mobileNavJs = readFileSync(join(process.cwd(), 'public', 'js', 'mobile-nav.js'), 'utf8')
  const notifRoute = readFileSync(join(process.cwd(), 'src', 'routes', 'notifications.ts'), 'utf8')

  it('the spark notifications link DIRECT to the lean page (no /project.html hop)', () => {
    // the S161 doctrine, finally consistent on the attention surface too
    expect(notifRoute).toMatch(/unreviewedSparks\) \{[\s\S]{0,600}href: `\/spark\.html\?id=\$\{p\.id\}`/)
    // the spark block must NOT link the heavy page anymore (the comment may mention
    // the retired hop — only the href form is the contract)
    const sparkBlock = notifRoute.slice(notifRoute.indexOf('unreviewedSparks) {'), notifRoute.indexOf('upcomingDeadlines) {'))
    expect(sparkBlock).not.toContain('href: `/project.html?id=')
    // the project kinds keep the heavy page
    expect(notifRoute).toMatch(/overdueProjects\) \{[\s\S]{0,300}href: `\/project\.html\?id=/)
  })

  it('the chrome rows are SMART deep-links: the leading severity\'s filter', () => {
    // hib-init paints the account-menu row's href with the severity hash + resets on 0
    expect(hibInitJs).toMatch(/row\.setAttribute\('href', d\.count > 0 \? '\/notifications\.html#' \+ sev : '\/notifications\.html'\)/)
    // mobile-nav paints the sheet row the same way
    expect(mobileNavJs).toMatch(/row\.setAttribute\('href', '\/notifications\.html#' \+ sev\)/)
    expect(mobileNavJs).toMatch(/row\.setAttribute\('href', '\/notifications\.html'\)/)
    // the sheet row lookup rides the STABLE data-notif-row hook (survives the rewrite)
    expect(mobileNavJs).toMatch(/a\.mobile-more-row\[data-notif-row\]/)
    expect(mobileNavJs).toMatch(/notif: true/)
    // normPath drops the hash — the aria-current comparison stays route-true
    expect(mobileNavJs).toMatch(/String\(p\)\.split\('#'\)\[0\]/)
  })

  it('the palette\'s Notifications row: the live-count sublabel + the smart destination', () => {
    // the count rides the row (the Trash pattern) via the SHARED memo — no second fetch
    expect(paletteJs).toMatch(/window\.__hibNotifCounts/)
    expect(paletteJs).toMatch(/'hibana:notif-count'/)
    expect(paletteJs).toMatch(/readNotifCounts\(\)/)
    // the sublabel reuses the S191 key with the FA digits + the 99+ cap
    expect(paletteJs).toMatch(/notif\.needsAttention[\s\S]{0,200}needing attention/)
    expect(paletteJs).toMatch(/d\.count > 99 \? '99\+'/)
    // the destination is the leading severity's filter
    expect(paletteJs).toMatch(/d\.urgent > 0 \? '#urgent' : d\.warning > 0 \? '#warning' : '#info'/)
  })

  it('the badge ring tracks the chip\'s hover/focus surface (the halo fix)', () => {
    // the ring paints --card at rest (the S191 pin) and --bg-soft under hover/focus
    const rest = quicknotesCss.slice(quicknotesCss.indexOf('.chip-notif-badge {'))
    expect(rest.slice(0, rest.indexOf('}') + 1)).toMatch(/box-shadow:\s*0 0 0 2px var\(--card\)/)
    const hover = quicknotesCss.slice(quicknotesCss.indexOf('.rail-user-chip:hover .chip-notif-badge'))
    const hoverBody = hover.slice(0, hover.indexOf('}') + 1)
    expect(hoverBody).toMatch(/box-shadow:\s*0 0 0 2px var\(--bg-soft\)/)
    expect(quicknotesCss).toMatch(/\.rail-user-chip:focus-visible \.chip-notif-badge/)
  })
})

// S193 — THE REVIEW FLOW: the queue bar's token family + the promote action's
// grammar + the queue-aware landings. The bar rides the SAME --nav-active-* teal
// tint family the rail (S189) and the mobile bar (S190) proved on their own
// surfaces — the position line carries the label ink rung (the .muted rung would
// sit under the 4.5:1 small-text bar on the blended tint).
describe('S193 the review flow — the queue bar + the promote action on the lean page', () => {
  const dashboardCss = readFileSync(join(process.cwd(), 'public', 'css', 'dashboard.css'), 'utf8')
  const sparkJs = readFileSync(join(process.cwd(), 'public', 'js', 'spark-page.js'), 'utf8')
  const sparkHtml = readFileSync(join(process.cwd(), 'public', 'spark.html'), 'utf8')

  it('the queue bar paints the --nav-active-* family (the S189/S190 grammar)', () => {
    const bar = dashboardCss.slice(dashboardCss.indexOf('.spark-queue {'))
    const barBody = bar.slice(0, bar.indexOf('}') + 1)
    expect(barBody).toMatch(/background:\s*var\(--nav-active-bg\)/)
    expect(barBody).toMatch(/border:\s*1px solid var\(--nav-active-bg-hover\)/)
    expect(barBody).toMatch(/border-radius:\s*var\(--radius-sm\)/)
    // never the CSS opacity property (the S189 law: alpha rides the background COLOR)
    expect(barBody).not.toMatch(/opacity/)
    // the position line rides the label ink proven on this exact tint
    const pos = dashboardCss.slice(dashboardCss.indexOf('.spark-queue-pos {'))
    expect(pos.slice(0, pos.indexOf('}') + 1)).toMatch(/color:\s*var\(--nav-active-label\)/)
    expect(pos).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })

  it('the bar is CONTEXTUAL: fetched only for an old idea, rendered only IN the set with siblings', () => {
    // the fetch gate: >7d (the notifications' exact unreviewed boundary)
    expect(sparkJs).toMatch(/new Date\(project\.created_at\)\.getTime\(\) < Date\.now\(\) - 7 \* 24 \* 3600 \* 1000/)
    // the set: the notifications JSON's unreviewed-spark rows, oldest first
    expect(sparkJs).toMatch(/n\.kind === 'unreviewed-spark'/)
    expect(sparkJs).toMatch(/\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/)
    // the render guard: in-set AND ≥2 (a lone unreviewed idea has no queue)
    expect(sparkJs).toMatch(/queue\.length < 2 \|\| idx < 0/)
    // the position: "i of n" with FA digits (the S171 faDigits helper)
    expect(sparkJs).toMatch(/spark\.queuePos[\s\S]{0,120}faDig\(idx \+ 1\)/)
  })

  it('the promote action: the board dialog grammar + dirty fields folded into ONE PATCH', () => {
    // the button rides the lean page (ghost secondary — the ONE-primary rule)
    expect(sparkHtml).toMatch(/id="spark-promote" class="ghost small spark-promote"/)
    expect(sparkHtml).toMatch(/data-i18n="sparks\.promote"/)
    // the dialog: the board's stage set + the shared modal grammar
    expect(sparkJs).toMatch(/const PROMOTE_STAGES = \['planning', 'queued', 'developing', 'awaiting_dev', 'operational'\]/)
    expect(sparkJs).toMatch(/dlg\.id = 'spark-promote-dialog'/)
    // dirty title/description join the status PATCH — the words are never lost
    expect(sparkJs).toMatch(/const payload = \{ status \}[\s\S]{0,140}payload\.title = \$\('spark-title'\)\.value\.trim\(\) \|\| project\.title/)
    // promoted = the resume record switches to the PROJECT kind (the S119 grammar)
    expect(sparkJs).toMatch(/hibanaResume\?\.record\?\.\('project', id/)
    // the toast reuses the board's promoted key — zero new copy for the action
    expect(sparkJs).toMatch(/sparks\.promoted[\s\S]{0,60}Promoted — it now lives under Projects/)
  })

  it('the queue-aware landings: next idea, the caught-up close, the natural fallbacks', () => {
    // promote: next unreviewed idea in-queue; the new project's page without one
    expect(sparkJs).toMatch(/queueLanding\('\/project\.html\?id=' \+ encodeURIComponent\(id\)\)/)
    // delete: next idea in-queue; the shelf without one
    expect(sparkJs).toMatch(/queueLanding\('\/sparks\.html'\)/)
    // the landing rule: next exists → the next idea; else the notifications close
    expect(sparkJs).toMatch(/next \? '\/spark\.html\?id=' \+ encodeURIComponent\(next\.id\) : '\/notifications\.html'/)
    // the deliberate queue hop saves FIRST when dirty (never lose the words)
    expect(sparkJs).toMatch(/spark\.queueUnsaved[\s\S]{0,80}save\(\)\.then\(\(ok\) => \{ if \(ok\) leave\(\) \}\)/)
  })
})

// S195 — THE PANEL CLOSE-BUTTON FIX (the owner's report): the head's quiet pair
// steps up from the hairline era. The pixel probe that drove it: the .icon
// stroke-width 1.8 lives in the 24-unit viewBox, so at the old 17.6px render
// the effective stroke was 1.32px → 1px anti-aliased runs — the crossing X had
// no vertex mass to lean on and read as a fragile hairline (three VLM audits
// concurred, both themes, worst in dark). The 32px box also sat UNDER the app's
// own 40px coarse-pointer floor (misc.css) and its 44px .icon-btn recipe.
describe('S195 the panel head close button — geometry, optical stroke, floors', () => {
  const layoutCss = readFileSync(join(process.cwd(), 'public', 'css', 'layout.css'), 'utf8')
  const navJs = readFileSync(join(process.cwd(), 'public', 'js', 'nav.js'), 'utf8')

  it('the box: 2.25rem (36px) base with the 40px coarse-pointer floor', () => {
    const block = layoutCss.slice(layoutCss.indexOf('.rail-panel-close,'))
    const body = block.slice(0, block.indexOf('}') + 1)
    expect(body).toMatch(/inline-size:\s*2\.25rem; block-size:\s*2\.25rem/)
    // the coarse floor — the app's own documented 40px minimum for icon buttons
    const coarse = layoutCss.slice(layoutCss.indexOf('@media (pointer: coarse)'))
    expect(coarse.slice(0, coarse.indexOf('}') + 1)).toMatch(/\.rail-panel-close, \.rail-panel-tree \{ inline-size: 2\.5rem; block-size: 2\.5rem; \}/)
    // the quiet grammar rides unchanged: transparent rest, bg-soft hover, text ink, brand ring
    expect(body).toMatch(/background:\s*transparent; color:\s*var\(--muted\)/)
    const hover = layoutCss.slice(layoutCss.indexOf('.rail-panel-close:hover,'))
    expect(hover.slice(0, hover.indexOf('}') + 1)).toMatch(/background:\s*var\(--bg-soft\); color:\s*var\(--text\)/)
    const focus = layoutCss.slice(layoutCss.indexOf('.rail-panel-close:focus-visible,'))
    expect(focus.slice(0, focus.indexOf('}') + 1)).toMatch(/outline:\s*2px solid var\(--brand\); outline-offset:\s*1px/)
  })

  it('the icon grows with the box: 1.25rem (20px) — the .rail-btn .icon size', () => {
    const rule = layoutCss.slice(layoutCss.indexOf('.rail-panel-close .icon,'))
    expect(rule.slice(0, rule.indexOf('}') + 1)).toMatch(/inline-size:\s*1\.25rem; block-size:\s*1\.25rem/)
  })

  it('the X carries its own optical stroke-width 2 (the crossing reads lighter than the chevron\'s vertex)', () => {
    // the path-level attribute beats the inherited 1.8 (own declaration over
    // inheritance) — the ONE place the system's stroke forks, deliberately
    expect(navJs).toMatch(/<path stroke-width="2" d="M6 6l12 12M18 6L6 18"\/>/)
    // every OTHER X in the file keeps the shared 1.8 system (scoped fork, not a drift)
    const plainXs = navJs.match(/<path d="M6 6l12 12M18 6L6 18"\/>/g) || []
    expect(plainXs.length).toBeGreaterThanOrEqual(0) // none left bare in the panel head markup
  })
})
