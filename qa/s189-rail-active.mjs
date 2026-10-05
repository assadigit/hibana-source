#!/usr/bin/env node
// S189 (CHANGE 7) — the rail active-shape palette derivation + AA proof.
// The derivation record for the --nav-active-* family (variables.css light +
// claude-dark-theme.css dark twins); the same math rides CI as the
// identity-palette S189 block (src/tests/identity-palette.test.ts) — this
// script is the human-runnable twin (the qa/s185-palette.mjs pattern).
//
// THE CONTRACT (the owner's CHANGE 7):
//   shape  = #2F7B7F at 14% light / the lighter #8FCCCF at 20% dark
//            (alpha on the background COLOR only — never the opacity property)
//   icon   = the full #2F7B7F light / #8FCCCF dark          (>= 3:1 on the tint)
//   label  = #1F5A5D light / #9AD4D7 dark                    (>= 4.5:1 on the tint)
//   hover  = the same teal at 7% light / 10% dark (inactive), 18%/25% (active:hover)

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

let fail = 0
const check = (name, got, need) => {
  const ok = typeof need === 'string' ? got === need : got >= need
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${got}${typeof need === 'string' ? '' : ` (need >= ${need})`}`)
  if (!ok) fail++
}

console.log('=== LIGHT (rail surface --card #FFFFFF) ===')
const lightTint = blend('#2F7B7F', 0.14, '#FFFFFF')
console.log(`shape #2F7B7F @14% over #FFFFFF = ${lightTint}`)
check('icon #2F7B7F on the tint (3:1 non-text floor)', contrast('#2F7B7F', lightTint), 3)
check('label #1F5A5D on the tint (4.5:1 text floor)', contrast('#1F5A5D', lightTint), 4.5)
check('label #1F5A5D on the bare card', contrast('#1F5A5D', '#FFFFFF'), 4.5)

console.log('\n=== DARK (rail surface --card #1f1e1c) ===')
const darkTint = blend('#8FCCCF', 0.20, '#1f1e1c')
console.log(`shape #8FCCCF @20% over #1f1e1c = ${darkTint}`)
check('icon #8FCCCF on the dark tint (3:1)', contrast('#8FCCCF', darkTint), 3)
check('label #9AD4D7 on the dark tint (4.5:1)', contrast('#9AD4D7', darkTint), 4.5)
check('label #9AD4D7 on the bare dark card (4.5:1)', contrast('#9AD4D7', '#1f1e1c'), 4.5)

console.log(fail === 0 ? '\nS189 palette: ALL PASS' : `\nS189 palette: ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
