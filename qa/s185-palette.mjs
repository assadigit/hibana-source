// qa/s185-palette.mjs — S185 (the owner's batch-1 color round, Project Detail page).
// Derives the five-column "one family" (same lightness, same softness — the owner's
// Block 3 spec) in OKLCH, the warm-gray card border for the #F5F4F1 canvas (Block 2),
// and runs the AA checks (column inks on their new tints, prio text on bg, muted on
// the new canvas). Prints the ready-to-paste token block. Deterministic — re-run to
// re-tune: node qa/s185-palette.mjs
//
// Why OKLCH: equal OKLCH L/C across hues = perceptually equal lightness + colorfulness,
// which is exactly "the same lightness and softness for all five". Hues are taken from
// the CURRENT dots (the battle-tested semantic assignments: idea azure, planned amber,
// progress gold, done green, bug red) so only the family uniformity changes.

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const invGamma = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const [r, g, bl] = [lr, lg, lb].map((c) => Math.round(clamp01(gamma(clamp01(c))) * 255))
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')
}

function hexToOklch(hex) {
  const r = invGamma(parseInt(hex.slice(1, 3), 16) / 255)
  const g = invGamma(parseInt(hex.slice(3, 5), 16) / 255)
  const b = invGamma(parseInt(hex.slice(5, 7), 16) / 255)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const C = Math.sqrt(a * a + bb * bb)
  let H = (Math.atan2(bb, a) * 180) / Math.PI
  if (H < 0) H += 360
  return { L, C, H }
}

function relLum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => invGamma(parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [la, lb] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (la + 0.05) / (lb + 0.05)
}

// ── current state (project-header.css S88/S48 family) ─────────────────────────
const CURRENT = {
  idea:     { tint: '#EAF2FF', dot: '#5B9BFF', ink: '#5c7796', edge: '172 199 233' },
  planned:  { tint: '#FDF1E7', dot: '#F7A85B', ink: '#6b727b', edge: '209 212 216' },
  progress: { tint: '#FDF9E3', dot: '#F0C94A', ink: '#7d5a34', edge: '240 197 155' },
  done:     { tint: '#EAF7EE', dot: '#5CB176', ink: '#43704f', edge: '182 224 200' },
  bug:      { tint: '#FDEEF0', dot: '#F26A6A', ink: '#87555f', edge: '238 185 194' },
}

// ── the family: hues from the current dots; ONE lightness + ONE chroma each ──
const TINT = { L: 0.962, C: 0.018 }
const DOT = { L: 0.75, C: 0.13 }

console.log('═'.repeat(72))
console.log('S185 palette derivation — current OKLCH → the uniform family')
console.log('═'.repeat(72))
const family = {}
for (const [k, cur] of Object.entries(CURRENT)) {
  const dotO = hexToOklch(cur.dot)
  const tintO = hexToOklch(cur.tint)
  const H = dotO.H // the hue identity rides the dot
  family[k] = {
    bg: oklchToHex(TINT.L, TINT.C, H),
    dot: oklchToHex(DOT.L, DOT.C, H),
    ink: cur.ink,
    edge: cur.edge,
    H,
  }
  console.log(
    `${k.padEnd(9)} dot ${cur.dot} → oklch(${dotO.L.toFixed(3)} ${dotO.C.toFixed(3)} ${dotO.H.toFixed(0)}°)` +
    `  · tint ${cur.tint} → oklch(${tintO.L.toFixed(3)} ${tintO.C.toFixed(3)} ${tintO.H.toFixed(0)}°)`,
  )
}

// ── the warm border for the #F5F4F1 canvas (same weight as --line, warm cast) ─
const lineO = hexToOklch('#D4D4D4')
const BORDER_SOFT = oklchToHex(lineO.L - 0.005, 0.012, 90)
const PAGE_BG = '#F5F4F1'
const SURFACE = '#FFFFFF'

