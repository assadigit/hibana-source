// Math human-check (2026-08-30 (e)) — replaced Cloudflare Turnstile so signup has no
// third-party dependency. A small arithmetic challenge is signed with HMAC-SHA-256 plus
// an expiry; the answer is compared timing-safely after digit normalization, so a
// Persian/Arabic-numeral keyboard works. No state is stored: the token IS the challenge.
//
// P2.1 (F-M6, 2026-09-02): the token no longer carries the operands as separate dot-
// separated fields (`a.b.op.expS.sig`) — splitting by `.` recovered a/b/op directly, so
// a 4-line bot script defeated the captcha. The token now carries the QUESTION STRING
// (`"14 + 4 ="`) + expiry + sig. The operands are visible in the question anyway (that's
// the whole point), but they're no longer pre-split for a bot; parsing the question string
// is the same work a human does to read it.

import { timingSafeEqualStr } from '../lib/crypto'

const CAPTCHA_TTL_MS = 10 * 60 * 1000

const enc = new TextEncoder()

/** HMAC-SHA-256 of `payload` under `secret`, hex-encoded — the challenge signature. */
async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// timingSafeEqualStr moved to src/lib/crypto.ts (P2.2 / F-L28).

/** The human-readable question (e.g. "14 + 4 ="). */
const questionOf = (ch: Challenge) => `${ch.a} ${ch.op} ${ch.b} =`

/**
 * The signed payload — the question string + expiry, dot-separated. The question contains
 * no dots (integers + space + +/- + space + integer + " ="), so the token's structure is
 * unambiguous: `question.expS.sig`.
 */
const payloadOf = (ch: Challenge) => `${questionOf(ch)}.${ch.expS}`

interface Challenge {
  a: number
  b: number
  op: string
  expS: number
}

/** Persian ۰-۹ + Arabic ٠-٩ → ASCII digits, spaces/ZWNJ/LRM/RLM stripped. */
function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s\u200c\u200e\u200f]/g, '')
}

/** A fresh question: random +/−, ranges per the deployed generator, HMAC-signed. */
export async function issueMathCaptcha(secret: string, ttlMs = CAPTCHA_TTL_MS): Promise<{ question: string; token: string }> {
  const rand = crypto.getRandomValues(new Uint8Array(3))
  const op = rand[0] % 2 === 0 ? '+' : '-'
  const a = op === '+' ? 3 + (rand[1] % 18) : 10 + (rand[1] % 11)
  const b = op === '+' ? 2 + (rand[2] % 11) : 2 + (rand[2] % (a - 2))
  const ch = { a, b, op, expS: Math.floor((Date.now() + ttlMs) / 1000) }
  const sig = await hmacHex(secret, payloadOf(ch))
  return { question: questionOf(ch), token: `${payloadOf(ch)}.${sig}` }
}

type CaptchaResult = 'missing_secret' | 'missing_token' | 'invalid' | 'expired' | 'ok'

export async function verifyMathCaptcha(
  secret: string | undefined,
  token: string | undefined,
  answer: string | undefined,
): Promise<CaptchaResult> {
  if (!secret) return 'missing_secret'
  if (!token) return 'missing_token'
  // P2.1 (F-M6): split from the RIGHT so the question (which may contain any characters
  // except dots) is never mis-parsed. Token format: `question.expS.sig`.
  const lastDot = token.lastIndexOf('.')
  if (lastDot < 1) return 'invalid'
  const sig = token.slice(lastDot + 1)
  const rest = token.slice(0, lastDot)
  const secondDot = rest.lastIndexOf('.')
  if (secondDot < 1) return 'invalid'
  const expS = Number(rest.slice(secondDot + 1))
  const question = rest.slice(0, secondDot)
  if (!Number.isInteger(expS)) return 'invalid'
  // Parse the question "a op b =" back into {a, op, b} to re-derive the expected sig.
  const m = question.match(/^(\d+)\s*([+\-])\s*(\d+)\s*=$/)
  if (!m) return 'invalid'
  const ch: Challenge = { a: Number(m[1]), op: m[2], b: Number(m[3]), expS }
  const expect = await hmacHex(secret, payloadOf(ch))
  if (!timingSafeEqualStr(sig, expect)) return 'invalid'
  if (Date.now() / 1000 > ch.expS) return 'expired'
  const expected = ch.op === '+' ? ch.a + ch.b : ch.a - ch.b
  return normalizeDigits(String(answer ?? '')) === String(expected) ? 'ok' : 'invalid'
}
