// Math human-check (2026-08-30 (e)) — replaced Cloudflare Turnstile so signup has no
// third-party dependency. A small arithmetic challenge is signed with HMAC-SHA-256 plus
// an expiry; the answer is compared timing-safely after digit normalization, so a
// Persian/Arabic-numeral keyboard works. No state is stored: the token IS the challenge.

const CAPTCHA_TTL_MS = 10 * 60 * 1000

const enc = new TextEncoder()

/** HMAC-SHA-256 of `payload` under `secret`, hex-encoded — the challenge signature. */
async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** The signed payload — everything the verifier must re-derive to trust the token. */
const payloadOf = (ch: Challenge) => `${ch.a}.${ch.b}.${ch.op}.${ch.expS}`

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
  return { question: `${a} ${op} ${b} =`, token: `${payloadOf(ch)}.${sig}` }
}

export type CaptchaResult = 'missing_secret' | 'missing_token' | 'invalid' | 'expired' | 'ok'

export async function verifyMathCaptcha(
  secret: string | undefined,
  token: string | undefined,
  answer: string | undefined,
): Promise<CaptchaResult> {
  if (!secret) return 'missing_secret'
  if (!token) return 'missing_token'
  const parts = token.split('.')
  if (parts.length !== 5) return 'invalid'
  const sig = parts[4] ?? ''
  const ch: Challenge = { a: Number(parts[0]), b: Number(parts[1]), op: parts[2], expS: Number(parts[3]) }
  if (!Number.isInteger(ch.a) || !Number.isInteger(ch.b) || (ch.op !== '+' && ch.op !== '-') || !Number.isInteger(ch.expS)) {
    return 'invalid'
  }
  const expect = await hmacHex(secret, payloadOf(ch))
  if (!timingSafeEqual(sig, expect)) return 'invalid'
  if (Date.now() / 1000 > ch.expS) return 'expired'
  const expected = ch.op === '+' ? ch.a + ch.b : ch.a - ch.b
  return normalizeDigits(String(answer ?? '')) === String(expected) ? 'ok' : 'invalid'
}
