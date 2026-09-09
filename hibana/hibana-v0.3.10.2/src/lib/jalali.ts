// Small Jalali (Shamsi) calendar utilities — pure math, no dependency (the original
// jalaali-js algorithm, MIT; the package is not in the Workers bundle, and the vendor
// copy in public/vendor is browser-only). Server-side display conversion for deadlines
// (rule 3: Gregorian UTC storage, calendar conversion only at the render edge).
// Signature-compatible with jalaali-js toJalaali/toGregorian (1-based months/days).

const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]
const div = (a: number, b: number) => ~~(a / b)
const mod = (a: number, b: number) => a - ~~(a / b) * b

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = breaks.length
  if (jy < breaks[0] || jy >= breaks[bl - 1]) throw new Error(`Invalid Jalaali year ${jy}`)
  const gy = jy + 621
  let leapJ = -14
  let jp = breaks[0]
  let jm = 0
  let jump = 0
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i]
    jump = jm - jp
    if (jy < jm) break
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4)
    jp = jm
  }
  let n = jy - jp
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
  const march = 20 + leapJ - leapG
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33
  let leap = mod(mod(n + 1, 33) - 1, 4)
  if (leap === -1) leap = 4
  return { leap, gy, march }
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
  return d
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
  const i = div(mod(j, 1461), 4) * 5 + 308
  const gd = div(mod(i, 153), 5) + 1
  const gm = mod(div(i, 153), 12) + 1
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6)
  return { gy, gm, gd }
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  let gy = d2g(jdn).gy
  let jy = gy - 621
  const r = jalCal(jy)
  const jdn1f = g2d(gy, 3, r.march)
  let k = jdn - jdn1f
  let jm: number
  let jd: number
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31)
      jd = mod(k, 31) + 1
      return { jy, jm, jd }
    }
    k -= 186
  } else {
    jy -= 1
    k += 179
    if (r.leap === 1) k += 1
  }
  jm = 7 + div(k, 30)
  jd = mod(k, 30) + 1
  return { jy, jm, jd }
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy)
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1
}

/** Gregorian (1-based) → Jalali (1-based). */
export function toJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  return d2j(g2d(gy, gm, gd))
}

/** Jalali (1-based) → Gregorian (1-based). */
export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd))
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
/** Latin digits → Persian digits — keeps counters on the same numeral system as dates in fa
 *  (roast 2026-08-25: '۰ مورد' must not mix ۰ with 0 on one screen). */
export const faDigits = (s: string): string => s.replace(/\d/g, (d) => FA_DIGITS[Number(d)])

/** The calendar always follows the UI language (user decision 2026-08-25): Farsi → Shamsi
 *  (Jalali), English → Gregorian. The stored calendar_pref is derived from this, never
 *  chosen independently. */
export function calendarFor(lang: 'en' | 'fa'): 'gregorian' | 'shamsi' {
  return lang === 'fa' ? 'shamsi' : 'gregorian'
}

/** 'YYYY-MM-DD' → display string in the user's calendar + language ('2026/08/25', '۱۴۰۵/۰۶/۰۳'). */
export function formatDate(iso: string, cal: 'gregorian' | 'shamsi', lang: 'en' | 'fa'): string {
  const gy = Number(iso.slice(0, 4))
  const gm = Number(iso.slice(5, 7))
  const gd = Number(iso.slice(8, 10))
  let s: string
  if (cal === 'shamsi') {
    const j = toJalali(gy, gm, gd)
    s = `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`
  } else {
    s = `${gy}/${String(gm).padStart(2, '0')}/${String(gd).padStart(2, '0')}`
  }
  return lang === 'fa' ? faDigits(s) : s
}

const G_MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const J_MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
// Indexed by Date#getUTCDay() (0=Sunday…6=Saturday); the fa week starts on شنبه.
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

/** Human long date: 'دوشنبه ۳ شهریور ۱۴۰۵' (fa/shamsi) or 'Monday, 25 August 2026' (en).
 *  Used for the board header — server-rendered so it never depends on a client pass. */
export function formatDateLong(iso: string, cal: 'gregorian' | 'shamsi', lang: 'en' | 'fa'): string {
  const gy = Number(iso.slice(0, 4))
  const gm = Number(iso.slice(5, 7))
  const gd = Number(iso.slice(8, 10))
  const wd = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay()
  if (cal === 'shamsi') {
    const j = toJalali(gy, gm, gd)
    return `${WEEKDAYS_FA[wd]} ${faDigits(String(j.jd))} ${J_MONTHS_FA[j.jm - 1]} ${faDigits(String(j.jy))}`
  }
  return `${WEEKDAYS_EN[wd]}, ${gd} ${G_MONTHS_EN[gm - 1]} ${gy}`
}