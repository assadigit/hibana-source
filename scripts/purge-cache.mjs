// One-command Cloudflare zone cache purge for hibana.ir — `npm run purge`.
//
// WHY THIS EXISTS (S72, 2026-09-18): the S72 deploy went CI+CD green but hibana.ir served a
// STALE nav partial for hours — the zone caches HTML aggressively (Edge-TTL override that
// ignores the origin's max-age=0; cf-cache-status: HIT on /login TODAY even with max-age=0),
// and the deploy token lacked zone-purge permission, so the fix was wait-for-TTL + ship an
// /api/nav route as the root fix. With Zone→Cache Purge on the deploy token, ANY stale-edge
// incident becomes `npm run purge` (or nothing at all — cd.yml purges after every prod deploy).
//
// TOKEN: `CLOUDFLARE_API_TOKEN` env var first (the CI path — credentials.md is not on the
// GitHub runner), else parsed from gitignored credentials.md in-process (never printed).
// ZONE:  `--zone <id>` → `CLOUDFLARE_ZONE_ID` env → resolved by name (default hibana.ir).
//
// Modes:
//   (default)              purge_everything — the incident hammer (safe: cache refill only)
//   --url <u> [--url …]    exact-URL purge (free-plan safe, chunked 30/request)
//   --file <path.json>     {"files":[…]} exact-URL purge from a file
//   --dry                  resolve + print the plan, touch nothing
//   --no-verify            skip the post-purge edge probes
//
// Exit codes: 0 purged (or dry) · 1 token lacks Cache Purge (runbook printed) · 2 other error.
/* global process, console, fetch, AbortSignal, setTimeout, URL */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root = this script's ../ — so `node /abs/path/scripts/purge-cache.mjs` works from
// ANY cwd (credentials.md lookup + docs references), not just the repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : (args[i + 1] ?? '')
}
const urls = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) { urls.push(args[i + 1]); i++ }
}
const DRY = args.includes('--dry')
const NO_VERIFY = args.includes('--no-verify')

if (args.includes('--help') || args.includes('-h')) {
  console.log(`usage: npm run purge [-- --url <u> …] [--file <path>] [--zone <id>] [--zone-name <name>] [--dry] [--no-verify]
  default      purge_everything on the hibana.ir zone
  --url        purge exact URLs only (repeatable; free plan allows 30/request — chunked)
  --file       JSON file {"files":["https://…"]} — exact-URL purge
  --zone       zone id override (default: resolved via /zones?name=hibana.ir)
  --zone-name  zone name for resolution + verification base (default hibana.ir)
  --dry        show the plan, touch nothing
  --no-verify skip post-purge edge probes`)
  process.exit(0)
}

// ---------- token (env → credentials.md; never printed) ----------
let token = process.env.CLOUDFLARE_API_TOKEN || ''
if (!token) {
  const credsPath = join(REPO_ROOT, 'credentials.md')
  if (existsSync(credsPath)) {
    const m = readFileSync(credsPath, 'utf8').match(/cfut_[A-Za-z0-9]+/) // first = deploy token
    if (m) token = m[0]
  }
}
if (!token) {
  console.error('no token: set CLOUDFLARE_API_TOKEN or put the deploy token in credentials.md')
  process.exit(2)
}
const ZONE_NAME = flag('--zone-name') || 'hibana.ir'
const API = 'https://api.cloudflare.com/client/v4'
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const warn = (msg) => { if (process.env.CI) console.log(`::warning::${msg}`) }

// ---------- zone resolution ----------
let zoneId = flag('--zone') || process.env.CLOUDFLARE_ZONE_ID || ''
if (!zoneId) {
  const r = await fetch(`${API}/zones?name=${encodeURIComponent(ZONE_NAME)}&per_page=5`, {
    headers: H, signal: AbortSignal.timeout(15000),
  })
  const b = await r.json().catch(() => ({}))
  if (!r.ok || !b?.success) {
    console.error(`zone lookup failed: HTTP ${r.status}${b?.errors?.length ? ' ' + JSON.stringify(b.errors.map((e) => e.code + ':' + e.message)) : ''}`)
    process.exit(2)
  }
  const z = (b.result ?? []).find((x) => x.name === ZONE_NAME)
  if (!z) { console.error(`zone "${ZONE_NAME}" not found in this account`); process.exit(2) }
  zoneId = z.id
}

