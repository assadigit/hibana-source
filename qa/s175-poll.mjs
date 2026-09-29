#!/usr/bin/env node
// S175 release-chain poller — watches the CI + CD runs for a sha until both complete.
// Usage: node qa/s175-poll.mjs <sha> [maxMinutes]
import { readFileSync } from 'node:fs'

const sha = process.argv[2]
const maxMin = Number(process.argv[3] || 15)
const token = (readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').match(/^GITHUB_TOKEN=(.+)$/m) || [])[1]?.trim()
if (!sha || !token) { console.error('need <sha> + .secrets.env GITHUB_TOKEN'); process.exit(2) }

const deadline = Date.now() + maxMin * 60_000
while (Date.now() < deadline) {
  const res = await fetch(`https://api.github.com/repos/assadigit/hibana-source/actions/runs?per_page=10`, { headers: { Authorization: `token ${token}` } })
  const j = await res.json()
  const mine = j.workflow_runs.filter((r) => r.head_sha.startsWith(sha))
  const lines = mine.map((r) => `${r.id} ${r.name} ${r.status} ${r.conclusion || '-'}`)
  console.log(lines.join('\n') || '(no runs yet)')
  const ci = mine.find((r) => r.name === 'CI')
  const cd = mine.find((r) => r.name === 'CD')
  if (ci && cd && ci.status === 'completed' && cd.status === 'completed') {
    console.log(`FINAL: CI=${ci.conclusion} CD=${cd.conclusion}`)
    process.exit(ci.conclusion === 'success' && cd.conclusion === 'success' ? 0 : 1)
  }
  await new Promise((r) => setTimeout(r, 25_000))
}
console.error('timeout waiting for CI+CD')
process.exit(3)
