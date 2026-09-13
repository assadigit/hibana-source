#!/usr/bin/env node
// scripts/mobile-audit.mjs — S43's reusable responsive audit harness.
//
// Sweeps EVERY user-facing page at phone width (390×844, mobile + touch) in FA-RTL and
// EN-LTR (light; dark spot-check), against a freshly seeded rich account, and measures:
//   1. document-level horizontal scroll (the hard law: <html> never scrolls sideways)
//   2. elements extending past the viewport edges
//   3. "container out of box" — children spilling out of their card/bordered ancestors
//      (with intentional overhangs whitelisted: the S42 carousel arrows etc.)
//   4. touch targets < 40px (44 is the bar; 40 flags real problems, not rounding)
//   5. clipped single-line text on controls
//   6. micro fonts (< 11px)
//
// Usage:  node scripts/mobile-audit.mjs [--width 390] [--locale fa] [--keep]
// Prints a per-page defect table + writes /tmp/mobile-audit-report.json and screenshots
// to /tmp/mobile-audit-shots/. Exits 0 always — it's a REPORTER, the triage is human.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const PORT = 3018
const DB = '/tmp/hibana-audit.db'
const BASE = `http://127.0.0.1:${PORT}`
const SHOT_DIR = '/tmp/mobile-audit-shots'
const REPORT = '/tmp/mobile-audit-report.json'
let SERVER_PID = 0

const args = process.argv.slice(2)
const WIDTH = Number(args.find((_, i) => args[i] === '--width') != null ? args[args.indexOf('--width') + 1] : 390) || 390
const ONLY_LOCALE = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : null
const KEEP = args.includes('--keep')

const UUID = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
const PASS = 'e2e-password-123'

// ---------------------------------------------------------------- server ----
async function hashPass(pass) {
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  return `pbkdf2$100000$${b64(salt)}$${b64(Buffer.from(bits))}`
}

async function startServer() {
  const child = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: DB, PORT: String(PORT), NODE_ENV: 'development', OPEN_REGISTRATION: 'true',
      GITHUB_OWNER: 'x', GITHUB_REPO: 'y', GITHUB_TOKEN: 'x', OWNER_EMAIL: 'test@test.local',
      TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_SECRET: 'x',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => process.stderr.write(d))
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return child
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('audit server failed to boot')
}

// ------------------------------------------------------------------ seed ----
async function seedUser(db, email, username, lang) {
  const id = UUID()
  const hash = (await hashPass(PASS)).replace(/'/g, "''")
  const now = new Date().toISOString()
  db.exec(`DELETE FROM users WHERE email = '${email}'`)
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', '${username}', '${email}', '${hash}', 'owner', '${lang}', ${lang === 'fa' ? "'shamsi'" : "'gregorian'"}, 'UTC', '${now}', '${now}')`,
  )
  seedData(db, id, now)
  return id
}

