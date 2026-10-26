import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Autopilot Phase 0 characterization (gap: the offline queue client).
//
// public/js/queue.js (255 lines of IndexedDB + fetch + beacon logic — the client
// half of "never lose an idea") had ZERO tests: vitest runs in the node
// environment and nothing imports public/js. This harness evaluates the REAL
// file (byte-for-byte, no reimplementation) against a minimal synchronous fake
// IndexedDB — no new dependencies — and pins the load-bearing behaviors:
// enqueue/count, the flush verdict matrix (200/401/400/5xx), the retry-then-drop
// rule, project creates + rail refresh, the offline no-op, the pagehide beacon,
// and clearAll.

interface FakeBadge {
  textContent: string
  innerHTML: string
  hidden: boolean
}

interface TimerEntry {
  fn: () => void
  ms: number
  cancelled: boolean
}

/** Minimal synchronous fake IndexedDB — exactly the API surface queue.js touches:
 * open(name, version) + onupgradeneeded, per-store Maps keyed by the 'id' keyPath,
 * transactions that complete on the microtask queue, and count/add/getAll/delete/
 * put/clear requests with synchronous results. */
function makeFakeIdb() {
  const stores = new Map<string, Map<unknown, unknown>>()
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    deleteObjectStore: (n: string) => {
      stores.delete(n)
    },
    createObjectStore: (n: string) => {
      stores.set(n, new Map())
    },
    transaction: (storeName: string) => {
      const m = stores.get(storeName)
      if (!m) throw new Error(`no such store: ${storeName}`)
      const mkReq = (result: unknown) => ({ result, error: null, onsuccess: null, onerror: null })
      const storeObj = {
        count: () => mkReq(m.size),
        add: (row: { id: unknown }) => {
          m.set(row.id, row)
          return mkReq(undefined)
        },
        getAll: () => mkReq([...m.values()].map((row) => structuredClone(row))),
        delete: (k: unknown) => {
          m.delete(k)
          return mkReq(undefined)
        },
        put: (row: { id: unknown }) => {
          m.set(row.id, row)
          return mkReq(undefined)
        },
        clear: () => {
          m.clear()
          return mkReq(undefined)
        },
      }
      const tx: Record<string, unknown> = { oncomplete: null, onerror: null, error: null }
      tx.objectStore = () => storeObj
      queueMicrotask(() => {
        ;(tx.oncomplete as (() => void) | null)?.()
      })
      return tx
    },
  }
  const indexedDB = {
    open: () => {
      const req: Record<string, unknown> = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null }
      queueMicrotask(() => {
        ;(req.onupgradeneeded as ((ev: { target: { result: unknown } }) => void) | null)?.({ target: { result: db } })
        req.result = db
        ;(req.onsuccess as (() => void) | null)?.()
      })
      return req
    },
  }
  return { indexedDB, stores }
}

interface QueueHarness {
  queue: {
    enqueue: (item: unknown) => Promise<void>
    flush: () => Promise<boolean>
    count: () => Promise<number>
    clearAll: () => Promise<number>
    onCount: (fn: (n: number) => void) => void
  }
  fetchMock: ReturnType<typeof vi.fn>
  sendBeacon: ReturnType<typeof vi.fn>
  railRefresh: ReturnType<typeof vi.fn>
  badge: FakeBadge
  timers: TimerEntry[]
  stores: Map<string, Map<unknown, unknown>>
  fireTimers: () => void
  trigger: (event: string) => void
}

/** Evaluates the REAL public/js/queue.js in a sandboxed scope with fakes for every
 * browser global it touches. setTimeout/clearTimeout are captured (never run on
 * their own); setInterval is a no-op so nothing keeps the process alive.
 * getAll() returns structuredClone copies — exactly like real IndexedDB, so object
 * mutations made during a flush NEVER leak back into the store (fidelity matters:
 * a live-reference getAll silently fakes retry-counter persistence). */
