import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

// S244 — the spec pack's Phase 5 client round (the deadline engine + UI). The
// write surface landed in Phase 1 (S240: due_at + due_origin_at + the origin
// rules) and the READ surface in Phase 2 (S241: the server-computed
// effective-deadline triple on every board-payload task row); this suite pins
// the Phase 5 CLIENT contracts:
//   1. The shared Gregorian/Jalali date control (D6 — due-control.js): the
//      segmented calendar selector, the six §11.3 presets with the EXACT
//      semantics, the Add time (optional) toggle OFF by default, date-only
//      resolving to LOCAL 23:59 (§11.2 — superseding assumption 10's interim
//      UTC end-of-day parse), the value contract = the ISO-8601 UTC instant.
//   2. The Add/Edit Task Due date (optional) toggle (§9.1): OFF by default,
//      the read-only inherited line reading the payload row's
//      effective_due_source (§10.1), the explicit-null removal contract (§10.2).
//   3. The card deadline row + the thin progress bar: the triple-consumption
//      (NO client re-derivation — the renderers read effective_due_* and the
//      bar reads effective_due_origin_at), the §12.3 thresholds at the EXACT
//      48h/7d boundaries (§24), the §12.4 done-neutrality, the LTR-bar-in-RTL
//      rule (§17), and the byte-identical grammar across the client + server
//      twins (the parity extension lives in kanban-parity.test.ts).
//   4. The desktop seam tripwires (the Phase 9 re-pin inventory): ZERO new
//      fetch sites — the control + the render stack ride no network at all.
//
// Doctrine: the s242/s243 source-pin style (vitest runs in node; nothing
// imports public/js — the real files are read byte-for-byte) EXTENDED with the
// i18n-parity loader's precedent: devboard.js + the vendored jalaali are
// EXECUTED in a VM sandbox so the threshold boundaries and the Jalali
// round-trip are tested behaviorally, not just textually.

const readPublic = (rel: string) => readFileSync(join(process.cwd(), 'public', rel), 'utf8')

/** Executes the vendored jalaali + devboard.js in one VM sandbox (the i18n
 * parity loader's pattern) — window.HibanaBoard comes out live, its helpers
 * callable with deterministic `now` values. */
