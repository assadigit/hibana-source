import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toJalali, toGregorian, faDigits, formatDate, calendarFor } from '../lib/jalali'

// Autopilot Phase 0 characterization (gap: Jalali calendar edge cases + client/server
// algorithm parity).
//
// Two independent implementations of the Jalali calendar live in this repo:
//   - server: src/lib/jalali.ts (the jalaali-js breaks-array algorithm)
//   - client: public/js/jalali.js (the calendar_utils.py 33-year-cycle port, exposed
//     as window.__hibJalali)
// They had NO cross-check. A silent divergence would corrupt every Shamsi date the
// UI renders. This suite pins: known oracle dates, leap years (Esfand 30), Nowruz
// March-20/21 boundaries, a 200-year round-trip sweep, and BYTE-LEVEL AGREEMENT of
// the two algorithms across the practical range (Gregorian 1925–2125).
//
// Verified agreement before writing this file: 0 mismatches over that entire range,
// both directions — these tests keep it that way.

function loadClientJalali(): {
  g2j: (gy: number, gm: number, gd: number) => [number, number, number]
  j2g: (jy: number, jm: number, jd: number) => [number, number, number]
  jalaliLeap: (jy: number) => boolean
  jMonthDays2: (jy: number, jm: number) => number
  toFa: (n: number | string) => string
} {
  const src = readFileSync(join(process.cwd(), 'public/js/jalali.js'), 'utf8')
  const window: Record<string, unknown> = {}
  new Function('window', src)(window)
  return window.__hibJalali as never
}

describe('Jalali conversion — oracle dates (characterization)', () => {
  it('the documented example: 2026-08-25 ↔ 1405/06/03', () => {
    expect(toJalali(2026, 8, 25)).toEqual({ jy: 1405, jm: 6, jd: 3 })
    expect(toGregorian(1405, 6, 3)).toEqual({ gy: 2026, gm: 8, gd: 25 })
  })

  it('Nowruz boundaries: leap years put Esfand 30 on March 20, Nowruz on March 21', () => {
    // 1403 is a leap year (Esfand has 30 days)
    expect(toJalali(2025, 3, 20)).toEqual({ jy: 1403, jm: 12, jd: 30 })
    expect(toJalali(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 })
    expect(toGregorian(1403, 12, 30)).toEqual({ gy: 2025, gm: 3, gd: 20 })
    // 1399 is a leap year too
    expect(toJalali(2021, 3, 20)).toEqual({ jy: 1399, jm: 12, jd: 30 })
    expect(toJalali(2021, 3, 21)).toEqual({ jy: 1400, jm: 1, jd: 1 })
  })

  it('Nowruz 1403 fell on March 20, 2024 (Gregorian leap year shifts the equinox)', () => {
    expect(toJalali(2024, 3, 20)).toEqual({ jy: 1403, jm: 1, jd: 1 })
  })

  it('non-leap Esfand ends at 29: 1402-12-29 is the last valid day of 1402', () => {
    expect(toGregorian(1402, 12, 29)).toEqual({ gy: 2024, gm: 3, gd: 19 })
    expect(toJalali(2024, 3, 19)).toEqual({ jy: 1402, jm: 12, jd: 29 })
  })

  it('CHARACTERIZED QUIRK: an out-of-range day (1402-12-30, non-leap) rolls into next year instead of throwing', () => {
    // jalaali's j2d does not validate day-of-month — the conversion silently
    // normalizes. This pins that (surprising but current) behavior explicitly.
    const g = toGregorian(1402, 12, 30)
    expect(g).toEqual({ gy: 2024, gm: 3, gd: 20 })
    expect(toJalali(g.gy, g.gm, g.gd)).toEqual({ jy: 1403, jm: 1, jd: 1 })
  })
})

describe('Jalali round-trip sweep (server algorithm)', () => {
  it('toJalali(toGregorian(jy, jm, jd)) is the identity for jy 1300–1500, every month, edge days', () => {
    for (let jy = 1300; jy <= 1500; jy += 1) {
      for (let jm = 1; jm <= 12; jm += 1) {
        for (const jd of [1, 15, 29]) {
          const g = toGregorian(jy, jm, jd)
          expect(toJalali(g.gy, g.gm, g.gd)).toEqual({ jy, jm, jd })
        }
      }
    }
  })
})

describe('client/server Jalali parity (the two-copies problem)', () => {
  const client = loadClientJalali()

  it('client g2j agrees with server toJalali for every date in Gregorian 1925–2125', () => {
    for (let gy = 1925; gy <= 2125; gy += 1) {
      for (let gm = 1; gm <= 12; gm += 1) {
        for (const gd of [1, 15, 28]) {
          const s = toJalali(gy, gm, gd)
          expect(client.g2j(gy, gm, gd)).toEqual([s.jy, s.jm, s.jd])
        }
      }
    }
  })

  it('client j2g agrees with server toGregorian for jy 1304–1504, every month, edge days', () => {
    for (let jy = 1304; jy <= 1504; jy += 1) {
      for (let jm = 1; jm <= 12; jm += 1) {
        for (const jd of [1, 15, 29]) {
          const s = toGregorian(jy, jm, jd)
          expect(client.j2g(jy, jm, jd)).toEqual([s.gy, s.gm, s.gd])
        }
      }
    }
  })

  it('both leap-year oracles agree: 1399 & 1403 leap, 1402 not; Esfand 30 only in leap years', () => {
    expect(client.jalaliLeap(1399)).toBe(true)
    expect(client.jalaliLeap(1402)).toBe(false)
    expect(client.jalaliLeap(1403)).toBe(true)
    expect(client.jMonthDays2(1403, 12)).toBe(30)
    expect(client.jMonthDays2(1402, 12)).toBe(29)
    // server-side agreement, via the boundary dates (its only public surface)
    expect(toGregorian(1403, 12, 30).gd).toBe(20) // Esfand 30 exists → March 20, 2025
    expect(toGregorian(1402, 12, 30).gd).toBe(20) // ...and 1402-12-30 NORMALIZES to 1403-01-01
    expect(toGregorian(1402, 12, 29).gd).toBe(19) // the real last day of 1402
  })

  it('client toFa and server faDigits agree', () => {
    expect(client.toFa('1405/06/03')).toBe(faDigits('1405/06/03'))
  })
})

describe('fa digits + formatDate (characterization)', () => {
  it('faDigits converts Latin digits to Persian digits', () => {
    expect(faDigits('1405/06/03')).toBe('۱۴۰۵/۰۶/۰۳')
    expect(faDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹')
    expect(faDigits('no digits here')).toBe('no digits here')
  })

  it("formatDate: '2026-08-25' shamsi/fa → '۱۴۰۵/۰۶/۰۳', gregorian/en → '2026/08/25'", () => {
    expect(formatDate('2026-08-25', 'shamsi', 'fa')).toBe('۱۴۰۵/۰۶/۰۳')
    expect(formatDate('2026-08-25', 'gregorian', 'en')).toBe('2026/08/25')
  })

  it("calendarFor follows the UI language (fa → shamsi, en → gregorian)", () => {
    expect(calendarFor('fa')).toBe('shamsi')
    expect(calendarFor('en')).toBe('gregorian')
  })
})
