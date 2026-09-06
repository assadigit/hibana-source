// Wires credentials into the deployed Worker WITHOUT ever printing them.
// Reads .secrets.env (gitignored, see .secrets.env.example), pipes each value into
// `wrangler secret put <KEY>` via stdin (not argv), mirrors into .dev.vars for local dev,
// then offers to create the private pm-app-assets repo.
//   npm run secrets:set [-- --prod]   (omit --prod for the dev worker)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Invoke wrangler via its JS entry point with node directly — no shell, no npx shims,
// no quoting hazards feeding secret values into the process list or into an npm arg parser.
const WRANGLER = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js')

const PROD = process.argv.includes('--prod')
const file = join(process.cwd(), '.secrets.env')
if (!existsSync(file)) {
  console.error('Missing .secrets.env — copy .secrets.env.example and fill in your values.')
  process.exit(1)
}

const lines = readFileSync(file, 'utf8').split(/\r?\n/)
const entries = lines
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(/=(.*)/s))
  .filter((m) => m[1] !== undefined)

let missing = 0
for (const [key, value] of entries) {
  if (!value.trim()) {
    console.warn(`  ⚠ ${key} is empty — skipped`)
    missing++
    continue
  }
  const args = [WRANGLER, 'secret', 'put', key]
  if (PROD) args.push('--env', 'prod')
  const r = spawnSync(process.execPath, args, {
    input: value,           // value goes via stdin — it never appears in the process list or console
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (r.status !== 0) {
    console.error(`  ✗ ${key} failed`); process.exit(1)
  }
  console.log(`  ✓ ${key} set as a Workers secret (value encrypted, not shown)`)
}

// Mirrors into .dev.vars so `wrangler dev` works locally too.
// L9 fix (2026-09-10): MERGE with any existing .dev.vars instead of overwriting. The old
// behavior wiped manual dev vars (custom ENVIRONMENT overrides, test keys) on every re-run.
// Existing keys are updated with the new value from .secrets.env; keys only in .dev.vars
// are preserved. Lines starting with # (comments) are kept as-is.
const devVarsPath = join(process.cwd(), '.dev.vars')
const existingLines = existsSync(devVarsPath) ? readFileSync(devVarsPath, 'utf8').split(/\r?\n/) : []
const existingMap = new Map()
const preservedLines = [] // comment lines + blank lines + keys NOT in .secrets.env
for (const line of existingLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) { preservedLines.push(line); continue }
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx < 0) { preservedLines.push(line); continue }
  const key = trimmed.slice(0, eqIdx).trim()
  existingMap.set(key, line)
}
// Write: .secrets.env entries (with values) first, then any preserved lines whose keys
// weren't in .secrets.env (keeps manual additions without duplicating managed keys).
const managedKeys = new Set(entries.filter((e) => e[1]?.trim()).map((e) => e[0]))
const outLines = entries.filter((e) => e[1]?.trim()).map((e) => e.join('='))
for (const line of preservedLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) { outLines.push(line); continue }
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx < 0) { outLines.push(line); continue }
  const key = trimmed.slice(0, eqIdx).trim()
  if (!managedKeys.has(key)) outLines.push(line) // preserve manual additions
}
if (outLines.length) {
  writeFileSync(devVarsPath, outLines.join('\n') + '\n')
  console.log('  ✓ .dev.vars merged for local development (gitignored)')
}

if (missing) console.warn(`\n${missing} value(s) were empty and skipped.`)

// --- optionally finish the loop: create the assets repo + register Telegram webhook ---
const map = Object.fromEntries(entries.filter((e) => e[1].trim()))
const ghToken = map.GITHUB_TOKEN
const ghOwner = process.env.GITHUB_OWNER || 'assadigit'
const GITHUB_REPO = process.env.GITHUB_REPO || 'hibana-safe'
if (ghToken && ghOwner) {
  try {
    const exists = await fetch(`https://api.github.com/repos/${ghOwner}/${GITHUB_REPO}`, { headers: { Authorization: `Bearer ${ghToken}` } })
    if (exists.status === 404) {
      const created = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: GITHUB_REPO, private: true, description: 'Hibana file storage: screenshots, changelogs, backups' }),
      })
      if (created.ok) console.log(`  ✓ private repo ${ghOwner}/${GITHUB_REPO} created`)
      else console.warn(`  ⚠ repo create failed (${created.status})`)
    } else if (exists.ok) {
      console.log(`  ✓ repo ${ghOwner}/${GITHUB_REPO} accessible (token OK)`)
    } else {
      console.warn(`  ⚠ repo check failed (${exists.status}) — verify token scope on ${ghOwner}/${GITHUB_REPO}`)
    }
  } catch (err) {
    console.warn('  ⚠ could not verify/create the GitHub repo:', err instanceof Error ? err.message : String(err))
  }
}

const tgToken = map.TELEGRAM_BOT_TOKEN
const tgSecret = map.TELEGRAM_SECRET
if (tgToken && tgSecret) {
  // Register the webhook so Telegram delivers messages to the deployed Worker (rule 11).
  const base = PROD ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
  try {
    const res = await fetch(`https://api.telegram.org/bot${tgToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${base}/api/telegram/webhook`, secret_token: tgSecret }),
    })
    const json = await res.json()
    if (json?.ok) console.log('  ✓ Telegram webhook registered (secret-token protected)')
    else console.warn('  ⚠ Telegram webhook failed:', JSON.stringify(json))
  } catch (err) {
    console.warn('  ⚠ could not set the Telegram webhook:', err instanceof Error ? err.message : String(err))
  }
}

console.log(`\nSecrets done. Redeploy with: npm run deploy${PROD ? ':prod' : ''}`)