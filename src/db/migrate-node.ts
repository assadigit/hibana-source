import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Local / self-hosted migration runner — mirrors `wrangler d1 migrations apply`
// (rule 4: the same numbered SQL files drive every environment).
// Imported only by Node entry points and tests — never by the Worker entry.
export function applyMigrations(dbPath: string, migrationsDir: string): void {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  )
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

  db.exec('BEGIN')
  try {
    for (const f of files) {
      if (applied.has(f)) continue
      db.exec(readFileSync(join(migrationsDir, f), 'utf8'))
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString())
      console.log(`applied ${f}`)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  db.close()
}