import { describe, it, expect } from 'vitest'
import { highlightCode, renderMarkdown } from '../lib/markdown'

// The CommonMark subset used by the quick-notebook render + the Notes Vault preview
// (S53: the client port in notes-page.js mirrors this file — keep them in lockstep).

describe("renderMarkdown (the app's markdown subset)", () => {
  it('renders headings, bold/italic/strike, inline code and links', () => {
    const html = renderMarkdown('# T\n\n**b** *i* ~~s~~ `c` [l](https://x.dev)')
    expect(html).toContain('<h1>T</h1>')
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<del>s</del>')
    expect(html).toContain('<code class="md-ic">c</code>')
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
    // S88: fences render as the .md-code panel — but the BODY stays verbatim (a bare
    // fence carries NO tokenization, so prose snippets don't light up as keywords)
    expect(html).toContain('md-code')
    expect(html).toContain('<pre><code># not a heading\n**not bold**\n</code></pre>')
    expect(html).not.toContain('<h1>')
    expect(html).not.toContain('<strong>')
    // the copy affordance rides every panel
    expect(html).toContain('data-md-copy')
  })

  it('S88 code panel: language chip from the info string + escaped, token-colored body', () => {
    const html = renderMarkdown('```js\nconst x = "hi" // note\n```')
    expect(html).toContain('data-lang="js"')
    expect(html).toContain('md-code-lang">js')
    // keyword + string + comment each get their token class; everything stays escaped
    expect(html).toContain('<span class="md-tok-kw">const</span>')
    expect(html).toContain('<span class="md-tok-str">&quot;hi&quot;</span>')
    expect(html).toContain('<span class="md-tok-com">// note</span>')
  })

  it('S88 highlightCode: numbers, function calls, operators, hash/dash comment families, and hostile input stays escaped', () => {
    const py = highlightCode('# comment\nx = 42', 'py')
    expect(py).toContain('<span class="md-tok-com"># comment</span>')
    expect(py).toContain('<span class="md-tok-num">42</span>')
    expect(highlightCode('-- sql note', 'sql')).toContain('md-tok-com')
    expect(highlightCode('fn(a)', '')).toContain('<span class="md-tok-fn">fn</span>')
    expect(highlightCode('#fff { color: red }', 'css')).not.toContain('md-tok-com') // # stays literal in CSS
    const hostile = highlightCode('<script>"a"</script>', 'js')
    expect(hostile).not.toContain('<script>')
    expect(hostile).toContain('&lt;')
    expect(hostile).toContain('script')
    expect(hostile).toContain('&quot;a&quot;')
  })

  it('S53 fix: unordered lists wrap ONCE in <ul> (no nested <ul><ol> double wrap)', () => {
    const html = renderMarkdown('intro\n\n- x\n- y\n\noutro')
    expect(html).toContain('<ul><li>x</li>\n<li>y</li>\n</ul>')
    expect(html).not.toContain('<ul><ol>')
  })

  it('S83 checklist: - [ ] / - [x] render as task rows (checkbox element + done state), never literal "[ ]" text', () => {
    const html = renderMarkdown('- [ ] open task\n- [x] done task\n- plain bullet')
    expect(html).toContain('<li class="md-task">')
    expect(html).toContain('<li class="md-task is-done">')
    expect(html).toContain('md-check is-on')
    expect(html).not.toContain('[ ]')
    expect(html).not.toContain('[x]')
    // the plain bullet in the same list keeps its normal <li>
    expect(html).toContain('<li>plain bullet</li>')
    // tasks ride the same <ul> as plain bullets (one list, mixed items)
    expect(html).toContain('<ul>')
    expect(html).not.toContain('<ul><ul>')
  })

  it('S84 checklist grammar widened: bare `[ ] text` lines, `+` bullets, empty tasks — but link lines stay links', () => {
    // the exact shape the owner typed by hand (no dash) is a task, not literal text
    const html = renderMarkdown('[ ] bare task\n* [X] star caps\n+ [ ] plus bullet\n[ ]')
    expect(html).not.toContain('>[ ]') // never literal bracket text in the output
    expect(html).not.toContain('[X]')
    expect(html).toContain('<li class="md-task')
    expect(html).toContain('<li class="md-task is-done')
    // empty task (marker ends the line, no trailing space) still renders a row
    expect((html.match(/<li class="md-task/g) || []).length).toBe(4)
    // a link whose text is exactly x (a single mark char) is NOT a task (space-after-] is required)
    const link = renderMarkdown('[x](https://a.com)')
    expect(link).toContain('<a href="https://a.com"')
    expect(link).not.toContain('md-task')
    // a non-task bracket line (multi-char mark) is untouched by the task pass
    const plain = renderMarkdown('- [ ] ok\n- [ab] not a task')
    expect(plain).toContain('md-task')
    expect(plain).toContain('<li>[ab] not a task</li>')
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
