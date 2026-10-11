(() => {
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const parse = (c) => { const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null }
  // S200 (UX-3): EFFECTIVE visibility — an element is measurable only if every
  // ancestor (and itself) actually renders it. The old check read the element's OWN
  // display/visibility/opacity only, which produced two real false-positive classes:
  // (a) the loader veil's brand pair — the veil is opacity:0 (.is-hidden) but its
  //     children compute opacity:1 (opacity is not inherited as a computed value);
  // (b) the mobile-nav tab anchor — the bar is display:none at ≥1025px, but the
  //     anchor's own `display:flex` rule still computes. Both were counted as
  //     contrast offenders while invisible to every user.
  const effectivelyVisible = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.5) return false
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false // decorative (WCAG 1.4.3 exempts pure decoration)
      n = n.parentElement
    }
    return true
  }
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
    // S200 (UX-3): a TEXT holder owns a DIRECT non-empty text node — textContent
    // bubbles from children, so the old check audited wrapper DIVs with their
    // children's text and the wrapper's (often inherited/irrelevant) color (the
    // loader's dark-tile mark div measured its white glyph's "H" at the page's
    // --text ink — a 1.1:1 phantom).
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    if (el.children.length > 3) continue // leaf-ish text holders
    if (!effectivelyVisible(el)) continue
    const cs = getComputedStyle(el)
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
