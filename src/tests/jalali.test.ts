import { describe, it, expect } from 'vitest'
import { toJalali, toGregorian, formatDate } from '../lib/jalali'

// lib/jalali — pure calendar math used for server-side deadline display (rule 3:
// Gregorian UTC storage, calendar conversion only at the render edge).

describe('jalali calendar (lib/jalali)', () => {
  it('matches known calendar dates', () => {
    // 22 May 1986 = 1 Khordad 1365 (Nowruz 1986 was 21 March); 21 March 2021 = 1 Farvardin 1400
    expect(toJalali(1986, 5, 22)).toEqual({ jy: 1365, jm: 3, jd: 1 })
    expect(toJalali(2021, 3, 21)).toEqual({ jy: 1400, jm: 1, jd: 1 })
  })

  it('round-trips gregorian ↔ jalali', () => {
    for (const [y, m, d] of [
      [2026, 8, 25], [2000, 1, 1], [1979, 2, 11], [2032, 12, 31], [2024, 2, 29], // leap day
    ] as const) {
      const j = toJalali(y, m, d)
      const g = toGregorian(j.jy, j.jm, j.jd)
      expect([g.gy, g.gm, g.gd]).toEqual([y, m, d])
    }
  })

  it('formatDate renders gregorian + shamsi with fa digits', () => {
    expect(formatDate('2026-08-25', 'gregorian', 'en')).toBe('2026/08/25')
    expect(formatDate('2026-08-25', 'shamsi', 'en')).toBe('1405/06/03')
    expect(formatDate('2026-08-25', 'shamsi', 'fa')).toBe('۱۴۰۵/۰۶/۰۳')
    expect(formatDate('2026-08-25', 'gregorian', 'fa')).toBe('۲۰۲۶/۰۸/۲۵')
  })
})