// ---------- collect exact URLs (--file / --url) ----------
let files = [...urls]
const filePath = flag('--file')
if (filePath) {
  if (!existsSync(filePath)) { console.error(`--file not found: ${filePath}`); process.exit(2) }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  const arr = Array.isArray(parsed) ? parsed : parsed.files
  if (!Array.isArray(arr) || arr.length === 0) { console.error('--file must be {"files":[…]} or an array of URLs'); process.exit(2) }
  files = files.concat(arr)
}
files = [...new Set(files.map(String))]
for (const u of files) {
  try { if (!/^https?:\/\//.test(new URL(u).href)) throw 0 } catch { console.error(`bad URL: ${u}`); process.exit(2) }
}

const mode = files.length ? `exact URLs (${files.length})` : 'purge_everything'
console.log(`zone: ${ZONE_NAME} (${zoneId.slice(0, 8)}…)`)
console.log(`mode: ${mode}${DRY ? '  [DRY — nothing purged]' : ''}`)
if (DRY) {
  if (files.length) files.forEach((u) => console.log(`  - ${u}`))
  console.log('dry run ok — token present, zone resolved')
  process.exit(0)
}

// ---------- purge (chunked 30 for URL purges; 1 retry on 429/5xx/network) ----------
const purgeBody = files.length ? null : { purge_everything: true }
const chunks = []
for (let i = 0; i < Math.max(files.length, 1); i += 30) chunks.push(files.slice(i, i + 30))

const RUNBOOK = `the deploy token lacks Zone → Cache Purge (this is exactly what made the S72
stale-nav incident a multi-step fix). Grant it — 60 seconds, one-time, dashboard-only
(the API cannot edit a token's own permissions):
  1. dash.cloudflare.com → My Profile → API Tokens
  2. find the deploy token (the one CD/wrangler uses — CLOUDFLARE_API_TOKEN)
  3. Edit → Permissions → Add more → Zone | Cache Purge | Purge
  4. Zone Resources: Include → All zones (hibana.ir is the account's only zone) → Save
The token VALUE does not change → the GitHub secret needs no update.
Then re-run: npm run purge  (and cd.yml purges automatically after every prod deploy)`

let lastErr = null
for (const chunk of chunks) {
  const body = purgeBody ?? { files: chunk }
  let done = false
  for (let attempt = 1; attempt <= 2 && !done; attempt++) {
    let r, b
    try {
      r = await fetch(`${API}/zones/${zoneId}/purge_cache`, {
        method: 'POST', headers: H, body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      })
      b = await r.json().catch(() => ({}))
    } catch (e) {
      lastErr = `network: ${e instanceof Error ? e.message : String(e)}`
      if (attempt === 1) { await new Promise((s) => setTimeout(s, 2000)); continue }
      break
    }
    if (r.ok && b?.success) { done = true; lastErr = null; break }
    const codes = (b?.errors ?? []).map((e) => `${e.code}:${e.message}`).join('; ')
    if (r.status === 401 || r.status === 403) {
      // CF reports a missing token scope as 401 "Authentication error" (or 403 9109) even
      // though /user/tokens/verify is 200 — this is the permission-missing signature.
      console.error(`PURGE DENIED: HTTP ${r.status} ${codes || '(no detail)'}`)
      console.error(RUNBOOK)
      warn(`CD purge skipped — deploy token lacks Zone.Cache Purge (see Changelogs §4 runbook)`)
      process.exit(1)
    }
    lastErr = `HTTP ${r.status} ${codes || '(no detail)'}`
    if ((r.status === 429 || r.status >= 500) && attempt === 1) {
      await new Promise((s) => setTimeout(s, 2000)); continue
    }
    break
  }
  if (!done) { console.error(`purge failed: ${lastErr}`); process.exit(2) }
}
console.log(files.length ? `purged ${files.length} URL(s) — accepted` : 'purge_everything accepted')

// ---------- post-purge diagnostics (informational — NOT pass/fail) ----------
// S74 CORRECTION of the S73 assumption: on this architecture / and /login
// legitimately serve cf-cache-status: HIT right after a successful purge.
// Workers Assets fronts every static path with a content-addressed edge layer
// that re-keys on EVERY deploy (S74 byte-verified: /login, /, and the S72
// incident URL /partials/nav?v=3 all served byte-identical-to-build content
// minutes after deploy, while showing HIT with no age header). The purge's
// target is the ZONE cache — the S72 stale-nav layer (custom-domain-only,
// drops query strings, ignores origin max-age) — and the API "success" above
// is the only reliable signal that it cleared. These probes print what the
// edge serves RIGHT NOW so an incident investigation has the data in the log;
// they CANNOT distinguish an always-fresh assets HIT from a zone-cache HIT,
// so they never fail the run and never emit warnings (S73's MISS/DYNAMIC
// expectation false-alarmed on every single run — warning fatigue).
if (!NO_VERIFY) {
  const base = `https://${ZONE_NAME}`
  const probes = ['/', '/login', '/api/nav']
  console.log('edge probes (informational — an assets-layer HIT is normal and always deploy-fresh):')
  for (const p of probes) {
    try {
      const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
      const cs = r.headers.get('cf-cache-status') ?? '(none)'
      const age = r.headers.get('age') ?? '-'
      const cc = (r.headers.get('cache-control') ?? '-').slice(0, 40)
      console.log(`  ${p.padEnd(10)} HTTP ${r.status}  cf-cache-status=${cs}  age=${age}s  cc=${cc}`)
    } catch (e) {
      console.log(`  ${p.padEnd(10)} probe failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
console.log('done')
