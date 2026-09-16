// S59b — email_log kind CHECK coverage (migration 0058).
//
// The pre-0058 CHECK (left by 0041) allowed only verify/reset/custom/broadcast/
// reminder/invite — but sendAndLog call sites also log 'test' (dev.ts) and
// 'backup_failed' (scheduledBackup's failure alert). logEmail's best-effort catch
// swallowed the constraint violation, so those rows vanished silently: the
// 09-12→09-16 backup fail storm sent alert emails that left ZERO email_log rows and
// read as "the alert path is dead" in the S59 forensics. 0058 widens the CHECK to
// the full vocabulary; this file pins it so a future kind can never silently
// regress the same way — add the kind to EMAIL_KINDS when you add a sendAndLog call.
import { describe, it, expect } from 'vitest'
import type { Db } from '../db/types'
import { makeTestDb, makeTestDbUpto } from './helpers'

/** Every kind any sendAndLog/logEmail call site can log today — keep in sync with the
 * CHECK in migrations/0058_email_log_kinds.sql (the migration comment lists them). */
const EMAIL_KINDS = [
  'verify', 'reset', 'custom', 'broadcast', 'reminder', 'invite', 'test', 'backup_failed',
] as const

async function insertKind(db: Db, kind: string): Promise<void> {
  await db.execute(
    "INSERT INTO email_log (id, to_email, kind, subject, status, sent_at) VALUES ('k-test', 'a@b.c', ?, 's', 'sent', '2026-09-16T00:00:00Z')",
    [kind],
  )
}

describe('email_log kind CHECK (0058)', () => {
  it('accepts every kind the app logs', async () => {
    const { db, close } = makeTestDb()
    try {
      for (const kind of EMAIL_KINDS) {
        await expect(insertKind(db, kind), `kind=${kind}`).resolves.toBeUndefined()
        await db.execute('DELETE FROM email_log WHERE kind = ?', [kind])
      }
    } finally {
      close()
    }
  })

  it('pre-0058 schema rejected backup_failed — the exact silent-drop this migration closes', async () => {
    const { db, close } = makeTestDbUpto(57)
    try {
      await expect(insertKind(db, 'backup_failed')).rejects.toThrowError(/constraint/i)
    } finally {
      close()
    }
  })

  it('still rejects unknown kinds (the CHECK keeps guarding typos — loudly now that logEmail warns)', async () => {
    const { db, close } = makeTestDb()
    try {
      await expect(insertKind(db, 'verfy')).rejects.toThrowError(/constraint/i) // typo'd kind must not land
    } finally {
      close()
    }
  })

  it('idx_email_log_status_sent exists on email_log (0041 dropped it; 0058 restores it)', async () => {
    const { db, close } = makeTestDb()
    try {
      const rows = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'email_log' AND name = 'idx_email_log_status_sent'",
      )
      expect(rows).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('quota count over the index-backed columns (smoke: emailsSentToday shape)', async () => {
    const { db, close } = makeTestDb()
    try {
      await insertKind(db, 'reminder')
      const rows = await db.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM email_log WHERE status = 'sent' AND sent_at >= '2026-09-16T00:00:00Z'",
      )
      expect(rows[0]?.n).toBe(1)
    } finally {
      close()
    }
  })
})
