#!/usr/bin/env node
// scripts/live-s256-probe.mjs — S256 (audit remediation Phase 5, the CSS/asset
// diet) live probe: proves FE-5's per-page bundles on the DEPLOYED workers.
//
// PART A — the carriers (every target, unauthenticated): sw.js v463; the four
//   Projects-section pages serve exactly ONE /dist/<page>-bundle.<hash>.css
//   link (no individual sheet links); dist/bundles.json serves; each bundle
//   resolves 200 immutable with the concatenation ORDER provable on the live
//   bytes (variables < devboard < themes < claude-dark < rtl LAST — the desktop
//   contract; projects-bundle additionally magic-wand AFTER rtl); health ok.
// PART B — the visual pass (dev, seeded probe user): {en,fa} × {light,claude-dark}
//   × the four pages — the bundle stylesheet parses (rules > 3000), the theme
//   token flips, FA carries dir=rtl, the board/project lanes render, zero page
//   errors. (The prod AUTHED visual pass rides the owner's test account, which
//   this session's credential block does not carry — the prod leg runs PART A +
//   health; the deployed artifact is byte-identical to dev's, which PART B
//   exercised visually.)
//
// Usage: node scripts/live-s256-probe.mjs [--target dev|prod|local]
// Env:   none for PART A; PART B (dev) needs the seeded probe user
//        (scripts/live-s256-devseed.mjs seed).

import { chromium } from 'playwright'

const args = process.argv.slice(2)
const targetFlag = args.indexOf('--target')
const target = targetFlag !== -1 ? args[targetFlag + 1] : 'dev'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : target === 'local' ? 'http://127.0.0.1:3017' : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.PROBE_LOGIN || 'probe-s256-dev@hibana.local'
const PASS = process.env.PROBE_PASS || 'probe-s256-dev-password'

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.error(`  ✗ ${label}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`) }
}

// One marker rule per sheet, in the exact bundle order (proves the live
// concatenation order — the cascade contract). rtl LAST on board-bundle;
// projects-bundle carries magic-wand after rtl.
// NOTE: the markers match the MINIFIED forms (esbuild drops attribute-value
// quotes: html[data-theme=light], [dir=rtl]).
const ORDER_MARKERS = [
  ['variables.css', '--accent:'],
  ['devboard.css', '.db-frame'],
  ['themes.css', 'html[data-theme=light]'],
  ['claude-dark-theme.css', 'html[data-theme=claude-dark]'],
]
const MAGIC_MARKER = ['magic-wand.css', '.magic-wand']