function loadBoardLib(stubI18n?: { t?: (k: string) => string; lang?: () => string }) {
  const sandbox: Record<string, unknown> = {
    window: {},
    document: { addEventListener() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console,
  }
  const win = sandbox.window as Record<string, unknown>
  runInNewContext(readPublic('vendor/jalaali.min.js'), sandbox, { filename: 'jalaali.min.js' })
  runInNewContext(readPublic('js/devboard.js'), sandbox, { filename: 'devboard.js' })
  if (stubI18n) {
    win.hibanaI18n = stubI18n
    if (!stubI18n.t) win.hibanaI18n = { t: (k: string) => k, lang: stubI18n.lang ?? (() => 'en') }
  }
  const B = win.HibanaBoard as Record<string, (...args: unknown[]) => unknown>
  if (!B) throw new Error('window.HibanaBoard did not load')
  return B
}

describe('S244 — the shared Gregorian/Jalali date control (D6, due-control.js)', () => {
  it('the control exists and is exposed (window.HibanaDueControl.create) — D6 CLOSED', () => {
    const js = readPublic('js/due-control.js')
    expect(js).toContain('window.HibanaDueControl = { create }')
    expect(js).toContain('S244 (spec pack Phase 5, D6)')
  })

  it('the segmented calendar selector + ONE editable date per calendar (§11.1) + the six presets + Add time OFF by default (§11.2)', () => {
    const js = readPublic('js/due-control.js')
    for (const marker of [
      // §11.1: the explicit Gregorian | Jalali segmented selector; the default
      // follows the user's calendar_pref (server-derived from the language —
      // the calendarFor rule the comment cites)
      'data-due-cal',
      "t('db.due.calG', 'Gregorian')",
      "t('db.due.calJ', 'Jalali')",
      "let cal = lang === 'fa' ? 'jalali' : 'gregorian'",
      // ONE editable date field per calendar — the other ships hidden
      'data-due-g',
      'data-due-j',
      'gIn.hidden = cal !== \'gregorian\'',
      // the six presets (§11.3) as compact chips
      'data-due-preset="today"',
      'data-due-preset="24h"',
      'data-due-preset="48h"',
      'data-due-preset="72h"',
      'data-due-preset="week"',
      'data-due-preset="month"',
      // the Add time (optional) toggle + the §11.2 helper text
      'data-due-time-toggle',
      "t('db.due.timeHint', 'Without a specified time, the deadline is 23:59 on the selected day.')",
    ]) {
      expect(js.includes(marker), `due-control.js must carry ${JSON.stringify(marker)}`).toBe(true)
    }
  })

  it('the presets\' EXACT semantics (§11.3): Today = LOCAL 23:59; 24/48/72h = now + N hours; This week = the selected calendar\'s week end; This month = the selected calendar\'s month end', () => {
    const js = readPublic('js/due-control.js')
    // Today → the day's LOCAL 23:59 sentinel (time OFF)
    expect(js).toContain("val = dayEndLocal(now.getFullYear(), now.getMonth() + 1, now.getDate())\n        timeOn = false")
    // 24/48/72h → exactly now + N hours (an instant WITH a time — the toggle reveals it)
    expect(js).toContain('val = new Date(now.getTime() + HOUR * Number(kind.slice(0, -1)))')
    // This week: Gregorian Sunday-first → coming Saturday; Jalali Saturday-first → coming Friday
    expect(js).toContain("const ahead = cal === 'jalali' ? (5 - dow + 7) % 7 : (6 - dow + 7) % 7")
    // This month: the Jalali month's own last day (Esfand 29/30 — the leap rule) converted back
    expect(js).toContain('const last = jMonthLen(j.jy, j.jm)')
    expect(js).toContain('const g = toG(j.jy, j.jm, last)')
  })

  it('§11.2 — date-only resolves to LOCAL 23:59 (assumption 10\'s UTC interim parse is GONE everywhere)', () => {
    const js = readPublic('js/due-control.js')
    // the LOCAL day-end resolver: new Date(y, m-1, d, 23, 59, 59, 999) — LOCAL
    // constructors, never a UTC 'T23:59:59Z' string parse
    expect(js).toContain('const dayEndLocal = (y, m, d) => new Date(y, m - 1, d, 23, 59, 59, 999)')
    expect(js).not.toContain('T23:59:59Z')
    // the value contract: the ISO-8601 UTC instant (storage unchanged)
    expect(js).toContain('value() { return val ? val.toISOString() : null }')
    // the interim parse is gone from devboard.js too (the quick-create swap)
    expect(readPublic('js/devboard.js')).not.toContain("new Date(dueIn.value + 'T23:59:59Z')")
  })

  it('the Jalali input parses Persian + Latin digits (1405/08/12) and rejects impossible days (Esfand 30 on a non-leap year)', () => {
    const js = readPublic('js/due-control.js')
    expect(js).toContain('const FA_DIG = \'۰۱۲۳۴۵۶۷۸۹\'')
    expect(js).toContain('const parseYmd = (raw) => {')
    expect(js).toContain('if (p.d > jMonthLen(p.y, p.m))')
  })

  it('the control rides board.html + sprint.html (the two modal-serving pages)', () => {
    // S256 (FE-13): due-control moved to v3 (the esc twin consolidation) — the
    // s247 acceptance matrix cites this test by its exact title; the title stays.
    for (const page of ['board.html', 'sprint.html']) {
      expect(readPublic(page)).toMatch(/\/js\/due-control\.js\?v=3/)
    }
  })
})

describe('S244 — the task-modal Due date (optional) toggle (§9.1/§10.1/§10.2)', () => {
  it('OFF by default in Add; in Edit the toggle reflects the PERSONAL deadline only (never the computed triple)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain('modalCtx.draft.dueOn = !!(task && task.due_at)')
    expect(js).toContain("modalCtx.draft.dueAt = task && task.due_at ? task.due_at : null")
    // the section mounts between Tags and Upload File (spec §3.3) with the
    // hidden-until-ON control mount
    expect(js).toContain("'<label class=\"db-sq-toggle\"><input type=\"checkbox\" data-db-due-toggle' + (modalCtx.draft.dueOn ? ' checked' : '')")
    expect(js).toContain("(modalCtx.draft.dueOn ? '' : ' hidden')")
  })

  it('the read-only inherited line reads the payload row\'s server-computed source (§10.1 — never a client re-derivation)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain("if (task && task.effective_due_source === 'sprint' && task.effective_due_at) {")
    expect(js).toContain("t('db.due.inherited', 'Using {sprint} sprint deadline · {date}')")
    // the line renders only while the toggle is OFF
    expect(js).toContain('if (!modalCtx.draft.dueOn) {')
    // the add-mode belt reads the drafted sprint's own raw due_at (no resolution
    // involved — a display read; completed sprints never show the line)
    expect(js).toContain("if (sp && sp.due_at && sprintStatusOf(sp) !== 'completed') { inhName = sp.name || ''; inhDate = sp.due_at }")
  })

  it('the save contract: create always carries the explicit key; edit sends due_at ON-or-removal, absent otherwise (contract §12.4)', () => {
    const js = readPublic('js/devboard.js')
    // create: the S242 explicit-key pattern — null = none, never implicit
    expect(js).toContain('due_at: modalCtx.draft.dueOn ? modalCtx.draft.dueAt : null,')
    // edit: the §10.2 explicit-null removal — only when a personal deadline existed
    expect(js).toContain('const hadPersonal = !!(savedTask && savedTask.due_at)')
    expect(js).toContain('if (modalCtx.draft.dueOn) body.due_at = modalCtx.draft.dueAt')
    expect(js).toContain('else if (hadPersonal) body.due_at = null')
    // a toggle ON with no picked date BLOCKS the save inline (never a silent no-deadline)
    expect(js).toContain("t('db.due.required', 'Pick a date for the deadline, or turn it off.')")
  })

  it('the quick-create + the sprint settings swapped to the shared control (the sanctioned supersession)', () => {
    const js = readPublic('js/devboard.js')
    expect(js).toContain('<div class="db-sq-due-mount" data-sq-due-mount hidden></div>')
    expect(js).toContain('if (dueToggle.checked) body.due_at = dueVal')
    const sp = readPublic('js/sprint-page.js')
    expect(sp).toContain('data-sd-due-toggle')
    expect(sp).toContain('data-sd-due-mount')
    expect(sp).toContain('sdDueCtl = window.HibanaDueControl.create({ value: s.due_at })')
    // the settings PATCH sends due_at EXPLICITLY: value→value preserves the
    // origin server-side (§13's semantics); null clears both
    expect(sp).toContain('if (dueToggle) patchBody.due_at = dueToggle.checked ? dueVal : null')
  })
})

