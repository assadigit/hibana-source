(() => {
  const de = document.documentElement
  const vw = de.clientWidth
  const vh = de.clientHeight
  const out = { url: location.pathname, lang: de.lang, dir: de.dir, theme: de.dataset.theme || 'system', vw, vh }
  // 1) horizontal page scroll
  out.pageHScroll = de.scrollWidth > vw + 1
  out.scrollW = de.scrollWidth
  // 2) elements extending beyond viewport (visible ones)
  const over = []
  const all = document.querySelectorAll('body *')
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue
    if (r.right > vw + 2 && r.left < vw + 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
      over.push(`${el.tagName.toLowerCase()}.${(el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '').slice(0, 40)} r=${Math.round(r.right)}`)
    }
  }
  out.viewportOverflows = over.slice(0, 6)
  out.viewportOverflowCount = over.length
  // 3) touch targets < 40px (44 is the bar; 40 flags real problems, not rounding)
  const small = []
  for (const el of document.querySelectorAll('button, a[href], [role="button"], summary, input[type="checkbox"], input[type="radio"], .icon-btn, .quad-btn')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (r.height < 40 || r.width < 40) {
      // skip inline text links inside paragraphs (legit small, not touch controls)
      const tag = el.tagName.toLowerCase()
      if (tag === 'a' && cs.display.startsWith('inline') && el.querySelector('button') === null) continue
      small.push(`${tag}${el.id ? '#' + el.id : ''}.${(typeof el.className === 'string' ? el.className.split(' ')[0] : '').slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
  }
  out.smallTouchTargets = small.slice(0, 8)
  out.smallTouchCount = small.length
  // 4) clipped text heuristic: single-line nowrap labels that got cut
  const clipped = []
  for (const el of document.querySelectorAll('button, .chip, .badge, .tab, th, .stat, .nav-item, [data-quad] .qname, .skc-title, .card h3, .proj-title')) {
    if (el.scrollWidth > el.clientWidth + 3 && getComputedStyle(el).overflowX === 'hidden') {
      clipped.push(`${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className.split(' ')[0] : '').slice(0, 30)} "${(el.textContent || '').trim().slice(0, 25)}"`)
    }
  }
  out.clippedText = clipped.slice(0, 6)
  out.clippedCount = clipped.length
  // 5) images without alt
  out.imgNoAlt = [...document.querySelectorAll('img:not([alt])')].map(i => i.src.split('/').pop()).slice(0, 4)
  // 6) lang sanity: FA page must have dir=rtl
  out.dirMismatch = (de.lang === 'fa') !== (de.dir === 'rtl')
  return JSON.stringify(out)
})()
