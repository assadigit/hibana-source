import { unzipSync } from 'fflate'

// Obsidian import helpers (spec §9). The flat-.md parsing used to live inline in
// integrations.ts; both the flat path and the new .zip path share it here so they parse
// identically. Pure functions — no DB, no runtime dependencies beyond fflate (pure JS,
// works on both the Worker and Node runtimes).

interface ParsedMarkdown {
  title: string
  description: string
}

/** Strip Obsidian YAML frontmatter, then title = first H1 or the filename (no extension). */
export function parseMarkdownNote(fileName: string, content: string): ParsedMarkdown | null {
  const clean = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = clean.split(/\r?\n/).map((l) => l.trim())
  const h1 = lines.find((l) => l.startsWith('# '))
  const title = (h1 ?? fileName.replace(/\.md$/i, '')).replace(/^#\s*/, '').slice(0, 200).trim()
  if (!title) return null
  const description =
    lines.filter((l) => !l.startsWith('#')).filter(Boolean).find((l) => !l.startsWith('-') && !l.startsWith('*')) ?? ''
  return { title, description: description.slice(0, 2000) }
}

interface ZipMarkdown {
  fileName: string
  content: string
}

// Obsidian exports the whole vault as a .zip with folders like `MyVault/Notes/Note.md`.
// Importable markdown entries only: skip directory entries, any path segment starting with
// '.' (the `.obsidian/` app config folder, `.trash/`, `.DS_Store`), and non-.md files.
const isMarkdownEntry = (name: string): boolean =>
  !name.endsWith('/') && /\.md$/i.test(name) && !name.split('/').some((seg) => seg.startsWith('.'))

/** Thrown when a zip exceeds the decompression budget — the route surfaces it as a 413. */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipLimitError'
  }
}

/**
 * Unzip a vault export and return the importable markdown entries (recursive folders).
 *
 * SECURITY (2026-08-28): the guard now runs BEFORE decompression, via fflate's `filter`
 * callback (it receives the central-directory metadata — declared sizes — per entry, and
 * entries it rejects are never inflated). Previously unzipSync() materialized EVERY entry
 * first and the 64MB cap was only checked afterwards — a zip-bomb could allocate
 * multi-GB of decompressed data inside the Worker's 128MB isolate before the cap fired.
 * fflate pre-allocates each output buffer at the declared originalSize, so a lying header
 * cannot silently inflate past what was declared.
 */
export function markdownFromZip(
  bytes: Uint8Array,
  limitBytes = 64 * 1024 * 1024,
  maxFiles = 5000,
): ZipMarkdown[] {
  let total = 0
  let count = 0
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!isMarkdownEntry(file.name)) return false // never even inflate non-markdown
      if (file.originalSize > limitBytes) throw new ZipLimitError(`Entry "${file.name}" is larger than the whole import budget.`)
      if (count >= maxFiles) throw new ZipLimitError(`Archive has more than ${maxFiles} markdown files.`)
      if (total + file.originalSize > limitBytes) throw new ZipLimitError(`Archive decompresses beyond the ${Math.floor(limitBytes / 1024 / 1024)}MB import budget.`)
      count++
      total += file.originalSize
      return true
    },
  })
  const entries: ZipMarkdown[] = []
  for (const [name, data] of Object.entries(files)) {
    entries.push({ fileName: name.replace(/^.*\//, ''), content: new TextDecoder().decode(data) })
  }
  return entries
}
