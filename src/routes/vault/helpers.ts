// Notes Vault shared helpers (Phase 4 split from routes/vault.ts).
//
// Purpose: the vault's request schemas, limits, and pure text helpers — icon/tag
// normalization, note excerpting, word counting, and the VaultNoteCard mapping.
// Used by every vault route module (folders/notes/imports) and re-exported from
// vault/index.ts for the test suite's direct imports.
//
// Public API: NOTE_BODY_LIMIT, NOTE_TITLE_LIMIT, FOLDER_NAME_LIMIT, TAG_LIMIT,
// createNoteSchema, patchNoteSchema, createFolderSchema, patchFolderSchema,
// reorderNotesSchema, sanitizeIcon, normalizeTags, excerptOf, wordCount,
// VaultNoteCard, toCard.
import { z } from 'zod'
import { uuidSchema } from '../../validation/schemas'
import type { VaultNoteRow } from '../../types'

export const NOTE_BODY_LIMIT = 200_000 // ~200KB — D1 row safety (owner-approved cap)
export const NOTE_TITLE_LIMIT = 300
const FOLDER_NAME_LIMIT = 80
const TAG_LIMIT = 24

export const createNoteSchema = z.object({
  title: z.string().max(NOTE_TITLE_LIMIT).optional(),
  content: z.string().max(NOTE_BODY_LIMIT).optional(),
  folderId: uuidSchema.nullable().optional(),
  tags: z.string().max(500).optional(),
})
export const patchNoteSchema = z.object({
  title: z.string().max(NOTE_TITLE_LIMIT).optional(),
  content: z.string().max(NOTE_BODY_LIMIT).optional(),
  folderId: uuidSchema.nullable().optional(), // omitted = untouched; null = unfile
  tags: z.string().max(500).optional(),
  starred: z.boolean().optional(),
  // S86 (0059): the note's emoji — null or '' clears it. Bounded to one grapheme-ish
  // cluster (family/ZWJ emojis reach ~25 UTF-16 units); sanitized in sanitizeIcon.
  icon: z.string().max(32).nullable().optional(),
})
export const createFolderSchema = z.object({
  name: z.string().min(1).max(FOLDER_NAME_LIMIT),
  parentId: uuidSchema.nullable().optional(),
})
export const patchFolderSchema = z.object({
  name: z.string().min(1).max(FOLDER_NAME_LIMIT).optional(),
  parentId: uuidSchema.nullable().optional(), // null = move to root
  // S86 (0059): the folder's emoji — null or '' clears it (the sparks-shelf twin).
  icon: z.string().max(32).nullable().optional(),
})

// S86 (0059): the drag-reorder payload — the ids of the CURRENT view in their new
// visual order (top → bottom). Every id must be a live note owned by the caller.
export const reorderNotesSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
})

/** S86: normalize a user-picked emoji. One emoji (any codepoints), no control chars,
 * * no newlines, capped hard. Returns '' when the input isn't a single-ish cluster —
 * the route stores NULL for that ("no icon"), never a broken string. */
export function sanitizeIcon(raw: string | null | undefined): string | null {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '') // control chars (newlines included)
    // NB: \u200d (ZWJ) is deliberately KEPT — it is structural for family/sequence
    // emojis (👨‍👩‍👧‍👦). Only the invisible-noise twins go: ZWSP, ZWNJ, LRM, RLM,
    // line/paragraph separators, BOM.
    .replace(/[\u200b\u200c\u200e\u200f\u2028\u2029\ufeff]/g, '')
    .trim()
  if (!s) return null
  // Grapheme-ish guard. heavy = the code points that carry visible glyphs (ZWJ,
  // variation selectors and keycap merges are joiners, not glyphs). A real emoji
  // cluster — even a four-person family — stays ≤ 4 heavy; pasted prose doesn't.
  const cps = [...s].map((ch) => ch.codePointAt(0) ?? 0)
  const joiner = (cp: number) => cp === 0x200d || cp === 0xfe0f || cp === 0x20e3
  const heavy = cps.filter((cp) => !joiner(cp))
  if (heavy.length > 4 || cps.length > 24) return null
  // ASCII letters never appear in an emoji cluster (keycaps are digits + FE0F/20E3,
  // and they keep their merge code points — a LONE letter/digit is prose, not an icon).
  const hasMerge = cps.some((cp) => cp === 0xfe0f || cp === 0x20e3)
  for (const cp of heavy) {
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return null
    if (cp >= 0x30 && cp <= 0x39 && !hasMerge) return null
  }
  return s
}

/** Normalize a manual-tags CSV: trim, drop empties + duplicates (case-insensitive),
 * cap the count, re-join with ", ". The pills are rendered from this. */
export function normalizeTags(raw: string | null | undefined): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of String(raw ?? '').split(',')) {
    const tag = t.trim().replace(/^#/, '')
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= TAG_LIMIT) break
  }
  return out.join(', ')
}

/** First ~160 chars of the note as a card excerpt: markdown markers stripped so the
 *  card reads like the rendered note, newlines flattened to spaces. */
export function excerptOf(content: string, max = 160): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ') // code blocks → nothing useful in an excerpt
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s{0,3}>\s?/gm, '') // quote markers
    // S84: task markers stripped BEFORE the list strip (a `- [ ] milk` line would
    // otherwise excerpt as literal `[ ] milk` — the raw-markdown look the owner
    // flagged). Bullet optional + space-or-EOL after `]` so `[x](url)` stays a link.
    .replace(/^[ \t]*(?:[-*+]|\d+\.)?[ \t]*\[[ xX]\](?:[ \t]+|$)/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '') // list markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[*_~`#]+/g, '') // emphasis/code markers
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain
}

/** Word count for the status bar / cards. Persian and English both count by whitespace
 *  runs; digits + Latin abbreviations count as words. */
export function wordCount(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean)
  return words.length
}

/** A note minus the full body — what list views return (the body would bloat the
 *  payload for folders with many notes; the editor fetches it on open). */
export type VaultNoteCard = Omit<VaultNoteRow, 'content'> & {
  excerpt: string
  word_count: number
}

export const toCard = (n: VaultNoteRow): VaultNoteCard => {
  const { content, ...rest } = n
  return { ...rest, excerpt: excerptOf(content), word_count: wordCount(content) }
}
