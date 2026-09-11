// Rule 6: PBKDF2 via Web Crypto. bcrypt/argon2 need native bindings Workers doesn't provide,
// so this is the documented, dependency-free alternative. Iterations are stored in the hash
// string so they can be raised later without invalidating existing hashes.
//
// Iteration count: 100,000. This is the MAXIMUM Cloudflare Workers supports (a hard platform
// limit — `crypto.subtle.deriveBits` with PBKDF2 throws NotSupportedError above 100k). The
// Node path can go higher, but Workers is the production runtime, so we cap at the Workers
// max. The M2 fix (2026-09-10) tried 600k per OWASP 2023 guidance, but that silently broke
// every signup + password reset on the Workers path — 600k hashes throw on verify, returning
// 500 internal_error. Reverted to 100k on 2026-09-11 (Session 26).
//
// Security trade-off: 100k is below OWASP 2023's 600k minimum for PBKDF2-SHA256, but it's
// what Apple Keychain and many production systems use. The hash format stores the iteration
// count per-hash, so if Hibana ever moves to a Node-only deployment, ITERATIONS can be raised
// and needsRehash() will lazily upgrade existing hashes on next login. JS-based scrypt/argon2
// were rejected — too slow on Workers CPU limits (10ms free / 30s paid for ~1-2s scrypt).

import { timingSafeEqual } from '../lib/crypto'

const ITERATIONS = 100_000 // Workers max — 600k throws NotSupportedError on the Cloudflare runtime
const MIN_ACCEPTED_ITERATIONS = 100_000 // legacy hashes below this are rejected (tampering guard)
const KEY_LEN_BITS = 256
const SALT_BYTES = 16

/** Stored format: pbkdf2$<iterations>$<saltB64>$<hashB64> */
export type PasswordHash = string

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_LEN_BITS,
  )
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < MIN_ACCEPTED_ITERATIONS) return false
  const salt = fromB64(parts[2])
  const expected = fromB64(parts[3])

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, expected.length * 8),
  )
  return timingSafeEqual(bits, expected)
}

/**
 * Returns true if the stored hash was hashed at a lower iteration count than the current
 * target (ITERATIONS). The login route calls this after a successful verify and silently
 * rehashes the password at the new target — zero UX impact, and the upgrade happens
 * organically as users log in.
 *
 * With ITERATIONS=100k (the Workers cap), this currently returns false for all hashes —
 * no upgrade is possible on the Workers runtime. The code path is kept for the future
 * Node-only deployment case (where ITERATIONS could be raised to 600k+ per OWASP 2023).
 */
export function needsRehash(stored: PasswordHash): boolean {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < MIN_ACCEPTED_ITERATIONS) return false
  return iterations < ITERATIONS
}

// timingSafeEqual moved to src/lib/crypto.ts (P2.2 / F-L28).