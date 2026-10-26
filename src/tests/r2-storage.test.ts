import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { r2Storage, r2ConfigFromEnv } from '../services/r2'

// S35: the R2/S3 adapter — AWS SigV4 over Web Crypto (runtime-agnostic: Workers + Node).
// These tests pin the REQUEST SHAPE (what the S3 API contract actually checks) with a
// stubbed fetch, plus the env parsing. The local end-to-end run (mini-services/shot-store
// on :3040) exercised the same adapter against a live S3-compatible server.

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const CFG = {
  endpoint: 'https://testacct.r2.cloudflarestorage.com',
  bucket: 'hibana-shots',
  accessKeyId: 'testkey',
  secretAccessKey: 'testsecret',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body?: Uint8Array
}

function stubStore(reply: { status: number; body?: ArrayBuffer } = { status: 200 }) {
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
      headers: { 'Content-Type': 'application/xml' },
    })
  }) as typeof fetch)
  return calls
}

describe('r2 adapter request shape (SigV4)', () => {
  it('PUT: path-style URL, Authorization AWS4 header, payload hash header, raw bytes body', async () => {
    const calls = stubStore()
    const store = r2Storage(CFG)
    await store.putObject('user1/proj1/screenshots/abc-shot.png', PNG_B64, 'image/png')
    expect(calls).toHaveLength(1)
    const put = calls[0]
    // path-style: endpoint/bucket/key — the leading slash of the key is normalized away
    expect(put.url).toBe('https://testacct.r2.cloudflarestorage.com/hibana-shots/user1/proj1/screenshots/abc-shot.png')
    expect(put.method).toBe('PUT')
    expect(put.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=testkey\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=(content-type;)?host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    // the payload hash header must be a real sha256 (64 hex) — the canonical request
    // hashes the SAME value, a mismatch is the classic SigV4 silent killer
    expect(put.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/)
    expect(put.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    expect(put.headers['content-type']).toBe('image/png')
    // body = the DECODED bytes (70 for the 1×1 PNG), not the base64 text
    expect(put.body?.byteLength).toBe(70)
  })

  it('GET: no body, same signing scheme; returns the raw ArrayBuffer', async () => {
    const bytes = new TextEncoder().encode('not-really-an-image')
    const calls = stubStore({ status: 200, body: bytes.buffer })
    const store = r2Storage(CFG)
    const out = await store.getObject('user1/proj1/screenshots/abc-shot.png')
    expect(new Uint8Array(out)).toEqual(bytes)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].body).toBeUndefined()
    expect(calls[0].headers['authorization']).toMatch(/^AWS4-HMAC-SHA256/)
  })

  it('DELETE: 404 is a SUCCESS (idempotent cleanup), other failures throw', async () => {
    const calls = stubStore({ status: 404 })
    const store = r2Storage(CFG)
    await expect(store.deleteObject('gone/key.png')).resolves.toBeUndefined()
    expect(calls[0].method).toBe('DELETE')
    stubStore({ status: 403 })
    await expect(r2Storage(CFG).deleteObject('locked/key.png')).rejects.toThrow(/403/)
  })

  it('PUT failure surfaces the status', async () => {
    stubStore({ status: 403 })
    await expect(r2Storage(CFG).putObject('k.png', PNG_B64, 'image/png')).rejects.toThrow(/R2 put failed \(403\)/)
  })
})

