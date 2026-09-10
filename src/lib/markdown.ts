// Markdown → HTML for notes (2026-08-25): Obsidian-style reading of pasted AI/text content.
// A pragmatic CommonMark subset — headings, bold/italic/strike, inline + fenced code, links,
// blockquotes, lists, rules, paragraphs. HTML is escaped FIRST, so note text is never injected.

const escHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

export function renderMarkdown(src: string): string {
  let s = escHtml(String(src ?? ''))
  // Fenced code blocks (``` … ```) — render verbatim, no further transforms.
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  // Headings (the core ask: ## heading → h2).
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>')
  s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>')
  s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>')
  // Blockquotes.
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
  // Unordered lists: each "- item" line becomes <li>; wrap consecutive runs in <ul>.
  s = s.replace(/^[ \t]*[-*] (.*)$/gm, '<li>$1</li>')
  s = s.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, '<ul>$&</ul>')
  // Ordered lists.
  s = s.replace(/^[ \t]*\d+\. (.*)$/gm, '<li>$1</li>')
  s = s.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, '<ol>$&</ol>')
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
  // Paragraphs: blank-line-separated blocks (skip blocks already wrapped in a block tag).
  s = s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    .map((b) => (/^<(h[1-6]|ul|ol|pre|blockquote|hr)/.test(b) ? b : `<p>${b}</p>`))
    .join('\n')
  // Soft line breaks inside a paragraph.
  s = s.replace(/([^>\n])\n(?=[^<\n])/g, '$1<br>\n')
  return s
}