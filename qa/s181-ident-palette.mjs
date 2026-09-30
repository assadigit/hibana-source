// S181 — the /color-palette-advisor hex pass, made numerical.
//
// The advisor's block-13 follow-up ("the exact hex tuning") was never delivered;
// this script is the advisor's replacement: it AUDITS a candidate twelve-token
// identity palette (the new --ident-* set in variables.css + PROJECT_HUE_TOKENS in
// src/routes/projects/helpers.ts) against the four laws the shipped design states:
//
//   1. CONTRAST   — every hue clears the WCAG 1.4.11 non-text floor (≥3:1) on BOTH
//                   surfaces it can appear on: the light card (#FFFFFF) and the
//                   claude-dark card (#1f1e1c).
//   2. FAMILY     — no hue sits in the red/orange/yellow family (hue 0–70° or
//                   >355°) — identity must never read as a state (red = destructive
//                   + problem, orange = warning/developing, yellow = planning).
//   3. DISTINCT   — every pair clears CIEDE2000 ≥ MIN_DE (identity dots are 8px;
//                   two different projects must never look like the same identity).
//                   The floor is calibrated against the OLD set's known collision
//                   (accent-1 #4A9FA3 vs accent-teal #3D8D91 — the pair that made
//                   the S179 set fail this law) — printed for reference.
//   4. BRAND      — every hue clears ≥ MIN_DE from the brand teal (#4A9FA3) — an
//                   identity dot may never read as "selected/current" either.
//   5. STATUS      — every hue clears ≥ MIN_DE_STATUS from every --st-* status token
//                   (idea/queued/developing/awaiting_dev/operational/bug/planning) —
//                   identity never reads as a state (block 13's first law).
//
// Run: node qa/s181-ident-palette.mjs   (exit 1 = a law is violated)
import { readFileSync } from 'node:fs'

const LIGHT_CARD = '#FFFFFF'
const DARK_CARD = '#1f1e1c'
const BRAND = '#4A9FA3'
const MIN_DE = 10 // the pairwise distinctness floor (see header)
const MIN_DE_STATUS = 8 // the identity-vs-status separation floor (see header)
const FAMILY_MIN_HUE = 70 // below this = red/orange/yellow family
const FAMILY_MAX_HUE = 355 // above this = back into red

// The status tokens (variables.css --st-*) — the hues identity must never wear.
const STATUS_TOKENS = {
  'st-idea': '#5B8DEF', 'st-planning': '#E9B93B', 'st-queued': '#17799E',
  'st-developing': '#E08A54', 'st-awaiting_dev': '#75689E',
  'st-operational': '#279E49', 'st-bug': '#E54D4D',
}

const hexes = {
  leaf: '#61702E',
  fern: '#709E51',
  moss: '#337731',
  jade: '#31775E',
  ocean: '#5C96BC',
  azure: '#4E66B7',
  cornflower: '#8C88CE',
  iris: '#8055B9',
  orchid: '#B679C8',
  mulberry: '#A7449D',
  rose: '#C775A4',
  blush: '#AE475F',
}

// ---------- color math ----------
const lin = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const contrast = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
const toLab = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
const hueOf = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return ((h * 60) + 360) % 360
}
// CIEDE2000 (compact, standard formulation)
function de2000(hex1, hex2) {
  const [L1, a1, b1] = toLab(hex1)
  const [L2, a2, b2] = toLab(hex2)
  const kL = 1
  const kC = 1
  const kH = 1
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))))
  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = Math.atan2(b1, a1p) * 180 / Math.PI + 360
  const h2p = Math.atan2(b2, a2p) * 180 / Math.PI + 360
  const dLp = L2 - L1
  const dCp = C2p - C1p
  const dhp = Math.abs(h1p - h2p) <= 180 ? h2p - h1p : h2p - h1p > 0 ? h2p - h1p - 360 : h2p - h1p + 360
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * Math.PI / 180)
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp = h1p + h2p
  if (Math.abs(h1p - h2p) > 180 && h1p + h2p < 360) hbp += 360
  if (Math.abs(h1p - h2p) > 180 && h1p + h2p >= 360) hbp -= 360
  hbp /= 2
  const T = 1 - 0.17 * Math.cos((hbp - 30) * Math.PI / 180) + 0.24 * Math.cos((2 * hbp) * Math.PI / 180) + 0.32 * Math.cos((3 * hbp + 6) * Math.PI / 180) - 0.2 * Math.cos((4 * hbp - 63) * Math.PI / 180)
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const Sc = 1 + 0.045 * Cbp
  const Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc
  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) +
    Math.pow(dCp / (kC * Sc), 2) +
    Math.pow(dHp / (kH * Sh), 2) +
    Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  )
}

