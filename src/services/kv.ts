// S38 (user: "which free alternative to R2 do you suggest — implement it and test it:
// upload in hibana, check they're really uploaded and shown, pictures must never expire
// unless deleted by me"): Cloudflare Workers KV is the pick — the no-card object store
// already on THIS Cloudflare account (same one that runs the Worker + D1). R2's free
// tier is card-gated (S36); KV is not: `wrangler kv namespace create` worked with the
// existing token and zero payment info. Free tier: 1 GB storage (≈ 5,000+ screenshots
// at the app's 5 MB upload cap), 100k reads / 1k writes per day, values ≤ 25 MB.
//
// THE NEVER-EXPIRE GUARANTEE (the user's explicit requirement): KV keys written WITHOUT
// an expirationTtl have NO expiry — they live until explicitly deleted. This adapter
// NEVER passes expirationTtl, so the only deletion path is the app's own
// DELETE /api/screenshots/:id (and B2/R2 remain the documented 10 GB upgrade path via
// the S36 env vars, unchanged, if the owner ever signs up).
//
// ONE codebase, two transports behind the same ObjectStore contract (portability rule):
//   - Worker path: the HIBANA_SHOTS KV *binding* (wrangler.toml) — no credential exists
//     inside the Worker at all, auth is the deployment itself. Fastest path (edge-local).
//   - Node/scripts path: the KV REST API with an account-scoped token (env KV_*),
//     used by start:node and scripts/live-shot-check.mjs.
//
// Consistency note: KV is eventually-consistent globally (≤ 60 s), but a read issued
// right after a write from the same client/colo — exactly the upload→card-render flow —
// hits the same KV node in practice. The live round-trip checks (S38 worklog) confirmed
// immediate read-after-write on both the REST and binding paths.
import type { ObjectStore } from './r2'

/** Which KV transport this runtime has. Built by the Worker/Node entry points. */
export type KvShotsConfig =
  | { mode: 'binding'; binding: import('@cloudflare/workers-types').KVNamespace }
  | { mode: 'rest'; accountId: string; namespaceId: string; apiToken: string }

const API_BASE = 'https://api.cloudflare.com/client/v4'

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Node/scripts path: KV_ACCOUNT_ID + KV_NAMESPACE_ID + KV_API_TOKEN. null = unset (the
 *  GitHub/R2 fallback chain stays active). Dedicated names — no silent coupling to the
 *  deploy token's CLOUDFLARE_* vars. */
export function kvRestConfigFromEnv(env: {
  KV_ACCOUNT_ID?: string
  KV_NAMESPACE_ID?: string
  KV_API_TOKEN?: string
}): Extract<KvShotsConfig, { mode: 'rest' }> | null {
  const accountId = env.KV_ACCOUNT_ID?.trim()
  const namespaceId = env.KV_NAMESPACE_ID?.trim()
  const apiToken = env.KV_API_TOKEN?.trim()
  if (!accountId || !namespaceId || !apiToken) return null
  return { mode: 'rest', accountId, namespaceId, apiToken }
}

export function kvStorage(cfg: KvShotsConfig): ObjectStore {
  if (cfg.mode === 'binding') {
    const kv = cfg.binding
    return {
      // NOTE: no options object on purpose — no expirationTtl anywhere (see header).
      async putObject(key: string, contentBase64: string) {
        await kv.put(key, b64ToBytes(contentBase64))
      },
      async getObject(key: string) {
        const value = await kv.get(key, 'arrayBuffer')
        // A null read with a live DB row = bytes gone at the provider; surface it loudly
        // (the row is the truth — the media route fails and the card's onerror shows).
        if (value === null) throw new Error(`KV get failed (404): ${key}`)
        return value
      },
      async deleteObject(key: string) {
        await kv.delete(key) // idempotent — deleting a missing key is a no-op
      },
    }
  }

  // REST transport (Node self-host, scripts). Key is a single path segment → percent-
  // encode it (our keys contain '/', e.g. user1/proj/screenshots/abc-shot.png).
  // Destructured consts — TS keeps the narrowed (non-binding) type inside the closure.
  const { accountId, namespaceId, apiToken } = cfg
  const base = `${API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values`
  async function call(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Uint8Array): Promise<Response> {
    return fetch(`${base}/${encodeURIComponent(key)}`, {
      method,
      headers: {
        authorization: `Bearer ${apiToken}`,
        ...(body ? { 'content-type': 'application/octet-stream' } : {}),
      },
      body: body ? (body as unknown as BodyInit) : undefined,
    })
  }
  return {
    async putObject(key: string, contentBase64: string) {
      const res = await call('PUT', key, b64ToBytes(contentBase64))
      if (!res.ok) throw new Error(`KV put failed (${res.status}): ${await res.text()}`)
    },
    async getObject(key: string) {
      const res = await call('GET', key)
      if (!res.ok) throw new Error(`KV get failed (${res.status}): ${await res.text()}`)
      return res.arrayBuffer()
    },
    async deleteObject(key: string) {
      const res = await call('DELETE', key)
      // 404 = already gone — idempotent cleanup, same contract as the S3 adapter
      if (!res.ok && res.status !== 404) throw new Error(`KV delete failed (${res.status}): ${await res.text()}`)
    },
  }
}
