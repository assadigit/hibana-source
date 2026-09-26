// S152 — the global task-category library's shared server side (the owner's 9-block
// spec). The 16 fixed pastel pairs are the ONLY colors a category may wear (block 5:
// "Present a fixed set of 16 pastel swatch tiles ... Do not provide a free-form color
// picker or hex input field. A curated swatch guarantees every category stays
// readable and visually distinct"). The same 16 pairs live in variables.css as the
// --cat-sw-* tokens (the design-token law's only other home) — a unit test pins the
// two lists together so they can never drift.

export interface CatPair {
  fill: string
  ink: string
}

// Reading order = the owner's list order (the swatch grid renders this order).
export const CAT_PAIRS: readonly CatPair[] = [
  { fill: '#F0CCCC', ink: '#682727' },
  { fill: '#F0D9CC', ink: '#683F27' },
  { fill: '#F0E7CC', ink: '#685727' },
  { fill: '#ECF0CC', ink: '#5F6827' },
  { fill: '#DEF0CC', ink: '#476827' },
  { fill: '#D0F0CC', ink: '#2F6827' },
  { fill: '#CCF0D5', ink: '#276837' },
  { fill: '#CCF0E2', ink: '#27684F' },
  { fill: '#CCF0F0', ink: '#276868' },
  { fill: '#CCE2F0', ink: '#274F68' },
  { fill: '#CCD5F0', ink: '#273768' },
  { fill: '#D0CCF0', ink: '#2F2768' },
  { fill: '#DECCF0', ink: '#472768' },
  { fill: '#ECCCF0', ink: '#5F2768' },
  { fill: '#F0CCE7', ink: '#682757' },
  { fill: '#F0CCD9', ink: '#68273F' },
] as const

const PAIR_SET = new Set(CAT_PAIRS.map((p) => `${p.fill}/${p.ink}`))

// A pair is valid only when BOTH halves come from the same curated tile — a fill
// from one tile with an ink from another is not a swatch the picker can offer.
export function isValidCatPair(fill: unknown, ink: unknown): boolean {
  if (typeof fill !== 'string' || typeof ink !== 'string') return false
  return PAIR_SET.has(`${fill.toUpperCase()}/${ink.toUpperCase()}`)
}

// Block 3: matching is case-insensitive and ignores leading/trailing whitespace —
// "ui/ux", " UI/UX " and "Ui /Ux "… (trim, then fold) are the same name.
export function normCatName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

export interface CategoryRow {
  id: string
  name: string
  color_fill: string
  color_text: string
  is_archived: number
  created_at: string
}
