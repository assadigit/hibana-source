import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { kvStorage, kvRestConfigFromEnv } from '../services/kv'
import type { ObjectStore } from '../services/r2'

// S38: the Workers KV adapter — the no-card screenshot store. Two transports behind one
// ObjectStore contract: the KV *binding* (Worker path — no credential in the Worker at
// all) and the KV *REST API* (Node/scripts path). These tests pin the request shape of
// both with stubs; the LIVE round-trip (real Cloudflare KV, real Worker, real bytes) is
// run by scripts/live-shot-check.mjs — see the S38 worklog.

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const KEY = 'user1/proj1/screenshots/abc-shot.png'

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---- binding mode (the Worker path) ------------------------------------------

/** Minimal KVNamespace double — records puts (value + options), serves gets from a map. */
function fakeBinding() {
  const puts: { key: string; value: Uint8Array; options: unknown }[] = []
  const deletes: string[] = []
  const map = new Map<string, Uint8Array>()
  const binding = {
    put: async (key: string, value: Uint8Array, options?: unknown) => {
      puts.push({ key, value, options })
      map.set(key, value)
    },
    get: async (key: string, type?: string) => {
      const v = map.get(key)
      if (v === undefined) return null
      return type === 'arrayBuffer' ? (v.slice().buffer as ArrayBuffer) : v
    },
    delete: async (key: string) => {
      deletes.push(key)
      map.delete(key)
    },
  }
  return { binding, puts, deletes }
}

describe('kv adapter — binding mode (Worker path)', () => {
  it('PUT stores the DECODED bytes with NO options — never an expirationTtl (the never-expire requirement)', async () => {
    const { binding, puts } = fakeBinding()
    const store: ObjectStore = kvStorage({ mode: 'binding', binding: binding as never })
    await store.putObject(KEY, PNG_B64, 'image/png')
    expect(puts).toHaveLength(1)
    expect(puts[0].key).toBe(KEY)
    expect(puts[0].value.byteLength).toBe(70) // 1×1 PNG bytes, not the base64 text
    // THE guarantee: no options object at all → no TTL → the key lives until deleted
    expect(puts[0].options).toBeUndefined()
  })

  it('GET round-trips the ArrayBuffer; a miss (row live, bytes gone) throws', async () => {
    const { binding } = fakeBinding()
    const store: ObjectStore = kvStorage({ mode: 'binding', binding: binding as never })
    await store.putObject(KEY, PNG_B64, 'image/png')
    const out = await store.getObject(KEY)
    expect(out.byteLength).toBe(70)
    await expect(store.getObject('missing/key.png')).rejects.toThrow(/KV get failed \(404\)/)
  })

  it('DELETE removes the key (KV deletes are idempotent — a missing key is a no-op)', async () => {
    const { binding, deletes } = fakeBinding()
    const store: ObjectStore = kvStorage({ mode: 'binding', binding: binding as never })
    await store.putObject(KEY, PNG_B64, 'image/png')
    await store.deleteObject(KEY)
    expect(deletes).toEqual([KEY])
    await expect(store.deleteObject(KEY)).resolves.toBeUndefined()
  })
})

// ---- REST mode (the Node/scripts path) ---------------------------------------

interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body?: Uint8Array
}

function stubRest(reply: { status: number; body?: ArrayBuffer } = { status: 200 }) {
  const calls: Captured[] = []
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method ?? 'GET'),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body instanceof Uint8Array ? init.body : undefined,
    })
    return new Response(reply.body ?? new ArrayBuffer(0), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch)
  return calls
}

const REST_CFG = { mode: 'rest' as const, accountId: 'acct123', namespaceId: 'ns456', apiToken: 'tok789' }

describe('kv adapter — REST mode (Node path)', () => {
  it('PUT: bearer token, percent-encoded key (slashes!), raw decoded bytes body', async () => {
    const calls = stubRest()
    await kvStorage(REST_CFG).putObject(KEY, PNG_B64, 'image/png')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/storage/kv/namespaces/ns456/values/user1%2Fproj1%2Fscreenshots%2Fabc-shot.png',
    )
    expect(calls[0].headers['authorization']).toBe('Bearer tok789')
    expect(calls[0].body?.byteLength).toBe(70)
  })

  it('GET: returns the raw ArrayBuffer from the response', async () => {
    const bytes = new TextEncoder().encode('kv-bytes')
    const calls = stubRest({ status: 200, body: bytes.buffer })
    const out = await kvStorage(REST_CFG).getObject(KEY)
    expect(new Uint8Array(out)).toEqual(bytes)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].body).toBeUndefined()
  })

  it('GET miss → 404 throws (the row is the truth; a missing object must be loud)', async () => {
    stubRest({ status: 404 })
    await expect(kvStorage(REST_CFG).getObject('gone/key.png')).rejects.toThrow(/KV get failed \(404\)/)
  })

  it('DELETE: 404 is a SUCCESS (idempotent cleanup); other failures throw', async () => {
    const calls = stubRest({ status: 404 })
    await expect(kvStorage(REST_CFG).deleteObject('gone/key.png')).resolves.toBeUndefined()
    expect(calls[0].method).toBe('DELETE')
    stubRest({ status: 403 })
    await expect(kvStorage(REST_CFG).deleteObject('locked/key.png')).rejects.toThrow(/KV delete failed \(403\)/)
  })

  it('PUT failure surfaces the status', async () => {
    stubRest({ status: 429 })
    await expect(kvStorage(REST_CFG).putObject('k.png', PNG_B64, 'image/png')).rejects.toThrow(/KV put failed \(429\)/)
  })
})

// ---- env parsing --------------------------------------------------------------

describe('kvRestConfigFromEnv', () => {
  it('builds the REST config from KV_ACCOUNT_ID/KV_NAMESPACE_ID/KV_API_TOKEN', () => {
    expect(kvRestConfigFromEnv({ KV_ACCOUNT_ID: 'a', KV_NAMESPACE_ID: 'n', KV_API_TOKEN: 't' })).toEqual({
      mode: 'rest',
      accountId: 'a',
      namespaceId: 'n',
      apiToken: 't',
    })
  })

  it('any missing var → null (the r2/GitHub fallback chain stays active)', () => {
    expect(kvRestConfigFromEnv({})).toBeNull()
    expect(kvRestConfigFromEnv({ KV_ACCOUNT_ID: 'a', KV_NAMESPACE_ID: 'n' })).toBeNull()
    expect(kvRestConfigFromEnv({ KV_ACCOUNT_ID: 'a', KV_API_TOKEN: 't' })).toBeNull()
    expect(kvRestConfigFromEnv({ KV_NAMESPACE_ID: ' n ', KV_API_TOKEN: 't', KV_ACCOUNT_ID: ' ' })).toBeNull() // blank != set
  })
})
