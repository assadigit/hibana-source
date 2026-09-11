// File storage backend (spec §8): a private GitHub repo via the Contents API.
// D1 keeps only paths; bytes live in GitHub, which versions them for free.
//
// Rule 7: reads MUST use the application/vnd.github.v3.raw Accept header — without it,
// files over 1MB come back as empty content with no error.

export interface GitHubConfig {
  owner: string
  repo: string
  token?: string // Cloudflare secret / env var (rule 5)
}

const API = 'https://api.github.com'

export function githubClient(cfg: GitHubConfig) {
  // Build headers deterministically. GitHub's REST API rejects requests without a
  // User-Agent, and Cloudflare's fetch() sends none by default — this is mandatory.
  const headers = (extra: Record<string, string>): Headers => {
    const h = new Headers({ 'User-Agent': 'hibana-cloudflare-worker', 'X-GitHub-Api-Version': '2022-11-28', ...extra })
    if (cfg.token) h.set('authorization', `Bearer ${cfg.token}`)
    return h
  }

  async function pushFile(path: string, contentB64: string, message: string): Promise<{ html_url: string }> {
    const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      method: 'PUT',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, content: contentB64 }),
    })
    if (!res.ok) throw new Error(`GitHub push failed (${res.status}): ${await res.text()}`)
    const data = (await res.json()) as { content: { html_url: string } }
    return { html_url: data.content.html_url }
  }

  /** Read file contents with the raw Accept header (rule 7). */
  async function readRaw(path: string): Promise<string> {
    const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      headers: headers({ Accept: 'application/vnd.github.v3.raw' }),
    })
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`)
    return res.text()
  }

  /** Read a binary file (images) as raw bytes — NEVER text-decode it: UTF-8 decoding
      corrupts non-ASCII bytes (PNG/JPEG mojibake → broken images). */
  async function readBinary(path: string): Promise<ArrayBuffer> {
    const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      headers: headers({ Accept: 'application/vnd.github.v3.raw' }),
    })
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`)
    return res.arrayBuffer()
  }

  /** List a directory (e.g. `backups`) — returns file entries with their SHAs. */
  async function listDir(dir: string): Promise<GitHubEntry[]> {
    const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${dir}`, {
      headers: headers({ Accept: 'application/vnd.github+json' }),
    })
    if (!res.ok) throw new Error(`GitHub list failed (${res.status}): ${await res.text()}`)
    const data = (await res.json()) as { name: string; path: string; sha: string; type: string }[]
    return data.filter((f) => f.type === 'file').map((f) => ({ name: f.name, path: f.path, sha: f.sha }))
  }

  /** Delete a file. The Contents API requires the SHA of the current version. When the SHA
      is not known (e.g. deleting an old project logo on replace/remove — Session 19 fix),
      look it up via a single GET to the Contents API first. Returns true on success, false
      if the file was already gone (404) — callers wrap in try/catch either way. */
  async function deleteFile(path: string, sha?: string): Promise<void> {
    let resolvedSha = sha
    if (!resolvedSha) {
      const probe = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
        headers: headers({ Accept: 'application/vnd.github+json' }),
      })
      if (probe.status === 404) return // already gone — nothing to delete
      if (!probe.ok) throw new Error(`GitHub sha-lookup failed (${probe.status}): ${await probe.text()}`)
      const meta = (await probe.json()) as { sha?: string }
      resolvedSha = meta.sha
      if (!resolvedSha) throw new Error(`GitHub sha-lookup returned no sha for ${path}`)
    }
    const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      method: 'DELETE',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: 'Hibana file cleanup', sha: resolvedSha }),
    })
    if (!res.ok) throw new Error(`GitHub delete failed (${res.status}): ${await res.text()}`)
  }

  return { pushFile, readRaw, readBinary, listDir, deleteFile }
}

interface GitHubEntry {
  name: string
  path: string
  sha: string
}

export interface GitHubClient {
  pushFile(path: string, contentB64: string, message: string): Promise<{ html_url: string }>
  readRaw(path: string): Promise<string>
  readBinary(path: string): Promise<ArrayBuffer>
  listDir(dir: string): Promise<GitHubEntry[]>
  deleteFile(path: string, sha?: string): Promise<void>
}