function seedData(db, uid, now) {
  const q = (s) => db.exec(s)
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const iso = (n) => new Date(Date.now() + n * 86400000).toISOString()

  // --- sparks: 3 folders w/ emoji icons, sparks inside + loose ones
  const folders = [['موبایل و ریسپانسیو', '📱'], ['درآمدی و فروش', '💰'], ['هوش مصنوعی', '🤖']]
  const fid = folders.map(([name, icon]) => {
    const id = UUID()
    q(`INSERT INTO spark_folders (id, user_id, name, icon, sort_order, created_at) VALUES ('${id}', '${uid}', '${name}', '${icon}', 0, '${now}')`)
    return id
  })
  const mkSpark = (title, folder) =>
    q(`INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, folder_id, created_at, updated_at)
       VALUES ('${UUID()}', '${uid}', '${title.replace(/'/g, "''")}', '', 'personal', 'spark', 0, '', 0, ${folder ? `'${folder}'` : 'NULL'}, '${iso(-3)}', '${now}')`)
  mkSpark('رابط کاربری جدید برای صفحه پرداخت با درگاه و تایید دو مرحله‌ای', fid[0])
  mkSpark('منوی همبرگری یا تب بار پایین؟ تست A/B', fid[0])
  mkSpark('کارت هدیه برای مشتریان قدیمی', fid[1])
  mkSpark('بسته اشتراکی ماهانه با تخفیف پلکانی', fid[1])
  mkSpark('چت‌بات پاسخگوی مشتری با زبان فارسی', fid[2])
  for (const t of ['ایده سریع یکی', 'ایده سریع دو', 'یک یادداشت خیلی طولانی برای تست شکستن خط عنوان که باید درست نمایش داده شود']) mkSpark(t, null)

  // --- pipeline projects across all 7 stages (dashboard stat carousel + projects page)
  const stages = ['unreviewed', 'unreviewed', 'investigating', 'awaiting', 'doing', 'doing', 'halted', 'operational']
  let doing = null
  stages.forEach((status, i) => {
    const id = UUID()
    if (status === 'doing' && !doing) doing = id
    q(`INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, progress_percent, archived_state, client_name, due_date, reminders_enabled, created_at, updated_at)
       VALUES ('${id}', '${uid}', 'پروژه ${status} شماره ${i + 1} با عنوان نسبتا طولانی', 'توضیحات تستی برای این پروژه', ${status === 'operational' ? "'client'" : "'personal'"}, '${status}', ${i}, '', ${10 * i}, NULL, ${status === 'operational' ? "'فروشگاه سدانما'" : 'NULL'}, '${days(i % 2 ? -4 : 12)}', 0, '${iso(-20 + i)}', '${iso(-1)}')`)
  })

  // --- the DOING project gets the full devboard treatment
  const cats = [['طراحی رابط', '#e07a5f'], ['فرانت‌اند', '#81b29a'], ['کیفیت و تست', '#f2cc8f']]
  const catIds = cats.map(([name, color]) => {
    const id = UUID()
    q(`INSERT INTO task_categories (id, project_id, name, color, sort_order, created_at) VALUES ('${id}', '${doing}', '${name}', '${color}', 0, '${now}')`)
    return id
  })
  const tagIds = [['رابط کاربری', '#d4a373'], ['فوری', '#e63946'], ['امنیت', '#457b9d']].map(([name, color]) => {
    const id = UUID()
    q(`INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('${id}', '${uid}', '${name}', '${color}', 0, '${now}')`)
    return id
  })
  const dt = (title, status, prio, cat, tags) => {
    const id = UUID()
    q(`INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sort_order, created_at, done_at, start_at, end_at, search_tags)
       VALUES ('${id}', '${doing}', '${title.replace(/'/g, "''")}', '${status}', '${prio}', ${cat ? `'${cat}'` : 'NULL'}, 0, '${iso(-5)}', ${status === 'done' ? `'${iso(-1)}'` : 'NULL'}, NULL, NULL, ${tags ? `'${tags}'` : "''"})`)
    return id
  }
  const taskRows = [
    dt('بازطراحی صفحه محصول با گالری تصاویر و مقایسه', 'idea', 'medium', catIds[0], 'ui'),
    dt('منوی فیلتر موبایل سرریز می‌شود و دکمه‌ها کوچک‌اند', 'bug', 'urgent', catIds[2], 'ui,urgent'),
    dt('خطای اعتبارسنجی فرم پرداخت در سافاری', 'bug', 'high', catIds[2], 'urgent'),
    dt('پیاده‌سازی کامپوننت کارت محصول واکنش‌گرا', 'planned', 'medium', catIds[1], 'ui'),
    dt('مهاجرت به نسخه جدید کتابخانه تقویم', 'planned', 'low', catIds[1], null),
    dt('اصلاح نویگیشن پایین در حالت تاریک', 'in_progress', 'high', catIds[0], 'ui'),
    dt('اتصال درگاه پرداخت جدید', 'in_progress', 'urgent', catIds[1], 'urgent'),
    dt('راه‌اندازی تست خودکار فرم ثبت‌نام', 'done', 'medium', catIds[2], null),
    dt('بهینه‌سازی تصاویر صفحه فرود', 'done', 'low', catIds[1], 'ui'),
  ]
  // tag links on two tasks
  q(`INSERT INTO dev_task_tags (task_id, tag_id) VALUES ('${taskRows[1]}', '${tagIds[1]}')`)
  q(`INSERT INTO dev_task_tags (task_id, tag_id) VALUES ('${taskRows[1]}', '${tagIds[0]}')`)
  q(`INSERT INTO dev_task_tags (task_id, tag_id) VALUES ('${taskRows[5]}', '${tagIds[0]}')`)

  // simple checklist tasks (project page + notifications overdue)
  const t = (title, done, due) =>
    q(`INSERT INTO tasks (id, project_id, title, done, due_date, created_at, completed_at) VALUES ('${UUID()}', '${doing}', '${title.replace(/'/g, "''")}', ${done ? 1 : 0}, ${due ? `'${due}'` : 'NULL'}, '${now}', ${done ? `'${now}'` : 'NULL'})`)
  t('تماس با مشتری برای تایید طرح', 1, null)
  t('جلسه با تیم توسعه', 0, days(-2))
  t('تحویل نسخه اول', 0, days(5))

  // payments + history + notes
  q(`INSERT INTO payments (id, project_id, label, amount, currency, status, created_at) VALUES ('${UUID()}', '${doing}', 'پیش‌پرداخت', 5000000, 'IRT', 'paid', '${now}')`)
  q(`INSERT INTO payments (id, project_id, label, amount, currency, status, created_at) VALUES ('${UUID()}', '${doing}', 'اقساط دوم', 7500000, 'IRT', 'pending', '${now}')`)
  q(`INSERT INTO project_history_log (id, project_id, note, created_at) VALUES ('${UUID()}', '${doing}', 'پروژه از مرحله بررسی به انجام منتقل شد', '${iso(-4)}')`)
  q(`INSERT INTO project_history_log (id, project_id, note, created_at) VALUES ('${UUID()}', '${doing}', 'اسپرینت اول شروع شد', '${iso(-2)}')`)

  // sprints (one active + one finished) + a backlog doc
  const sp1 = UUID(), sp2 = UUID()
  q(`INSERT INTO sprints (id, project_id, name, started_at, ended_at, created_at, is_draft, version, description) VALUES ('${sp1}', '${doing}', 'اسپرینت رابط موبایل', '${iso(-2)}', NULL, '${iso(-3)}', 0, '1.0', 'تمرکز روی ریسپانسیو و منو')`)
  q(`INSERT INTO sprints (id, project_id, name, started_at, ended_at, created_at, is_draft, version, description) VALUES ('${sp2}', '${doing}', 'اسپرینت پایه', '${iso(-12)}', '${iso(-5)}', '${iso(-13)}', 0, '0.9', 'راه‌اندازی اولیه')`)
  q(`UPDATE dev_tasks SET sprint_id = '${sp1}' WHERE id IN ('${taskRows[5]}', '${taskRows[6]}')`)
  q(`INSERT INTO backlog_docs (id, project_id, title, content, created_at, updated_at) VALUES ('${UUID()}', '${doing}', 'سند برنامه اسپرینت', '## هدف\\nرساندن رابط موبایل به حالت پایدار\\n- [ ] منو\\n- [x] فیلترها', '${now}', '${now}')`)

  // --- sadhana: 4 quadrants, mixed states, long titles
  const st = (quadrant, title, emoji, done, due, pinned) =>
    q(`INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, fuzzy, due_date, done, pinned, position, created_at, updated_at)
       VALUES ('${UUID()}', '${uid}', ${quadrant}, '${title.replace(/'/g, "''")}', '${emoji}', NULL, ${due ? `'${due}'` : 'NULL'}, ${done ? 1 : 0}, ${pinned ? 1 : 0}, 0, '${now}', '${now}')`)
  st(1, 'ورزش صبحگاهی و نرمش سی دقیقه‌ای', '🏃', 1, days(-1), 0)
  st(1, 'مدیتیشن و نوشتن روزنگار', '🧘', 0, null, 1)
  st(2, 'کار عمیق روی پروژه سدانما بدون مزاحمت', '🎯', 0, days(-2), 0)
  st(2, 'مرور ایمیل‌ها و پیام‌های مشتریان', '📮', 0, days(0), 0)
  st(3, 'یادگیری الگوهای طراحی جدید', '📚', 0, null, 0)
  st(3, 'تمرین زبان انگلیسی با پادکست', '🎧', 1, days(0), 0)
  st(4, 'زمان بازی و خانواده', '🎮', 0, null, 0)
  st(4, 'مرور هفتگی و برنامه‌ریزی', '📝', 0, days(2), 0)

  // --- canvas + notebook elements (sticky notes + text boxes, long FA strings)
  const ce = (board, type, x, y, w, h, content, extra = '') =>
    q(`INSERT INTO canvas_elements (id, user_id, board, type, x, y, width, height, color, content, font_size, z_index, deleted, locked, angle, created_at, updated_at${extra ? ', text_align' : ''})
       VALUES ('${UUID()}', '${uid}', '${board}', '${type}', ${x}, ${y}, ${w}, ${h}, '#f9d5a7', '${content.replace(/'/g, "''")}', 16, 1, 0, 0, 0, '${now}', '${now}'${extra ? `, '${extra}'` : ''})`)
  ce('canvas', 'sticky', 80, 80, 200, 140, 'یادداشت سفید برای تست: این متن باید در کادر جا شود')
  ce('canvas', 'sticky', 320, 120, 220, 160, 'کارت دوم با متن طولانی‌تر برای بررسی رفتار متن چندخطی در عرض کم')
  ce('canvas', 'note', 120, 300, 260, 60, 'متن راست‌چین', 'right')
  ce('notebook', 'sticky', 60, 100, 180, 130, 'یادداشت دفترچه یک')
  ce('notebook', 'sticky', 280, 90, 200, 150, 'یادداشت دفترچه دو با متن طولانی برای تست')
  ce('notebook', 'note', 100, 280, 240, 50, 'عنوان وسط‌چین', 'center')

  // --- quick notes
  for (const [k, title, c] of [['note', 'یادداشت سریع یک', 'محتوای کوتاه'], ['note', 'یادداشت سریع دو با عنوان طولانی برای تست', ''], ['list', 'خرید', 'شیر و نان و پنیر']]) {
    q(`INSERT INTO quick_notes (id, user_id, kind, title, content, sort_order, created_at, updated_at) VALUES ('${UUID()}', '${uid}', '${k}', '${title.replace(/'/g, "''")}', '${(c || '').replace(/'/g, "''")}', 0, '${now}', '${now}')`)
  }
  return { doing }
}