function loadQueue(over: { online?: boolean; responses?: Array<{ status: number; body?: string }> } = {}): QueueHarness {
  const { indexedDB, stores } = makeFakeIdb()
  const timers: TimerEntry[] = []
  const badge: FakeBadge = { textContent: '', innerHTML: '', hidden: true }
  const winListeners = new Map<string, Set<() => void>>()
  const sendBeacon = vi.fn()
  const railRefresh = vi.fn()
  const window: Record<string, unknown> = {
    indexedDB,
    addEventListener: (ev: string, fn: () => void) => {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set())
      winListeners.get(ev)!.add(fn)
    },
    hibana: { rail: { refresh: railRefresh } },
  }
  const document = { querySelector: () => badge, addEventListener: () => {} }
  const navigator = { onLine: over.online ?? true, sendBeacon }

  const responses = [...(over.responses ?? [])]
  const fetchMock = vi.fn(async () => {
    const r = responses.length > 0 ? responses.shift()! : { status: 200 }
    return new Response(r.body ?? '{}', { status: r.status })
  })

  const setTimeoutStub = (fn: () => void, ms: number) => {
    const entry = { fn, ms, cancelled: false }
    timers.push(entry)
    return entry
  }
  const clearTimeoutStub = (handle: TimerEntry | null) => {
    if (handle) handle.cancelled = true
  }

  const src = readFileSync(join(process.cwd(), 'public/js/queue.js'), 'utf8')
  const factory = new Function(
    'window',
    'document',
    'navigator',
    'indexedDB',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    `${src}\nreturn window.hibanaQueue`,
  )
  const queue = factory(
    window,
    document,
    navigator,
    indexedDB,
    fetchMock,
    setTimeoutStub,
    clearTimeoutStub,
    () => 0,
    () => {},
  ) as QueueHarness['queue']

  return {
    queue,
    fetchMock,
    sendBeacon,
    railRefresh,
    badge,
    timers,
    stores,
    fireTimers: () => {
      for (const t of [...timers]) if (!t.cancelled) t.fn()
    },
    trigger: (event: string) => {
      for (const fn of winListeners.get(event) ?? []) fn()
    },
  }
}

/** Drains the microtask queue so async counts/badges settle before assertions. */
const settle = () => new Promise<void>((r) => setImmediate(r))

const canvasItem = (id: string) => ({ kind: 'canvas', data: { id, type: 'note', x: 1, y: 2 } })
const projectItem = (title: string) => ({ kind: 'project', data: { title } })

