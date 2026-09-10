import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, jsonBody } from '../lib/http'
import { icon, quadrantGlyph } from '../lib/html'
import { legacyTaskNote, sadhanaTaskControls, taskStatusTrack, type SadhanaTaskNote } from '../lib/sadhana-task-controls'
import { localeOf, trL, type Locale, type Vars } from '../lib/i18n'
import { calendarFor, faDigits, formatDate, formatDateLong } from '../lib/jalali'
import { uuid } from '../lib/ids'
import { QUADRANTS, TAGS, orderedQuadrants, parseQuadrantOrder, resetDueRecurring, todayIn, type SadhanaTask, type TagId } from '../services/sadhana'
import type { Config, UserRow } from '../types'

// Sadhana — standalone quadrant task board (spec 2026-08-25). Board + archive + focus
// render as htmx fragments swapping `closest .sadhana-zone` (the same zone serves the
// board, the focus overlay and the archive container); JSON for fetch() consumers.
// Rule 1: every query is user-scoped. Fuzzy deadlines are labels only — no date math,
// never overdue (spec §6.10). Exact deadlines are displayed via [data-date] so the
// client calendar layer converts them (calendar pref on the user record).

export const FUZZY_LABEL: Record<string, { en: string; fa: string }> = {
  tom: { en: 'Until tomorrow', fa: 'تا فردا' },
  '48h': { en: 'Within 48 hours', fa: 'تا ۴۸ ساعت دیگر' },
  week: { en: 'This week', fa: 'این هفته' },
  mon: { en: 'This month', fa: 'این ماه' },
  '3mo': { en: 'Next 3 months', fa: 'سه ماه آینده' },
  '6mo': { en: 'Next 6 months', fa: 'شش ماه آینده' },
  ny: { en: 'By the new year', fa: 'تا سال نو' },
}

export const quickAddSchema = z.object({
  title: z.string().min(1).max(255),
  emoji: z.string().max(4).optional(),
})

// Deadline + recurrence live on the same task; fuzzy and exact are mutually exclusive,
// exact time requires an exact date, and a recurring task needs a type. Refinements are
// applied on the FINAL schemas (zod effects can't be merged/extended).
// htmx posts checkboxes/hidden twins as 'true'/'false' strings; JSON sends booleans.
export const toBool = (v: unknown): unknown => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v)

export const deadlinishFields = {
  fuzzy: z.enum(['tom', '48h', 'week', 'mon', '3mo', '6mo', 'ny']).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
} as const
export const recurshFields = {
  recurring: z.union([z.boolean(), z.preprocess(toBool, z.boolean())]).optional().default(false),
  recur_type: z.enum(['daily', 'weekly', 'ndays', 'monthly']).nullable().optional(),
  recur_config: z.string().max(64).optional().default(''),
} as const

export const createTaskSchema = z
  .object({ ...deadlinishFields, ...recurshFields })
  .extend({
    title: z.string().min(1).max(255),
    quadrant: z.union([z.number(), z.preprocess((v) => Number(v), z.number())]).pipe(z.literal(1).or(z.literal(2)).or(z.literal(3)).or(z.literal(4))),
    emoji: z.string().max(4).optional(),
    note: z.string().max(20_000).optional().default(''),
    // Form posts send one checkbox per checked tag (tags=w&tags=h) or a single string;
    // JSON consumers send an array. Accept both.
    tags: z
      .preprocess((v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]), z.array(z.enum(['w', 'p', 'sg', 'so', 'h'])).max(5))
      .optional()
      .default([]),
    focus: z.preprocess(toBool, z.boolean()).optional().default(false),
  })
  .superRefine((o, ctx) => {
    if (!o.title.trim()) ctx.addIssue({ code: 'custom', message: 'title required' })
    if (o.fuzzy && o.due_date) ctx.addIssue({ code: 'custom', message: 'fuzzy and exact are mutually exclusive' })
    if (o.due_time && !o.due_date) ctx.addIssue({ code: 'custom', message: 'exact time requires an exact date' })
    if (o.recurring && !o.recur_type) ctx.addIssue({ code: 'custom', message: 'recur_type required when recurring' })
  })

