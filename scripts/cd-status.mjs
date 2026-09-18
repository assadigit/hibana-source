#!/bin/env node
// S70 helper: poll the latest CD run status.
import { readFileSync } from 'node:fs'
const creds = readFileSync('credentials.md', 'utf8')
const token = (creds.match(/ghp_[A-Za-z0-9]+/) || [])[0]
const res = await fetch('https://api.github.com/repos/assadigit/hibana-source/actions/workflows/cd.yml/runs?per_page=1', {
  headers: { Authorization: `Bearer ${token}` },
})
const j = await res.json()
const r = j.workflow_runs?.[0]
if (!r) { console.log('no CD runs found'); process.exit(1) }
console.log(r.status, r.conclusion ?? '(running)', r.head_sha.slice(0, 7))
if (r.conclusion && r.conclusion !== 'success') process.exit(2)