console.log('─'.repeat(72))
console.log(`--border-soft: ${BORDER_SOFT}  (oklch(${(lineO.L - 0.005).toFixed(3)} 0.012 90°) — ${lineO.L.toFixed(3)}L neutral #D4D4D4 warm-cast)`)
console.log(`   separation vs #FFFFFF card: ${contrast(BORDER_SOFT, SURFACE).toFixed(2)}:1 · vs page ${PAGE_BG}: ${contrast(BORDER_SOFT, PAGE_BG).toFixed(2)}:1`)
console.log(`   (old --line #D4D4D4: vs white ${contrast('#D4D4D4', SURFACE).toFixed(2)}:1 · vs page ${contrast('#D4D4D4', PAGE_BG).toFixed(2)}:1)`)
console.log(`   the card itself vs the page: ${contrast(SURFACE, PAGE_BG).toFixed(2)}:1 (the owner's measured 1.1:1)`)

// ── AA checks ─────────────────────────────────────────────────────────────────
console.log('─'.repeat(72))
console.log('AA checks (WCAG 4.5:1 = pass for text):')
// The column-title inks sit ON their tinted strips — auto-darken any that miss
// 4.5:1 on the NEW tint (OKLCH L steps, hue + chroma preserved). Session 20 tuned
// these inks on WHITE; the strip tints were always the tighter surface.
for (const [k, f] of Object.entries(family)) {
  const oldOnOld = contrast(CURRENT[k].ink, CURRENT[k].tint)
  let ink = f.ink
  let guard = 0
  while (contrast(ink, f.bg) < 4.55 && guard++ < 20) {
    const o = hexToOklch(ink)
    ink = oklchToHex(o.L - 0.008, o.C, o.H)
  }
  if (ink !== f.ink) console.log(`  ${k} ink auto-darkened for strip AA: ${f.ink} → ${ink} (was ${oldOnOld.toFixed(2)}:1 on the old tint)`)
  family[k].ink = ink
}
let allPass = true
for (const [k, f] of Object.entries(family)) {
  const inkOnTint = contrast(f.ink, f.bg)
  const ok = inkOnTint >= 4.5
  if (!ok) allPass = false
  console.log(`  ink ${f.ink} on tint ${f.bg}: ${inkOnTint.toFixed(2)}:1 ${ok ? 'PASS' : 'FAIL'}`)
}
const checks = [
  ['--prio-urgent-text #A81F42 on --prio-urgent-bg #F9DFE6', contrast('#A81F42', '#F9DFE6')],
  ['--prio-high-text #A34A26 on #FBE5DA', contrast('#A34A26', '#FBE5DA')],
  ['--prio-medium-text #7A611C on #FAF0D3', contrast('#7A611C', '#FAF0D3')],
  ['--prio-low-text #55703F on #EAF1E4', contrast('#55703F', '#EAF1E4')],
  ['--text-muted #5C5C5C on --surface #FFFFFF', contrast('#5C5C5C', '#FFFFFF')],
  ['--text-muted #5C5C5C on --page-bg #F5F4F1', contrast('#5C5C5C', PAGE_BG)],
  ['--text #141414 on --page-bg #F5F4F1', contrast('#141414', PAGE_BG)],
  ['--primary #4A9FA3 vs --surface (focus border, 3:1 UI floor)', contrast('#4A9FA3', '#FFFFFF')],
  ['UA placeholder ~#75757A on --surface #FFFFFF', contrast('#75757A', '#FFFFFF')],
]
for (const [label, ratio] of checks) {
  const floor = label.includes('3:1') ? 3 : 4.5
  const ok = ratio >= floor
  if (!ok) allPass = false
  console.log(`  ${label}: ${ratio.toFixed(2)}:1 ${ok ? 'PASS' : 'FAIL'}`)
}

// ── the ready CSS block ───────────────────────────────────────────────────────
console.log('─'.repeat(72))
console.log('The token block (variables.css :root — light):')
const css = Object.entries(family)
  .map(([k, f]) => `  --col-${k}-bg: ${f.bg};  --col-${k}-dot: ${f.dot};  --col-${k}-ink: ${f.ink};  --col-${k}-edge: ${f.edge};`)
  .join('\n')
console.log(`  --page-bg: ${PAGE_BG}; --surface: ${SURFACE}; --border-soft: ${BORDER_SOFT}; --text-muted: #5C5C5C; --primary: #4A9FA3;\n${css}`)
console.log(`\nALL CHECKS ${allPass ? 'PASS' : '*** FAIL ***'}`)
process.exit(allPass ? 0 : 1)