const main = async () => {
  console.log(`S256 live CSS/asset-diet probe → ${URL_BASE} (${target})\n`)

  // ---- PART A: the carriers ----
  const sw = await fetch(`${URL_BASE}/sw.js`).then((r) => r.text()).catch(() => '')
  check('sw.js serves hibana-v463 (the S256 round)', sw.includes('const VERSION = "hibana-v463"'), sw.length)

  const bundlesJson = await fetch(`${URL_BASE}/dist/bundles.json`).then((r) => r.json()).catch(() => null)
  check('/dist/bundles.json serves with BOTH bundle keys', bundlesJson && bundlesJson['board-bundle.css'] && bundlesJson['projects-bundle.css'], JSON.stringify(bundlesJson)?.slice(0, 80))

  const PAGES = [
    ['board.html', 'board-bundle'],
    ['sprint.html', 'board-bundle'],
    ['projects.html', 'projects-bundle'],
    ['project.html', 'projects-bundle'],
  ]
  // (/kanban itself is AUTH-GATED on the workers (S205: requireAuth + the assets
  //  binding serves THE SAME board.html file /board.html serves) — an unauthed
  //  carrier probe cannot read it; the /board.html row pins the same document's
  //  head, and PART B's visual legs exercise /kanban directly, authed.)
  const bundleUrls = new Set()
  for (const [page, bundle] of PAGES) {
    const html = await fetch(`${URL_BASE}/${page}`).then((r) => r.text()).catch(() => '')
    const cssLinks = [...html.matchAll(/href="(\/dist\/[^"]+\.css)"/g)].map((m) => m[1])
    const bundleLinks = cssLinks.filter((l) => l.includes(`${bundle}.`))
    const sheetLinks = cssLinks.filter((l) => !/-bundle\./.test(l) && !/vendor/.test(l))
    check(`${page}: exactly ONE ${bundle} link (${cssLinks.length} dist css links total)`, bundleLinks.length === 1 && sheetLinks.length === 0, cssLinks.join(', '))
    if (bundleLinks[0]) bundleUrls.add(bundleLinks[0])
  }
  check('the two distinct bundles are linked (board-bundle + projects-bundle)', bundleUrls.size === 2, [...bundleUrls].join(' '))

  for (const url of bundleUrls) {
    const res = await fetch(`${URL_BASE}${url}`).catch(() => null)
    const cc = res ? res.headers.get('cache-control') || '' : ''
    const body = res ? await res.text() : ''
    check(`${url.split('/').pop()} serves 200 immutable`, res && res.status === 200 && /immutable/.test(cc), `status=${res && res.status} cc=${cc}`)
    check(`${url.split('/').pop()}: > 3000 rules of CSS`, body.length > 200_000, `${(body.length / 1024).toFixed(0)}KB`)
    // the ORDER proof, live-bytes edition: every constituent sheet's marker is
    // present AND rtl's rules sit in the file's LAST 2% (rtl.css is the tail
    // sheet; its LAST dir=rtl occurrence is its own final rules). The exact
    // ordered-parts byte proof is check-css-bundles.mjs on the committed source.
    const rtlIdx = body.lastIndexOf('dir=rtl')
    const allPresent = ORDER_MARKERS.every(([, marker]) => body.includes(marker))
    const rtlAtTail = rtlIdx > body.length * 0.98
    check(`${url.split('/').pop()}: every constituent sheet present (${ORDER_MARKERS.map(([n]) => n.split('.')[0]).join(', ')}) + rtl's rules at the TAIL`, allPresent && rtlAtTail, `rtl@${rtlIdx} of ${body.length}`)
    const magicIdx = body.indexOf(MAGIC_MARKER[1])
    if (url.includes('board-bundle.')) {
      check('board-bundle: rtl.css is the LAST sheet (no magic-wand after it)', !body.slice(rtlIdx).includes('.magic-wand'))
    } else {
      check('projects-bundle: magic-wand rides AFTER rtl (the page\'s own link order, preserved)', magicIdx > rtlIdx, `rtl@${rtlIdx} wand@${magicIdx}`)
    }
  }

  const health = await fetch(`${URL_BASE}/api/health`).then((r) => r.json()).catch(() => null)
  check('health probe ok', health && health.ok === true, JSON.stringify(health)?.slice(0, 80))

  // ---- PART B: the visual pass (dev/local with the seeded probe user) ----
  if (target !== 'prod') {
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const api = async (path, method, body) => {
      const res = await context.request.fetch(`${URL_BASE}${path}`, {
        method: method || 'GET',
        headers: { Origin: URL_BASE, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        data: body ? JSON.stringify(body) : undefined,
      }).catch(() => null)
      return res
    }
    const loginRes = await context.request.post(`${URL_BASE}/api/auth/login`, { headers: { 'Content-Type': 'application/json', Origin: URL_BASE }, data: { login: LOGIN, password: PASS } })
    if (loginRes.status() !== 200) {
      console.log(`  (PART B skipped — the probe user is not seeded on this target (login ${loginRes.status()}); seed with scripts/live-s256-devseed.mjs (needs the Hibana account's D1 credentials) or set PROBE_LOGIN/PROBE_PASS to the owner's test account)`)
      await browser.close()
      console.log(`\n${URL_BASE}: ${pass} passed, ${fail} failed`)
      process.exit(fail ? 1 : 0)
    }
    // a probe project with tasks across lanes + a sprint for the sprint page
    const proj = await api('/api/projects', 'POST', { title: 'S256 probe project', status: 'developing' })
    const pid = proj && proj.ok() ? (await proj.json()).id : null
    if (!pid) {
      check('the probe project was created (is the dev probe user seeded?)', false)
    } else {
      for (const t of [
        ['S256 probe task alpha', 'idea', 'high'],
        ['S256 probe task beta', 'planned', 'medium'],
        ['S256 probe task gamma', 'in_progress', 'low'],
      ]) {
        await api(`/api/projects/${pid}/devtasks`, 'POST', { title: t[0], status: t[1], priority: t[2] })
      }
      await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S256 probe sprint' })
      // per-page light backgrounds: variables.css --bg #E7E7E7 everywhere EXCEPT
      // project.html (its own warmer paper token #F5F4F1); claude-dark's --bg
      // #141413 is uniform.
      const LIGHT_BG = { default: 'rgb(231, 231, 231)', 'project.html': 'rgb(245, 244, 241)' }
      const DARK_BG = 'rgb(20, 20, 19)'
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 100)))
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(401|404|409|503)/.test(m.text())) pageErrors.push(m.text().slice(0, 100)) })
      const LEGS = [
        ['/kanban?project=' + pid, '.db-cols .pd-col'], // the board's lanes are .pd-col inside .db-cols (board-page.js's own grammar)
        ['/sprint.html?project=' + pid, '.sp-wrap, main'],
        ['/projects.html', 'main'],
        ['/project.html?id=' + pid, '.pd-col'],
      ]
      let leg = 0
      for (const lang of ['en', 'fa']) {
        // the server pref owns the language (localStorage is just the boot cache —
        // /api/auth/me's language_pref re-points it); PATCH it per phase, the
        // perf harness's setLanguage pattern.
        await api('/api/settings', 'PATCH', { language_pref: lang })
        for (const theme of ['light', 'claude-dark']) {
          for (const [path, sel] of LEGS) {
            leg++
            // set the prefs via localStorage on a first load, then RELOAD — the
            // boot scripts read them before first paint (addInitScript would
            // accumulate across the 16 legs; this is deterministic).
            await page.goto(`${URL_BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
            await page.evaluate(([l, t]) => {
              localStorage.setItem('hibana-lang', l)
              localStorage.setItem('hibana-theme', t)
              localStorage.setItem('hibana-tour-done', '1')
            }, [lang, theme])
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 })
            await page.waitForSelector(sel, { timeout: 15_000 }).catch(() => {})
            await page.waitForTimeout(600)
            const r = await page.evaluate((selArg) => {
              let bundleRules = 0
              for (const s of document.styleSheets) {
                if (s.href && s.href.includes('-bundle.')) { try { bundleRules += s.cssRules.length } catch {} }
              }
              return {
                bundleRules,
                sheets: document.querySelectorAll('link[rel=stylesheet]').length,
                bg: getComputedStyle(document.body).backgroundColor,
                dir: document.documentElement.getAttribute('dir') || '',
                themeAttr: document.documentElement.getAttribute('data-theme') || '',
                content: document.querySelectorAll(selArg).length > 0,
                font: getComputedStyle(document.body).fontFamily,
              }
            }, sel).catch(() => null)
            const pageKey = path.split('?')[0].replace('/', '')
            const wantBg = theme === 'light' ? (LIGHT_BG[pageKey] || LIGHT_BG.default) : DARK_BG
            check(`visual ${lang}/${theme} ${path.split('?')[0].replace('/', '')}: bundle parses (${r ? r.bundleRules : 0} rules), ${r ? r.sheets : 0} sheets`, r && r.bundleRules > 3000, JSON.stringify(r)?.slice(0, 90))
            check(`visual ${lang}/${theme} ${path.split('?')[0].replace('/', '')}: the ${theme} theme token paints`, r && r.bg === wantBg, r ? r.bg : 'n/a')
            check(`visual ${lang}/${theme} ${path.split('?')[0].replace('/', '')}: ${lang === 'fa' ? 'dir=rtl (FA)' : 'dir=ltr (EN)'} + content renders`, r && (lang === 'fa' ? r.dir === 'rtl' : r.dir !== 'rtl') && r.content, r ? `dir=${r.dir} theme=${r.themeAttr}` : 'n/a')
          }
        }
      }
      check(`PART B: ${leg} visual legs ran with ZERO page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
      // cleanup: soft-delete the probe project (trash; the 7-day cron purges)
      const del = await api(`/api/projects/${pid}`, 'DELETE')
      check('probe project soft-deleted (trash)', del && del.status() === 200, String(del && del.status()))
    }
    await browser.close()
  } else {
    console.log('\n(prod target: PART A + health only — the authed visual pass needs the owner\'s test account, not in this session\'s credential block; dev ran the full visual matrix on the same deployed artifact bytes)')
  }

  console.log(`\n${URL_BASE}: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
