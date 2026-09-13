// S35 (user request 2026-09 — "find a free cloud storage we can connect to by API"):
// Cloudflare R2 object storage via the S3 REST API (AWS SigV4, Web Crypto only — runs
// on BOTH runtimes, Workers and Node, zero new dependencies). R2's free tier is the
// pick: 10 GB-month storage, 1M Class A + 10M Class B ops/month, ZERO egress — and
// it lives on the same Cloudflare account the Worker already deploys to.
//
// Scope: the SCREENSHOT pipeline only (push/read/delete). Avatars, logos and backups
// stay on the GitHub Contents API (spec §8) — screenshots are the high-volume,
// user-facing surface that benefits from a real object store. The `github_path`
// column keeps its name for compatibility (it is the STORAGE PATH; the provider is
// decided by which adapter is configured, not by the column).
//
// SigV4 notes (real quirks that break naive implementations):
//   - the canonical request's payload hash covers UNSIGNED-PAYLOAD only when the
//     header says so; here we hash the actual body (no streaming).
//   - the canonical URI is the URL-encoded path per S3 rules; our keys are
//     [A-Za-z0-9/_.-] only (ids + sanitized filenames), so encoding is identity —
//     keep it that way when building keys.
//   - x-amz-content-sha256 must be the SAME hash used in the canonical request.

export interface R2Config {
  endpoint: string // e.g. https://<account>.r2.cloudflarestorage.com
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface ObjectStore {
  /** Put bytes at the key. contentBase64 = the raw payload (not the GitHub JSON shape). */
  putObject(key: string, contentBase64: string, contentType: string): Promise<void>
  /** Read the object's bytes (never text-decoded — images corrupt). */
  getObject(key: string): Promise<ArrayBuffer>
  /** Delete by key; a 404 is a success (idempotent cleanup). */
  deleteObject(key: string): Promise<void>
}

const enc = new TextEncoder()
const ALGO = { name: 'HMAC', hash: 'SHA-256' } as const
// TS 5.7 + workers-types type arrays as ArrayBufferLike — every Web Crypto entry
// point below takes BufferSource; one narrow cast keeps both runtimes happy.
const src = (u: Uint8Array): BufferSource => u as unknown as BufferSource

async function hmac(key: Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', src(key), ALGO, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, src(enc.encode(data)))
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data : enc.encode(data)
  const digest = await crypto.subtle.digest('SHA-256', src(buf))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export function r2Storage(cfg: R2Config): ObjectStore {
  const url = new URL(cfg.endpoint)
  const host = url.host // path-style: host/bucket/key (R2 + every S3-compatible accepts it)
  const trimmed = cfg.endpoint.replace(/\/+$/, '')

  /** One SigV4-signed request. Body: bytes (PUT/DELETE) or none (GET). */
  async function signed(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Uint8Array, contentType?: string): Promise<Response> {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260913T054246Z
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = body ? await sha256Hex(body) : await sha256Hex('')
    const canonicalUri = '/' + cfg.bucket + '/' + key.replace(/^\/+/, '')
    // canonical headers: host + x-amz-content-sha256 + x-amz-date (+ content-type on PUT)
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    }
    if (contentType) headers['content-type'] = contentType
    const signedHeaderNames = Object.keys(headers).sort()
    const canonicalHeaders = signedHeaderNames.map((h) => h + ':' + headers[h].trim() + '\n').join('')
    const canonicalRequest = [
      method,
      canonicalUri,
      '', // no query
      canonicalHeaders,
      signedHeaderNames.join(';'),
      payloadHash,
    ].join('\n')
    const scope = `${dateStamp}/auto/s3/aws4_request` // R2 uses region 'auto'
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      await sha256Hex(canonicalRequest),
    ].join('\n')
    const kDate = await hmac(enc.encode('AWS4' + cfg.secretAccessKey), dateStamp)
    const kRegion = await hmac(new Uint8Array(kDate), 'auto')
    const kService = await hmac(new Uint8Array(kRegion), 's3')
    const kSigning = await hmac(new Uint8Array(kService), 'aws4_request')
    const signature = toHex(await hmac(new Uint8Array(kSigning), stringToSign))
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`
    const reqHeaders: Record<string, string> = { ...headers, authorization }
    return fetch(`${trimmed}${canonicalUri}`, { method, headers: reqHeaders, body: body ? (body as unknown as BodyInit) : undefined })
  }

  const b64ToBytes = (b64: string): Uint8Array => {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  return {
    async putObject(key, contentBase64, contentType) {
      const res = await signed('PUT', key, b64ToBytes(contentBase64), contentType)
      if (!res.ok) throw new Error(`R2 put failed (${res.status}): ${await res.text()}`)
    },
    async getObject(key) {
      const res = await signed('GET', key)
      if (!res.ok) throw new Error(`R2 get failed (${res.status}): ${await res.text()}`)
      return res.arrayBuffer()
    },
    async deleteObject(key) {
      const res = await signed('DELETE', key)
      // 404 = already gone (R2 deletes are idempotent) — not an error
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status}): ${await res.text()}`)
    },
  }
}

/** Build the config from Worker/Node env (see Env.R2_*); null when not configured. */
export function r2ConfigFromEnv(env: {
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_ENDPOINT?: string
}): R2Config | null {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) return null
  const endpoint = env.R2_ENDPOINT?.trim() ||
    (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null)
  if (!endpoint) return null
  return { endpoint: endpoint.replace(/\/+$/, ''), bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
}
