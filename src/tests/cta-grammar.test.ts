// src/tests/cta-grammar.test.ts — S186 (the owner's CTA development rule): the
// app-wide lint that keeps the rule true for FUTURE screens. The rule:
//   · ONE primary CTA per view — a SOLID teal fill (var(--cta)) with the on-teal
//     label (var(--btn-text)). The shared primary IS the bare <button> grammar in
//     base.css (the "Capture an idea" style); hover/focus/pressed/disabled all
//     ride the same block.
//   · Every other button in the view is a SECONDARY (.ghost outlined / .btn
//     neutral) — never the teal fill, and (since S186) never teal TEXT either:
//     secondaries read neutral so teal is reserved for the one primary + links.
//   · The primary sits at the TRAILING end of its button row: DOM order
//     [secondary…, primary] (a flex row mirrors under RTL, so trailing stays
//     trailing in both directions).
//   · The global floating action button is an app-shell element — exempt from
//     the one-per-view count, but it keeps the shared primary style.
//
// This file pins three invariants at the TEMPLATE level (SSR routes + client JS
// + shell HTML), so a new screen cannot quietly reintroduce a ghost-styled main
// action or a leading-end primary:
//   1. no <button type="submit"> carries a secondary class (.ghost / .btn as a
//      whole class TOKEN — .qa-btn & friends are the shared primary circles and
//      pass);
//   2. in every .row block holding a submit + 2+ buttons, the submit button is
//      the LAST button (the trailing end);
//   3. base.css's secondary grammar resolves to NEUTRAL ink (var(--text)) — the
//      teal-text secondary that caused the crop-modal incident cannot return.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd())
const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }

function collect(dir: string, exts: string[]): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (exts.some((e) => p.endsWith(e))) out.push(p)
    }
  }
  try { walk(dir) } catch { /* dir absent */ }
  return out
}

const TEMPLATES = [
  ...collect(join(ROOT, 'src', 'routes'), ['.ts']),
  ...collect(join(ROOT, 'src', 'lib'), ['.ts']),
  ...collect(join(ROOT, 'public', 'js'), ['.js']),
  ...collect(join(ROOT, 'public'), ['.html']).filter((f) => isFile(f)),
]

// class tokens: "ghost" or "btn" as a WHOLE token (jq-btn / save-btn are the
// shared composer circles, not the neutral .btn secondary).
const SECONDARY_CLASS = /<button[^>]*type="submit"[^>]*\bclass="[^"]*(?:^|\s)(?:ghost|btn)(?:\s|")/
const ROW_RE = /<div class="row[^"]*"[^>]*>([\s\S]*?)<\/div>/g
const BUTTON_RE = /<button[^>]*>/
const SUBMIT_RE = /<button[^>]*type="submit"/

describe('S186 CTA grammar (the app-wide development rule)', () => {
  it('no main action (type=submit) wears a secondary class (.ghost/.btn)', () => {
    const offenders: string[] = []
    for (const f of TEMPLATES) {
      const src = readFileSync(f, 'utf8')
      const m = src.match(SECONDARY_CLASS)
      if (m) offenders.push(`${f}: ${m[0].slice(0, 90)}`)
    }
    expect(offenders, `secondary-styled main actions (rule: the primary is the bare-button solid teal):\n${offenders.join('\n')}`).toEqual([])
  })

  it('every multi-button row puts the submit (primary) LAST — the trailing end', () => {
    const offenders: string[] = []
    for (const f of TEMPLATES) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(ROW_RE)) {
        const block = m[1]
        if (!SUBMIT_RE.test(block)) continue
        const buttons = block.match(BUTTON_RE)
        if (!buttons || buttons.length < 2) continue
        const sm = SUBMIT_RE.exec(block)
        if (sm && block.lastIndexOf('<button') !== sm.index) {
          offenders.push(`${f}: ${block.replace(/\s+/g, ' ').slice(0, 110)}`)
        }
      }
    }
    expect(offenders, `rows where the primary is NOT the trailing button:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the secondary grammar reads NEUTRAL (base.css .ghost ink = var(--text))', () => {
    const css = readFileSync(join(ROOT, 'public', 'css', 'base.css'), 'utf8')
    const ghost = css.match(/button\.ghost,\s*a\.ghost\s*\{([^}]*)\}/)
    expect(ghost, 'the button.ghost/a.ghost rule exists in base.css').toBeTruthy()
    expect(ghost![1]).toContain('color: var(--text)')
    expect(ghost![1]).not.toContain('var(--link)')
  })
})
