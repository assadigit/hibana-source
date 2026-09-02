// Rule 6: PBKDF2 via Web Crypto. bcrypt/argon2 need native bindings Workers doesn't provide,
// so this is the documented, dependency-free alternative. Iterations are stored in the hash
// string so they can be raised later without invalidating existing hashes.

import { timingSafeEqual } from '../lib/crypto'

const ITERATIONS = 100_000 // >= 100,000 per rule 6
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
  if (!Number.isInteger(iterations) || iterations < 100_000) return false
  const salt = fromB64(parts[2])
  const expected = fromB64(parts[3])

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, expected.length * 8),
  )
  return timingSafeEqual(bits, expected)
}

// timingSafeEqual moved to src/lib/crypto.ts (P2.2 / F-L28).