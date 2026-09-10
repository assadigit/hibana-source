// Read-only prod D1 query: screenshot-push errors in error_log (session-9 audit)
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.secrets.env', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const DATABASE_ID = "d842fcb5-44f6-4bbd-a772-3699ccadb496"
const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID
const TOKEN = env.CLOUDFLARE_API_TOKEN
const sql = `SELECT path, status, code, substr(message,1,90) AS msg, datetime(created_at) AS at FROM error_log WHERE path LIKE '%screenshots%' ORDER BY created_at DESC LIMIT 10`
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql }),
})
const j = await res.json()
if (!j.success) { console.error('API error', JSON.stringify(j.errors).slice(0, 300)); process.exit(1) }
const rows = j.result?.[0]?.results ?? []
console.log('screenshot-path errors in prod error_log:', rows.length)
for (const r of rows) console.log(r.at, r.status, r.code, r.msg)
const sql2 = `SELECT COUNT(*) AS n FROM screenshots`
const res2 = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: sql2 }) })
const j2 = await res2.json()
console.log('prod screenshots rows:', j2.result?.[0]?.results)