describe('S244 — the card deadline row + bar: the triple-consumption (NO re-derivation)', () => {
  it('the render stack reads effective_due_* and NEVER re-derives the resolution client-side (spec §18)', () => {
    const js = readPublic('js/devboard.js')
    // the state reads the payload's effective_due_at — no now-minus-X heuristics
    expect(js).toContain('const due = task && task.effective_due_at')
    expect(js).toContain("const sprintSrc = task.effective_due_source === 'sprint'")
    // §12.2: the bar's start point is the payload's effective_due_origin_at —
    // the server-computed winning-level origin, coalesced server-side already;
    // the client's only belt is the missing-field coalesce, never a re-derivation
    expect(js).toContain('const originMs = task.effective_due_origin_at ? Date.parse(task.effective_due_origin_at) : dueMs')
    // the NO-re-derivation anti-pin: no personal-over-sprint resolution logic
    // ever appears in the client (the server owns it — S241's decision)
    const renderBlock = js.slice(js.indexOf('const deadlineStateOf'), js.indexOf('// hibana-sync-status-spec'))
    expect(renderBlock).not.toMatch(/task\.due_at\s*!=\s*null/)
    expect(renderBlock).not.toMatch(/sprint\.due_at\s*!=\s*null/)
  })

  it('board-page.js: the row + bar slot between the sprint row and the tags/meta area (Screen A order)', () => {
    const js = readPublic('js/board-page.js')
    expect(js).toContain('const deadlineHtml = B().deadlineRowHtml ? B().deadlineRowHtml(task, lang) : \'\'')
    // S246 (Phase 7): the dep badge row joined after the deadline row — the pin
    // moves with it (intent preserved: the deadline row stays between the
    // sprint row and the tags/meta area).
    expect(js).toContain('sprintRowHtml +\n                        deadlineHtml +\n                        depHtml +\n                        chipsHtml +')
    // the read-only task view joins the deadline display (the row-only variant)
    expect(js).toContain('B().deadlineViewHtml ? B().deadlineViewHtml(task, lang) : \'\'')
  })

  it('detail-helpers.ts: the server twin computes the triple through the SAME exported helper (loadDetail\'s additive seam)', () => {
    const ts = readPublic('../src/routes/projects/detail-helpers.ts')
    expect(ts).toContain('...effectiveDeadlineOf(t, t.sprint_id != null ? sprintBy.get(t.sprint_id) : null)')
    // the twin renders the byte-identical grammar after the sprint badge
    expect(ts).toContain('${sprintBadgeHtml(t.sprint_id)}\n                    ${deadlineRowHtml(t)}')
    // S245 moved the row's closing: the Extend affordance (${extBtn}) joined the
    // txt span inside the row (Screens J2/J3) — the pin moves with it, the row
    // grammar + the LTR-locked bar below are unchanged
    expect(ts).toContain('`<span class="db-due-row st-${state}">${DUE_ICON}<span class="db-due-txt" dir="auto">${esc(label)}</span>${extBtn}</span>`')
  })

  it('project-page.js: the repaint twin reads the SAME triple from the detail payload (the third renderer)', () => {
    const js = readPublic('js/project-page.js')
    expect(js).toContain('window.HibanaBoard.deadlineRowHtml ? window.HibanaBoard.deadlineRowHtml(t, pdLang) : \'\'')
    // S246 (Phase 7): the dep badge row joined after the deadline row — the pin
    // moves with it (intent preserved: the deadline row's slot is unchanged).
    expect(js).toContain('${pdReadMoreBtnHtml(t.title)}${deadlineHtml}${depHtml}${pdTagChipsHtml(tt, sprintBadgeHtml)}')
  })
})

