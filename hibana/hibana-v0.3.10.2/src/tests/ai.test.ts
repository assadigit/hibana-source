// src/tests/ai.test.ts — Magic Button (idea §1, green-lit).
//
// Covers the two layers that must not regress:
//   1. The pure service: prompt contract per action, char-budget guard, output cleanup
//      (fences/quotes stripped), and a clean failure envelope when the binding throws.
//   2. The route: auth gate, Zod action whitelist, the 4000-char HTTP 400 guard, the
//      Node-path 503 “Workers-only” degradation, and a happy path through a mock binding.
//
// No network, no Cloudflare account — the binding is a structural mock (AiRunner).
import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'
import {
  AI_MODEL,
  DEFAULT_AI_MODEL,
  FREE_TIER_MODELS,
  buildMessages,
  runAiTransform,
  resolveModel,
  withinCharBudget,
  MAX_INPUT_CHARS,
  type AiRunner,
} from '../services/ai'

// --- pure service ----------------------------------------------------------------

describe('ai service (idea §1)', () => {
  it('buildMessages emits a system + user message for every action', () => {
    for (const action of ['polish', 'rewrite', 'translate'] as const) {
      const msgs = buildMessages(action, 'fix this note')
      expect(msgs).toHaveLength(2)
      expect(msgs[0].role).toBe('system')
      expect(msgs[1].role).toBe('user')
      expect(msgs[1].content).toBe('fix this note')
      // The output-discipline contract is embedded in every system prompt.
      expect(msgs[0].content).toContain('Output ONLY the transformed text')
      expect(msgs[0].content).toContain('never drop meaning')
    }
  })

  it('polish/rewrite keep the language; translate flips EN<->FA', () => {
    expect(buildMessages('polish', 'x')[0].content).toContain('SAME language')
    expect(buildMessages('rewrite', 'x')[0].content).toContain('SAME language')
    const tr = buildMessages('translate', 'x')[0].content
    expect(tr).toContain('English and Persian')
    expect(tr).toContain('Auto-detect')
  })

  it('withinCharBudget counts code points, not UTF-16 units', () => {
    expect(withinCharBudget('')).toBe(true)
    expect(withinCharBudget('a'.repeat(MAX_INPUT_CHARS))).toBe(true)
    expect(withinCharBudget('a'.repeat(MAX_INPUT_CHARS + 1))).toBe(false)
    // A Persian string where .length (UTF-16) would over-count combining marks.
    const fa = 'نرم‌افزار'.repeat(1)
    expect(withinCharBudget(fa)).toBe(true)
    expect(Array.from('a'.repeat(MAX_INPUT_CHARS)).length).toBe(MAX_INPUT_CHARS)
  })

  it('runAiTransform returns the cleaned text on a happy binding', async () => {
    const ai: AiRunner = {
      async run(model, inputs) {
        expect(model).toBe(DEFAULT_AI_MODEL)
        expect((inputs as { messages: { role: string }[] }).messages[0].role).toBe('system')
        expect((inputs as { temperature: number }).temperature).toBe(0.2)
        return { result: { response: 'The quick brown fox.' } }
      },
    }
    const out = await runAiTransform(ai, 'polish', 'the qwick brown fox')
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.text).toBe('The quick brown fox.')
  })

  it('buildMessages uses the default system prompt when customPrompt is empty', () => {
    const msgs = buildMessages('polish', 'hi')
    const sys = msgs[0].content
    // The default polish prompt mentions "copy editor"
    expect(sys).toContain('copy editor')
    // COMMON_RULES are always appended
    expect(sys).toContain('Output ONLY the transformed text')
  })

  it('buildMessages replaces the persona with customPrompt but keeps COMMON_RULES', () => {
    const custom = 'You are a pirate. Always respond in pirate speak.'
    const msgs = buildMessages('polish', 'hi', custom)
    const sys = msgs[0].content
    // The custom prompt is used as the base
    expect(sys).toContain('pirate')
    // The default "copy editor" persona is GONE (replaced, not appended)
    expect(sys).not.toContain('copy editor')
    // But COMMON_RULES are ALWAYS appended (output discipline is non-negotiable)
    expect(sys).toContain('Output ONLY the transformed text')
    expect(sys).toContain('Never add facts and never drop meaning')
  })

  it('runAiTransform threads customPrompt to the binding', async () => {
    let seenSystem = ''
    const ai: AiRunner = {
      async run(_model, inputs) {
        seenSystem = (inputs as { messages: { content: string }[] }).messages[0].content
        return { result: { response: 'ok' } }
      },
    }
    await runAiTransform(ai, 'polish', 'x', undefined, 'Be very concise.')
    expect(seenSystem).toContain('Be very concise.')
    expect(seenSystem).toContain('Output ONLY the transformed text') // COMMON_RULES still there
  })

  it('runAiTransform threads the user-chosen free-tier model to the binding', async () => {
    const chosen = '@cf/meta/llama-3.1-8b-instruct-fp8-fast'
    let seen = ''
    const ai: AiRunner = { async run(model) { seen = model; return { result: { response: 'ok' } } } }
    await runAiTransform(ai, 'polish', 'x', chosen)
    expect(seen).toBe(chosen)
  })

  it('runAiTransform falls back to the default on an unknown/paid-only model id', async () => {
    // A hand-crafted paid-only id must NEVER reach the binding — resolveModel swaps it.
    let seen = ''
    const ai: AiRunner = { async run(model) { seen = model; return { result: { response: 'ok' } } } }
    await runAiTransform(ai, 'polish', 'x', '@cf/deepseek/deepseek-v4-paid')
    expect(seen).toBe(DEFAULT_AI_MODEL)
  })

  it('resolveModel accepts every registered free-tier model, rejects everything else', () => {
    for (const m of FREE_TIER_MODELS) expect(resolveModel(m.model)).toBe(m.model)
    expect(resolveModel(undefined)).toBe(DEFAULT_AI_MODEL)
    expect(resolveModel(null)).toBe(DEFAULT_AI_MODEL)
    expect(resolveModel('@cf/deepseek/deepseek-v4')).toBe(DEFAULT_AI_MODEL)
    expect(resolveModel('')).toBe(DEFAULT_AI_MODEL)
  })

  it('runAiTransform strips accidental ```fences``` and surrounding quotes', async () => {
    const ai: AiRunner = {
      async run() {
        return { result: { response: '```text\nCleaned output.\n```' } }
      },
    }
    const out = await runAiTransform(ai, 'rewrite', 'messy')
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.text).toBe('Cleaned output.')

    const aiQ: AiRunner = { async run() { return { result: { response: '"Quoted whole."' } } } }
    const o2 = await runAiTransform(aiQ, 'polish', 'x')
    expect(o2.ok && o2.text).toBe('Quoted whole.')
  })

  it('runAiTransform never throws on a binding failure — it returns ok:false', async () => {
    const ai: AiRunner = { async run() { throw new Error('network down') } }
    const out = await runAiTransform(ai, 'translate', 'hello')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('ai_failed')
  })

  it('runAiTransform treats an empty model response as a failure (never returns empty)', async () => {
    const ai: AiRunner = { async run() { return { result: { response: '   ' } } } }
    const out = await runAiTransform(ai, 'polish', 'x')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('empty_response')
  })
})