// ---------------------------------------------------------------- audit -----
// Injected in-page. Mirrors e2e/fixtures/audit-fn.js (fixing its broken `aref]`
// selector) + adds the container-spill detector. Returns a compact JSON report.
const AUDIT_FN = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth, vh = de.clientHeight
  const out = { url: location.pathname + location.search, dir: de.dir, lang: de.lang, vw, vh }
  const label = (el) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''
    return tag + id + (cls ? '.' + cls : '')
  }
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  // 1) page-level h-scroll
  out.docHScroll = de.scrollWidth - vw

  // 2) viewport overflows (skip intentional fixed-position chrome + intentional overhang)
  const INTENTIONAL = el => {
    const c = typeof el.className === 'string' ? el.className : ''
    if (/stat-arrow|tour|coachmark|emoji-picker|lightbox|dz|sr-only/.test(c)) return true
    return false
  }
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed') continue
    if (INTENTIONAL(el)) continue
    const r = el.getBoundingClientRect()
    if ((r.right > vw + 2 || r.left < -2) && r.left < vw && r.right > 0) {
      over.push({ el: label(el), right: Math.round(r.right), left: Math.round(r.left) })
    }
  }
  out.viewportOverflows = over

  // 3) container spill: child sticks out of its nearest "box" ancestor
  //    (box = border or visible background or overflow clipping), inline-axis, > 6px
  const spills = []
  const BOX = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.position === 'fixed' || cs.position === 'sticky') return null
      const border = ['border','border-inline','border-left','border-right','border-inline-start','border-inline-end']
        .some(p => (cs.getPropertyValue(p + '-width') || '0px') !== '0px' && cs.getPropertyValue(p + '-style') !== 'none')
      const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'
      const clip = cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
      const cardish = (typeof a.className === 'string' && /card|chip|badge|btn|box|panel|cell|row|head|bar|col|quadrant|skc|sf-|db-|pd-|notif|cal-|proj|task|stat|spd|sp-/i.test(a.className)) && !/body|shell|wrap$/i.test(a.className)
      if (border || bg || clip || cardish) return a
    }
    return null
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || INTENTIONAL(el)) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'absolute' || cs.position === 'fixed') continue
    const box = BOX(el)
    if (!box) continue
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect()
    const dRight = r.right - b.right, dLeft = b.left - r.left
    if (dRight > 6 || dLeft > 6) {
      // the box itself must be within the viewport (spill of off-screen cards is 2's job)
      if (b.right <= 0 || b.left >= vw) continue
      spills.push({ el: label(el), box: label(box), dRight: Math.round(dRight), dLeft: Math.round(dLeft) })
    }
  }
  out.containerSpills = spills.slice(0, 25)

  // 4) small touch targets
  const small = []
  const SEL = 'button, a[href], [role="button"], summary, input, select, textarea, .icon-btn, .quad-btn, .chip, .btn'
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if (cs.pointerEvents === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.height < 1 || r.width < 1) continue
    // count the rect, not the padding: the TAP SURFACE must be >= 40 in the thin axis
    const minDim = Math.min(r.width, r.height)
    if (minDim < 40) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'a' && cs.display.startsWith('inline') && !el.querySelector('button,img,svg')) continue
      if (el.closest('[data-tour], .tour, .sr-only')) continue
      small.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) })
    }
  }
  out.smallTargets = small.slice(0, 40)
  out.smallTargetCount = small.length

  // 5) clipped control text
  const clipped = []
  for (const el of document.querySelectorAll('button, .chip, .badge, .tab, [role="button"]')) {
    if (!visible(el)) continue
    if (el.scrollWidth > el.clientWidth + 4) {
      const t = (el.textContent || '').trim().slice(0, 24)
      if (t) clipped.push({ el: label(el), t })
    }
  }
  out.clippedControls = clipped.slice(0, 15)

  // 6) micro fonts
  const micro = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if (cs.fontSize && parseFloat(cs.fontSize) < 11 && el.children.length === 0 && (el.textContent || '').trim()) {
      micro.push({ el: label(el), px: parseFloat(cs.fontSize) })
    }
  }
  out.microFonts = micro.slice(0, 12)
  return JSON.stringify(out)
})()`

// ------------------------------------------------------------- the sweep ----
async function main() {
  rmSync(DB, { force: true })
  rmSync(SHOT_DIR, { recursive: true, force: true })
  mkdirSync(SHOT_DIR, { recursive: true })
  const server = await startServer()
  SERVER_PID = server.pid
  console.log('audit server up on', PORT)

  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const faUser = await seedUser(db, 'mobile-fa@test.local', 'mobile-fa', 'fa')
  const enUser = await seedUser(db, 'mobile-en@test.local', 'mobile-en', 'en')
  const faDoing = db.prepare("SELECT id FROM projects WHERE user_id = ? AND status = 'doing' LIMIT 1").get(faUser)
  const enDoing = db.prepare("SELECT id FROM projects WHERE user_id = ? AND status = 'doing' LIMIT 1").get(enUser)
  db.close()

  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const report = { width: WIDTH, pages: [], meta: { faUser, enUser, faDoing: faDoing.id, enDoing: enDoing.id } }

  const sweep = async (locale, theme, email, doingId) => {
    const ctx = await browser.newContext({
      viewport: { width: WIDTH, height: 844 },
      isMobile: true, hasTouch: true,
      locale: locale === 'fa' ? 'fa-IR' : 'en-US',
      timezoneId: 'Asia/Tehran',
      colorScheme: 'light',
    })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)))

    // login
    await page.goto(`${BASE}/login.html`)
    await page.fill('[name="login"]', email)
    await page.fill('[name="password"]', PASS)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/app', { timeout: 15000 })
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(600)

    if (theme === 'dark') {
      await page.evaluate(() => { localStorage.setItem('hibana-theme', 'dark'); localStorage.setItem('theme', 'dark') })
    }

    const routes = [
      ['app', '/app'],
      ['projects', '/projects.html'],
      ['project-detail', `/project.html?id=${doingId}`],
      ['sparks', '/sparks.html'],
      ['board', `/board.html?project=${doingId}`],
      ['sprint', `/sprint.html?project=${doingId}`],
      ['calendar', '/calendar.html'],
      ['notifications', '/notifications.html'],
      ['clients', '/clients.html'],
      ['reports', '/reports.html'],
      ['sadhana', '/sadhana.html'],
      ['settings', '/settings.html'],
      ['archive', '/archive.html'],
      ['gallery', '/gallery.html'],
      ['admin', '/admin.html'],
      ['404', '/404.html'],
      ['canvas', '/canvas.html'],
      ['whiteboard', '/whiteboard.html'],
    ]

    for (const [name, path] of routes) {
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
        await page.waitForTimeout(900) // htmx swaps + menus settle
        const raw = await page.evaluate(AUDIT_FN)
        const res = JSON.parse(raw)
        res.page = name; res.locale = locale; res.theme = theme
        res.consoleErrors = consoleErrors.splice(0, 4)
        report.pages.push(res)
        const flags = [
          res.docHScroll > 1 ? `HSCROLL+${res.docHScroll}` : '',
          res.viewportOverflows.length ? `VP-OVF:${res.viewportOverflows.length}` : '',
          res.containerSpills.length ? `SPILL:${res.containerSpills.length}` : '',
          res.smallTargetCount ? `TAP:${res.smallTargetCount}` : '',
          res.clippedControls.length ? `CLIP:${res.clippedControls.length}` : '',
          res.microFonts.length ? `FONT:${res.microFonts.length}` : '',
        ].filter(Boolean).join(' ') || 'clean'
        console.log(`[${locale}/${theme}] ${name.padEnd(16)} ${flags}`)
        if (flags !== 'clean') {
          await page.screenshot({ path: `${SHOT_DIR}/${locale}-${theme}-${name}.png`, fullPage: false })
        }
      } catch (e) {
        console.log(`[${locale}/${theme}] ${name.padEnd(16)} ERROR ${String(e).slice(0, 120)}`)
        report.pages.push({ page: name, locale, theme, error: String(e).slice(0, 300) })
      }
    }
    await ctx.close()
  }

  const combos = []
  if (!ONLY_LOCALE || ONLY_LOCALE === 'fa') { combos.push(['fa', 'light', 'mobile-fa@test.local', faDoing.id]); combos.push(['fa', 'dark', 'mobile-fa@test.local', faDoing.id]) }
  if (!ONLY_LOCALE || ONLY_LOCALE === 'en') { combos.push(['en', 'light', 'mobile-en@test.local', enDoing.id]) }
  for (const c of combos) await sweep(...c)

  writeFileSync(REPORT, JSON.stringify(report, null, 2))
  console.log('\nreport →', REPORT, '| shots →', SHOT_DIR)
  await browser.close()
  if (!KEEP) { try { process.kill(-server.pid, 'SIGTERM') } catch {} }
}

main().catch((e) => {
  console.error(e)
  try { process.kill(-SERVER_PID, 'SIGKILL') } catch {}
  process.exit(1)
})
