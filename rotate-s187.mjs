// rotate-s187.mjs — the S187 cache-bust rotation (sandbox-local helper).
// Bumps the ?v= of every asset touched by the to-do empty-state round:
//   app.js v217→218 (×24 pages), i18n-en.js v92→93 (×26), i18n.js v146→147 (×26),
//   dashboard-todo.css v23→24 (×23), dashboard.css v38→39 (×23),
//   sadhana-page.js v13→14 (×1), sadhana-board.css v24→25 (×1),
//   + the i18n-fa.js?v=86→87 lazy literal inside i18n.js (3 occurrences).
// Run once, then `node scripts/check-cache-bust.mjs` must PASS.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PUB = '/home/z/hibana/public'
const BUMPS = [
  ['js/app.js?v=217', 'js/app.js?v=218'],
  ['js/i18n-en.js?v=92', 'js/i18n-en.js?v=93'],
  ['js/i18n.js?v=146', 'js/i18n.js?v=147'],
  ['css/dashboard-todo.css?v=23', 'css/dashboard-todo.css?v=24'],
  ['css/dashboard.css?v=38', 'css/dashboard.css?v=39'],
  ['js/sadhana-page.js?v=13', 'js/sadhana-page.js?v=14'],
  ['css/sadhana-board.css?v=24', 'css/sadhana-board.css?v=25'],
]

const htmls = readdirSync(PUB).filter((f) => f.endsWith('.html'))
const counts = Object.fromEntries(BUMPS.map(([, b]) => [b, 0]))
for (const f of htmls) {
  const p = join(PUB, f)
  let txt = readFileSync(p, 'utf8')
  for (const [oldRef, newRef] of BUMPS) {
    if (txt.includes(oldRef)) {
      counts[newRef] += txt.split(oldRef).length - 1
      txt = txt.split(oldRef).join(newRef)
    }
  }
  writeFileSync(p, txt)
}
for (const [ref, n] of Object.entries(counts)) console.log(`${ref}: ${n} page refs`)

// the lazy i18n-fa literal inside i18n.js (injection path + comments)
const ij = join(PUB, 'js/i18n.js')
let itxt = readFileSync(ij, 'utf8')
const faOld = "i18n-fa.js?v=86"
const faNew = "i18n-fa.js?v=87"
const faN = itxt.split(faOld).length - 1
itxt = itxt.split(faOld).join(faNew)
writeFileSync(ij, itxt)
console.log(`${faNew}: ${faN} literals in i18n.js`)

// verify: no stale refs remain anywhere
let stale = 0
for (const f of htmls) {
  const txt = readFileSync(join(PUB, f), 'utf8')
  for (const [oldRef] of BUMPS) if (txt.includes(oldRef)) { console.error(`STALE ${oldRef} in ${f}`); stale++ }
}
if (readFileSync(ij, 'utf8').includes(faOld)) { console.error(`STALE ${faOld} in i18n.js`); stale++ }
console.log(stale === 0 ? 'ROTATION CLEAN' : `STALE REFS: ${stale}`)