describe('S244 — the §12.3 thresholds at the EXACT boundaries (§24) + §12.4 done-neutrality', () => {
  // behavioral: devboard.js executes in a VM (the i18n-parity loader's pattern)
  const B = loadBoardLib() as Record<string, (a: unknown, b?: unknown, c?: unknown) => string | number | null>
  const iso = (ms: number) => new Date(ms).toISOString()
  const NOW = Date.UTC(2026, 10, 6, 12, 0, 0) // a fixed instant — deterministic edges
  const task = (dueMs: number, extra: Record<string, unknown> = {}) => ({
    status: 'in_progress',
    effective_due_at: iso(dueMs),
    effective_due_source: 'task',
    effective_due_origin_at: iso(NOW - 86400000),
    ...extra,
  })
  const DAY = 86400000
  const H = 3600000

  it('exactly 7 days → approaching; a hair over 7 days → comfortable (§12.3 "up to 7 days")', () => {
    expect(B.deadlineStateOf(task(NOW + 7 * DAY), NOW)).toBe('approaching')
    expect(B.deadlineStateOf(task(NOW + 7 * DAY + 1), NOW)).toBe('comfortable')
  })

  it('exactly 48 hours → urgent; a hair over 48 hours → approaching (§12.3 "48 hours or less")', () => {
    expect(B.deadlineStateOf(task(NOW + 48 * H), NOW)).toBe('urgent')
    expect(B.deadlineStateOf(task(NOW + 48 * H + 1), NOW)).toBe('approaching')
  })

  it('the deadline passed → overdue; a hair before → urgent', () => {
    expect(B.deadlineStateOf(task(NOW), NOW)).toBe('overdue')
    expect(B.deadlineStateOf(task(NOW + 1), NOW)).toBe('urgent')
  })

  it('§12.4: a done task reads DONE (neutral) regardless of how close the deadline is — no live countdown', () => {
    expect(B.deadlineStateOf(task(NOW + H, { status: 'done' }), NOW)).toBe('done')
    expect(B.deadlineStateOf(task(NOW - DAY, { status: 'done' }), NOW)).toBe('done')
  })

  it('§10.3: the null triple (no deadline — the completed-sprint neutrality nulled it server-side) reads null → no row, no bar', () => {
    expect(B.deadlineStateOf({ status: 'in_progress', effective_due_at: null, effective_due_source: null, effective_due_origin_at: null }, NOW)).toBe(null)
    expect(B.deadlineRowHtml({ status: 'in_progress', effective_due_at: null, effective_due_source: null, effective_due_origin_at: null }, 'en', NOW)).toBe('')
  })

  it('§12.2: the elapsed-time fill from effective_due_origin_at — clamped 0-100, full when passed, never completion', () => {
    expect(B.deadlineElapsedPct(task(NOW - 1), NOW)).toBe(100) // passed → full
    // origin = NOW-1d, due = NOW+4d → a 5-day span, 1 day elapsed → 20%
    expect(B.deadlineElapsedPct(task(NOW + 4 * DAY), NOW)).toBe(20)
    // now still before the origin → the fill has not started (clamped low)
    expect(B.deadlineElapsedPct(task(NOW + 8 * DAY, { effective_due_origin_at: iso(NOW + DAY) }), NOW)).toBe(0)
    // the origin is the PAYLOAD's value: a sprint-shared origin shifts the ratio
    const inherited = task(NOW + 9 * DAY, { effective_due_source: 'sprint', effective_due_origin_at: iso(NOW - 9 * DAY) })
    expect(B.deadlineElapsedPct(inherited, NOW)).toBe(50)
  })

  it('the row grammar: the icon + the threshold WORD (never color alone) + the direction-locked LTR bar', () => {
    const html = B.deadlineRowHtml(task(NOW + 7 * DAY), 'en', NOW) as string
    expect(html).toContain('<span class="db-due-row st-approaching">')
    expect(html).toContain('db-due-ic')
    expect(html).toContain('7 days left')
    expect(html).toContain('<span class="db-due-bar" aria-hidden="true"><span class="db-due-fill st-approaching" style="width:')
    // the sprint-source row identifies the source (§10.1's card wording)
    const sprintRow = B.deadlineRowHtml(task(NOW + 7 * DAY, { effective_due_source: 'sprint' }), 'en', NOW) as string
    expect(sprintRow).toContain('Sprint deadline · 7 days left')
    // a done task renders the neutral Done indication (§12.4)
    const doneRow = B.deadlineRowHtml(task(NOW + DAY, { status: 'done' }), 'en', NOW) as string
    expect(doneRow).toContain('st-done')
    expect(doneRow).toContain('✓ Done · Due')
  })

  it('the wording: Due today / Due tomorrow / Overdue by — the spec §12.3 examples\' vocabulary', () => {
    expect(B.deadlineRowHtml(task(NOW + 11 * H), 'en', NOW)).toContain('Due today') // same UTC day… local day at noon + 11h
    expect(B.deadlineRowHtml(task(NOW + DAY), 'en', NOW)).toContain('Due tomorrow')
    expect(B.deadlineRowHtml(task(NOW - DAY), 'en', NOW)).toContain('Overdue by 1 day')
    expect(B.deadlineRowHtml(task(NOW - 3 * DAY), 'en', NOW)).toContain('Overdue by 3 days')
  })
})

