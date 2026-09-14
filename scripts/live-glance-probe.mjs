#!/usr/bin/env node
// scripts/live-glance-probe.mjs — S44's live functional probe (the S41+ D1-probe-user
// pattern). Verifies on a DEPLOYED worker that: (1) the glance strip anchors carry
// data-nav-local (the page owns the click — nav.js's interceptor stands down; the
// owner's "nothing happens" dead-click fix), (2) the shipped nav.js bundle carries
// the data-nav-local check + the same-page re-execution logic, (3) the shipped
// sparks-page bundle injects menus into every view (the data-nav-local hosts), (4)
// the shipped sprint-page bundle carries the today-flag + the S45 sprint-batch
// contracts (render-time i18n, the rich empty state, the finish name span) + the
// shipped devboard.css (20px strip, .sp-empty, the coarse floor), (5) the SW
// rotated to v346. Purges the probe user afterwards.
// Usage: node scripts/live-glance-probe.mjs [dev|prod]   (default: dev)

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'

const target = process.argv[2] || 'dev'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
const DB = target === 'prod' ? 'pm-app-prod' : 'pm-app-dev'
const envArg = target === 'prod' ? '--env prod' : ''

const UUID = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
const EMAIL = `probe-s44-${target}@hibana.local`
const PASS = 'probe-s44-password'
const TOKEN = randomBytes(32).toString('hex')

async function sha256(s) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex')
}

function d1(sql) {
  const file = `/tmp/live-glance-probe-${Date.now()}.sql`
  writeFileSync(file, sql)
  try {
    return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, envArg ? envArg.split(' ') : [], '--file', file, '--remote', '-y'].flat(), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } finally {
    rmSync(file, { force: true })
  }
}

