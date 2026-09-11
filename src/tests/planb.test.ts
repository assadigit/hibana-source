import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createApp } from '../app'
import { sendPlanBBackupToChat, prunePlanB, PLANB_RETENTION_DEFAULT } from '../services/backup-planb'
import { importAesKey, decryptBackup, isEncryptedBlob } from '../services/backup'
import type { Config } from '../types'
import type { Db } from '../db/types'

// Plan B backup channel (0044 → session 14, docs/perf-and-data-safety.md §1): the
// Telegram disaster-recovery copy is ON-DEMAND ONLY now — the 4×/day automatic cron push
// was removed (it filled the owner's chat with backup documents). Senders: the bot's ⚙
// Settings 🗄 button (webhook callback 'bak', owner-only) and POST /api/admin/backup/planb.
// These tests pin: the gates (bot token, encryption-mandatory), the on-demand webhook
// path (owner send + member no-op), the send itself (multipart + HIBENC1 blob + silent +
// caption + pin), the planb_backups log, retention, and the rule-8 round-trip.

// A valid base64 32-byte AES key (test-only; deterministic so decrypt is verifiable).
const ENC_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')

function planCfg(db: Db, over: Partial<Config> = {}): Config {
  return {
    db,
    isProd: true,
    github: { owner: 'x', repo: 'y', token: '' },
    telegramToken: 'test-bot-token',
    backupEncryptionKey: ENC_KEY,
    ...over,
  }
}

/** Capture every outbound Bot API call; return {calls, respond} where respond maps a
 * URL substring → JSON body, defaulting to a generic ok. */
function stubBotApi(respond: (url: string) => unknown = () => ({ ok: true })) {
  const originalFetch = globalThis.fetch
  const calls: { url: string; body?: unknown }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('api.telegram.org/bot')) {
      calls.push({ url, body: init?.body })
      return new Response(JSON.stringify(respond(url) ?? { ok: true }))
    }
    return originalFetch(input, init)
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

/** Decode a multipart sendDocument body to text (the HIBENC1 blob is base64 = ASCII). */
const bodyText = (body: unknown): string =>
  body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body ?? '')

