import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Phase 5 gates: Telegram webhook validates the secret-token header (rule 11),
// captures land and auto-create sparks, Obsidian import bulk-creates Sparks.

async function makeApp(db: Db, userId?: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: undefined,
    telegramToken: 'test-bot-token',
    telegramSecret: 'wxyz-secret',
    assets: undefined,
  })
  const cookie = userId ? `hibana_session=${await createSession(db, userId)}` : undefined
  return { app, auth: { Cookie: cookie ?? '', 'Content-Type': 'application/json' } }
}

// Stub the outbound Telegram API (sendMessage) so tests need no network; captures the body.
function stubTelegram() {
  const originalFetch = globalThis.fetch
  let outbound = ''
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('api.telegram.org/bot')) {
      outbound = String(init?.body)
      return new Response('{"ok":true}')
    }
    return originalFetch(input, init)
  }) as typeof fetch
  return {
    outbound: () => outbound,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

describe('Phase 5 — telegram + obsidian import', () => {
  it('webhook rejects requests without the correct secret-token header (rule 11)', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await makeApp(db)
      const res = await app.fetch(
        new Request('http://local/api/telegram/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { chat: { id: 1 }, from: { id: 2 }, text: 'spoofed idea' } }),
        }),
      )
      expect(res.status).toBe(403) // no secret header → rejected
      const boxes = await db.query('SELECT COUNT(*) AS n FROM telegram_captures')
      expect(boxes[0].n).toBe(0) // and nothing was created
    } finally {
      close()
    }
  })

  it('linked user: webhook captures the idea, creates a Spark, and replies (via mocked sendMessage)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', userId])
      const { app } = await makeApp(db)

      // Stub the outbound Telegram API call so the test needs no network.
      const originalFetch = globalThis.fetch
      let outboundBody = ''
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('api.telegram.org/bot')) {
          outboundBody = String(init?.body)
          return new Response('{"ok":true}')
        }
        return originalFetch(input, init)
      }) as typeof fetch

      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 9001 }, from: { id: 77 }, text: 'build a telegram bot' } }),
          }),
        )
        expect(res.status).toBe(200)

        // capture row exists and is attributed to the user
        const caps = await db.query<{ user_id: string; raw_text: string }>('SELECT user_id, raw_text FROM telegram_captures')
        expect(caps).toHaveLength(1)
        expect(caps[0].user_id).toBe(userId)
        expect(caps[0].raw_text).toBe('build a telegram bot')

        // a spark project was auto-created with the raw text as the title (§9)
        const sparks = await db.query<{ title: string; status: string }>('SELECT title, status FROM projects')
        expect(sparks).toHaveLength(1)
        expect(sparks[0].status).toBe('spark')
        expect(sparks[0].title).toContain('build a telegram bot')

        // and the confirmation echoes the text + deep link
        expect(outboundBody).toContain('build a telegram bot')
        expect(outboundBody).toContain('/project.html?id=')
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      close()
    }
  })

  it('unlinked chat: capture stored, no spark, gentle instructions reply', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await makeApp(db)
      const originalFetch = globalThis.fetch
      let outboundBody = ''
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('api.telegram.org/bot')) {
          outboundBody = String(init?.body)
          return new Response('{"ok":true}')
        }
        return originalFetch(input, init)
      }) as typeof fetch
      try {
        await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 555 }, from: { id: 11 }, text: 'orphan idea' } }),
          }),
        )
        const caps = await db.query<{ user_id: string | null }>('SELECT user_id FROM telegram_captures')
        expect(caps[0].user_id).toBeNull() // unclaimed until the account links
        const sparks = await db.query('SELECT COUNT(*) AS n FROM projects')
        expect(sparks[0].n).toBe(0)
        expect(outboundBody).toContain('/start')
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      close()
    }
  })

  it('obsidian import bulk-creates Sparks from markdown files', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeApp(db, userId)

      const form = new FormData()
      form.append('files', new File(['# E-commerce idea\n\nBuild a print-on-demand store front.'], 'proj-a.md', { type: 'text/markdown' }))
      form.append('files', new File(['---\nyaml: frontmatter\n---\nDraft project two\n\nSome notes here.'], 'proj-b.md', { type: 'text/markdown' }))

      const res = await app.fetch(
        new Request('http://local/api/import/obsidian', { method: 'POST', body: form, headers: { Cookie: auth.Cookie } }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { imported: number }
      expect(body.imported).toBe(2)

      const sparks = await db.query<{ title: string; description: string }>("SELECT title, description FROM projects WHERE status = 'spark' ORDER BY title")
      expect(sparks.map((s) => s.title)).toEqual(['E-commerce idea', 'proj-b']) // H1 wins; no heading → filename
      expect(sparks[0].description).toContain('print-on-demand')
    } finally {
      close()
    }
  })

  function vaultZip(): File {
    // A realistic Obsidian vault export: nested folders, an app-config folder, trash and non-markdown files.
    const bytes = zipSync({
      'MyVault/Note One.md': strToU8('# First idea\n\nLaunch the print-on-demand store.'),
      'MyVault/sub/deeper/Note Two.md': strToU8('Second idea\n\nA second context line.'),
      'MyVault/.obsidian/config.json': strToU8('{}'),
      'MyVault/.obsidian/templates/tmpl.md': strToU8('# Template\n\nmust not import'),
      'MyVault/.trash/Deleted Note.md': strToU8('# Garbage\n\nmust not import'),
      'MyVault/README.txt': strToU8('hello'),
      'MyVault/notes.md.txt': strToU8('not markdown'),
    })
    return new File([bytes as unknown as BlobPart], 'vault.zip', { type: 'application/zip' })
  }

  it('obsidian zip import bulk-creates Sparks, recursing folders and skipping app/trash/non-md entries', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeApp(db, userId)

      const form = new FormData()
      form.append('files', vaultZip())
      const res = await app.fetch(
        new Request('http://local/api/import/obsidian', { method: 'POST', body: form, headers: { Cookie: auth.Cookie } }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { imported: number; duplicates: number }
      expect(body.imported).toBe(2)

      const sparks = await db.query<{ title: string; description: string }>("SELECT title, description FROM projects WHERE status = 'spark' ORDER BY title")
      expect(sparks.map((s) => s.title)).toEqual(['First idea', 'Note Two']) // recursion + H1-wins / basename fallback
      expect(sparks[0].description).toContain('print-on-demand')

      const tags = await db.query<{ name: string }>('SELECT DISTINCT t.name FROM tags t JOIN project_tags pt ON pt.tag_id = t.id')
      expect(tags.map((t) => t.name)).toContain('Imported') // spec §9: tagged “Imported”
    } finally {
      close()
    }
  })

  it('zip import is idempotent: re-importing skips existing titles and reports the skip count', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeApp(db, userId)
      const post = async () => {
        const form = new FormData()
        form.append('files', vaultZip())
        return app.fetch(new Request('http://local/api/import/obsidian', { method: 'POST', body: form, headers: { Cookie: auth.Cookie } }))
      }

      const first = (await (await post()).json()) as { imported: number; duplicates: number }
      expect([first.imported, first.duplicates]).toEqual([2, 0])
      const second = (await (await post()).json()) as { imported: number; duplicates: number }
      expect([second.imported, second.duplicates]).toEqual([0, 2]) // nothing new, both skipped

      const count = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(count[0].n).toBe(2)
    } finally {
      close()
    }
  })

  it('zip import rejects a file that is not a real archive', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeApp(db, userId)
      const form = new FormData()
      form.append('files', new File(['this is just plain text, not a zip'], 'fake.zip', { type: 'application/zip' }))
      const res = await app.fetch(
        new Request('http://local/api/import/obsidian', { method: 'POST', body: form, headers: { Cookie: auth.Cookie } }),
      )
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid_zip')
      const count = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(count[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('dedupe is per-user (rule 1): same title in two accounts imports twice', async () => {
    const { db, close } = makeTestDb()
    try {
      const userA = await makeUser(db)
      const userB = await makeUser(db)
      const { app } = await makeApp(db)
      const cookieA = `hibana_session=${await createSession(db, userA)}`
      const cookieB = `hibana_session=${await createSession(db, userB)}`

      const send = async (cookie: string) => {
        const form = new FormData()
        form.append('files', new File(['# Shared Idea\n\nsame title'], 'a.md', { type: 'text/markdown' }))
        return app.fetch(new Request('http://local/api/import/obsidian', { method: 'POST', body: form, headers: { Cookie: cookie } }))
      }

      expect((await ((await send(cookieA)).json() as Promise<{ imported: number }>)).imported).toBe(1)
      expect((await ((await send(cookieB)).json() as Promise<{ imported: number }>)).imported).toBe(1) // user B's vault is separate

      const count = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(count[0].n).toBe(2)
    } finally {
      close()
    }
  })

  it('telegram-status: unauthenticated and non-owner are refused; owner sees the live registration', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      await makeUser(db, { role: 'member' })
      const { app } = await makeApp(db)

      const anonymousReq = await app.fetch(new Request('http://local/api/dev/telegram-status'))
      expect(anonymousReq.status).toBe(401)

      const memberId = (await db.query<{ id: string }>('SELECT id FROM users WHERE role = ?', ['member']))[0].id
      const asMember = await app.fetch(new Request('http://local/api/dev/telegram-status', { headers: { Cookie: `hibana_session=${await createSession(db, memberId)}` } }))
      expect(asMember.status).toBe(403)

      // Stub the outbound Telegram calls (getMe + getWebhookInfo) so the test needs no network.
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('api.telegram.org/bot')) {
          if (url.endsWith('/getMe')) return new Response('{"ok":true,"result":{"username":"hibana_test_bot"}}')
          return new Response('{"ok":true,"result":{"url":"https://hibana.aliassadi.workers.dev/api/telegram/webhook","pending_update_count":0,"last_error_message":null}}')
        }
        return originalFetch(input, init)
      }) as typeof fetch
      try {
        const ownerCookie = `hibana_session=${await createSession(db, ownerId)}`
        const res = await app.fetch(new Request('http://local/api/dev/telegram-status', { headers: { Cookie: ownerCookie } }))
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
          ok: boolean
          bot: string
          environment: string
          expected_webhook: string
          webhook_url: string
          points_here: boolean
          pending_updates: number
        }
        expect(body.ok).toBe(true)
        expect(body.bot).toBe('@hibana_test_bot')
        expect(body.environment).toBe('dev')
        expect(body.webhook_url).toBe('https://hibana.aliassadi.workers.dev/api/telegram/webhook')
        expect(body.points_here).toBe(true)
        expect(body.pending_updates).toBe(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      close()
    }
  })

  it('telegram-status: reports 503 when the bot token is not configured', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const app = createApp({
        db,
        isProd: false,
        github: { owner: 'x', repo: 'y', token: '' },
        emailKey: undefined,
        telegramToken: undefined,
        telegramSecret: 's',
        assets: undefined,
      })
      const res = await app.fetch(
        new Request('http://local/api/dev/telegram-status', { headers: { Cookie: `hibana_session=${await createSession(db, ownerId)}` } }),
      )
      expect(res.status).toBe(503)
    } finally {
      close()
    }
  })

  it('telegram /reset from an unlinked chat: no token issued, reply points to linking first (spec §9 secondary reset)', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await makeApp(db)
      const bot = stubTelegram()
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 999 }, from: { id: 9 }, text: '/reset' } }),
          }),
        )
        expect(res.status).toBe(200)
        const tokens = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM password_resets')
        expect(tokens[0].n).toBe(0)
        expect(bot.outbound()).toContain('/start') // tells them to link the account first
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('telegram /reset from a linked chat: issues a one-time hashed token and replies with a reset link', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', userId])
      const { app } = await makeApp(db)
      const bot = stubTelegram()
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 9001 }, from: { id: 77 }, text: '/reset' } }),
          }),
        )
        expect(res.status).toBe(200)
        const rows = await db.query<{ token_hash: string; user_id: string }>('SELECT token_hash, user_id FROM password_resets')
        expect(rows).toHaveLength(1)
        expect(rows[0].user_id).toBe(userId) // rule 1: the token belongs to the linked account only
        expect(bot.outbound()).toContain('/reset.html?token=')
        const raw = bot.outbound().match(/token=([A-Za-z0-9]+)/)?.[1]
        expect(raw).toBeTruthy()
        expect(rows[0].token_hash).not.toBe(raw) // token never stored raw
        expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/) // sha-256
        expect(bot.outbound()).toContain('http://local/reset.html?token=') // requestOrigin deep link
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('telegram /reset token is fully redeemable: confirm sets a new password, one-time, and the new login works', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', userId])
      const email = (await db.query<{ email: string }>('SELECT email FROM users WHERE id = ?', [userId]))[0].email
      const { app } = await makeApp(db)
      const bot = stubTelegram()
      try {
        await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 9001 }, from: { id: 77 }, text: '/reset' } }),
          }),
        )
        const raw = bot.outbound().match(/token=([A-Za-z0-9]+)/)?.[1]
        expect(raw).toBeTruthy()

        const confirm = await app.fetch(
          new Request('http://local/api/auth/reset/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: raw, password: 'telegram-new-password' }),
          }),
        )
        expect(confirm.status).toBe(200)

        const used = await db.query<{ used_at: string | null }>('SELECT used_at FROM password_resets')
        expect(used[0].used_at).toBeTruthy() // one-time: consumed

        const login = await app.fetch(
          new Request('http://local/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: email, password: 'telegram-new-password' }),
          }),
        )
        expect(login.status).toBe(200) // the new password works
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })
})

