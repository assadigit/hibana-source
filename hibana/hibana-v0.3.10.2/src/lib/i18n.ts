import type { Context } from 'hono'

// Server-side i18n for htmx fragments (spec §14). Fragments are server-rendered and
// re-fetched after each action, so the correct place to translate them is here — the
// authenticated user's language_pref is already on the context. Client chrome (nav,
// static headings, JS-built strings) is handled by public/js/i18n.js on the browser.
//
// Convention: the English string is the key and carries the value verbatim, so the
// default (en) output stays byte-identical to today — no dict file to keep in sync,
// no key drift. Interpolate with {curly} placeholders.

export type Locale = 'en' | 'fa'

export type Vars = Record<string, string | number>

/** Language preference for a request context (defaults to English). */
export function localeOf(c: Context): Locale {
  const u = c.get('user') as { language_pref?: Locale } | undefined
  return u?.language_pref === 'fa' ? 'fa' : 'en'
}

function fill(s: string, vars?: Vars): string {
  if (!vars) return s
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** Translate a string given an explicit language. */
export function trL(lang: Locale, en: string, fa?: string, vars?: Vars): string {
  return fill(lang === 'fa' && fa ? fa : en, vars)
}

/** Bound translator for a request. `t('English', 'فارسی')` / `t('x {n} y', '…', { n })`. */
export function trFor(c: Context): (en: string, fa?: string, vars?: Vars) => string {
  const lang = localeOf(c)
  return (en, fa, vars) => trL(lang, en, fa, vars)
}