describe('S244 — the LTR-bar-in-RTL rule (spec §17) + the shared CSS', () => {
  it('the bar is direction-locked LTR — time progression never reverses in RTL (the explicit §17 exception)', () => {
    const css = readPublic('css/devboard.css')
    expect(css).toContain('direction: ltr; /* §17: the elapsed-time fill always progresses left-to-right */')
    // the thin 4-6px band + the rounded neutral track
    expect(css).toContain('block-size: 5px; /* the 4-6px thin spec band */')
    // the four restrained state colors + the neutral done
    for (const st of ['st-comfortable', 'st-approaching', 'st-urgent', 'st-overdue', 'st-done']) {
      expect(css).toContain(`.db-due-row.${st} {`)
      expect(css).toContain(`.db-due-fill.${st} {`)
    }
  })

  it('the control\'s CSS ships (the segmented calendar + the presets + the Jalali invalid state)', () => {
    const css = readPublic('css/devboard.css')
    for (const marker of ['.db-due-ctl {', '.db-due-presets {', '.db-due-j.is-invalid {', '.db-due-inherited {']) {
      expect(css.includes(marker), `devboard.css must carry ${JSON.stringify(marker)}`).toBe(true)
    }
  })
})

describe('S244 — i18n EN+FA parity for every new string', () => {
  /** Loads a dictionary file in a VM sandbox (the check-i18n-parity loader, scoped). */
  function loadDict(file: string, varName: string): Record<string, unknown> {
    const src = readFileSync(join(process.cwd(), 'public/js', file), 'utf8')
    const sandbox: Record<string, unknown> = { window: {} }
    runInNewContext(src, sandbox, { filename: file, timeout: 5000 })
    const dict = (sandbox.window as Record<string, Record<string, unknown>>)[varName]
    if (!dict || typeof dict !== 'object') throw new Error(`could not load ${varName}`)
    return dict
  }

  const NEW_KEYS = [
    'db.due.toggleOpt', 'db.due.calLabel', 'db.due.calG', 'db.due.calJ',
    'db.due.p24', 'db.due.p48', 'db.due.p72', 'db.due.pWeek', 'db.due.pMonth',
    'db.due.addTime', 'db.due.timeLabel', 'db.due.timeHint', 'db.due.jalaliPh',
    'db.due.invalid', 'db.due.required', 'db.due.inherited', 'db.due.sprintDue',
    'db.due.dueToday', 'db.due.dueTomorrow', 'db.due.leftDays',
    'db.due.overdueDay', 'db.due.overdueDays', 'db.due.overdueHours', 'db.due.doneLabel',
  ]

  it('every new key exists in BOTH dictionaries (written FA copy, not placeholders)', () => {
    const en = loadDict('i18n-en.js', '__hibanaDictEN')
    const fa = loadDict('i18n-fa.js', '__hibanaDictFA')
    const flat = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const out: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flat(v as Record<string, unknown>, key))
        else out.push(key)
      }
      return out
    }
    const enKeys = new Set(flat(en))
    const faKeys = new Set(flat(fa))
    for (const key of NEW_KEYS) {
      expect(enKeys.has(key), `i18n-en.js must carry ${key}`).toBe(true)
      expect(faKeys.has(key), `i18n-fa.js must carry ${key}`).toBe(true)
    }
    // the FA copy is real Persian (Arabic-script characters), not EN echoes
    const faRaw = readPublic('js/i18n-fa.js')
    expect(faRaw).toMatch(/'db\.due\.toggleOpt': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.due\.sprintDue': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.due\.inherited': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.due\.timeHint': '[^']*[؀-ۿ][^']*'/)
    expect(faRaw).toMatch(/'db\.due\.overdueDays': '[^']*[؀-ۿ][^']*'/)
  })
})

