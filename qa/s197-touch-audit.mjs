#!/usr/bin/env node
// qa/s197-touch-audit.mjs — S197 (Track B: UI/UX) THE TOUCH + OPTICAL ROUND's
// measuring stick. The S196 banked audit counted VISUAL boxes only
// (getBoundingClientRect under a coarse-pointer emulation) — but the app has an
// established recipe for compact controls: the padded ::after HIT RING (base.css
// .theme-floater/.pw-toggle/.ghost.danger, dashboard-todo.css .qa-btn), which a
// rect-only probe cannot see. This audit measures the REAL tap law:
//
//   1. BOX       — getBoundingClientRect of the button (the visual box).
//   2. HIT       — elementFromPoint compass probes outward from the box edge in
//                  1px steps, all 8 directions, worst direction wins → the
//                  EFFECTIVE hit area (the ::after ring counts: pseudo-element
//                  boxes hit-test as their originating element).
//   3. STROKE    — the rendered icon's computed stroke-width × rendered px / 24
//                  viewBox = the EFFECTIVE stroke in device px (the S195 probe's
//                  math; ≥~1.3px reads solid, ~0.9px reads as a ghost hairline).
//
//   Measured TWICE per control: pointer:fine (the default) and pointer:coarse
//   (CDP Emulation.setEmulatedMedia) — the coarse pass is the app's own
//   documented 40px floor (misc.css @media (pointer: coarse)).
//
// Usage (QA server on 3017, canonical tree):
//   node qa/s197-touch-audit.mjs [--floor 40]
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:3017'
const FLOOR = Number(process.argv.includes('--floor') ? process.argv[process.argv.indexOf('--floor') + 1] : 40)

// The exact template markup of every banked-offender control (copied verbatim
// from the pages/controllers that render them — the CSS cascade is the real one:
// login.html's sheets + the owning sheets injected in page-realistic order).
const SHEETS = [
  '/css/notes.css', '/css/dashboard.css', '/css/dashboard-todo.css',
  '/css/to-do-list.css', '/css/task-controls.css', '/css/calendar.css',
  '/css/sadhana-board.css', '/css/quicknotes.css', '/css/misc.css',
]
const ICON = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
const PLUS = ICON('M12 5v14M5 12h14')
const X = ICON('M6 6l12 12M18 6L6 18')
const EYE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'

// [id, markup, {static:true → neutralize position:absolute/fixed for probing}]
const CONTROLS = [
  ['pw-toggle (login)', `<div class="pw-field" style="width:220px"><input type="password" style="width:200px"><button type="button" class="pw-toggle">${EYE}</button></div>`],
  ['theme-floater', `<button class="theme-floater" style="position:relative">${ICON('M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4')}</button>`, { static: true }],
  ['vault-sec-add', `<button type="button" class="vault-sec-add">${PLUS}</button>`],
  ['qa-btn (composer FAB)', `<button type="button" class="qa-btn">${PLUS}</button>`],
  ['.note-add .qa-btn', `<div class="note-add" style="display:flex;width:300px"><input style="flex:1;min-width:0"><button type="button" class="qa-btn">${PLUS}</button></div>`],
  ['q-fab (sadhana)', `<div class="sadhana-wrap"><button type="button" class="q-fab" style="position:relative">＋</button></div>`, { static: true }],
  ['q-pen (sadhana)', `<div class="sadhana-wrap"><div class="q-title-row"><button type="button" class="q-pen"><svg class="q-pen-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/></svg></button></div></div>`],
  ['zen-btn (sadhana)', `<div class="sadhana-wrap"><button class="zen-btn"><svg class="zen-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="1"/></svg></button></div>`],
  ['pd-cat-swatch-tile', `<div class="pd-cat-swatches"><button type="button" class="pd-cat-swatch-tile" style="background:#e8d5c4;color:#3a3226"><span aria-hidden="true">Aa</span></button><button type="button" class="pd-cat-swatch-tile" style="background:#d4ddd0;color:#2e3a2c"><span aria-hidden="true">Aa</span></button></div>`],
  ['dash-vault-dismiss', `<div style="position:relative;width:280px"><button type="button" class="dash-vault-dismiss" style="position:relative">${X}</button></div>`, { static: true }],
  ['task-note-delete', `<button type="button" class="ghost task-note-delete">${X}</button>`],
  ['cal-note-x', `<div class="cal-day-note"><span class="cal-note-glyph">📝</span><span class="cal-day-note-text">note text</span><button type="button" class="cal-note-x">✕</button></div>`],
]

