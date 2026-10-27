import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// hibana-sync-status-spec §16 (acceptance): "New tests cover the state transitions
// and the count rule." Same harness doctrine as offline-queue.test.ts: vitest runs
// in node and nothing imports public/js, so this suite evaluates the REAL
// public/js/sync-state.js byte-for-byte (no reimplementation) against fakes for
// every browser global it touches. setTimeout/clearTimeout are captured and never
// run on their own — fireTimers() advances the 500ms Syncing threshold exactly
// when a test wants to.

interface TimerEntry {
  fn: () => void
  ms: number
  cancelled: boolean
}

interface SyncHarness {
  sync: {
    track: (id: string, run: () => Promise<unknown>) => Promise<unknown>
    trackBulk: (ids: string[], run: () => Promise<unknown>) => Promise<unknown>
    markAllSyncing: () => void
    stateOf: (id: string) => string
    syncedAt: (id: string) => number | null
    count: () => number
    subscribe: (fn: (n: number, id: string | null) => void) => () => void
  }
  timers: TimerEntry[]
  fireTimers: () => void
  clickRetry: (id: string) => void
  goOnline: () => void
  announced: () => string[]
  painted: () => string[]
  detailPainted: () => string[]
}

/** Evaluates the REAL public/js/sync-state.js in a sandboxed scope. The fake
 * document records outerHTML repaints (card + detail badges), routes the delegated
 * retry click, and gives announce() ONE persistent live region whose textContent
 * setter records every polite announcement. The fake window carries a HibanaChips
 * twin that records repaint calls instead of building markup. */
function loadSync(over: { online?: boolean } = {}): SyncHarness {
  const timers: TimerEntry[] = []
  const painted: string[] = []
  const detailPainted: string[] = []
  const announcements: string[] = []
  const docListeners = new Map<string, Array<(e: unknown) => void>>()
  const winListeners = new Map<string, Set<() => void>>()
  let online = over.online ?? true

  // one shared live region: the module keeps its own reference, so textContent
  // writes must land in a persistent object we can observe
  const liveRegion: Record<string, unknown> = {
    className: '',
    id: '',
    setAttribute: () => {},
  }
  Object.defineProperty(liveRegion, 'textContent', {
    set: (v: string) => { announcements.push(v) },
    get: () => announcements[announcements.length - 1] || '',
  })

  const document = {
    addEventListener: (ev: string, fn: (e: unknown) => void) => {
      if (!docListeners.has(ev)) docListeners.set(ev, [])
      docListeners.get(ev)!.push(fn)
    },
    querySelectorAll: (sel: string) => {
      const m = sel.match(/^\[(data-sync-badge(?:-detail)?)="(.+)"\]$/)
      if (!m) return []
      const isDetail = m[1] === 'data-sync-badge-detail'
      const node: Record<string, unknown> = {}
      Object.defineProperty(node, 'outerHTML', {
        set: (v: string) => { (isDetail ? detailPainted : painted).push(v) },
        get: () => '',
      })
      return [node]
    },
    createElement: () => liveRegion,
    body: { appendChild: () => {}, contains: () => true },
  }

  const window: Record<string, unknown> = {
    addEventListener: (ev: string, fn: () => void) => {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set())
      winListeners.get(ev)!.add(fn)
    },
    HibanaChips: {
      syncBadgeHtml: (id: string, state: string, pop?: boolean) => `badge:${id}:${state}${pop ? ':pop' : ''}`,
      syncBadgeDetailHtml: (id: string, state: string, pop?: boolean) => `detail:${id}:${state}${pop ? ':pop' : ''}`,
    },
    hibanaI18n: { t: (k: string) => ({ 'sync.synced': 'Synced', 'sync.failed': "Couldn't sync. Retry" })[k] },
  }
  const navigator = { get onLine() { return online } }

  const setTimeoutStub = (fn: () => void, ms: number) => {
    const entry = { fn, ms, cancelled: false }
    timers.push(entry)
    return entry
  }
  const clearTimeoutStub = (handle: TimerEntry | null) => {
    if (handle) handle.cancelled = true
  }

  const src = readFileSync(join(process.cwd(), 'public/js/sync-state.js'), 'utf8')
  const factory = new Function(
    'window',
    'document',
    'navigator',
    'setTimeout',
    'clearTimeout',
    `${src}\nreturn window.HibanaSyncState`,
  )
  const sync = factory(window, document, navigator, setTimeoutStub, clearTimeoutStub) as SyncHarness['sync']

  return {
    sync,
    timers,
    fireTimers: () => {
      for (const t of [...timers]) if (!t.cancelled) t.fn()
    },
    clickRetry: (id: string) => {
      const pill = { getAttribute: () => id }
      const ev = { target: { closest: (sel: string) => (sel === '[data-sync-retry]' ? pill : null) } }
      for (const fn of docListeners.get('click') ?? []) fn(ev)
    },
    goOnline: () => {
      online = true
      for (const fn of winListeners.get('online') ?? []) fn()
    },
    announced: () => announcements,
    painted: () => painted,
    detailPainted: () => detailPainted,
  }
}

