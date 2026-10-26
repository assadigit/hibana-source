import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTestDb } from './helpers'
import { sendAndLog } from '../services/email'

// Phase 1 (PLAYBOOK §5 — integrations/logging) regression pins:
//   1. the Resend fetch carries a timeout signal (P1-c B5 — the one outbound
//      integration call without one; a stalled connection used to hang the auth
//      flow or cron step riding it). The wiring is pinned by intercepting
//      AbortSignal.timeout and asserting the fetch received that exact signal.
//   2. the magic-wand toast path escapes the server-provided message before the
//      innerHTML toast sink (P1-c B4 — latent XSS sink; pinned as a source
//      contract on the real client file, same spirit as the escape-lint gate).

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Resend send carries a timeout signal (P1-c B5, Phase 1 fix)', () => {
  it('the fetch is called with AbortSignal.timeout(15000) — the exact signal instance', async () => {
    const { db, close } = makeTestDb()
    try {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
      let received: AbortSignal | undefined
      vi.stubGlobal('fetch', (async (_input: RequestInfo | URL, init?: RequestInit) => {
        received = init?.signal as AbortSignal
        return new Response(JSON.stringify({ id: 'x' }), { status: 200 })
      }) as typeof fetch)

      await sendAndLog(
        { db, emailKey: 'test-key' },
        { to: 'to@test.dev', kind: 'verify', subject: 's', title: 't', bodyHtml: '<p>b</p>', origin: 'http://local' },
      )

      expect(timeoutSpy).toHaveBeenCalledTimes(1)
      expect(timeoutSpy).toHaveBeenCalledWith(15_000)
      const created = timeoutSpy.mock.results[0]!.value as AbortSignal
      expect(received).toBeInstanceOf(AbortSignal)
      expect(received).toBe(created) // the signal actually rode the request
      expect(received!.aborted).toBe(false) // 15s budget intact at call time
    } finally {
      close()
    }
  })

  it('a send that never resolves rejects via the signal instead of hanging forever', async () => {
    const { db, close } = makeTestDb()
    try {
      vi.stubGlobal('fetch', ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<never>((_, reject) => {
          // a stalled connection that only ever ends when the abort fires
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          // if NO signal is wired, this promise never settles and the test times out
        })) as typeof fetch)

      // Abort the created signal deterministically after grabbing it via the spy.
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
      const p = sendAndLog(
        { db, emailKey: 'test-key' },
        { to: 'to@test.dev', kind: 'verify', subject: 's', title: 't', bodyHtml: '<p>b</p>', origin: 'http://local' },
      )
      // wait for the fetch to start (the signal is created before it), then fire the abort
      await vi.waitFor(() => expect(timeoutSpy).toHaveBeenCalled())
      const created = timeoutSpy.mock.results[0]!.value as AbortSignal
      created.dispatchEvent(new Event('abort'))
      await expect(p).rejects.toThrow('aborted')
    } finally {
      close()
    }
  })
})

describe('magic-wand toast path escapes server messages (P1-c B4, Phase 1 fix)', () => {
  const src = readFileSync(join(process.cwd(), 'public/js/magic-wand.js'), 'utf8')

  it('the server-provided message is esc()\'d before the innerHTML toast sink', () => {
    // source-contract pin: the app.js H2 contract (toast renders via innerHTML →
    // callers MUST escape) is now honored at this, the only call site that fed the
    // sink a server-controlled string
    expect(src).toContain('msg = esc(body.message)')
  })

  it('the wand\'s esc helper neutralizes all five HTML-significant characters', () => {
    const helper = src.match(/function esc\(s\) \{[^\n]+\}/)?.[0]
    expect(helper).toBeTruthy()
    const esc = new Function(`${helper}; return esc`)() as (s: unknown) => string
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(esc(`it's "quoted" & <tagged>`)).toBe(`it&#39;s &quot;quoted&quot; &amp; &lt;tagged&gt;`)
    expect(esc(null)).toBe('') // nullish tolerance, same as app.js
  })
})