describe('telegram account linking — any authenticated user', () => {
  it('member can generate a link code', async () => {
    const { db, close } = makeTestDb()
    try {
      const memberId = await makeUser(db, { role: 'member' })
      const { app, auth } = await makeApp(db, memberId)
      const res = await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; code: string }
      expect(body.ok).toBe(true)
      expect(body.code).toMatch(/^[a-f0-9]{12}$/)
      const links = await db.query<{ code: string }>('SELECT code FROM telegram_links WHERE user_id = ?', [memberId])
      expect(links.length).toBe(1)
      expect(links[0].code).toBe(body.code)
    } finally {
      close()
    }
  })

  it('generating again invalidates the previous code (one active per account)', async () => {
    const { db, close } = makeTestDb()
    try {
      const memberId = await makeUser(db, { role: 'member' })
      const { app, auth } = await makeApp(db, memberId)
      const first = (await (await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))).json()) as { code: string }
      const second = (await (await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))).json()) as { code: string }
      expect(second.code).not.toBe(first.code)
      const links = await db.query<{ code: string }>('SELECT code FROM telegram_links WHERE user_id = ?', [memberId])
      expect(links.length).toBe(1)
      expect(links[0].code).toBe(second.code)
    } finally {
      close()
    }
  })

  it('generation sweeps expired codes but keeps other users fresh ones', async () => {
    const { db, close } = makeTestDb()
    try {
      const memberA = await makeUser(db, { role: 'member' })
      const memberB = await makeUser(db, { role: 'member' })
      await db.execute('INSERT INTO telegram_links (code, user_id, created_at) VALUES (?, ?, ?)', [
        'aaaa1111', memberA, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      ])
      await db.execute('INSERT INTO telegram_links (code, user_id, created_at) VALUES (?, ?, ?)', [
        'bbbb2222', memberB, new Date().toISOString(),
      ])
      const { app, auth } = await makeApp(db, memberA)
      const res = await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      expect((await db.query('SELECT code FROM telegram_links WHERE code = ?', ['aaaa1111'])).length).toBe(0)
      expect((await db.query('SELECT code FROM telegram_links WHERE code = ?', ['bbbb2222'])).length).toBe(1)
      const own = await db.query<{ code: string }>('SELECT code FROM telegram_links WHERE user_id = ?', [memberA])
      expect(own.length).toBe(1)
      expect(own[0].code).toMatch(/^[a-f0-9]{12}$/)
      expect(own[0].code).not.toBe('aaaa1111')
    } finally {
      close()
    }
  })

  it('webhook /start rejects an expired code', async () => {
    const { db, close } = makeTestDb()
    try {
      const memberId = await makeUser(db, { role: 'member' })
      await db.execute('INSERT INTO telegram_links (code, user_id, created_at) VALUES (?, ?, ?)', [
        'cccc3333', memberId, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      ])
      const { app } = await makeApp(db)
      const bot = stubTelegram()
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 111 }, from: { id: 222 }, text: '/start cccc3333' } }),
          }),
        )
        expect(res.status).toBe(200)
        expect(bot.outbound()).toContain('invalid or already used')
        const user = await db.query<{ telegram_chat_id: string | null }>('SELECT telegram_chat_id FROM users WHERE id = ?', [memberId])
        expect(user[0].telegram_chat_id).toBeNull()
        expect((await db.query('SELECT COUNT(*) AS n FROM telegram_captures'))[0].n).toBe(0)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('status endpoint: 401 anonymous, linked=false for a fresh member, linked=true + chat_id after /start', async () => {
    const { db, close } = makeTestDb()
    try {
      const memberId = await makeUser(db, { role: 'member' })
      const { app, auth } = await makeApp(db, memberId)

      const anonymous = await app.fetch(new Request('http://local/api/telegram/status'))
      expect(anonymous.status).toBe(401)

      const before = (await (await app.fetch(new Request('http://local/api/telegram/status', { headers: auth }))).json()) as {
        bot: string; linked: boolean; chat_id: string | null
      }
      expect(before.bot).toBe('@Hibana_PM_bot')
      expect(before.linked).toBe(false) // fresh member, never linked
      expect(before.chat_id).toBeNull()

      const code = ((await (await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))).json()) as { code: string }).code
      const bot = stubTelegram()
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 777 }, from: { id: 888 }, text: `/start ${code}` } }),
          }),
        )
        expect(res.status).toBe(200)
      } finally {
        bot.restore()
      }

      const after = (await (await app.fetch(new Request('http://local/api/telegram/status', { headers: auth }))).json()) as {
        linked: boolean; chat_id: string | null
      }
      expect(after.linked).toBe(true)
      expect(after.chat_id).toBe('777')
    } finally {
      close()
    }
  })

  it('unlink clears the mapping and codes; captures stay; /reset refuses the chat', async () => {
    const { db, close } = makeTestDb()
    try {
      const memberId = await makeUser(db, { role: 'member' })
      const { app, auth } = await makeApp(db, memberId)
      const code = ((await (await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))).json()) as { code: string }).code
      const bot = stubTelegram()
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 777 }, from: { id: 222 }, text: `/start ${code}` } }),
          }),
        )
        expect(res.status).toBe(200)
      } finally {
        bot.restore()
      }
      const now = new Date().toISOString()
      await db.execute(
        'INSERT INTO telegram_captures (id, user_id, raw_text, telegram_user_id, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['cap-1', memberId, 'kept', '222', now, now],
      )

      const del = await app.fetch(new Request('http://local/api/telegram/link', { method: 'DELETE', headers: auth }))
      expect(del.status).toBe(200)

      const user = await db.query<{ telegram_chat_id: string | null }>('SELECT telegram_chat_id FROM users WHERE id = ?', [memberId])
      expect(user[0].telegram_chat_id).toBeNull()
      expect((await db.query('SELECT code FROM telegram_links WHERE user_id = ?', [memberId])).length).toBe(0)
      const caps = await db.query<{ user_id: string }>('SELECT user_id FROM telegram_captures WHERE id = ?', ['cap-1'])
      expect(caps[0].user_id).toBe(memberId) // captures are account data now (rule 1)

      const bot2 = stubTelegram()
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
            body: JSON.stringify({ message: { chat: { id: 777 }, from: { id: 222 }, text: '/reset' } }),
          }),
        )
        expect(res.status).toBe(200)
        expect(bot2.outbound()).toContain('not linked')
      } finally {
        bot2.restore()
      }
      expect((await db.query('SELECT COUNT(*) AS n FROM password_resets'))[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('unlink requires auth', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await makeApp(db)
      const res = await app.fetch(new Request('http://local/api/telegram/link', { method: 'DELETE' }))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })
})

