/* sadhana-data.js — TAGS + FUZZY data extracted from sadhana-page.js (Focus 3.1).
   Pure data: tag definitions + fuzzy-date options. Loaded before sadhana-page.js
   (defer preserves order). Exposed via window.__hibanaSadhanaData. */
window.__hibanaSadhanaData = (() => {
  const TAGS = [
    { id: 'w', cls: 'w', ico: '💼', en: 'Work', fa: 'کار' },
    { id: 'p', cls: 'p', ico: '🏠', en: 'Personal', fa: 'شخصی' },
    { id: 'sg', cls: 'sg', ico: '📈', en: 'Self-Growth', fa: 'رشد فردی' },
    { id: 'so', cls: 'so', ico: '🤝', en: 'Social', fa: 'اجتماعی' },
    { id: 'h', cls: 'h', ico: '💪', en: 'Health', fa: 'سلامت' },
  ]
  const FUZZY = [
    { k: 'tom', ico: '🌅', en: 'Until Tomorrow', fa: 'تا فردا' },
    { k: '48h', ico: '⏰', en: 'Within 48 hours', fa: 'ظرف ۴۸ ساعت' },
    { k: 'week', ico: '📅', en: 'This week', fa: 'این هفته' },
    { k: 'mon', ico: '🗓️', en: 'This month', fa: 'این ماه' },
    { k: '3mo', ico: '🌿', en: 'Next 3 months', fa: '۳ ماه آینده' },
    { k: '6mo', ico: '🌊', en: 'Next 6 months', fa: '۶ ماه آینده' },
    { k: 'ny', ico: '🎆', en: 'By the new year', fa: 'تا سال نو' },
  ]
  return { TAGS, FUZZY }
})()
