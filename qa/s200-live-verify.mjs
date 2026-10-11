#!/usr/bin/env node
// qa/s200-live-verify.mjs — S200 (SPEED + DIET) live proof.
// The round changed 12 CSS bundles + 3 JS (i18n-en, i18n-fa, i18n.js's injected
// literal) + sw.js (v434: the SHELL's Login.webp swap) + Login.webp itself + the
// shell pages' HTML (skip-link, aria-labels, preloads). The LIVE proof:
//   1. each page's wired /dist/<name>.<hash>.css|js ref resolves and is
//      BYTE-IDENTICAL to the canonical local build;
//   2. the live bundles carry the round's own grammar (minifier-agnostic probes):
//      --accent-ink in variables + claude-dark + dashboard's converted label,
//      the dead .precent*/.topbar-search families GONE, the q-pen/cal-note-x hit
//      rings, quicknotes' Login.webp url, the qeSymbol/qeEmpty i18n keys;
//   3. sw.js VERSION = hibana-v434 AND the SHELL precaches /Login.webp;
//   4. /Login.webp itself: byte-identical + served as image/webp;
//   5. the shell pages' HTML carries the skip-link + the aria-labels;
//   6. health ok/up/63 (no migration this round).
// RUN WITH THE TREE IN WIRED FORM (node scripts/build.mjs --prod --wire-html;
// --restore-html after) — i18n.js embeds its lazy i18n-fa literal, which the wire
// step rewrites to /dist/i18n-fa.<hash>.js (the S191/S193/S199 verifier lesson).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v434'
const EXPECT_SCHEMA = '63'

// the round's assets + one canonical page each that loads them (login carries the
// i18n trio + the auth sheets; dashboard the app chrome + misc; notes/sadhana their
// sheets — verifier lesson: check the page actually LINKS the sheet before probing)
const PAGE_TARGETS = {
  'login.html': ['variables', 'themes', 'claude-dark-theme', 'layout', 'quicknotes', 'i18n-en', 'i18n'],
  'dashboard.html': ['dashboard', 'dashboard-todo', 'to-do-list', 'calendar', 'misc'],
  'notes.html': ['notes'],
  'sadhana.html': ['sadhana-board'],
}

// minifier-agnostic probes (must-survive) + must-NOT-contain (the diet's gone
// families). NOTE the minifier's own grammar: custom-property values KEEP the
// space after the colon (--accent-ink: #297073, not :#), and esbuild escapes
// non-ASCII as \uXXXX — so the fa-dictionary probe keys on the KEY NAME, not the
// Persian value (the first S200 verifier pass got both of these wrong).
const CONTENT_PROBES = {
  variables: { has: ['--accent-ink: #297073'] },
  themes: { has: ['--accent-ink: #297073'] },
  'claude-dark-theme': { has: ['--accent-ink: #d9997f'] },
  dashboard: { has: ['var(--accent-ink)'], lacks: ['precent-head', 'precent-row'] },
  layout: { lacks: ['topbar-search', 'rail-cal-legend'] },
  quicknotes: { has: ['Login.webp'], lacks: ['lang-check'] },
  notes: { lacks: ['vault-move-row'] },
  'to-do-list': { lacks: ['progress-label'] },
  'i18n-en': { has: ['Pick a symbol'] },
  'sadhana-board': { has: ['q-pen'] },
  calendar: { has: ['cal-note-x'] },
  misc: { lacks: ['precent-all'] },
  'dashboard-todo': { lacks: ['activity-more'] },
  i18n: { has: ['i18n-fa'] },
}
// i18n-fa's new keys verified via the manifest-discovered bundle (it's injected,
// never wired into HTML — the S199 lesson on lazy assets). esbuild escapes the
// Persian VALUES as \uXXXX, so the probes key on the KEY NAMES.
const MANIFEST_ONLY = {
  'i18n-fa': { has: ['sadhana.qeSymbol', 'sadhana.qeEmpty'] },
}

const results = []
let fail = false

const localFile = (prefix, ext) =>
  readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && f.endsWith(ext)) || null

const check = async (label, liveUrl, localPath) => {
  const local = readFileSync(localPath)
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return null }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
  return r.ok ? buf.toString('utf8') : null
}