describe('r2ConfigFromEnv', () => {
  it('builds the endpoint from the account id, strips trailing slashes', () => {
    const cfg = r2ConfigFromEnv({ R2_ACCOUNT_ID: 'abc123', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })
    expect(cfg).toEqual({ endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', region: 'auto' })
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: 'abc123', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b', R2_ENDPOINT: 'https://s3.example.org/' })?.endpoint).toBe('https://s3.example.org')
  })

  it('unset credentials or missing endpoint → null (the GitHub path stays active)', () => {
    expect(r2ConfigFromEnv({})).toBeNull()
    expect(r2ConfigFromEnv({ R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })).toBeNull() // no account id, no endpoint
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: 'a', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })).toBeNull() // no access key
  })

  // S36: the SigV4 scope region — R2 answers to 'auto'; Backblaze B2 (the no-card
  // free alternative) validates it against the endpoint; anything else defaults
  // us-east-1; an explicit R2_REGION/S3_REGION always wins.
  it('derives the SigV4 region from the endpoint host (B2, R2, default)', () => {
    const b2 = r2ConfigFromEnv({ R2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })
    expect(b2?.region).toBe('us-west-004')
    const r2 = r2ConfigFromEnv({ R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })
    expect(r2?.region).toBe('auto')
    const generic = r2ConfigFromEnv({ R2_ENDPOINT: 'https://s3.example.org', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })
    expect(generic?.region).toBe('us-east-1')
    const local = r2ConfigFromEnv({ R2_ENDPOINT: 'http://localhost:3040', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })
    expect(local?.region).toBe('us-east-1')
  })

  it('R2_REGION (or S3_REGION) overrides the derived region', () => {
    expect(r2ConfigFromEnv({ R2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b', R2_REGION: 'eu-central-1' })?.region).toBe('eu-central-1')
    expect(r2ConfigFromEnv({ R2_ENDPOINT: 'https://s3.example.org', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b', S3_REGION: 'us-west-1' })?.region).toBe('us-west-1')
  })
})

describe('S36 region flows into the SigV4 credential scope', () => {
  it('a B2 config signs with the endpoint region, not auto', async () => {
    const calls = stubStore()
    const store = r2Storage({ endpoint: 'https://s3.us-west-004.backblazeb2.com', bucket: 'hibana-shots', accessKeyId: 'testkey', secretAccessKey: 'testsecret', region: 'us-west-004' })
    await store.putObject('user1/proj1/screenshots/abc-shot.png', PNG_B64, 'image/png')
    expect(calls[0].headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=testkey\/\d{8}\/us-west-004\/s3\/aws4_request/)
  })

  // AP-37 (Phase 2): the SIGNING KEY must derive from the same region as the scope.
  // The old code derived it from a hardcoded 'auto' — signatures looked well-formed
  // but every non-R2 provider 403'd (scope said us-west-004, key said 'auto').
  // Pin: an INDEPENDENT SigV4 recomputation from the captured request (RFC recipe,
  // reimplemented here — not imported from r2.ts) must match the sent Authorization.
  it('the signature matches an independent SigV4 recomputation (region flows into the signing key)', async () => {
    const calls = stubStore()
    const cfg = { endpoint: 'https://s3.us-west-004.backblazeb2.com', bucket: 'hibana-shots', accessKeyId: 'testkey', secretAccessKey: 'testsecret', region: 'us-west-004' }
    const store = r2Storage(cfg)
    await store.putObject('user1/proj1/screenshots/abc-shot.png', PNG_B64, 'image/png')
    expect(calls).toHaveLength(1)
    const c = calls[0]
    const auth = String(c.headers['authorization'])
    const m = auth.match(/^AWS4-HMAC-SHA256 Credential=testkey\/(\d{8})\/us-west-004\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/)
    expect(m).not.toBeNull()
    const [, , , claimedSig] = m!
    // --- independent recomputation (the SigV4 spec recipe) ---
    const enc = new TextEncoder()
    const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
    const sha256Hex = async (d: string | Uint8Array) => toHex(await crypto.subtle.digest('SHA-256', d instanceof Uint8Array ? (d as unknown as BufferSource) : enc.encode(d)))
    const hmac = async (key: Uint8Array, msg: string) => {
      const k = await crypto.subtle.importKey('raw', key as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      return crypto.subtle.sign('HMAC', k, enc.encode(msg))
    }
    const u = new URL(c.url)
    const hdrs: Record<string, string> = {
      host: u.host,
      'content-type': String(c.headers['content-type']),
      'x-amz-content-sha256': String(c.headers['x-amz-content-sha256']),
      'x-amz-date': String(c.headers['x-amz-date']),
    }
    const names = Object.keys(hdrs).sort()
    const canonicalHeaders = names.map((h) => `${h}:${hdrs[h].trim()}\n`).join('')
    const payloadHash = await sha256Hex(c.body!)
    const canonicalRequest = ['PUT', u.pathname, '', canonicalHeaders, names.join(';'), payloadHash].join('\n')
    const amzDate = hdrs['x-amz-date']
    const dateStamp = amzDate.slice(0, 8)
    const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')
    const kDate = await hmac(enc.encode('AWS4' + cfg.secretAccessKey), dateStamp)
    const kRegion = await hmac(new Uint8Array(kDate), cfg.region) // us-west-004 — NOT 'auto'
    const kService = await hmac(new Uint8Array(kRegion), 's3')
    const kSigning = await hmac(new Uint8Array(kService), 'aws4_request')
    const expected = toHex(await hmac(new Uint8Array(kSigning), stringToSign))
    expect(claimedSig).toBe(expected) // old code: 'auto' key → a DIFFERENT (rejected) signature
  })
})