describe('S244 — the Jalali round-trip (the real vendored converter + the render stack in fa)', () => {
  it('the FA day label converts through the vendored jalaali (storage Gregorian UTC, conversion at the render edge — rule 3)', () => {
    // the sandbox loads jalaali.min.js + devboard.js together; a fa stub carrying
    // the REAL dictionary strings turns the render stack's labels Jalali + the
    // digits Persian (the page's own wiring, exercised headless)
    const faMap: Record<string, string> = {
      'db.ov.due': 'مهلت {d}',
      'db.due.leftDays': '{n} روز مانده',
      'db.due.dueToday': 'مهلت امروز',
      'db.due.dueTomorrow': 'مهلت فردا',
      'db.due.doneLabel': 'انجام شد',
      'db.due.sprintDue': 'مهلت اسپرینت',
    }
    const B = loadBoardLib({ t: (k: string) => faMap[k] ?? k, lang: () => 'fa' }) as Record<string, (a: unknown, b?: unknown, c?: unknown) => string>
    // 2026-11-06 → 15 Aban 1405; 2026-11-21 → 30 Aban (Aban holds 30 days); 15 calendar days between
    const html = B.deadlineRowHtml({
      status: 'in_progress',
      effective_due_at: '2026-11-21T12:00:00.000Z',
      effective_due_source: 'task',
      effective_due_origin_at: '2026-11-05T12:00:00.000Z',
    }, 'fa', Date.UTC(2026, 10, 6, 11, 0, 0)) as string
    expect(html).toContain('مهلت ۳۰ آبان · ۱۵ روز مانده')
    // the sprint-source row identifies the source in fa too (§10.1)
    const sprintRow = B.deadlineRowHtml({
      status: 'in_progress',
      effective_due_at: '2026-11-21T12:00:00.000Z',
      effective_due_source: 'sprint',
      effective_due_origin_at: '2026-11-05T12:00:00.000Z',
    }, 'fa', Date.UTC(2026, 10, 6, 11, 0, 0)) as string
    expect(sprintRow).toContain('مهلت اسپرینت · ۱۵ روز مانده')
  })
})