const runProbes = (key, text) => {
  const spec = CONTENT_PROBES[key]
  if (!spec) return
  for (const p of spec.has || []) {
    const hit = text.includes(p)
    if (!hit) fail = true
    results.push(`${hit ? '✓' : '✗'} live ${key} carries ${p}`)
  }
  for (const p of spec.lacks || []) {
    const gone = !text.includes(p)
    if (!gone) fail = true
    results.push(`${gone ? '✓' : '✗'} live ${key} no longer carries ${p}`)
  }
}

// 1. byte-identity of every round asset off its page + 2. the content probes
for (const [page, targets] of Object.entries(PAGE_TARGETS)) {
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  for (const t of targets) {
    const ext = t.endsWith('.js') || t === 'i18n' || t === 'i18n-en' ? '.js' : '.css'
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.${ext.slice(1)})"`)
    const ref = re.exec(html)?.[1] || null
    const local = ref ? localFile(t, ext) : null
    if (ref && local) {
      const text = await check(`${t}${ext} (wired, off ${page})`, BASE + ref, join(DIST, local))
      if (text) runProbes(t, text)
    } else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// 2b. the manifest-discovered lazy bundle (i18n-fa)
{
  const manifest = await (await fetch(`${BASE}/dist/manifest.json`, { cache: 'no-store' })).json()
  for (const [name, spec] of Object.entries(MANIFEST_ONLY)) {
    const url = manifest[`${name}.js`]
    const local = url ? localFile(name, '.js') : null
    if (url && local) {
      const text = await check(`${name}.js (manifest-discovered)`, BASE + '/' + url.replace(/^\//, ''), join(DIST, local))
      if (text) {
        for (const p of spec.has) {
          const hit = text.includes(p)
          if (!hit) fail = true
          results.push(`${hit ? '✓' : '✗'} live ${name}.js carries ${p}`)
        }
      }
    } else { results.push(`✗ ${name}: manifest entry or local file MISSING`); fail = true }
  }
}

// 3. sw.js version + the SHELL's WebP swap
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  const ok = sw.includes(`const VERSION = "${EXPECT_SW}"`)
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} sw.js VERSION = ${EXPECT_SW}`)
  const webp = sw.includes("'/Login.webp'")
  const jpgGone = !sw.includes("'/Login.jpg'")
  if (!webp || !jpgGone) fail = true
  results.push(`${webp && jpgGone ? '✓' : '✗'} sw.js SHELL precaches /Login.webp (jpg ${jpgGone ? 'gone' : 'STILL THERE'})`)
}

// 4. Login.webp itself: byte-identical + the right content type
{
  const local = readFileSync(join(process.cwd(), 'public', 'Login.webp'))
  const r = await fetch(`${BASE}/Login.webp`, { cache: 'no-store' })
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  const ctype = r.headers.get('content-type') || ''
  if (!same || !ctype.includes('image/webp')) fail = true
  results.push(`${same && ctype.includes('image/webp') ? '✓' : '✗'} /Login.webp: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'} · ${ctype}`)
}

// 5. the shell pages' HTML grammar (skip-link + aria-labels + the WebP preload)
{
  const login = await (await fetch(`${BASE}/login.html`, { cache: 'no-store' })).text()
  const checks = [
    ['login skip-link', login.includes('class="skip-link"') && login.includes('a11y.skipToMain')],
    ['login WebP preload', login.includes('href="/Login.webp"')],
  ]
  const canvas = await (await fetch(`${BASE}/canvas.html`, { cache: 'no-store' })).text()
  checks.push(['canvas pen aria-labels', canvas.includes('aria-label="Thin pen"')])
  const sadhana = await (await fetch(`${BASE}/sadhana.html`, { cache: 'no-store' })).text()
  checks.push(['sadhana qeEmo/qeEmpty aria-labels', sadhana.includes('aria-label="Pick a symbol"') && sadhana.includes('aria-label="No symbol — minimalist"')])
  for (const [label, ok] of checks) {
    if (!ok) fail = true
    results.push(`${ok ? '✓' : '✗'} ${label}`)
  }
}

// 6. health (no migration this round — schema stays 63)
{
  const h = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
  const ok = h.ok === true && h.db === 'up' && String(h.schema_version) === EXPECT_SCHEMA
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} health ok=${h.ok} db=${h.db} schema_version=${h.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)
}

console.log(results.join('\n'))
console.log(`\nS200 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