describe('Plan B — Telegram backup channel (0044, on-demand since session 14)', () => {
  it('migration 0044: users.telegram_backup still defaults 0 + planb_backups exists (column retired, kept for rollback safety)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const rows = await db.query<{ telegram_backup: number }>('SELECT telegram_backup FROM users WHERE id = ?', [userId])
      expect(rows[0].telegram_backup).toBe(0)
      await db.query('SELECT COUNT(*) AS n FROM planb_backups') // table exists
    } finally {
      close()
    }
  })

  it('webhook: owner taps 🗄 Send backup now in Settings → ONE encrypted document lands + confirmation', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { role: 'owner' })
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', userId])
      await db.execute('UPDATE users SET language_pref = ? WHERE id = ?', ['en', userId])
      const { app } = (await makeApp(db, { backupEncryptionKey: ENC_KEY }))!
      const stub = stubBotApi((url) => {
        if (url.includes('sendDocument')) {
          return { ok: true, result: { message_id: 77, document: { file_id: 'FILE-X', file_size: 512 } } }
        }
        return { ok: true }
      })
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret', Origin: 'http://local' },
            body: JSON.stringify({
              callback_query: {
                id: 'cb1',
                from: { id: 77 },
                message: { message_id: 55, chat: { id: 9001 }, text: 'x' },
                data: 'bak',
              },
            }),
          }),
        )
        expect(res.status).toBe(200)

        // Exactly ONE document send — the on-demand tap is the only trigger.
        const sends = stub.calls.filter((c) => c.url.includes('sendDocument'))
        expect(sends).toHaveLength(1)
        expect(bodyText(sends[0].body)).toContain('9001')

        // The settings message is edited to the confirmation (sha256 + UTC time).
        const edit = stub.calls.find((c) => c.url.includes('editMessageText'))
        expect(edit).toBeTruthy()
        expect(bodyText(edit?.body)).toContain('Backup sent')
        expect(bodyText(edit?.body)).toContain('sha256')

        // The log row exists (powers the drill + retention).
        const log = await db.query<{ user_id: string; chat_id: string; message_id: number; file_id: string }>(
          'SELECT user_id, chat_id, message_id, file_id FROM planb_backups',
        )
        expect(log).toHaveLength(1)
        expect(log[0].message_id).toBe(77)
        expect(log[0].file_id).toBe('FILE-X')
      } finally {
        stub.restore()
      }
    } finally {
      close()
    }
  })

  it('webhook: owner taps 🗄 with NO encryption key configured → refusal, zero documents, honest reason', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { role: 'owner' })
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', userId])
      await db.execute('UPDATE users SET language_pref = ? WHERE id = ?', ['en', userId])
      const { app } = (await makeApp(db, { backupEncryptionKey: undefined }))!
      const stub = stubBotApi()
      try {
        await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret', Origin: 'http://local' },
            body: JSON.stringify({
              callback_query: { id: 'cb1', from: { id: 77 }, message: { message_id: 55, chat: { id: 9001 }, text: 'x' }, data: 'bak' },
            }),
          }),
        )
        expect(stub.calls.filter((c) => c.url.includes('sendDocument'))).toHaveLength(0)
        const edit = stub.calls.find((c) => c.url.includes('editMessageText'))
        expect(bodyText(edit?.body)).toContain('Backup failed')
        expect(bodyText(edit?.body)).toContain('BACKUP_ENCRYPTION_KEY')
      } finally {
        stub.restore()
      }
    } finally {
      close()
    }
  })

  it('webhook: Settings shows the Backup button for owners, NOT for members; a member tapping a crafted "bak" is a no-op', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner' })
      const memberId = await makeUser(db, { role: 'member' })
      await db.execute('UPDATE users SET telegram_chat_id = ?, language_pref = ? WHERE id = ?', ['9001', 'en', ownerId])
      await db.execute('UPDATE users SET telegram_chat_id = ?, language_pref = ? WHERE id = ?', ['9002', 'en', memberId])
      const { app } = (await makeApp(db, { backupEncryptionKey: ENC_KEY }))!
      const stub = stubBotApi()
      try {
        const tap = (chatId: number, data: string) =>
          app.fetch(
            new Request('http://local/api/telegram/webhook', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret', Origin: 'http://local' },
              body: JSON.stringify({
                callback_query: { id: 'cb1', from: { id: 77 }, message: { message_id: 55, chat: { id: chatId }, text: 'x' }, data },
              }),
            }),
          )

        await tap(9001, 'set')
        await tap(9002, 'set')

        const edits = stub.calls.map((c) => bodyText(c.body))
        const ownerRender = edits.find((b) => b.includes('9001') && b.includes('Backup: on-demand'))
        const memberRender = edits.find((b) => b.includes('9002') && b.includes('Settings'))
        expect(ownerRender).toBeTruthy()
        expect(ownerRender).toContain('callback_data":"bak"')
        expect(memberRender).toBeTruthy()
        expect(memberRender).not.toContain('Backup: on-demand')
        expect(memberRender).not.toContain('"bak"')

        // A member sending a crafted 'bak' callback must never receive the whole-DB blob.
        await tap(9002, 'bak')
        expect(stub.calls.filter((c) => c.url.includes('sendDocument'))).toHaveLength(0)
        const after = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM planb_backups')
        expect(after[0].n).toBe(0)
      } finally {
        stub.restore()
      }
    } finally {
      close()
    }
  })

  it('sendPlanBBackupToChat: sends the HIBENC1-encrypted snapshot silently, logs it, round-trips (rule 8)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { role: 'owner' })
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', userId])
      await db.execute(
        "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES ('p1', ?, 'P1', 'd', 'personal', 'spark', 0, 'n', ?, ?)",
        [userId, new Date().toISOString(), new Date().toISOString()],
      )

      const stub = stubBotApi((url) => {
        if (url.includes('sendDocument')) {
          return { ok: true, result: { message_id: 42, document: { file_id: 'FILE-ID-1', file_size: 999 } } }
        }
        return { ok: true }
      })
      try {
        const result = await sendPlanBBackupToChat(planCfg(db), userId, '9001')
        expect(result.ok).toBe(true)
        expect(result.reason).toBeUndefined()
        expect(result.messageId).toBe(42)
        expect(result.fileId).toBe('FILE-ID-1')
        expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)

        // The send: multipart to sendDocument, silent, hashed filename, caption with sha.
        const send = stub.calls.find((c) => c.url.includes('sendDocument'))
        expect(send).toBeTruthy()
        const text = bodyText(send?.body)
        expect(text).toContain('name="chat_id"')
        expect(text).toContain('9001')
        expect(text).toContain('name="disable_notification"')
        expect(text.toLowerCase()).toContain('true') // silent — a requested document is not an alert
        expect(text).toContain('filename="hibana-backup-')
        expect(text).toContain('.bin"')
        expect(text).toContain('sha256 ')
        expect(text).toContain('schema ')

        // The newest document is pinned (unpin-all then pin), best-effort.
        expect(stub.calls.some((c) => c.url.includes('unpinAllChatMessages'))).toBe(true)
        expect(stub.calls.some((c) => c.url.includes('pinChatMessage') && bodyText(c.body).includes('"message_id":42'))).toBe(true)

        // The planb_backups log row carries the drill's handles.
        const log = await db.query<{ user_id: string; chat_id: string; message_id: number; file_id: string; sha256: string; schema_version: number }>(
          'SELECT user_id, chat_id, message_id, file_id, sha256, schema_version FROM planb_backups',
        )
        expect(log).toHaveLength(1)
        expect(log[0].file_id).toBe('FILE-ID-1')
        expect(log[0].sha256).toBe(result.sha256)
        expect(log[0].schema_version).toBe(20260920) // Session 20: snapshot shape gained project_archives + dev_task_tags

        // Round-trip: the document content is the BASE64 TEXT of the encrypted blob
        // (same format as a GitHub snapshot file). Extract it from the multipart body,
        // decode, and verify it is the rule-8-compliant snapshot with the SAME key.
        const blobB64 = text.split('Content-Type: application/octet-stream\r\n\r\n')[1]?.split('\r\n--')[0]
        expect(blobB64).toBeTruthy()
        const blobBytes = new Uint8Array(Buffer.from(blobB64, 'base64'))
        expect(isEncryptedBlob(blobBytes)).toBe(true)
        const key = await importAesKey(ENC_KEY)
        const plain = new TextDecoder().decode(await decryptBackup(key, blobBytes))
        const snapshot = JSON.parse(plain)
        expect(snapshot.schema_version).toBe(20260920)
        expect((snapshot.data.users ?? []).some((r: Record<string, unknown>) => 'password_hash' in r)).toBe(false)
        expect('sessions' in snapshot.data).toBe(false)
        expect(snapshot.data.projects).toHaveLength(1) // the row we planted
      } finally {
        stub.restore()
      }
    } finally {
      close()
    }
  })

  it('sendPlanBBackupToChat gates: no bot token / no encryption key refuse with zero network calls (dev included — the tap is explicit)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { role: 'owner' })
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', userId])

      // Gate: no bot token → refused.
      const noTok = stubBotApi()
      try {
        const r = await sendPlanBBackupToChat(planCfg(db, { telegramToken: '' }), userId, '9001')
        expect(r.ok).toBe(false)
        expect(r.reason).toContain('TELEGRAM_BOT_TOKEN')
        expect(noTok.calls).toHaveLength(0)
      } finally {
        noTok.restore()
      }

      // Gate: no encryption key → refuses (never plaintext to Telegram). Dev included:
      // the isProd gate is gone — an explicit tap on a self-hosted deployment is correct.
      const plain = stubBotApi()
      try {
        const dev = await sendPlanBBackupToChat(planCfg(db, { isProd: false, backupEncryptionKey: undefined }), userId, '9001')
        expect(dev.ok).toBe(false)
        expect(dev.reason).toContain('BACKUP_ENCRYPTION_KEY')
        expect(plain.calls).toHaveLength(0)
      } finally {
        plain.restore()
      }

      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM planb_backups')
      expect(rows[0].n).toBe(0) // refused sends never log
    } finally {
      close()
    }
  })

  it('retention: prunePlanB deletes beyond keepN (Telegram message + log row)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { role: 'owner' })
      const now = Date.now()
      for (let i = 0; i < 5; i++) {
        await db.execute(
          'INSERT INTO planb_backups (id, user_id, chat_id, message_id, file_id, file_size, sha256, schema_version, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [`row-${i}`, userId, '9001', 100 + i, `file-${i}`, 100, 'a'.repeat(64), 20260910, new Date(now - i * 3600_000).toISOString()],
        )
      }
      const stub = stubBotApi()
      try {
        const pruned = await prunePlanB(db, 'test-bot-token', userId, 2)
        expect(pruned).toHaveLength(3) // keep the 2 newest (100, 101), delete 102, 103, 104
        expect(pruned).toEqual([102, 103, 104])
        const left = await db.query<{ message_id: number }>('SELECT message_id FROM planb_backups WHERE user_id = ?', [userId])
        expect(left.map((r) => r.message_id).sort()).toEqual([100, 101])
        // every doomed row attempted deleteMessage on the right chat
        const deletes = stub.calls.filter((c) => c.url.includes('deleteMessage'))
        expect(deletes).toHaveLength(3)
        for (const d of deletes) expect(bodyText(d.body)).toContain('9001')
        expect(PLANB_RETENTION_DEFAULT).toBe(60)
      } finally {
        stub.restore()
      }
    } finally {
      close()
    }
  })
})

async function makeApp(db: Db, over: Partial<Config> = {}): Promise<{ app: ReturnType<typeof createApp> } | null> {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: undefined,
    telegramToken: 'test-bot-token',
    telegramSecret: 'wxyz-secret',
    assets: undefined,
    ...over,
  })
  return { app }
}