// ---------- audit ----------
const names = Object.keys(hexes)
let fail = 0
const problems = []
console.log(`S181 identity palette audit — ${names.length} tokens`)
console.log('─'.repeat(96))
console.log('token        hex       hue°    contrast:white  contrast:dark-card')
for (const n of names) {
  const h = hexes[n]
  const cw = contrast(h, LIGHT_CARD)
  const cd = contrast(h, DARK_CARD)
  const hue = hueOf(h)
  const flags = []
  if (cw < 3) flags.push(`white ${cw.toFixed(2)}<3`)
  if (cd < 3) flags.push(`dark ${cd.toFixed(2)}<3`)
  if (hue < FAMILY_MIN_HUE || hue > FAMILY_MAX_HUE) flags.push(`hue ${hue.toFixed(0)}° in the red/orange/yellow family`)
  if (de2000(h, BRAND) < MIN_DE) flags.push(`only ΔE${de2000(h, BRAND).toFixed(1)} from the brand teal`)
  let nearStatus = ''
  for (const [sn, sh] of Object.entries(STATUS_TOKENS)) {
    const de = de2000(h, sh)
    if (de < MIN_DE_STATUS) flags.push(`only ΔE${de.toFixed(1)} from ${sn} ${sh}`)
    if (!nearStatus || de < nearStatus.de) nearStatus = { de, sn }
  }
  if (flags.length) { fail++; problems.push(`${n} ${h}: ${flags.join('; ')}`) }
  console.log(`${n.padEnd(12)} ${h}  ${hue.toFixed(0).padStart(3)}°   ${cw.toFixed(2).padStart(10)}      ${cd.toFixed(2).padStart(10)}${flags.length ? '   ✗ ' + flags.join('; ') : '   ✓'}   [nearest status: ${nearStatus.sn} ΔE${nearStatus.de.toFixed(1)}]`)
}
console.log('─'.repeat(96))
// pairwise distinctness
let minPair = Infinity
let minPairName = ''
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const de = de2000(hexes[names[i]], hexes[names[j]])
    if (de < minPair) { minPair = de; minPairName = `${names[i]}↔${names[j]}` }
    if (de < MIN_DE) { fail++; problems.push(`pair ${names[i]}(${hexes[names[i]]}) ↔ ${names[j]}(${hexes[names[j]]}): ΔE2000 ${de.toFixed(1)} < ${MIN_DE}`) }
  }
}
console.log(`pairwise ΔE2000 floor ${MIN_DE}: minimum pair = ${minPairName} at ΔE ${minPair.toFixed(1)}`)
// calibration reference: the OLD set's known collisions
console.log('─'.repeat(96))
console.log('calibration (the OLD S179 set — the collisions this pass retires):')
const old = { 'accent-1': '#4A9FA3', 'accent-teal': '#3D8D91', 'accent-green': '#5A9E80', 'st-operational': '#279E49', 'accent-purple': '#7C6FAE', 'st-awaiting_dev': '#75689E', 'accent-sky': '#6E9BC5', 'st-idea': '#5B8DEF' }
const oldPairs = [['accent-1', 'accent-teal'], ['accent-1', 'BRAND(=accent-1 itself)'], ['accent-green', 'st-operational'], ['accent-purple', 'st-awaiting_dev'], ['accent-sky', 'st-idea']]
for (const [a, b] of oldPairs) {
  const ha = old[a]
  const hb = b.startsWith('BRAND') ? BRAND : old[b]
  console.log(`  ${a} ${ha} ↔ ${b} ${hb}: ΔE2000 ${de2000(ha, hb).toFixed(1)}`)
}

// ---------- the drift pin: variables.css ↔ this audit ----------
try {
  const css = readFileSync(new URL('../public/css/variables.css', import.meta.url), 'utf8')
  let drift = 0
  for (const [n, h] of Object.entries(hexes)) {
    const re = new RegExp(`--ident-${n}:\\s*${h.replace('#', '#')}\\b`)
    if (!re.test(css)) { drift++; console.log(`✗ variables.css --ident-${n} does not carry ${h}`) }
  }
  const tokenCount = (css.match(/--ident-[a-z]+:/g) || []).length
  if (tokenCount !== names.length) { drift++; console.log(`✗ variables.css carries ${tokenCount} --ident-* tokens (expected ${names.length})`) }
  if (drift === 0) console.log(`✓ variables.css carries all ${names.length} --ident-* tokens at the audited hexes`)
  if (drift > 0) fail++
} catch (e) {
  console.log(`(variables.css not readable in this run: ${e.message})`)
}

console.log('─'.repeat(96))
if (fail) {
  console.log(`FAIL — ${fail} law violation(s):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('PASS — all four laws hold (contrast, family, distinctness, brand separation).')
