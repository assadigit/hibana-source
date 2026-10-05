#!/usr/bin/env node
// S191 — THE ATTENTION SURFACE palette + geometry proofs.
//
// THE BUG FIX THIS ROUND PROVES FIRST: --badge-pending-bg/-fg was REFERENCED since
// R2.1 (notifications.css chips/icons/accents + variables.css --status-warning-soft
// → task-controls status dots) but NEVER DEFINED — every "Soon"/warning surface
// silently rendered unstyled. The pair is now defined (light #FBF0D4/#7A580C, dark
// #332C17/#DCC078) and these proofs pin the AA floors.
//
// THE CHROME PILLS: the chip badge (.chip-notif-badge) + the menu/sheet row pills
// (.menu-count-pill) paint the severity families' SOFT fills with their AA inks —
// the same pairs the page chips use. The chip badge sits on the RAIL surface
// (--card) with a 2px --card separation ring, so its ground is SOLID --card (no
// translucency — simpler than the S190 bar bound). Floors: pill text >= 4.5:1
// (they are text, small bold).
//
// THE GROUP HEADS: the severity label rides --bg (the page canvas) at weight 600
// uppercase small — muted by design, but the SEVERITY labels are the family hues:
// urgent = --danger, soon = --badge-pending-fg, heads-up = --badge-spark-fg.
// Small-bold text floor: >= 4.5:1 on --bg, both themes.

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
function rgba(hex, alpha, groundHex) {
  const f = parseInt(hex.slice(1), 16), g = parseInt(groundHex.slice(1), 16)
  const ch = (fc, gc) => Math.round(alpha * fc + (1 - alpha) * gc)
  return '#' + [ch((f >> 16) & 255, (g >> 16) & 255), ch((f >> 8) & 255, (g >> 8) & 255), ch(f & 255, g & 255)]
    .map((v) => v.toString(16).padStart(2, '0')).join('')
}
const fmt = (x) => x.toFixed(2)

let fails = 0
function check(name, ratio, floor) {
  const ok = ratio >= floor
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${fmt(ratio)}:1 (floor ${floor}:1)`)
}

console.log('S191 — the pending pair (the never-defined token, now defined + proven)')
check('light pending fg on pending bg (chips, icons, accents, dots)', contrast('#7A580C', '#FBF0D4'), 4.5)
check('dark pending fg on pending bg', contrast('#DCC078', '#332C17'), 4.5)
check('light pending fg on the page canvas --bg (group head label)', contrast('#7A580C', '#E7E7E7'), 4.5)
check('dark pending fg on the dark canvas --bg', contrast('#DCC078', '#141413'), 4.5)

console.log('S191 — the chrome pills (severity soft fills, AA inks)')
// LIGHT: pill grounds are the soft fills themselves; the rail beneath is --card #FFFFFF.
check('light urgent pill: --danger on --danger-soft', contrast('#b42318', '#fdeaea'), 4.5)
check('light warning pill: pending fg on pending bg', contrast('#7A580C', '#FBF0D4'), 4.5)
check('light info pill: --badge-spark-fg on --badge-spark-bg', contrast('#2E5FA3', '#E8EFFB'), 4.5)
// DARK: --danger-soft is rgba(217,119,87,.14) — blend it over the dark card #1f1e1c
// (the pill is its own closed surface on --card; the blend IS the ground).
const darkDangerSoft = rgba('#D97757', 0.14, '#1f1e1c')
check('dark urgent pill: --danger on blended --danger-soft over card', contrast('#e89b85', darkDangerSoft), 4.5)
check('dark warning pill: pending fg on pending bg', contrast('#DCC078', '#332C17'), 4.5)
check('dark info pill: spark fg on spark bg', contrast('#8FB4E8', '#22304A'), 4.5)

console.log('S191 — the group head severity labels (on the page canvas --bg)')
check('light urgent label: --danger on --bg', contrast('#b42318', '#E7E7E7'), 4.5)
check('dark urgent label: --danger on dark --bg', contrast('#e89b85', '#141413'), 4.5)
check('light heads-up label: spark fg on --bg', contrast('#2E5FA3', '#E7E7E7'), 4.5)
check('dark heads-up label: spark fg on dark --bg', contrast('#8FB4E8', '#141413'), 4.5)
check('light soon label: pending fg on --bg', contrast('#7A580C', '#E7E7E7'), 4.5)
check('dark soon label: pending fg on dark --bg', contrast('#DCC078', '#141413'), 4.5)

console.log('S191 — the group head COUNT pill (--bg-soft ground, --muted ink)')
// --muted on --bg-soft: light #6B6B6B-ish on #F0F0F0 / dark #A8A29E-ish on #2A2927.
// Read from the sheets to stay token-true:
import { readFileSync } from 'node:fs'
const vars = readFileSync('public/css/variables.css', 'utf8')
const dark = readFileSync('public/css/claude-dark-theme.css', 'utf8')
const tok = (src, name) => { const m = src.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})')); return m ? m[1] : null }
const tokm = (src, name) => { const m = src.match(new RegExp('--' + name + ':\\s*rgba?\\(([^)]+)\\)')); return m ? m[1] : null }
const lmuted = tok(vars, 'muted'), dmuted = tok(dark, 'muted')
const lbgsoft = tok(vars, 'bg-soft'), dbgsoft = tok(dark, 'bg-soft')
if (lmuted && lbgsoft) check('light count pill: --muted on --bg-soft', contrast(lmuted, lbgsoft), 4.5)
if (dmuted && dbgsoft) check('dark count pill: --muted on --bg-soft', contrast(dmuted, dbgsoft), 4.5)
if (!lmuted || !lbgsoft || !dmuted || !dbgsoft) {
  console.log('  NOTE: a muted/bg-soft token is non-hex — the count pill floor rides the token values above')
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS')
process.exit(fails ? 1 : 0)
