// Iranian (Jalali/Shamsi) official holidays (Round 9.1, R9 fix).
// Provides `getHolidays(jalaliYear, jalaliMonth)` → Map<dayNumber, {name, type}> for a month.
//
// Three sources, all DB-free, all "always correct":
//  1. Friday = weekend (جمعه تعطیل) — computed from the Gregorian weekday; no data needed.
//  2. Fixed Jalali holidays (Nowruz, Sizdah Bedar, etc.) — keyed by MM-DD, never change.
//  3. Islamic (Hijri lunar) holidays — detected dynamically via Intl.DateTimeFormat with the
//     'islamic-umalqura' calendar (built into modern browsers). Each day of the displayed
//     month is converted to its Hijri date; if the Hijri MM-DD matches a known holiday,
//     it's marked. This is ALWAYS correct for any year — no annual table updates needed.
//
// R9 FIX: inlined the Jalali conversion math (same as src/lib/jalali.ts) instead of
// relying on window.jalaali — eliminates the script-load race condition that caused the
// wrong month to display.

;(() => {
  // ---- Inlined Jalali conversion (pure math, MIT jalaali-js algorithm) ----
  const BREAKS = [-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178]
  const div = (a, b) => ~~(a / b)
  const mod = (a, b) => a - ~~(a / b) * b
  function jalCal(jy) {
    const bl = BREAKS.length
    const gy = jy + 621
    let leapJ = -14, jp = BREAKS[0], jm = 0, jump = 0
    for (let i = 1; i < bl; i++) { jm = BREAKS[i]; jump = jm - jp; if (jy < jm) break; leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm }
    let n = jy - jp
    leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
    const march = 20 + leapJ - leapG
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33
    let leap = mod(mod(n + 1, 33) - 1, 4)
    if (leap === -1) leap = 4
    return { leap, gy, march }
  }
  function g2d(gy, gm, gd) {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
    return d
  }
  function d2g(jdn) {
    let j = 4 * jdn + 139361631
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    const i = div(mod(j, 1461), 4) * 5 + 308
    return { gy: div(j, 1461) - 100100 + div(8 - mod(div(i, 153), 12) + 1, 6), gm: mod(div(i, 153), 12) + 1, gd: div(mod(i, 153), 5) + 1 }
  }
  function d2j(jdn) {
    let gy = d2g(jdn).gy, jy = gy - 621
    const r = jalCal(jy), jdn1f = g2d(gy, 3, r.march)
    let k = jdn - jdn1f
    if (k >= 0) { if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; k -= 186 }
    else { jy -= 1; k += 179; if (r.leap === 1) k += 1 }
    return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 }
  }
  function j2d(jy, jm, jd) { const r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1 }
  const toJalali = (gy, gm, gd) => d2j(g2d(gy, gm, gd))
  const toGregorian = (jy, jm, jd) => d2g(j2d(jy, jm, jd))

  // ---- Fixed Jalali (Shamsi) holidays — keyed by "MM-DD". Never change. ----
  const FIXED_JALALI = {
    '01-01': { name: 'نوروز', nameEn: 'Nowruz (Persian New Year)' },
    '01-02': { name: 'نوروز', nameEn: 'Nowruz' },
    '01-03': { name: 'نوروز', nameEn: 'Nowruz' },
    '01-04': { name: 'نوروز', nameEn: 'Nowruz' },
    '01-12': { name: 'روز جمهوری اسلامی', nameEn: 'Islamic Republic Day' },
    '01-13': { name: 'سیزده‌بدر', nameEn: 'Sizdah Bedar (Nature Day)' },
    '03-15': { name: 'قیام پانزده خرداد', nameEn: '15 Khordad Uprising' },
    '11-22': { name: 'پیروزی انقلاب اسلامی', nameEn: 'Islamic Revolution Anniversary (22 Bahman)' },
    '12-29': { name: 'ملی شدن صنعت نفت', nameEn: 'Oil Industry Nationalization Day (29 Esfand)' },
  }

  // ---- Islamic (Hijri lunar) holidays — keyed by Hijri "M-D". Detected dynamically. ----
  const ISLAMIC_HOLIDAYS = {
    '1-9': { name: 'تاسوعا', nameEn: "Tasu'a" },
    '1-10': { name: 'عاشورا', nameEn: 'Ashura' },
    '2-20': { name: 'اربعین', nameEn: 'Arbaeen' },
    '3-12': { name: 'میلاد پیامبر', nameEn: 'Mawlid an-Nabi' },
    '3-17': { name: 'میلاد پیامبر / امام صادق', nameEn: 'Mawlid / Imam Sadiq birthday' },
    '6-3': { name: 'شهادت حضرت فاطمه', nameEn: 'Martyrdom of Fatimah' },
    '7-13': { name: 'شهادت امام موسی کاظم', nameEn: 'Martyrdom of Imam Musa al-Kadhim' },
    '9-21': { name: 'شهادت امام علی', nameEn: 'Martyrdom of Imam Ali (21 Ramadan)' },
    '10-1': { name: 'عید فطر', nameEn: 'Eid al-Fitr' },
    '10-2': { name: 'عید فطر', nameEn: 'Eid al-Fitr (day 2)' },
    '10-3': { name: 'عید فطر', nameEn: 'Eid al-Fitr (day 3)' },
    '10-25': { name: 'شهادت امام صادق', nameEn: 'Martyrdom of Imam Sadiq (25 Shawwal)' },
    '12-9': { name: 'روز عرفه', nameEn: 'Day of Arafah' },
    '12-10': { name: 'عید قربان', nameEn: 'Eid al-Adha' },
    '12-18': { name: 'عید غدیر', nameEn: 'Eid al-Ghadir' },
  }

  function gregorianToHijriMd(gy, gm, gd) {
    try {
      const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric' })
      const parts = fmt.formatToParts(new Date(Date.UTC(gy, gm - 1, gd)))
      let m = '', d = ''
      for (const p of parts) { if (p.type === 'month') m = p.value; if (p.type === 'day') d = p.value }
      if (!m || !d) return null
      return `${parseInt(m, 10)}-${parseInt(d, 10)}`
    } catch { return null }
  }

  function getHolidays(jy, jm) {
    const result = new Map()
    const firstG = toGregorian(jy, jm, 1)
    const njm = jm === 12 ? 1 : jm + 1
    const njy = jm === 12 ? jy + 1 : jy
    const nextFirstG = toGregorian(njy, njm, 1)
    const daysInMonth = Math.round(
      (Date.UTC(nextFirstG.gy, nextFirstG.gm - 1, nextFirstG.gd) -
       Date.UTC(firstG.gy, firstG.gm - 1, firstG.gd)) / 86400000
    )

    for (let day = 1; day <= daysInMonth; day++) {
      const g = toGregorian(jy, jm, day)
      const date = new Date(Date.UTC(g.gy, g.gm - 1, g.gd))
      const dow = date.getUTCDay() // 0=Sun, 5=Fri

      // Friday = تعطیل (official weekend/holiday in Iran). The user wants Fridays shown
      // as holidays — red-tinted cell + "تعطیل" badge — same as other official holidays.
      if (dow === 5) {
        result.set(day, { name: 'جمعه تعطیل', nameEn: 'Friday (holiday)', type: 'holiday' })
      }

      const jKey = `${String(jm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const fixed = FIXED_JALALI[jKey]
      if (fixed) {
        result.set(day, { name: fixed.name, nameEn: fixed.nameEn, type: 'holiday' })
        continue
      }

      // Islamic (Hijri) holiday — only if not already a Friday (don't double-mark)
      if (dow !== 5) {
        const hijriMd = gregorianToHijriMd(g.gy, g.gm, g.gd)
        if (hijriMd && ISLAMIC_HOLIDAYS[hijriMd]) {
          const h = ISLAMIC_HOLIDAYS[hijriMd]
          result.set(day, { name: h.name, nameEn: h.nameEn, type: 'holiday' })
        }
      }
    }

    return result
  }

  window.hibanaJalaliHolidays = { getHolidays }
})()
