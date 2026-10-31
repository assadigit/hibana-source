// scripts/s230-shots.mjs — visual evidence for the S230 kanban redesign round.
// Boots the Node server on a scratch DB, seeds one empty + one populated project,
// and captures the QA-checklist shots: light/dark × empty/populated × EN/FA/RTL +
// the desktop minimum (1100×720) + an open column menu.
// Usage: node scripts/s230-shots.mjs [outdir]
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const OUT = path.resolve(process.argv[2] || 'shots-s230')
mkdirSync(OUT, { recursive: true })
const PORT = 3317
const DB = '/tmp/hibana-s230-shots.db'
const SHOTS = '/tmp/hibana-s230-shots-store'
const BASE = `http://localhost:${PORT}`

const server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, DB_PATH: DB, PORT: String(PORT), NODE_ENV: 'development', RATE_LIMIT_DISABLE: '1', OPEN_REGISTRATION: 'true', GITHUB_OWNER: 'x', GITHUB_REPO: 'y', GITHUB_TOKEN: 'x', OWNER_EMAIL: 't@t.local', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_SECRET: 'x', HIBANA_SHOTS_DIR: SHOTS, CAPTCHA_SECRET_KEY: 'test-secret' },
  stdio: 'ignore',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2500)

const PASS = 'e2e-password-123'

// seed the shots user directly in the scratch DB (the e2e specs' recipe — the
// signup page carries captcha/invite friction a shots script doesn't need)
const { randomBytes } = await import('node:crypto')
const { DatabaseSync } = await import('node:sqlite')
const USER_EMAIL = `s230-shots@test.local`
const ITER = 100_000
const salt = randomBytes(16)
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256)
const hash = `pbkdf2$${ITER}$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`
const FA_EMAIL = 's230-shots-fa@test.local'
{
  const db = new DatabaseSync(DB)
  const now = new Date().toISOString()
  const mkUser = (email, username, lang) => {
    const id = randomBytes(16).toString('hex')
    try { db.exec(`DELETE FROM users WHERE email = '${email}'`) } catch {}
    db.exec(`INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
      VALUES ('${id}', '${username}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'shamsi', 'UTC', '${now}', '${now}')`)
  }
  mkUser(USER_EMAIL, 's230shots', 'en')
  mkUser(FA_EMAIL, 's230shotsfa', 'fa')
  db.close()
}

const run = async () => {
  const browser = await chromium.launch()
  const mkPage = async (vp, theme, lang) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 })
    await ctx.addInitScript(({ t, l }) => {
      try {
        localStorage.setItem('hibana-tour-done', '1')
        localStorage.setItem('hibana-ln-done', '1')
        if (t) localStorage.setItem('hibana-theme', t)
        if (l) localStorage.setItem('hibana-lang', l)
      } catch {}
    }, { t: theme, l: lang })
    return ctx.newPage()
  }
  // seed an empty + populated project as the shots user
  const page = await mkPage({ width: 1600, height: 900 })
  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', USER_EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 10000 })
  const cookies = await page.context().cookies()

  const mk = async (title, tasks, asPage = page) => {
    const res = await asPage.evaluate(async ([title, tasks]) => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'developing' }) })
      const { id } = await r.json()
      for (const t of tasks) await fetch(`/api/projects/${id}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) })
      return id
    }, [title, tasks])
    return res
  }
  const emptyPid = await mk('Currena', [])
  const popPid = await mk('Aurora Launch', [
    { title: 'Design the onboarding illustrations', status: 'idea', priority: 'high' },
    { title: 'Login rate-limit misfires for EU users', status: 'bug', priority: 'urgent' },
    { title: 'Ship the settings page round', status: 'planned' },
    { title: 'Refactor the sync engine retries', status: 'in_progress', priority: 'high' },
    { title: 'Dark mode contrast fixes', status: 'done' },
    { title: 'Per-card sync badge', status: 'done', priority: 'low' },
  ])

  // login as the fa user for the fa shots (language rides the user's language_pref)
  // + seed THE FA USER'S OWN boards (ownership: a user cannot open another user's
  // project — the EN seed boards 404 for the FA session, which renders the gone state)
  let faCookies = []
  let faEmptyPid = null
  let faPopPid = null
  {
    const p = await mkPage({ width: 1600, height: 900 })
    await p.goto(`${BASE}/login.html`)
    await p.fill('[name="login"]', FA_EMAIL)
    await p.fill('[name="password"]', PASS)
    await p.click('button[type=submit]')
    await p.waitForURL('**/app', { timeout: 10000 })
    faEmptyPid = await mk('کانبان فارسی', [], p)
    faPopPid = await mk('پروژهٔ نمونه', [
      { title: 'طراحی صفحهٔ تنظیمات', status: 'idea', priority: 'high' },
      { title: 'رفع خطای ورود در شبکهٔ کند', status: 'bug', priority: 'urgent' },
      { title: 'انتشار نسخهٔ جدید', status: 'planned' },
      { title: 'بازنویسی موتور همگام‌سازی', status: 'in_progress', priority: 'high' },
      { title: 'حالت تاریک بررسی شد', status: 'done' },
      { title: 'نشان همگام‌سازی کارت‌ها', status: 'done', priority: 'low' },
    ], p)
    faCookies = await p.context().cookies()
    await p.context().close()
  }

  const shoot = async (name, url, vp, theme, lang, hook) => {
    const p = await mkPage(vp, theme, lang)
    await p.context().addCookies(lang === 'fa' ? faCookies : cookies)
    await p.goto(url)
    await p.waitForSelector('.db-cols', { timeout: 10000 })
    await p.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 2)) // away from the edge-hover rail zone
    await p.waitForTimeout(700)
    if (hook) await hook(p)
    await p.screenshot({ path: path.join(OUT, name + '.png') })
    await p.context().close()
    console.log('shot:', name)
  }

  const E = `${BASE}/kanban?project=${emptyPid}`
  const P = `${BASE}/kanban?project=${popPid}`
  await shoot('01-empty-light-1600', E, { width: 1600, height: 900 })
  await shoot('02-empty-min-1100', E, { width: 1100, height: 720 })
  await shoot('03-populated-light-1600', P, { width: 1600, height: 900 })
  await shoot('04-empty-dark-1600', E, { width: 1600, height: 900 }, 'claude-dark')
  await shoot('05-populated-dark-1600', P, { width: 1600, height: 900 }, 'claude-dark')
  await shoot('06-empty-fa-rtl-1600', `${BASE}/kanban?project=${faEmptyPid}`, { width: 1600, height: 900 }, null, 'fa')
  await shoot('07-populated-fa-rtl-1600', `${BASE}/kanban?project=${faPopPid}`, { width: 1600, height: 900 }, null, 'fa')
  await shoot('08-narrow-800', E, { width: 800, height: 720 })
  await shoot('09-col-menu-open', P, { width: 1600, height: 900 }, null, null, async (p) => {
    await p.click('.pd-col[data-status="done"] [data-db-col-menu]')
    await p.waitForTimeout(250)
  })
  await shoot('10-add-flow', E, { width: 1600, height: 900 }, null, null, async (p) => {
    await p.click('.pd-col[data-status="idea"] .pd-empty-add')
    await p.waitForSelector('.db-modal-card')
    await p.waitForTimeout(300)
  })
  await browser.close()
}

try { await run() } finally { server.kill() }
console.log('DONE →', OUT)
