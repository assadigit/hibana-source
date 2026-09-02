// Shared helpers for scripts. `loadSecrets()` parses the gitignored credential files so an
// agent can USE the stored tokens/API keys in-process WITHOUT the user re-pasting them.
//
// Files:
//   .secrets.env  -> service tokens (GITHUB_TOKEN, RESEND_KEY, TELEGRAM_*, OWNER_EMAIL)
//   .admin.secrets-> seeded super-admin logins (DEV_ADMIN, DEV_ADMIN_PASS, PROD_ADMIN, ...)
//
// SECURITY: these values must never be printed to a transcript. Use them inside scripts
// (e.g. pass to fetch()/wrangler via stdin/headers) and only report booleans/counts.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function parseKeyValue(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

export function secrets() {
  return {
    ...parseKeyValue(join(process.cwd(), '.secrets.env')),
    ...parseKeyValue(join(process.cwd(), '.admin.secrets')),
  }
}

/** Non-destructive existence/summary check (safe to log). */
export function secretsSummary() {
  const s = secrets()
  return Object.keys(s).map((k) => `${k}${s[k] ? ': set' : ': empty'}`)
}

// CLI: `node scripts/lib.mjs --summary` prints only key-status (no values).
if (process.argv[1] && process.argv[1].endsWith('lib.mjs')) {
  if (process.argv.includes('--summary')) {
    console.log(secretsSummary().join('\n'))
  } else {
    console.log('Usage: node scripts/lib.mjs --summary   (only reports which keys are set)')
  }
}