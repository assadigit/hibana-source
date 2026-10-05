#!/usr/bin/env node
// S190 — the mobile bottom-bar active-shape palette proof (the s189-rail-active.mjs
// pattern, extended to the bar's TRANSLUCENT surface).
//
// THE SURFACE (the one thing that differs from the rail): the bar paints
//   background: color-mix(in srgb, var(--card) 92%, transparent) + backdrop blur
// so the tint's ground is NOT a solid card — it is 92% card composited over whatever
// sits behind the bar. The bound: the underlying content can shift the effective
// ground at most 8% toward its own color. The proofs below run the tint over the
// NOMINAL ground (the page canvas --bg behind the bar) AND the two worst-case
// bounds (pure black behind the light bar / pure white behind the dark bar — the
// far ends any content can pull the ground toward). The icon >= 3:1 non-text floor
// and the label >= 4.5:1 text floor must hold on ALL of them, both themes.
//
// THE CONTRACT (the S189 family, reused verbatim):
//   shape  = #2F7B7F @14% light / #8FCCCF @20% dark (alpha on the COLOR only)
//   icon   = #2F7B7F light / #8FCCCF dark
//   label  = #1F5A5D light / #9AD4D7 dark
// (The More sheet's active row rides the SOLID --card surface — the exact S189
//  blend, already proven there; only the BAR needs the translucent bound.)

function srgb(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function lum(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}
function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
function blend(fgHex, alpha, groundHex) {
  const f = parseInt(fgHex.slice(1), 16), g = parseInt(groundHex.slice(1), 16)
  const ch = (fc, gc) => Math.round(alpha * fc + (1 - alpha) * gc)
  return '#' + [ch((f >> 16) & 255, (g >> 16) & 255), ch((f >> 8) & 255, (g >> 8) & 255), ch(f & 255, g & 255)]
    .map((v) => v.toString(16).padStart(2, '0')).join('')
}
// The bar's 92% card over the underlying content — the effective ground bound.
function barGround(cardHex, underlyingHex) { return blend(cardHex, 0.92, underlyingHex) }

let fail = 0
const check = (name, got, need) => {
  const ok = typeof need === 'string' ? got === need : got >= need
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${got}${typeof need === 'string' ? '' : ` (need >= ${need})`}`)
  if (!ok) fail++
}

console.log('=== LIGHT — bar = 92% #FFFFFF card over the ground ===')
const lightGrounds = {
  'nominal (canvas #E7E7E7 behind)': barGround('#FFFFFF', '#E7E7E7'),
  'worst case (black #000000 behind)': barGround('#FFFFFF', '#000000'),
}
for (const [label, ground] of Object.entries(lightGrounds)) {
  const tint = blend('#2F7B7F', 0.14, ground)
  console.log(`\n  ground ${label} = ${ground} → shape ${tint}`)
  check(`icon #2F7B7F on the bar tint (3:1)`, contrast('#2F7B7F', tint), 3)
  check(`label #1F5A5D on the bar tint (4.5:1)`, contrast('#1F5A5D', tint), 4.5)
}

console.log('\n=== DARK — bar = 92% #1f1e1c card over the ground ===')
const darkGrounds = {
  'nominal (canvas #141413 behind)': barGround('#1f1e1c', '#141413'),
  'worst case (white #FFFFFF behind)': barGround('#1f1e1c', '#FFFFFF'),
}
for (const [label, ground] of Object.entries(darkGrounds)) {
  const tint = blend('#8FCCCF', 0.20, ground)
  console.log(`\n  ground ${label} = ${ground} → shape ${tint}`)
  check(`icon #8FCCCF on the bar tint (3:1)`, contrast('#8FCCCF', tint), 3)
  check(`label #9AD4D7 on the bar tint (4.5:1)`, contrast('#9AD4D7', tint), 4.5)
}

console.log('\n=== The More sheet row (solid --card — the S189 blend, re-proven) ===')
check('light: row label #1F5A5D on the solid tint', contrast('#1F5A5D', blend('#2F7B7F', 0.14, '#FFFFFF')), 4.5)
check('light: row icon #2F7B7F on the solid tint', contrast('#2F7B7F', blend('#2F7B7F', 0.14, '#FFFFFF')), 3)
check('dark: row label #9AD4D7 on the solid tint', contrast('#9AD4D7', blend('#8FCCCF', 0.20, '#1f1e1c')), 4.5)
check('dark: row icon #8FCCCF on the solid tint', contrast('#8FCCCF', blend('#8FCCCF', 0.20, '#1f1e1c')), 3)

console.log(fail === 0 ? '\nS190 mobile-active palette: ALL PASS' : `\nS190 mobile-active palette: ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
