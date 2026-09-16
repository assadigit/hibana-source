import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../lib/markdown'

// The CommonMark subset used by the quick-notebook render + the Notes Vault preview
// (S53: the client port in notes-page.js mirrors this file — keep them in lockstep).

describe("renderMarkdown (the app's markdown subset)", () => {
  it('renders headings, bold/italic/strike, inline code and links', () => {
    const html = renderMarkdown('# T\n\n**b** *i* ~~s~~ `c` [l](https://x.dev)')
    expect(html).toContain('<h1>T</h1>')
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<del>s</del>')
    expect(html).toContain('<code>c</code>')
    expect(html).toContain('<a href="https://x.dev" target="_blank" rel="noopener">l</a>')
  })

  it('escapes HTML FIRST — note text is never injected as markup', () => {
    const html = renderMarkdown('<script>alert(1)</script> & "quotes"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('renders fenced code verbatim (no further transforms inside)', () => {
    const html = renderMarkdown('```\n# not a heading\n**not bold**\n```')
    expect(html).toContain('<pre><code># not a heading\n**not bold**\n</code></pre>')
  })

  it('S53 fix: unordered lists wrap ONCE in <ul> (no nested <ul><ol> double wrap)', () => {
    const html = renderMarkdown('intro\n\n- x\n- y\n\noutro')
    expect(html).toContain('<ul><li>x</li>\n<li>y</li>\n</ul>')
    expect(html).not.toContain('<ul><ol>')
  })

  it('ordered lists wrap in <ol>; a UL run adjacent to an OL run stays two lists', () => {
    const html = renderMarkdown('1. a\n2. b\n- c')
    expect(html).toContain('<ol><li>a</li>\n<li>b</li>\n</ol>')
    expect(html).toContain('<ul><li>c</li></ul>')
    expect(html.indexOf('<ol>')).toBeLessThan(html.indexOf('<ul>'))
  })

  it('blockquotes, hr and paragraphs', () => {
    const html = renderMarkdown('> quoted\n\n---\n\npara one')
    expect(html).toContain('<blockquote>quoted</blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<p>para one</p>')
  })

  it('never emits javascript: links', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('href="javascript:')
  })
})