export const patchTaskSchema = z
  .object({ ...deadlinishFields })
  .extend({
    title: z.string().min(1).max(255).optional(),
    emoji: z.string().max(4).optional(),
    note: z.string().max(20_000).optional(),
    pinned: z.union([z.boolean(), z.preprocess(toBool, z.boolean())]).optional(),
    progress: z.enum(['untouched', 'in_progress', 'on_hold']).optional(),
    // NO defaults here on purpose: a PATCH must carry at least one explicit field, and
    // `{}` must stay rejectable (recurshFields' defaults would mask an empty update).
    recurring: z.union([z.boolean(), z.preprocess(toBool, z.boolean())]).optional(),
    recur_type: z.enum(['daily', 'weekly', 'ndays', 'monthly']).nullable().optional(),
    recur_config: z.string().max(64).optional(),
  })
  .superRefine((o, ctx) => {
    if (Object.keys(o).length === 0) ctx.addIssue({ code: 'custom', message: 'empty update' })
    if (o.fuzzy && o.due_date) ctx.addIssue({ code: 'custom', message: 'fuzzy and exact are mutually exclusive' })
    if (o.due_time && !o.due_date) ctx.addIssue({ code: 'custom', message: 'exact time requires an exact date' })
    if (o.recurring && !o.recur_type) ctx.addIssue({ code: 'custom', message: 'recur_type required when recurring' })
  })

export const moveSchema = z.object({
  quadrant: z.union([z.number(), z.preprocess((v) => Number(v), z.number())]).pipe(z.literal(1).or(z.literal(2)).or(z.literal(3)).or(z.literal(4))),
})
export const reorderSchema = z.object({
  quadrant: z.union([z.number(), z.preprocess((v) => Number(v), z.number())]).pipe(z.literal(1).or(z.literal(2)).or(z.literal(3)).or(z.literal(4))),
  ids: z.array(z.string().uuid()).max(200),
})
export const quadrantOrderSchema = z.object({
  ids: z.array(z.union([z.number(), z.preprocess((v) => Number(v), z.number())])).length(4),
}).superRefine((body, ctx) => {
  const ids = body.ids
  if (new Set(ids).size !== 4 || ![1, 2, 3, 4].every((id) => ids.includes(id))) {
    ctx.addIssue({ code: 'custom', message: 'ids must be a complete quadrant permutation' })
  }
})
export const updateSchema = z.object({ text: z.string().trim().min(1).max(500) })
export const QUADRANT_ICONS = ['gear', 'target', 'star', 'heart', 'flag', 'folder-plus', 'calendar', 'book', 'idea', 'bell', 'mountain', 'leaf'] as const
export const GLYPH_IDS = new Set<string>(QUADRANT_ICONS) // glyph ids vs plain-emoji icon values
export const QUADRANT_ACCENTS = ['accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-green', 'accent-purple', 'accent-pink', 'accent-teal'] as const
export const renameSchema = z.object({
  name: z.string().max(60).nullable(),
  subtitle: z.string().max(120).nullable().optional(), // 0025: optional editable subheading (blank = empty line)
  // icon_id is either one of the SVG glyph ids (dashboard picker) or a plain emoji
  // (sadhana.html picker, user request 2026-09-02) — max 8 chars covers every emoji incl. ZWJ sequences.
  icon_id: z.string().max(8).optional(),
  accent_color: z.enum(QUADRANT_ACCENTS).optional(),
})

// Weekday button order per language (spec §5.12: the Persian week starts with Saturday).
// Spec weekdays are Mon=0…Sun=6 — the same numbers the API/storage use.
export const WEEKDAYS: Record<Locale, { n: number; label: string }[]> = {
  en: [
    { n: 0, label: 'Mon' }, { n: 1, label: 'Tue' }, { n: 2, label: 'Wed' }, { n: 3, label: 'Thu' },
    { n: 4, label: 'Fri' }, { n: 5, label: 'Sat' }, { n: 6, label: 'Sun' },
  ],
  fa: [
    { n: 6, label: 'شنبه' }, { n: 0, label: 'یکشنبه' }, { n: 1, label: 'دوشنبه' }, { n: 2, label: 'سه‌شنبه' },
    { n: 3, label: 'چهارشنبه' }, { n: 4, label: 'پنج‌شنبه' }, { n: 5, label: 'جمعه' },
  ],
}

export type BoardCtx = { user: UserRow; lang: Locale; cal: 'gregorian' | 'shamsi'; tz: string; today: string }