describe('telegram bot commands — /note, /idea, /list (quick notes on the dashboard)', () => {
  // Capture-EVERY outbound bot message (the shared stubTelegram only keeps the last one).
  const stubBot = () => {
    const originalFetch = globalThis.fetch
    const sent: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.telegram.org/bot')) {
        sent.push(String(init?.body ?? ''))
        return new Response('{"ok":true}')
      }
      return originalFetch(input, init)
    }) as typeof fetch
    return { sent, restore: () => { globalThis.fetch = originalFetch } }
  }

  const webhook = (app: { fetch: Function }, text: string, chatId = 700, fromId = 701) =>
    app.fetch(
      new Request('http://local/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
        body: JSON.stringify({ message: { chat: { id: chatId }, from: { id: fromId }, text } }),
      }),
    )

  // Create a member, generate a link code with their session, link chat 700 via /start.
  // Returns the authed app (webhook calls + Settings) and the linked member id.
  const linkMember = async (db: Db, chatId = 700, fromId = 701) => {
    const memberId = await makeUser(db, { role: 'member' })
    const { app, auth } = await makeApp(db, memberId)
    const code = ((await (await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))).json()) as { code: string }).code
    const bot = stubTelegram()
    try {
      const res = await webhook(app, `/start ${code}`, chatId, fromId)
      expect(res.status).toBe(200)
    } finally {
      bot.restore()
    }
    return { app, memberId }
  }

  it('/note adds a Quick Note card to the dashboard notebook', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      const bot = stubBot()
      try {
        const res = await webhook(app, '/note call mom') // chat 700 got linked in linkMember
        expect(res.status).toBe(200)
        expect(bot.sent.length).toBe(1)
        expect(bot.sent[0]).toContain('Note added')
        const notes = await db.query<{ kind: string; content: string; user_id: string }>('SELECT kind, content, user_id FROM quick_notes')
        expect(notes.length).toBe(1)
        expect(notes[0].kind).toBe('note')
        expect(notes[0].content).toBe('call mom')
        expect(notes[0].user_id).toBe(memberId)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('/note without text replies with usage and saves nothing', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/note')
        expect(bot.sent[bot.sent.length - 1]).toContain('/note <text>')
        expect((await db.query('SELECT COUNT(*) AS n FROM quick_notes'))[0].n).toBe(0)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('/idea is the explicit idea path — Spark + capture + link back', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/idea ship the app')
        expect(bot.sent[bot.sent.length - 1]).toContain('Captured')
        expect(bot.sent[bot.sent.length - 1]).toContain('/project.html?id=')
        const sparks = await db.query<{ title: string; status: string; user_id: string }>("SELECT title, status, user_id FROM projects WHERE status = 'spark'")
        expect(sparks.length).toBe(1)
        expect(sparks[0].title).toBe('ship the app')
        expect(sparks[0].user_id).toBe(memberId)
        expect((await db.query('SELECT COUNT(*) AS n FROM telegram_captures'))[0].n).toBe(1)
        expect((await db.query('SELECT COUNT(*) AS n FROM quick_notes'))[0].n).toBe(0)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('/list collects items one per message and /done saves a checklist note', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/list')
        expect(bot.sent[bot.sent.length - 1]).toContain('List mode on')
        await webhook(app, 'first item')
        expect(bot.sent[bot.sent.length - 1]).toContain('1 item so far')
        await webhook(app, 'second item')
        expect(bot.sent[bot.sent.length - 1]).toContain('2 items so far')
        await webhook(app, '/done')
        expect(bot.sent[bot.sent.length - 1]).toContain('List saved (2 items)')

        const notes = await db.query<{ kind: string; content: string }>('SELECT kind, content FROM quick_notes')
        expect(notes.length).toBe(1)
        expect(notes[0].kind).toBe('list')
        const items = JSON.parse(notes[0].content) as { t: string; d: number }[]
        expect(items.map((i) => i.t)).toEqual(['first item', 'second item'])
        expect(items.every((i) => i.d === 0)).toBe(true)
        expect((await db.query('SELECT COUNT(*) AS n FROM projects'))[0].n).toBe(0) // never an idea
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('/done without a list session saves nothing', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/done')
        expect(bot.sent[bot.sent.length - 1]).toContain('No active list')
        expect((await db.query('SELECT COUNT(*) AS n FROM quick_notes'))[0].n).toBe(0)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('/cancel discards the session; the next plain message is an Idea again', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/list')
        await webhook(app, 'draft item')
        await webhook(app, '/cancel')
        expect(bot.sent[bot.sent.length - 1]).toContain('List discarded (1 item)')
        expect((await db.query('SELECT COUNT(*) AS n FROM quick_notes'))[0].n).toBe(0)

        await webhook(app, 'plain idea text')
        expect(bot.sent[bot.sent.length - 1]).toContain('Captured')
        expect((await db.query("SELECT COUNT(*) AS n FROM projects WHERE status = 'spark'"))[0].n).toBe(1)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('unlinked chat cannot use commands — link-first reply, nothing saved', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await makeApp(db)
      const bot = stubBot()
      try {
        await webhook(app, '/note secret idea', 800, 802)
        expect(bot.sent[bot.sent.length - 1]).toContain('Link your account first')
        expect((await db.query('SELECT COUNT(*) AS n FROM quick_notes'))[0].n).toBe(0)
        expect((await db.query('SELECT COUNT(*) AS n FROM telegram_captures'))[0].n).toBe(0)
        expect((await db.query('SELECT COUNT(*) AS n FROM projects'))[0].n).toBe(0)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('a list session persists until /done or /cancel (not finite — no TTL, design §7.4)', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/list')
        await webhook(app, 'old item')
        // No TTL — the session persists (design §7.4, round-2 Q5). A later plain text
        // appends to the same list rather than being captured as a new idea.
        await webhook(app, 'urgent idea')
        expect(bot.sent[bot.sent.length - 1]).toContain('2 item')
        expect((await db.query("SELECT COUNT(*) AS n FROM projects WHERE status = 'spark'"))[0].n).toBe(0)
        const sess = await db.query<{ state: string }>('SELECT state FROM telegram_bot_sessions WHERE user_id = ?', [memberId])
        const items = JSON.parse(sess[0]?.state ?? '{}').items
        expect(items).toEqual(['old item', 'urgent idea'])
        expect((await db.query('SELECT COUNT(*) AS n FROM quick_notes'))[0].n).toBe(0)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('unknown commands get the help pointer, not a capture', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/foo')
        expect(bot.sent[bot.sent.length - 1]).toContain('Unknown command')
        expect((await db.query('SELECT COUNT(*) AS n FROM projects'))[0].n).toBe(0)
        expect((await db.query('SELECT COUNT(*) AS n FROM telegram_captures'))[0].n).toBe(0)
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('/help lists the commands — linked and unlinked variants', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await makeApp(db) // unlinked app for the first call
      const bot = stubBot()
      try {
        await webhook(app, '/help', 900, 901) // unlinked chat
        expect(bot.sent[bot.sent.length - 1]).toContain('/start <code>')
        const linked = await linkMember(db)
        await webhook(linked.app, '/help')
        expect(bot.sent[bot.sent.length - 1]).toContain('/idea <text>')
        expect(bot.sent[bot.sent.length - 1]).toContain('/note <text>')
        expect(bot.sent[bot.sent.length - 1]).toContain('/list')
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })
})

describe('telegram /status + /pause + /resume (spec §5.17/§6.22)', () => {
  const stubBot = () => {
    const originalFetch = globalThis.fetch
    const sent: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.telegram.org/bot')) {
        sent.push(String(init?.body ?? ''))
        return new Response('{"ok":true}')
      }
      return originalFetch(input, init)
    }) as typeof fetch
    return { sent, restore: () => { globalThis.fetch = originalFetch } }
  }

  const webhook = (app: { fetch: Function }, text: string, chatId = 750, fromId = 751) =>
    app.fetch(
      new Request('http://local/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
        body: JSON.stringify({ message: { chat: { id: chatId }, from: { id: fromId }, text } }),
      }),
    )

  const linkMember = async (db: Db, chatId = 750, fromId = 751) => {
    const memberId = await makeUser(db, { role: 'member' })
    const { app, auth } = await makeApp(db, memberId)
    const code = ((await (await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))).json()) as { code: string }).code
    const bot = stubTelegram()
    try {
      const res = await webhook(app, `/start ${code}`, chatId, fromId)
      expect(res.status).toBe(200)
    } finally {
      bot.restore()
    }
    return { app, memberId }
  }

  it('/status reports the linked username + open task deadlines; /pause suspends; /resume restores', async () => {
    const { db, close } = makeTestDb()
    const bot = stubBot()
    try {
      const { app, memberId } = await linkMember(db)
      const now = new Date().toISOString()
      await db.execute(
        "INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, due_date, done, deleted_at, pinned, cleared_at, position, progress, note, recurring, created_at, updated_at) VALUES (?, ?, 3, 'deadline task', '📌', '2030-01-01', 0, NULL, 0, NULL, 0, 'untouched', '', 0, ?, ?)",
        [crypto.randomUUID(), memberId, now, now],
      )

      await webhook(app, '/status')
      expect(bot.sent[bot.sent.length - 1]).toContain('open tasks with deadlines: <b>1</b>')
      expect(bot.sent[bot.sent.length - 1]).toContain('Reminders: ✅ on')

      await webhook(app, '/pause')
      expect(bot.sent[bot.sent.length - 1]).toContain('Reminders paused')
      const paused = await db.query<{ telegram_paused: number }>('SELECT telegram_paused FROM users WHERE id = ?', [memberId])
      expect(paused[0].telegram_paused).toBe(1)

      await webhook(app, '/status')
      expect(bot.sent[bot.sent.length - 1]).toContain('Reminders: ⏸ paused')

      await webhook(app, '/resume')
      expect(bot.sent[bot.sent.length - 1]).toContain('Reminders resumed')
      const resumed = await db.query<{ telegram_paused: number }>('SELECT telegram_paused FROM users WHERE id = ?', [memberId])
      expect(resumed[0].telegram_paused).toBe(0)
    } finally {
      bot.restore()
      close()
    }
  })

  it('/pause from an unlinked chat points to linking first; re-linking via /start re-enables reminders', async () => {
    const { db, close } = makeTestDb()
    const bot = stubBot()
    try {
      const { app } = await makeApp(db)
      await webhook(app, '/pause', 888, 889) // unlinked chat
      expect(bot.sent[bot.sent.length - 1]).toContain('not linked')

      const { app: linkedApp, memberId } = await linkMember(db, 888, 889) // same chat, now linked
      const flag = await db.query<{ telegram_paused: number }>('SELECT telegram_paused FROM users WHERE id = ?', [memberId])
      expect(flag[0].telegram_paused).toBe(0) // /start <code> resumed (spec §6.22)
      void linkedApp
    } finally {
      bot.restore()
      close()
    }
  })
})

describe('telegram /update — move a project to a new stage (Session 19 cron round 2)', () => {
  const stubBot = () => {
    const originalFetch = globalThis.fetch
    const sent: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.telegram.org/bot')) {
        sent.push(String(init?.body ?? ''))
        return new Response('{"ok":true}')
      }
      return originalFetch(input, init)
    }) as typeof fetch
    return { sent, restore: () => { globalThis.fetch = originalFetch } }
  }
  const webhook = (app: { fetch: Function }, text: string, chatId = 700, fromId = 701) =>
    app.fetch(
      new Request('http://local/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
        body: JSON.stringify({ message: { chat: { id: chatId }, from: { id: fromId }, text } }),
      }),
    )
  const linkMember = async (db: Db, chatId = 700, fromId = 701) => {
    const memberId = await makeUser(db, { role: 'member' })
    const { app, auth } = await makeApp(db, memberId)
    const code = ((await (await app.fetch(new Request('http://local/api/telegram/link-code', { method: 'POST', headers: auth }))).json()) as { code: string }).code
    const bot = stubTelegram()
    try { await webhook(app, `/start ${code}`, chatId, fromId) } finally { bot.restore() }
    return { app, memberId }
  }

  it('updates a project stage by title prefix + stage key', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      // Seed a project at 'unreviewed'
      const pid = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, memberId, 'Star Map', 'unreviewed', now, now],
      )
      const bot = stubBot()
      try {
        const res = await webhook(app, '/update star map doing')
        expect(res.status).toBe(200)
        const msg = bot.sent[bot.sent.length - 1]
        expect(msg).toContain('Stage updated')
        expect(msg).toContain('Star Map')
        expect(msg).toContain('unreviewed')
        expect(msg).toContain('doing')
        expect(msg).toContain('/project.html?id=')
        const after = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = ?', [pid])
        expect(after[0].status).toBe('doing')
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('accepts the EN label ("In Progress") and FA label ("در حال انجام")', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      const pid = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, memberId, 'Star Map', 'unreviewed', now, now],
      )
      const bot = stubBot()
      try {
        await webhook(app, '/update star map In Progress')
        let after = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = ?', [pid])
        expect(after[0].status).toBe('doing')
        // reset and try FA
        await db.execute('UPDATE projects SET status = ? WHERE id = ?', ['investigating', pid])
        await webhook(app, '/update star map در حال انجام')
        after = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = ?', [pid])
        expect(after[0].status).toBe('doing')
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('replies with usage when no project arg is given', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app } = await linkMember(db)
      const bot = stubBot()
      try {
        await webhook(app, '/update doing')
        expect(bot.sent[bot.sent.length - 1]).toContain('Usage: /update')
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('rejects an unknown stage with a helpful list', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      const pid = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, memberId, 'Star Map', 'unreviewed', now, now],
      )
      const bot = stubBot()
      try {
        await webhook(app, '/update star map frobnicate')
        const msg = bot.sent[bot.sent.length - 1]
        expect(msg).toContain('Unknown stage')
        expect(msg).toContain('unreviewed · investigating')
        // status unchanged
        const after = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = ?', [pid])
        expect(after[0].status).toBe('unreviewed')
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('refuses to set "spark" (ideas are promoted from the Ideas page)', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      const pid = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, memberId, 'Star Map', 'doing', now, now],
      )
      const bot = stubBot()
      try {
        await webhook(app, '/update star map spark')
        const msg = bot.sent[bot.sent.length - 1]
        expect(msg).toContain("can't be set from here")
        const after = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = ?', [pid])
        expect(after[0].status).toBe('doing') // unchanged
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('replies "already at" when the stage matches', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      const pid = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, memberId, 'Star Map', 'doing', now, now],
      )
      const bot = stubBot()
      try {
        await webhook(app, '/update star map doing')
        const msg = bot.sent[bot.sent.length - 1]
        expect(msg).toContain('already at')
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })

  it('is user-scoped: a project owned by another user is not found', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, memberId } = await linkMember(db)
      // Another user's project with the same title prefix
      const other = await makeUser(db, { email: 'other@x.local', username: 'other' })
      const pid = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, other, 'Star Map', 'unreviewed', now, now],
      )
      const bot = stubBot()
      try {
        await webhook(app, '/update star map doing')
        const msg = bot.sent[bot.sent.length - 1]
        expect(msg).toContain('No project found')
        // other user's project untouched (rule 1)
        const after = await db.query<{ status: string; user_id: string }>('SELECT status, user_id FROM projects WHERE id = ?', [pid])
        expect(after[0].status).toBe('unreviewed')
        expect(after[0].user_id).toBe(other)
        void memberId
      } finally {
        bot.restore()
      }
    } finally {
      close()
    }
  })
})