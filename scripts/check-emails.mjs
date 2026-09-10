#!/usr/bin/env node
// P0 email check (ROADMAP): confirm the Resend pipeline actually delivers.
// Reads RESEND_KEY + OWNER_EMAIL in-process (never printed).
//   node scripts/check-emails.mjs            # list recent sends + delivery status
//   node scripts/check-emails.mjs --send     # send a fresh test email, then list
// Note: the stored RESEND_KEY is a sending-only key (Resend "restricted_api_key"), so the
// history/list endpoint returns 401 — delivery can't be confirmed via the API; the owner must
// check the inbox. Sending a test email still proves the send path works.
// Resend "last_event": sent → delivered (accepted by inbox) → opened/clicked.
// Prints status only, no secret values.

import { secrets } from './lib.mjs'

const s = secrets()
const API = 'https://api.resend.com'
const key = s.RESEND_KEY
if (!key) {
  console.error('RESEND_KEY not set in .secrets.env')
  process.exit(1)
}
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }

async function list() {
  const res = await fetch(`${API}/emails?limit=25`, { headers })
  if (res.status === 401) {
    const j = await res.json().catch(() => ({}))
    if (j?.name === 'restricted_api_key') {
      console.log('Resend key is sending-only — the history endpoint is refused (401 restricted_api_key).')
      console.log('Delivery cannot be checked via the API; the owner must confirm arrival in the inbox.')
      return
    }
  }
  if (!res.ok) throw new Error(`Resend list failed (${res.status}): ${await res.text()}`)
  const { data } = await res.json()
  if (!data || data.length === 0) {
    console.log('no emails in Resend history yet')
    return
  }
  console.log(`recent sends: ${data.length}`)
  for (const e of data) {
    const to = Array.isArray(e.to) ? e.to.join(',') : String(e.to ?? '?')
    console.log(`  [${e.last_event ?? '?'}] ${e.created_at ?? ''} -> ${to} :: ${e.subject ?? ''}`)
  }
  const delivered = data.filter((e) => e.last_event === 'delivered' || e.last_event === 'opened' || e.last_event === 'clicked').length
  const problem = data.filter((e) => e.last_event === 'bounced' || e.last_event === 'complained').length
  console.log(`delivery status: ${delivered} delivered/opened, ${problem} bounced/complained`)
}

if (process.argv.includes('--send')) {
  if (!s.OWNER_EMAIL) {
    console.error('OWNER_EMAIL not set in .secrets.env')
    process.exit(1)
  }
  const res = await fetch(`${API}/emails`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: 'Hibana <onboarding@resend.dev>',
      to: [s.OWNER_EMAIL],
      subject: 'Hibana — P0 email check',
      html: '<p>P0 email verification: if this arrives, the Resend pipeline is delivering.</p>',
    }),
  })
  if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`)
  console.log(`fresh test email sent to ${s.OWNER_EMAIL}`)
  await new Promise((r) => setTimeout(r, 4000))
  console.log('---')
}

try {
  await list()
} catch (err) {
  console.error('EMAIL CHECK ERROR:', err instanceof Error ? err.message : err)
  process.exit(1)
}
