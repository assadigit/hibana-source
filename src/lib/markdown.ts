// Markdown → HTML for notes (2026-08-25): Obsidian-style reading of pasted AI/text content.
// A pragmatic CommonMark subset — headings, bold/italic/strike, inline + fenced code, links,
// blockquotes, lists, rules, paragraphs. HTML is escaped FIRST, so note text is never injected.

const escHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

export function renderMarkdown(src: string): string {
  let s = escHtml(String(src ?? ''))
  // Fenced code blocks (``` … ```): pulled OUT into placeholders before any other
  // transform and restored last — the inline passes (bold/italic/links…) used to run
  // over the fence body too, so `**x**` inside a code block rendered as a literal
  // <strong> tag instead of verbatim text (found by the S53 vault renderer tests).
  const fences: string[] = []
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => {
    fences.push(`<pre><code>${code}</code></pre>`)
    return `\x03${fences.length - 1}\x03`
  })
  // Headings (the core ask: ## heading → h2).
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>')
  s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>')
  s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>')
  // Blockquotes.
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
  // Task-list items (S83, owner request — the Note Editor's Checklist): GitHub-style
  // `- [ ]` / `- [x]`. Parsed BEFORE the generic bullet so the checkbox never renders
  // as literal "[ ]" text; rides the same \x01U\x02 UL grouping as plain bullets.
  // Server-side the box is a static span (reading views); the vault's live editor
  // (notes-page.js) renders the same structure with an interactive button instead.
  // S84: the bullet is optional (a bare `[ ] text` line is a task — the exact shape
  // the owner typed), `+` joins the bullets, and the marker may end the line; a
  // space before text stays REQUIRED so `[x](url)` keeps parsing as a link.
  s = s.replace(/^[ \t]*(?:[-*+] )?\[([ xX])\](?:[ \t]+(.*))?$/gm, (_m, mark: string, rest?: string) => {
    const done = mark.toLowerCase() === 'x'
    return `\x01U\x02<li class="md-task${done ? ' is-done' : ''}"><span class="md-check${done ? ' is-on' : ''}" aria-hidden="true"></span><span class="md-task-txt">${rest ?? ''}</span></li>`
  })
  // Lists (S53 fix): typed markers first (\x01U\x02 / \x01O\x02), then per-type runs —
  // the old unmarked double pass wrapped unordered lists as <ul><ol><li>… (the second
  // pass re-wrapped the first pass's <li> run), rendering bullets as numbers with a
  // double indent. Markers keep a UL run and an adjacent OL run from merging, and the
  // final strip removes them from the output.
  s = s.replace(/^[ \t]*[-*] (.*)$/gm, '\x01U\x02<li>$1</li>')
  s = s.replace(/^[ \t]*\d+\. (.*)$/gm, '\x01O\x02<li>$1</li>')
  s = s.replace(/(?:\x01U\x02<li[^>]*>[\s\S]*?<\/li>\n?)+/g, '<ul>$&</ul>')
  s = s.replace(/(?:\x01O\x02<li[^>]*>[\s\S]*?<\/li>\n?)+/g, '<ol>$&</ol>')
  s = s.replace(/\x01[OU]\x02/g, '')
  // Horizontal rule.
  s = s.replace(/^---+$/gm, '<hr>')
  // Links (http(s) only — never javascript:).
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  // Bold / italic / strike / inline code (bold first so its ** can't be split).
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Paragraphs: blank-line-separated blocks (skip blocks already wrapped in a block tag
  // or holding a fence placeholder — those restore to <pre> and must not gain a <p>).
  s = s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    .map((b) => (/^<(h[1-6]|ul|ol|pre|blockquote|hr|\x03)/.test(b) ? b : `<p>${b}</p>`))
    .join('\n')
  // Soft line breaks inside a paragraph (never inside a fence placeholder line).
  s = s.replace(/([^>\n])\n(?=[^<\n])/g, '$1<br>\n')
  // Restore the code fences — after every other pass, so their bodies stay verbatim.
  s = s.replace(/\x03(\d+)\x03/g, (_m, i: string) => fences[Number(i)] ?? '')
  return s
}