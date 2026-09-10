// Constant-time comparison helpers (P2.2 / F-L28).
//
// Web Crypto has no built-in constant-time compare; these XOR-folds are the standard
// replacement. Both early-return on length mismatch, which only reveals the length —
// acceptable for the fixed-length inputs they guard (PBKDF2 32-byte hash, 64-char HMAC
// sig hex, Telegram secret of configured length). The length-leak is NOT exploitable
// for any current caller.

/** Byte-wise constant-time compare (PBKDF2 derived bits vs stored hash). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Char-wise constant-time string compare (HMAC sig hex, Telegram webhook secret). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