/** Drains the microtask queue so track()'s promise chain settles before asserts. */
const settle = () => new Promise<void>((r) => setImmediate(r))

describe('sync-state (hibana-sync-status-spec §8 transitions + §9 count rule)', () => {
  it('a fast sync goes Pending → Synced and never shows Syncing (spec: only past ~500ms)', async () => {
    const h = loadSync()
    let resolveRun: (v: unknown) => void = () => {}
    const run = () => new Promise((r) => { resolveRun = r })
    h.sync.track('t1', run)
    expect(h.sync.stateOf('t1')).toBe('pending')
    await settle() // let the tracked run() actually start (it assigns resolveRun)
    resolveRun({})
    await settle()
    expect(h.sync.stateOf('t1')).toBe('synced')
    expect(h.painted().some((p) => p.includes(':syncing'))).toBe(false)
    expect(h.sync.count()).toBe(0)
  })

  it('a slow sync shows Syncing only after the 500ms threshold, then Synced', async () => {
    const h = loadSync()
    let resolveRun: (v: unknown) => void = () => {}
    const run = () => new Promise((r) => { resolveRun = r })
    h.sync.track('t1', run)
    expect(h.sync.stateOf('t1')).toBe('pending')
    await settle() // let the tracked run() actually start
    h.fireTimers() // 500ms elapsed
    expect(h.sync.stateOf('t1')).toBe('syncing')
    resolveRun({})
    await settle()
    expect(h.sync.stateOf('t1')).toBe('synced')
    expect(h.painted().some((p) => p.startsWith('badge:t1:synced:pop'))).toBe(true)
  })

  it('a failure marks the card Failed and the count rule holds (pending + failed only)', async () => {
    const h = loadSync()
    const ok = h.sync.track('ok', () => Promise.resolve({}))
    const bad = h.sync.track('bad', () => Promise.reject(new Error('500')))
    await Promise.allSettled([ok, bad])
    expect(h.sync.stateOf('ok')).toBe('synced')
    expect(h.sync.stateOf('bad')).toBe('failed')
    expect(h.sync.count()).toBe(1)
    void h.sync.track('pending', () => new Promise(() => {}))
    expect(h.sync.count()).toBe(2)
  })

  it('the failed pill retries ONLY its card: click → new cycle → Synced, count drops to zero', async () => {
    const h = loadSync()
    let attempts = 0
    const run = () => {
      attempts++
      return attempts === 1 ? Promise.reject(new Error('500')) : Promise.resolve({})
    }
    await h.sync.track('t1', run).catch(() => {})
    expect(h.sync.stateOf('t1')).toBe('failed')
    expect(attempts).toBe(1)
    h.clickRetry('t1')
    await settle()
    expect(attempts).toBe(2)
    expect(h.sync.stateOf('t1')).toBe('synced')
    expect(h.sync.count()).toBe(0)
  })

  it('a newer edit while an older one is syncing wins: the old verdict is discarded (seq guard)', async () => {
    const h = loadSync()
    let resolveOld: (v: unknown) => void = () => {}
    let resolveNew: (v: unknown) => void = () => {}
    const oldRun = () => new Promise((r) => { resolveOld = r })
    const newRun = () => new Promise((r) => { resolveNew = r })
    h.sync.track('t1', oldRun)
    h.fireTimers() // the old cycle goes Syncing
    expect(h.sync.stateOf('t1')).toBe('syncing')
    h.sync.track('t1', newRun) // newer edit — back to Pending (spec §8)
    expect(h.sync.stateOf('t1')).toBe('pending')
    resolveOld({}) // the stale ack arrives
    await settle()
    expect(h.sync.stateOf('t1')).toBe('pending') // discarded — the newer cycle owns the card
    resolveNew({})
    await settle()
    expect(h.sync.stateOf('t1')).toBe('synced')
  })

  it('offline: a failure keeps the card Pending (the label switches, not the state)', async () => {
    const h = loadSync({ online: false })
    await h.sync.track('t1', () => Promise.reject(new Error('offline'))).catch(() => {})
    expect(h.sync.stateOf('t1')).toBe('pending')
    expect(h.sync.count()).toBe(1) // still needs attention
  })

  it('reconnect resumes: every still-pending retry re-runs when the network returns', async () => {
    const h = loadSync({ online: false })
    let attempts = 0
    const run = () => {
      attempts++
      return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({})
    }
    await h.sync.track('t1', run).catch(() => {})
    expect(h.sync.stateOf('t1')).toBe('pending')
    h.goOnline()
    await settle()
    expect(attempts).toBe(2)
    expect(h.sync.stateOf('t1')).toBe('synced')
  })

  it('pressing Sync moves every Pending and Failed card to Syncing together (spec §9)', async () => {
    const h = loadSync()
    void h.sync.track('a', () => new Promise(() => {}))
    void h.sync.track('b', () => new Promise(() => {}))
    await h.sync.track('c', () => Promise.reject(new Error('x'))).catch(() => {})
    expect(h.sync.count()).toBe(3)
    h.sync.markAllSyncing()
    expect(h.sync.stateOf('a')).toBe('syncing')
    expect(h.sync.stateOf('b')).toBe('syncing')
    expect(h.sync.stateOf('c')).toBe('syncing')
  })

  it('trackBulk: one request, many cards — all Pending together, all settled by the one verdict', async () => {
    const h = loadSync()
    const run = vi.fn(() => Promise.resolve({}))
    await h.sync.trackBulk(['a', 'b', 'c'], run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(h.sync.stateOf('a')).toBe('synced')
    expect(h.sync.stateOf('b')).toBe('synced')
    expect(h.sync.stateOf('c')).toBe('synced')
  })

  it('subscribe delivers the count — the Sync button derives from the same store (§9)', async () => {
    const h = loadSync()
    const seen: number[] = []
    h.sync.subscribe((n) => seen.push(n))
    await h.sync.track('t1', () => Promise.resolve({})).catch(() => {})
    expect(seen[0]).toBe(1) // pending
    expect(seen[seen.length - 1]).toBe(0) // synced
  })

  it('the polite region announces Synced and Failed — never Pending or Syncing (§12)', async () => {
    const h = loadSync()
    let resolveRun: (v: unknown) => void = () => {}
    void h.sync.track('t1', () => new Promise((r) => { resolveRun = r }))
    await settle() // let the tracked run() actually start
    h.fireTimers() // syncing appears — must stay silent
    expect(h.announced()).toEqual([])
    resolveRun({})
    await settle()
    expect(h.announced()).toEqual(['Synced'])
    await h.sync.track('t2', () => Promise.reject(new Error('x'))).catch(() => {})
    expect(h.announced()).toEqual(['Synced', "Couldn't sync. Retry"])
  })

  it('syncedAt records the last confirmed sync (the §10 "Synced N minutes ago" source)', async () => {
    const h = loadSync()
    expect(h.sync.syncedAt('t1')).toBe(null) // never tracked → server-rendered, no client timestamp yet
    await h.sync.track('t1', () => Promise.resolve({}))
    expect(typeof h.sync.syncedAt('t1')).toBe('number')
  })

  it('an untracked (server-rendered) card reads as synced — the implicit state (§2)', () => {
    const h = loadSync()
    expect(h.sync.stateOf('never-edited')).toBe('synced')
    expect(h.sync.count()).toBe(0)
  })
})