describe('S244 — the desktop seam tripwires (the Phase 9 re-pin inventory)', () => {
  it('the fetch counts NEVER moved — the control + the render stack ride ZERO network of their own', () => {
    expect((readPublic('js/devboard.js').match(/\bfetch\(/g) || []).length).toBe(7)
    expect((readPublic('js/board-page.js').match(/\bfetch\(/g) || []).length).toBe(4)
    // the NEW module ships zero fetches (a pure input widget)
    expect((readPublic('js/due-control.js').match(/\bfetch\(/g) || []).length).toBe(0)
    expect((readPublic('js/due-control.js').match(/\bhibanaFetch\(/g) || []).length).toBe(0)
  })

  it('sw.js is at hibana-v463 with the S256 carrier note (the CSS/asset diet moved the ladder; the S244 pin intent is preserved, the carriers moved with it)', () => {
    const sw = readPublic('sw.js')
    expect(sw.includes('const VERSION = "hibana-v463"')).toBe(true)
    expect(sw.includes('// v463 (S256)')).toBe(true)
    expect(sw).toMatch(/due-control\.js v1 \(NEW tag on board\+sprint\)/)
    expect(sw).toMatch(/devboard\.js v36/)
    expect(sw).toMatch(/i18n-fa\.js\?v=104/)
  })
})
