(() => {
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const parse = (c) => { const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null }
  const effBg = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor)
      if (bg && bg.a > 0.85) return bg
      n = n.parentElement
    }
    const rootBg = parse(getComputedStyle(document.documentElement).getPropertyValue('--bg') || getComputedStyle(document.body).backgroundColor)
    return rootBg || { r: 255, g: 255, b: 255, a: 1 }
  }
  const ratio = (a, b) => {
    const la = lum(a.r, a.g, a.b), lb = lum(b.r, b.g, b.b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  const offenders = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || !(el.textContent || '').trim()) continue
    if (el.children.length > 3) continue // leaf-ish text holders
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.5) continue
    const fg = parse(cs.color)
    if (!fg) continue
    const fs = parseFloat(cs.fontSize)
    const bold = +cs.fontWeight >= 700
    const large = fs >= 24 || (fs >= 18.66 && bold)
    const need = large ? 3 : 4.5
    const r = ratio(fg, effBg(el))
    if (r < need - 0.05) {
      const key = cs.color + '|' + cs.fontSize
      if (seen.has(key)) continue
      seen.add(key)
      offenders.push({ txt: (el.textContent || '').trim().slice(0, 24), color: cs.color, size: Math.round(fs) + 'px', ratio: Math.round(r * 10) / 10, need })
    }
  }
  return JSON.stringify({ url: location.pathname, lang: document.documentElement.lang, theme: document.documentElement.dataset.theme, offenders: offenders.slice(0, 12) })
})()