describe('offline queue — enqueue/count/badge (characterization)', () => {
  it('enqueue stores the item, paints "N unsynced changes", and schedules the debounced flush', async () => {
    const h = loadQueue()
    await h.queue.enqueue(canvasItem('n1'))
    await settle()
    expect(await h.queue.count()).toBe(1)
    expect(h.badge.textContent).toBe('1 unsynced changes')
    expect(h.badge.hidden).toBe(false)

    await h.queue.enqueue(canvasItem('n2'))
    await settle()
    expect(await h.queue.count()).toBe(2)
    expect(h.badge.textContent).toBe('2 unsynced changes')

    // the debounce timer is armed (1500ms) — firing it runs a flush
    expect(h.timers.some((t) => t.ms === 1500)).toBe(true)
    h.fireTimers()
    await settle()
    expect(h.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('onCount listeners receive the live queue depth', async () => {
    const h = loadQueue()
    const seen: number[] = []
    h.queue.onCount((n) => seen.push(n))
    await h.queue.enqueue(canvasItem('n1'))
    await settle()
    expect(seen).toContain(1)
  })
})

describe('offline queue — flush verdict matrix (characterization)', () => {
  it('200: the canvas batch is POSTed to /api/canvas/sync and removed; badge → Saved', async () => {
    const h = loadQueue()
    await h.queue.enqueue(canvasItem('a'))
    await h.queue.enqueue(canvasItem('b'))

    const ok = await h.queue.flush()
    expect(ok).toBe(true)
    expect(h.fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/canvas/sync')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ elements: [canvasItem('a').data, canvasItem('b').data] })

    await settle()
    expect(await h.queue.count()).toBe(0)
    expect(h.badge.textContent).toBe('Saved')
    // the Saved hint re-arms the idle state after 2200ms
    expect(h.timers.some((t) => t.ms === 2200)).toBe(true)
  })

  it('401: items are KEPT, badge parks in "Sign in to sync", flush returns false', async () => {
    const h = loadQueue({ responses: [{ status: 401 }] })
    await h.queue.enqueue(canvasItem('kept'))
    const ok = await h.queue.flush()
    expect(ok).toBe(false)
    await settle()
    expect(await h.queue.count()).toBe(1)
    expect(h.badge.textContent).toBe('Sign in to sync')
  })

  it('400 (permanently invalid): the item is dropped, not retried forever', async () => {
    const h = loadQueue({ responses: [{ status: 400 }] })
    await h.queue.enqueue(canvasItem('bad'))
    const ok = await h.queue.flush()
    expect(ok).toBe(true) // queue ends empty → the flush "succeeded"
    await settle()
    expect(await h.queue.count()).toBe(0)
  })

  it('REGRESSION (AUDIT AP-1 fixed): 5xx retry counters PERSIST across flushes — the item drops after MAX_RETRIES=5', async () => {
    // queue.js used to bump `retries` on the object it read via getAll() — but real
    // IndexedDB returns STRUCTURED CLONES, so the bump was lost when the row was never
    // re-put. The re-put only happened inside `if (drop.length > 0)`, which requires
    // retries ≥ 5, which requires persistence → the drop branch was unreachable dead
    // code: items stayed queued forever on persistent 5xx (the very incident the drop
    // was shipped to fix). Phase 2 fix: survivors are re-put (and mirrored) on EVERY
    // 5xx, so the counter accumulates across flushes and the drop triggers at 5.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = loadQueue({ responses: Array.from({ length: 20 }, () => ({ status: 500 })) })
    await h.queue.enqueue(canvasItem('flaky'))
    try {
      for (let i = 1; i <= 4; i += 1) {
        const ok = await h.queue.flush()
        expect(ok).toBe(false)
        expect(await h.queue.count()).toBe(1) // still queued — within the retry budget
      }
      // the counter PERSISTED: the stored row itself now carries retries=4
      const pending = h.stores.get('pending') as Map<string, unknown>
      const row = [...pending.values()][0] as { retries: number }
      expect(row.retries).toBe(4)

      // 5th consecutive 5xx → MAX_RETRIES reached → dropped with the warning
      const ok = await h.queue.flush()
      expect(ok).toBe(false)
      expect(await h.queue.count()).toBe(0)
      expect(warn).toHaveBeenCalledWith('[queue] dropping', 1, 'canvas items after', 5, 'failed syncs (server error)')
    } finally {
      warn.mockRestore()
    }
  })

  it('REGRESSION (AUDIT AP-1 fixed, project path): a project item\'s retry counter persists and it drops on the 5th 5xx', async () => {
    // Same structured-clone bug on the /api/projects loop: the bump was never written
    // back, so a persistently-failing server kept the item queued forever.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = loadQueue({ responses: Array.from({ length: 20 }, () => ({ status: 500 })) })
    await h.queue.enqueue(projectItem('server on fire'))
    try {
      for (let i = 1; i <= 4; i += 1) {
        const ok = await h.queue.flush()
        expect(ok).toBe(false)
        expect(await h.queue.count()).toBe(1)
      }
      const pending = h.stores.get('pending') as Map<string, unknown>
      const row = [...pending.values()][0] as { retries: number }
      expect(row.retries).toBe(4)

      const ok = await h.queue.flush()
      expect(ok).toBe(false)
      expect(await h.queue.count()).toBe(0)
      expect(warn).toHaveBeenCalledWith('[queue] dropping project', expect.any(String), 'after', 5, 'failed syncs')
    } finally {
      warn.mockRestore()
    }
  })

  it('REGRESSION (AP-1): a 200 after partial 5xx failures resets nothing stale — the item syncs normally', async () => {
    // A successful flush must clear the item regardless of its persisted retry count
    // (the counter only ever gates the persistent-5xx drop; it must not block a 200).
    const h = loadQueue({ responses: [{ status: 500 }, { status: 500 }, { status: 200 }] })
    await h.queue.enqueue(canvasItem('recovers'))
    await h.queue.flush()
    await h.queue.flush()
    const ok = await h.queue.flush()
    expect(ok).toBe(true)
    expect(await h.queue.count()).toBe(0)
  })

  it('REGRESSION (AP-34): a 600-item offline queue flushes in CHUNKED sync POSTs (≤500/server cap), losing nothing', async () => {
    // The old flush POSTed the WHOLE queue in one body; past the server's 500-element
    // Zod cap that 400'd, and the invalidInput drop rule then silently discarded EVERY
    // queued edit (badge → "Saved") — a mass data-loss on reconnect after long offline.
    const h = loadQueue({ responses: [{ status: 200 }, { status: 200 }] })
    for (let i = 0; i < 600; i += 1) await h.queue.enqueue(canvasItem(`big-${i}`))
    await settle()
    const ok = await h.queue.flush()
    expect(ok).toBe(true)
    expect(h.fetchMock).toHaveBeenCalledTimes(2) // 400 + 200 elements
    const sizes = h.fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)).elements.length)
    expect(sizes).toEqual([400, 200])
    expect(await h.queue.count()).toBe(0)
  })

  it('REGRESSION (AP-34): the pagehide beacon is chunked the same way', async () => {
    const h = loadQueue()
    for (let i = 0; i < 600; i += 1) await h.queue.enqueue(canvasItem(`bc-${i}`))
    await settle()
    h.trigger('pagehide')
    expect(h.sendBeacon).toHaveBeenCalledTimes(2)
    const [first, second] = h.sendBeacon.mock.calls as Array<[string, Blob]>
    expect(JSON.parse(await first[1].text()).elements.length).toBe(400)
    expect(JSON.parse(await second[1].text()).elements.length).toBe(200)
  })

  it('REGRESSION (P2-a F4): emit()\'s count chain carries a .catch (no unhandledrejection on IDB failure)', () => {
    // Source-contract pin: the real module's emit must terminate its promise chain.
    const src = readFileSync(join(process.cwd(), 'public/js/queue.js'), 'utf8')
    const m = src.match(/function emit\(\) \{[\s\S]*?\n {2}\}/)
    expect(m).not.toBeNull()
    expect(m![0]).toContain('.catch(')
  })

  it('project items POST one-by-one to /api/projects and refresh the rail on success', async () => {
    const h = loadQueue()
    await h.queue.enqueue(projectItem('Idea A'))
    await h.queue.enqueue(projectItem('Idea B'))
    const ok = await h.queue.flush()
    expect(ok).toBe(true)
    expect(h.fetchMock).toHaveBeenCalledTimes(2)
    for (const call of h.fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(call[0]).toBe('/api/projects')
      expect(call[1].method).toBe('POST')
    }
    expect(await h.queue.count()).toBe(0)
    expect(h.railRefresh).toHaveBeenCalledTimes(2)
  })

  it('a canvas 401 blocks the whole flush — project items behind it are never attempted', async () => {
    const h = loadQueue({ responses: [{ status: 401 }] })
    await h.queue.enqueue(canvasItem('c'))
    await h.queue.enqueue(projectItem('p'))
    const ok = await h.queue.flush()
    expect(ok).toBe(false)
    expect(h.fetchMock).toHaveBeenCalledTimes(1) // only the canvas batch was tried
    expect(await h.queue.count()).toBe(2) // everything is kept for the re-auth retry
  })
})

describe('offline queue — offline + beacon + clearAll (characterization)', () => {
  it('flush is a no-op while navigator.onLine is false', async () => {
    const h = loadQueue({ online: false })
    await h.queue.enqueue(canvasItem('offline'))
    const ok = await h.queue.flush()
    expect(ok).toBe(false)
    expect(h.fetchMock).not.toHaveBeenCalled()
    expect(await h.queue.count()).toBe(1)
  })

  it('pagehide sends the canvas batch via sendBeacon and KEEPS the items queued (idempotent LWW)', async () => {
    const h = loadQueue()
    await h.queue.enqueue(canvasItem('beacon'))
    await settle()
    h.trigger('pagehide')
    expect(h.sendBeacon).toHaveBeenCalledTimes(1)
    const [url, blob] = h.sendBeacon.mock.calls[0] as [string, Blob]
    expect(url).toBe('/api/canvas/sync')
    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await blob.text())).toEqual({ elements: [canvasItem('beacon').data] })
    expect(await h.queue.count()).toBe(1) // the queue survives for the next regular flush
  })

  it('clearAll drops everything from the store and the mirror (the beacon then sends nothing)', async () => {
    const h = loadQueue()
    await h.queue.enqueue(canvasItem('one'))
    await h.queue.enqueue(canvasItem('two'))
    await settle()
    const removed = await h.queue.clearAll()
    expect(removed).toBe(2)
    expect(await h.queue.count()).toBe(0)
    h.trigger('pagehide')
    expect(h.sendBeacon).not.toHaveBeenCalled()
  })
})

describe('offline queue — harness sanity (guards the characterization itself)', () => {
  it('the real module\'s upgrade path created the pending store, keyed by the row id', async () => {
    const h = loadQueue()
    await h.queue.enqueue(canvasItem('x'))
    await settle()
    expect(h.stores.has('pending')).toBe(true) // opened through the real module's open()/onupgradeneeded
    const pending = h.stores.get('pending') as Map<string, unknown>
    expect(pending.size).toBe(1)
    // the stored row carries the client-generated UUID as its key (the id keyPath —
    // the historic autoIncrement bug is structurally impossible in this shape)
    const row = [...pending.values()][0] as { id: string; kind: string }
    expect(row.kind).toBe('canvas')
    expect(typeof row.id).toBe('string')
    expect(pending.has(row.id)).toBe(true)
  })
})