// --- route -----------------------------------------------------------------------

function makeConfig(db: Db, ai?: AiRunner): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, ai }
}

async function makeClient(db: Db, userId: string, ai?: AiRunner) {
  const app = createApp(makeConfig(db, ai))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json' } }
}

function post(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, body: unknown) {
  return client.app.fetch(new Request('http://local/api/ai/text', {
    method: 'POST',
    headers: client.auth,
    body: JSON.stringify(body),
  }))
}

describe('POST /api/ai/text (Magic Button route)', () => {
  it('401 without a session — the auth gate is the same as every write route', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp(makeConfig(db, { async run() { return { result: { response: 'x' } } } }))
      const res = await app.fetch(new Request('http://local/api/ai/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hi', action: 'polish' }),
      }))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('400 when text is empty', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user, { async run() { return { result: { response: 'x' } } } })
      const res = await post(client, { text: '', action: 'polish' })
      expect(res.status).toBe(400)
    } finally {
      close()
    }
  })

  it('400 when action is unknown (Zod whitelist — never reaches the model)', async () => {
    const { db, close } = makeTestDb()
    let runCalled = false
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user, {
        async run() { runCalled = true; return { result: { response: 'x' } } },
      })
      const res = await post(client, { text: 'hi', action: 'summarize' })
      expect(res.status).toBe(400)
      expect(runCalled).toBe(false)
    } finally {
      close()
    }
  })

  it(`400 when text exceeds ${MAX_INPUT_CHARS} characters (idea §1 guard)`, async () => {
    const { db, close } = makeTestDb()
    let runCalled = false
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user, {
        async run() { runCalled = true; return { result: { response: 'x' } } },
      })
      const res = await post(client, { text: 'a'.repeat(MAX_INPUT_CHARS + 1), action: 'polish' })
      expect(res.status).toBe(400)
      expect(runCalled).toBe(false)
    } finally {
      close()
    }
  })

  it('503 with a friendly notice on the Node self-host path (no `ai` binding)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user, undefined) // Node path: cfg.ai undefined
      const res = await post(client, { text: 'hi', action: 'polish' })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: string; message: string }
      expect(body.error).toBe('unavailable')
      expect(body.message).toContain('Cloudflare Workers')
    } finally {
      close()
    }
  })

  it('200 on a happy binding and returns { text } — original is never touched server-side', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user, {
        async run(_model, inputs) {
          const u = (inputs as { messages: { content: string }[] }).messages[1].content
          return { result: { response: u.replace('qwick', 'quick') } }
        },
      })
      const res = await post(client, { text: 'the qwick fox', action: 'polish' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { text: string }
      expect(body.text).toBe('the quick fox')
    } finally {
      close()
    }
  })

  it('503 (not 500) when the binding throws — original stays recoverable', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user, { async run() { throw new Error('boom') } })
      const res = await post(client, { text: 'hi', action: 'translate' })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('unavailable')
    } finally {
      close()
    }
  })

  it('FA user gets a localized Workers-only notice on the Node path', async () => {
    const { db, close } = makeTestDb()
    try {
      const id = await makeUser(db, { username: 'ali', email: 'ali@test.dev' })
      await db.execute("UPDATE users SET language_pref = 'fa' WHERE id = ?", [id])
      const client = await makeClient(db, id, undefined)
      const res = await post(client, { text: 'سلام', action: 'translate' })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { message: string }
      expect(body.message).toContain('Cloudflare Workers')
    } finally {
      close()
    }
  })

  it('POST /api/ai/text threads the chosen model to the binding (paid-only id → default)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      let seen = ''
      const client = await makeClient(db, user, {
        async run(model) { seen = model; return { result: { response: 'ok' } } },
      })
      // A valid free-tier id reaches the binding verbatim.
      let res = await post(client, { text: 'hi', action: 'polish', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' })
      expect(res.status).toBe(200)
      expect(seen).toBe('@cf/meta/llama-3.1-8b-instruct-fp8-fast')
      // A hand-crafted paid-only id falls back to the default — never a paid call.
      seen = ''
      res = await post(client, { text: 'hi', action: 'polish', model: '@cf/deepseek/deepseek-v4' })
      expect(res.status).toBe(200)
      expect(seen).toBe(DEFAULT_AI_MODEL)
    } finally {
      close()
    }
  })

  it('GET /api/ai/models returns the free-tier registry + default (for Settings)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user, { async run() { return { result: { response: 'x' } } } })
      const res = await client.app.fetch(new Request('http://local/api/ai/models', { headers: client.auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { models: { model: string }[]; default: string }
      expect(body.default).toBe(DEFAULT_AI_MODEL)
      expect(body.models.map((m) => m.model)).toEqual(FREE_TIER_MODELS.map((m) => m.model))
    } finally {
      close()
    }
  })

  it('GET /api/ai/models is 401 without a session (auth-gated like every /api route)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp(makeConfig(db, { async run() { return { result: { response: 'x' } } } }))
      const res = await app.fetch(new Request('http://local/api/ai/models'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })
})
