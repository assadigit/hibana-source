import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Deploy-gate validation for the HTML → dist wiring (dr-integrity session,
// docs/dr-integrity-closeout.md §5): scripts/check-dist-wiring.mjs runs between the
// wired build and `wrangler deploy`. These tests exercise the gate against synthetic
// trees — a stale ref, an orphan file, an unwired leftover, a missing SW hook must all
// FAIL the gate (abort deploy); a consistent tree and a canonical (unwired) tree pass.

const SCRIPT = join(process.cwd(), 'scripts', 'check-dist-wiring.mjs')

function run(cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], { cwd, encoding: 'utf8' })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}\n${e.stderr ?? ''}` }
  }
}

/** Synthetic tree helper: manifest + optional HTML + dist files + sw.js */
function makeTree(opts: {
  manifest?: Record<string, string>
  html?: string
  distFiles?: string[]
  swJs?: string
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'hibana-distwiring-'))
  mkdirSync(join(dir, 'public', 'dist'), { recursive: true })
  writeFileSync(join(dir, 'public', 'sw.js'), opts.swJs ?? 'fetch("/dist/manifest.json")')
  if (opts.manifest) {
    writeFileSync(join(dir, 'public', 'dist', 'manifest.json'), JSON.stringify(opts.manifest))
  }
  if (opts.html !== undefined) {
    writeFileSync(join(dir, 'public', 'page.html'), opts.html)
  }
  for (const f of opts.distFiles ?? []) {
    writeFileSync(join(dir, 'public', 'dist', f), 'x')
  }
  return dir
}

const GOOD_MANIFEST = { 'app.js': 'dist/app.6b1fa9da.js', 'app.css': 'dist/app.b432907d.css' }

describe('check-dist-wiring (deploy gate)', () => {
  it('consistent wired tree passes', () => {
    const dir = makeTree({
      manifest: GOOD_MANIFEST,
      html: '<script src="/dist/app.6b1fa9da.js" defer></script><link rel="stylesheet" href="/dist/app.b432907d.css">',
      distFiles: ['app.6b1fa9da.js', 'app.b432907d.css'],
    })
    try {
      const r = run(dir)
      expect(r.code).toBe(0)
      expect(r.out).toContain('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stale hash reference FAILS the deploy (would serve immutable-wrong or 404)', () => {
    const dir = makeTree({
      manifest: GOOD_MANIFEST,
      html: '<script src="/dist/app.deadbeef.js" defer></script>',
      distFiles: ['app.6b1fa9da.js', 'app.b432907d.css'],
    })
    try {
      const r = run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('NOT in the manifest')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('orphan dist file FAILS (immutable-served file unknown to the manifest)', () => {
    const dir = makeTree({
      manifest: GOOD_MANIFEST,
      html: '<script src="/dist/app.6b1fa9da.js" defer></script><link rel="stylesheet" href="/dist/app.b432907d.css">',
      distFiles: ['app.6b1fa9da.js', 'app.b432907d.css', 'app.orphan123.js'],
    })
    try {
      const r = run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('orphan')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('partially-wired page FAILS (still references the unwired /js/ entry)', () => {
    const dir = makeTree({
      manifest: GOOD_MANIFEST,
      html: '<script src="/js/app.js?v=159" defer></script><link rel="stylesheet" href="/dist/app.b432907d.css">',
      distFiles: ['app.6b1fa9da.js', 'app.b432907d.css'],
    })
    try {
      const r = run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('wiring incomplete')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('canonical (unwired) tree passes as a no-op — the committed form is valid', () => {
    const dir = makeTree({
      manifest: GOOD_MANIFEST,
      html: '<script src="/js/app.js?v=159" defer></script>',
      distFiles: ['app.6b1fa9da.js', 'app.b432907d.css'],
    })
    try {
      const r = run(dir)
      expect(r.code).toBe(0)
      expect(r.out).toContain('canonical')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('wired tree without the manifest-driven SW hook FAILS', () => {
    const dir = makeTree({
      manifest: GOOD_MANIFEST,
      html: '<script src="/dist/app.6b1fa9da.js" defer></script><link rel="stylesheet" href="/dist/app.b432907d.css">',
      distFiles: ['app.6b1fa9da.js', 'app.b432907d.css'],
      swJs: '// old SW without manifest precache',
    })
    try {
      const r = run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('manifest-driven')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
