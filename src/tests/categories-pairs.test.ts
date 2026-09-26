import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAT_PAIRS, isValidCatPair, normCatName } from '../lib/categories'

// S152: the 16 curated category pairs live in TWO homes by design — the server's
// validation constant (src/lib/categories.ts) and the design-token block in
// variables.css (--cat-sw-*) that feeds every swatch grid. This pin exists so the
// two lists can never drift (the design-token law's enforcement teeth).
const css = readFileSync(join(process.cwd(), 'public', 'css', 'variables.css'), 'utf8')

describe('S152 category swatch pairs', () => {
  it('exposes exactly 16 pairs', () => {
    expect(CAT_PAIRS).toHaveLength(16)
  })

  it('every pair is a valid input (self-consistent)', () => {
    for (const p of CAT_PAIRS) expect(isValidCatPair(p.fill, p.ink)).toBe(true)
  })

  it('cross-tile pairs are rejected (a fill from one tile with another ink)', () => {
    expect(isValidCatPair(CAT_PAIRS[0].fill, CAT_PAIRS[1].ink)).toBe(false)
    expect(isValidCatPair('#FFFFFF', '#000000')).toBe(false)
    expect(isValidCatPair(undefined, null)).toBe(false)
  })

  it('variables.css carries the SAME 16 pairs in the same order (--cat-sw-*)', () => {
    for (let i = 0; i < CAT_PAIRS.length; i++) {
      const fillRe = new RegExp(`--cat-sw-${i + 1}-fill:\\s*${CAT_PAIRS[i].fill.replace('#', '#')}\\s*;`)
      const inkRe = new RegExp(`--cat-sw-${i + 1}-ink:\\s*${CAT_PAIRS[i].ink.replace('#', '#')}\\s*;`)
      expect(css).toMatch(fillRe)
      expect(css).toMatch(inkRe)
    }
    // and the token block stops at 16 (no stray 17th tile)
    expect(css).not.toMatch(/--cat-sw-17-/)
  })

  it('normCatName trims + casefolds (block 3: near-duplicates cannot fork)', () => {
    expect(normCatName('  UI/UX ')).toBe('ui/ux')
    expect(normCatName('UI/UX')).toBe(normCatName(' ui/ux '))
    expect(normCatName(null as unknown as string)).toBe('')
  })
})