const measure = (el) => {
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  // compass probes: max outward distance (1px steps, worst of 8 directions) where
  // elementFromPoint still resolves to the button (or a descendant)
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
  const reaches = []
  for (const [dx, dy] of dirs) {
    let d = 0
    for (let step = 1; step <= 24; step++) {
      const px = cx + dx * (r.width / 2 + step), py = cy + dy * (r.height / 2 + step)
      if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) break
      const hit = document.elementFromPoint(px, py)
      if (!(hit === el || (hit && el.contains(hit)))) break
      d = step
    }
    reaches.push(d)
  }
  const worst = Math.min(...reaches)
  // icon: first svg descendant (or self) — rendered px + computed stroke-width
  let icon = null
  const svg = el.matches('svg') ? el : el.querySelector('svg')
  if (svg) {
    const sr = svg.getBoundingClientRect()
    const sw = parseFloat(getComputedStyle(svg).strokeWidth || '0')
    icon = { px: Math.round(sr.width * 10) / 10, sw, eff: Math.round(sw * sr.width / 24 * 100) / 100 }
  }
  return { box: [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10], ring: worst, icon }
}

async function runPass(page, mode) {
  const rows = []
  for (let i = 0; i < CONTROLS.length; i++) {
    const [id] = CONTROLS[i]
    const el = page.locator(`#s197-host [data-c="c${i}"]`)
    // pw-toggle is the button INSIDE the pw-field; the note-add row targets its button
    const target = id.startsWith('pw-toggle') || id.startsWith('.note-add')
      ? el.locator('button').last()
      : id.startsWith('pd-cat-swatch')
        ? el.locator('button').first()
        : el.locator(id.includes('q-pen (') ? '.q-pen' : id.includes('zen-btn') ? '.zen-btn' : id.includes('q-fab') ? '.q-fab' : id.includes('task-note-delete') ? '.task-note-delete' : id.includes('cal-note-x') ? '.cal-note-x' : 'button').first()
    const m = await target.evaluate(measure)
    const hit = [Math.round((m.box[0] + 2 * m.ring) * 10) / 10, Math.round((m.box[1] + 2 * m.ring) * 10) / 10]
    rows.push({ id, mode, box: m.box, ring: m.ring, hit, icon: m.icon })
  }
  return rows
}

const browser = await chromium.launch()

// TWO contexts: the fine-pointer world (default) and the coarse-pointer world
// (hasTouch — the ONLY reliable pointer:coarse emulation: Chromium's CDP
// setEmulatedMedia ignores the 'pointer' feature; a hasTouch context sets it
// natively, so the app's own @media (pointer: coarse) floors engage for real).
async function prepare(page) {
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' })
  // inject the owning sheets (login carries base/components/quicknotes already)
  await page.evaluate((sheets) => {
    for (const href of sheets) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = href
      document.head.appendChild(l)
    }
  }, SHEETS)
  await page.waitForTimeout(400)
  // the scratch host — real markup, real cascade, big row gaps so rings never
  // steal from a neighbor (the probe measures ONE control at a time)
  await page.evaluate((controls) => {
    const host = document.createElement('div')
    host.id = 's197-host'
    host.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483000;display:grid;gap:56px;padding:24px;background:var(--card);font:inherit'
    controls.forEach((c, i) => {
      const row = document.createElement('div')
      row.dataset.c = 'c' + i
      row.innerHTML = c[1]
      host.appendChild(row)
    })
    document.body.appendChild(host)
  }, CONTROLS)
}

const finePage = await browser.newPage({ viewport: { width: 1280, height: 2400 } })
await prepare(finePage)
const fine = await runPass(finePage, 'fine')

const coarseCtx = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 2400 } })
const coarsePage = await coarseCtx.newPage()
await prepare(coarsePage)
const coarseMatch = await coarsePage.evaluate(() => matchMedia('(pointer: coarse)').matches)
if (!coarseMatch) { console.error('FATAL: hasTouch context did not set pointer:coarse'); process.exit(1) }
const coarse = await runPass(coarsePage, 'coarse')

await browser.close()

// ---- report ----
const fmt = (v) => (v == null ? '—' : `${v}px`)
console.log(`\nS197 touch+optical audit — floor ${FLOOR}px (coarse) · effective stroke target ≥1.3px\n`)
console.log('control'.padEnd(26) + 'mode   box            ring    HIT            icon(px/sw/eff)   verdict')
let fails = 0
for (const r of [...fine, ...coarse]) {
  const hitMin = Math.round(Math.min(r.hit[0], r.hit[1]) * 10) / 10
  const icon = r.icon ? `${r.icon.px}/${r.icon.sw}/${r.icon.eff}` : '—'
  const verdict = r.mode === 'coarse'
    ? hitMin >= FLOOR ? 'PASS' : `FAIL (${hitMin} < ${FLOOR})`
    : r.icon && r.icon.eff < 1.1 && r.icon.px > 0 ? 'OPTICAL-FAIL' : 'fine-ok'
  if (verdict.startsWith('FAIL') || verdict === 'OPTICAL-FAIL') fails++
  console.log(
    r.id.padEnd(26) + r.mode.padEnd(7) +
    `${r.box[0]}×${r.box[1]}`.padEnd(15) + fmt(r.ring).padEnd(8) +
    `${r.hit[0]}×${r.hit[1]}`.padEnd(15) + icon.padEnd(18) + verdict,
  )
}
console.log(`\n${fails === 0 ? 'ALL GREEN' : fails + ' failing measurements'} (coarse floor ${FLOOR}px; optical floor 1.1px effective stroke)`)
process.exit(fails === 0 ? 0 : 1)
