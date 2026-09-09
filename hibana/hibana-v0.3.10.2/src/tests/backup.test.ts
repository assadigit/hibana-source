import { describe, it, expect } from 'vitest'
import { backupToGitHub, selectOldBackups, enforceRetention } from '../services/backup'
import { githubClient } from '../services/github'
import { makeTestDb, makeUser } from './helpers'

// Backup retention (ROADMAP P2): snapshots accumulate daily forever; the cron/admin backup
// must prune to the newest N. The GitHub client is stubbed at the fetch boundary — these
// tests need zero network, matching the telegram/obsidian test pattern.

type StubHandler = (url: string, init: RequestInit) => Response

/** Run `fn` with globalThis.fetch stubbed to `handler`; returns what `fn` returned. */
async function withGithubStub<T>(handler: StubHandler, fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init ?? {})
  }) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe('backup retention', () => {
  it('selectOldBackups keeps the newest N and returns the rest in oldest-first order', () => {
    const paths = [
      'backups/snapshot-2026-08-01T00-00-00-000Z.json',
      'backups/snapshot-2026-08-02T00-00-00-000Z.json',
      'backups/snapshot-2026-08-03T00-00-00-000Z.json',
      'backups/snapshot-2026-08-04T00-00-00-000Z.json',
      'backups/snapshot-2026-08-05T00-00-00-000Z.json',
    ]
    expect(selectOldBackups(paths, 3)).toEqual([paths[0], paths[1]])
    expect(selectOldBackups(paths, 5)).toEqual([])
  })

  it('selectOldBackups ignores non-snapshot files and clamps keepN to at least 1', () => {
    const paths = [
      'backups/README.md',
      'backups/.gitkeep',
      'backups/snapshot-2026-08-01T00-00-00-000Z.json',
      'backups/snapshot-2026-08-02T00-00-00-000Z.json',
    ]
    expect(selectOldBackups(paths, 0)).toEqual(['backups/snapshot-2026-08-01T00-00-00-000Z.json'])
    expect(selectOldBackups([], 5)).toEqual([])
  })

  it('github client lists a dir and deletes a file via the Contents API (with its SHA)', async () => {
    const client = githubClient({ owner: 'o', repo: 'r', token: 'tok' })
    const deletes: { url: string; body?: string }[] = []
    await withGithubStub((url, init) => {
      if (init.method === 'DELETE') {
        deletes.push({ url, body: String(init.body) })
        return new Response('{}', { status: 200 })
      }
      return new Response(
        JSON.stringify([
          { name: 'snapshot-a.json', path: 'backups/snapshot-a.json', sha: 'sha-a', type: 'file' },
          { name: 'sub', path: 'backups/sub', sha: 'sha-sub', type: 'dir' },
        ]),
        { status: 200 },
      )
    }, async () => {
      const entries = await client.listDir('backups')
      expect(entries).toEqual([{ name: 'snapshot-a.json', path: 'backups/snapshot-a.json', sha: 'sha-a' }])
      await client.deleteFile('backups/snapshot-a.json', 'sha-a')
    })
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('/contents/backups/snapshot-a.json')
    expect(deletes[0].body).toContain('"sha-a"')
  })

  it('enforceRetention deletes only the oldest snapshots beyond the keep window', async () => {
    const client = githubClient({ owner: 'o', repo: 'r', token: 't' })
    const deleted: string[] = []
    await withGithubStub((url, init) => {
      if (init.method === 'DELETE') {
        deleted.push(url)
        return new Response('{}', { status: 200 })
      }
      return new Response(
        JSON.stringify([
          { name: 'snapshot-2026-08-01T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-01T00-00-00-000Z.json', sha: 's1', type: 'file' },
          { name: 'snapshot-2026-08-02T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-02T00-00-00-000Z.json', sha: 's2', type: 'file' },
          { name: 'snapshot-2026-08-03T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-03T00-00-00-000Z.json', sha: 's3', type: 'file' },
          { name: 'snapshot-2026-08-04T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-04T00-00-00-000Z.json', sha: 's4', type: 'file' },
          { name: 'README.md', path: 'backups/README.md', sha: 'sr', type: 'file' },
        ]),
        { status: 200 },
      )
    }, async () => {
      const removed = await enforceRetention(client, 2)
      expect(removed).toEqual([
        'backups/snapshot-2026-08-01T00-00-00-000Z.json',
        'backups/snapshot-2026-08-02T00-00-00-000Z.json',
      ])
    })
    expect(deleted).toHaveLength(2)
    expect(deleted.every((u) => !u.includes('README'))).toBe(true) // unrelated files untouched
  })

  it('backupToGitHub pushes the snapshot, then prunes down to keepN', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const deleted: string[] = []
      const state: { pushedPath: string } = { pushedPath: '' }
      const result = await withGithubStub((url, init) => {
        if (init.method === 'PUT') {
          state.pushedPath = new URL(url).pathname.split('/contents/')[1]
          return new Response(JSON.stringify({ content: { html_url: 'https://github.com/x' } }), { status: 201 })
        }
        if (init.method === 'DELETE') {
          deleted.push(url)
          return new Response('{}', { status: 200 })
        }
        // The listing after the push sees two old snapshots + the one just written.
        const freshName = state.pushedPath.split('/').pop() ?? ''
        return new Response(
          JSON.stringify([
            { name: 'snapshot-2026-08-01T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-01T00-00-00-000Z.json', sha: 's1', type: 'file' },
            { name: 'snapshot-2026-08-02T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-02T00-00-00-000Z.json', sha: 's2', type: 'file' },
            { name: freshName, path: state.pushedPath, sha: 'sf', type: 'file' },
          ]),
          { status: 200 },
        )
      }, async () => backupToGitHub(db, { owner: 'o', repo: 'r', token: 't' }, undefined, 2))

      expect(result.path).toContain('backups/snapshot-')
      expect(result.url).toBe('https://github.com/x')
      // keepN=2 → the oldest of the three is pruned; the fresh one is untouched
      expect(result.retained).toEqual(['backups/snapshot-2026-08-01T00-00-00-000Z.json'])
      expect(deleted).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('a failed retention listing never fails the backup itself', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const result = await withGithubStub((url, init) => {
        if (init.method === 'GET') return new Response('boom', { status: 500 })
        return new Response(JSON.stringify({ content: { html_url: 'https://github.com/x' } }), { status: 201 })
      }, async () => backupToGitHub(db, { owner: 'o', repo: 'r', token: 't' }, undefined, 2))
      expect(result.path).toContain('backups/snapshot-')
      expect(result.retained).toEqual([]) // prune skipped; next run retries
    } finally {
      close()
    }
  })
})