const main = async () => {
  // --- seed: probe user + doing/operational projects + session (sessions.id = sha256(token))
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  const hash = `pbkdf2$100000$${b64(salt)}$${b64(Buffer.from(bits))}`
  const uid = UUID()
  const pid1 = UUID()
  const pid2 = UUID()
  const now = new Date().toISOString()
  await d1(`
    DELETE FROM users WHERE email = '${EMAIL}';
    INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
      VALUES ('${uid}', 'probe-s44', '${EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'fa', 'shamsi', 'UTC', '${now}', '${now}');
    INSERT INTO projects (id, user_id, title, type, status, sort_order, reminders_enabled, created_at, updated_at)
      VALUES ('${pid1}', '${uid}', 'پروب S44 در حال انجام', 'personal', 'doing', 0, 0, '${now}', '${now}');
    INSERT INTO projects (id, user_id, title, type, status, sort_order, reminders_enabled, created_at, updated_at)
      VALUES ('${pid2}', '${uid}', 'پروب S44 عملیاتی', 'personal', 'operational', 0, 0, '${now}', '${now}');
    INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('${await sha256(TOKEN)}', '${uid}', '${now}', '${new Date(Date.now() + 3600_000).toISOString()}');
  `)

  const cookie = `hibana_session=${TOKEN}`
  const results = []
  const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

  // 1) the glance strip (fragment) carries data-nav-local on its anchors
  const frag = await fetch(`${URL_BASE}/api/projects?view=cards&status=doing`, { headers: { Cookie: cookie, 'HX-Request': 'true', Origin: URL_BASE } })
  const fragBody = await frag.text()
  check('HX GET /api/projects?view=cards → 200', frag.status === 200, String(frag.status))
  check('glance strip renders (data-pglance present)', fragBody.includes('data-pglance='))
  check('glance anchors carry data-nav-local (S44)', /data-pglance="doing"[^>]*data-nav-local|data-nav-local[^>]*data-pglance="doing"/.test(fragBody), 'the page owns the click — no more dead clicks')
  check('the active box is highlighted for status=doing', /pglance-box[^"]*is-active[^>]*data-pglance="doing"|data-pglance="doing"[^>]*class="pglance-box[^"]*is-active/.test(fragBody))

  // 2) the shipped nav.js bundle: interceptor opt-out + same-page re-execution
  const projectsShell = await (await fetch(`${URL_BASE}/projects.html`)).text()
  const navSrc = projectsShell.match(/\/dist\/nav\.[a-f0-9]+\.js|\/js\/nav\.js\?v=\d+/)?.[0] || ''
  check('projects shell references nav.js', !!navSrc, navSrc)
  if (navSrc) {
    const nav = await (await fetch(`${URL_BASE}${navSrc}`)).text()
    check('nav.js: data-nav-local interceptor checks shipped', nav.includes('data-nav-local'))
    check('nav.js: same-page re-execution shipped', nav.includes('-page(\\.[0-9a-f]+)?\\.js$'))
  }

  // 3) the shipped sparks-page bundle: every-view menu injection hosts
  const sparksShell = await (await fetch(`${URL_BASE}/sparks.html`)).text()
  const sparksSrc = sparksShell.match(/\/dist\/sparks-page\.[a-f0-9]+\.js|\/js\/sparks-page\.js\?v=\d+/)?.[0] || ''
  check('sparks shell references sparks-page.js', !!sparksSrc, sparksSrc)
  if (sparksSrc) {
    const sp = await (await fetch(`${URL_BASE}${sparksSrc}`)).text()
    check('sparks-page: the every-view ⋯ hosts shipped', sp.includes('kanban-card') && sp.includes('sticky-note') && sp.includes('data-nav-local'))
    check('sparks-page: poll-survival (beforeSwap capture) shipped', /beforeSwap/.test(sp))
  }

  // 4) the shipped sprint-page bundle: the today flag
  const sprintShell = await (await fetch(`${URL_BASE}/sprint.html`)).text()
  const sprintSrc = sprintShell.match(/\/dist\/sprint-page\.[a-f0-9]+\.js|\/js\/sprint-page\.js\?v=\d+/)?.[0] || ''
  check('sprint shell references sprint-page.js', !!sprintSrc, sprintSrc)
  if (sprintSrc) {
    const spr = await (await fetch(`${URL_BASE}${sprintSrc}`)).text()
    check('sprint-page: the today flag shipped', spr.includes('sp-today-flag') && spr.includes('db.today'))
    // S45 sprint batch: render-time i18n (S1), rich empty state (S7), finish name (S3).
    // NB: the dist bundle is MINIFIED — the _t helper gets renamed, so we pin the
    // string LITERALS (keys survive minification verbatim) instead of call sites.
    check('sprint-page: render-time i18n shipped (db.categories at render)', spr.includes('db.categories'))
    check('sprint-page: render-time i18n shipped (popover buttons)', spr.includes('common.save') && spr.includes('db.finishSprint'))
    check('sprint-page: the rich empty state shipped (sp-empty + CTA)', spr.includes('sp-empty') && spr.includes('data-sp-empty-define') && spr.includes('sp.emptyHint'))
    check('sprint-page: the finish name span shipped', spr.includes('sp-finish-name'))
  }
  // S45: the shipped devboard.css — the 20px strip + the empty-state card + the coarse floor
  // (minified: no spaces after colons — regex with \s*)
  const devCss = sprintShell.match(/\/dist\/devboard\.[a-f0-9]+\.css|\/css\/devboard\.css\?v=\d+/)?.[0] || ''
  check('sprint shell references devboard.css', !!devCss, devCss)
  if (devCss) {
    const css = await (await fetch(`${URL_BASE}${devCss}`)).text()
    check('devboard.css: the 20px strip + .sp-empty shipped', /block-size:\s*20px/.test(css) && css.includes('.sp-empty'))
    check('devboard.css: the coarse touch floor shipped', /\.sp-sprint-chip\s*\{[^}]*min-block-size:\s*40px/.test(css.replace(/\n/g, ' ')))
  }
  const i18nFa = sparksShell.match(/\/dist\/i18n-fa\.[a-f0-9]+\.js/)?.[0] || ''
  if (i18nFa) {
    const dict = await (await fetch(`${URL_BASE}${i18nFa}`)).text()
    check('i18n-fa carries db.today («امروز»)', dict.includes("'db.today'") && dict.includes('امروز'))
    check('i18n-fa carries sp.emptyHint (the S45 empty-state hint)', dict.includes("'sp.emptyHint'"))
  }

  // 5) the SW rotated
  const sw = await (await fetch(`${URL_BASE}/sw.js`)).text()
  check('sw version v346', sw.includes('hibana-v346'))

  // 6) purge the probe user (cascade)
  await d1(`DELETE FROM users WHERE email = '${EMAIL}';`)
  const gone = await (await fetch(`${URL_BASE}/api/projects?view=cards`, { headers: { Cookie: cookie, 'HX-Request': 'true', Origin: URL_BASE } })).text()
  check('probe user purged (session dead)', gone.includes('unauthorized') || gone.includes('auth') || gone.includes('401'), gone.slice(0, 60))

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${target.toUpperCase()} ${failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASS'}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
