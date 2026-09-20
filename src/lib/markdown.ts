// Markdown → HTML for notes (2026-08-25): Obsidian-style reading of pasted AI/text content.
// A pragmatic CommonMark subset — headings, bold/italic/strike, inline + fenced code, links,
// blockquotes, lists, rules, paragraphs. HTML is escaped FIRST, so note text is never injected.
//
// S88 (owner: the code block "uses the same styling as regular text — no syntax coloring,
// no way to copy it"): fenced blocks now render as a full .md-code panel — mono font +
// smaller size (CSS), per-token syntax coloring (the lightweight tokenizer below; no
// Prism/highlight.js dep — the app has a no-build, vendor-budgeted client), a language
// chip, and a Copy button (data-md-copy; app.js owns the ONE delegated clipboard handler
// so every markdown surface — vault preview, quicknote reader — gets it for free). The
// fences are pulled out of the RAW text (pre-escape) so the tokenizer sees real quotes
// and backslashes; its output is escaped per-token, never interpolated raw.

const escHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

// --- S88: the syntax tokenizer -----------------------------------------------------
// A single-pass, regex-driven tokenizer — deliberately tiny (the whole highlighter is
// ~60 lines vs ~100KB of Prism). It is NOT a parser: it gets the 90% visual win (the
// five token classes every editor colors) and never breaks the text (unknown tokens
// pass through escaped). Language handling is a family heuristic, not per-language
// grammars: comment style (// vs # vs --) is the only thing that changes per language.

/** Languages whose line comments start with `#` (python/shell/yaml family). */
const HASH_COMMENT_LANGS = new Set([
  'py', 'python', 'sh', 'bash', 'zsh', 'shell', 'console', 'yaml', 'yml', 'toml', 'ini',
  'conf', 'cfg', 'ruby', 'rb', 'r', 'perl', 'dockerfile', 'makefile', 'make', 'ps1',
])
/** Languages whose line comments start with `--` (sql/lua family). */
const DASH_COMMENT_LANGS = new Set(['sql', 'lua', 'haskell', 'hs'])

/** The keyword set — the union of the C-like / python / shell / sql families the notes
 *  realistically carry. Extra-family keywords simply stay unlit; nothing breaks. */
const MD_KEYWORDS = new Set([
  // C-like
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'default', 'break', 'continue', 'class', 'extends', 'implements', 'new', 'delete',
  'typeof', 'instanceof', 'void', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'yield',
  'await', 'async', 'import', 'from', 'export', 'this', 'super', 'static', 'get', 'set',
  'null', 'true', 'false', 'undefined', 'throw',
  // python
  'def', 'elif', 'lambda', 'pass', 'with', 'as', 'not', 'and', 'or', 'is', 'none', 'raise',
  'except', 'assert', 'global', 'nonlocal', 'print',
  // shell
  'echo', 'exit', 'then', 'fi', 'done', 'esac', 'local', 'export', 'source', 'alias', 'unset',
  // go/rust
  'package', 'struct', 'impl', 'match', 'go', 'defer', 'chan', 'select', 'mut', 'crate', 'pub',
  'nil', 'string', 'int', 'bool', 'float',
  // sql (lowercased compare covers SELECT/SELECT)
  'select', 'insert', 'update', 'delete', 'where', 'join', 'left', 'right', 'inner', 'outer',
  'create', 'table', 'index', 'values', 'group', 'order', 'by', 'having', 'limit',
])

/** Tokenize raw code → escaped HTML with <span class="md-tok-*"> coloring.
 *  Comments/strings/numbers/keywords/function-calls/operators — the Notion/Obsidian
 *  code-block grammar. Persian/Arabic prose inside a block stays plain (identifiers
 *  only match [A-Za-z_$]). */
export function highlightCode(code: string, lang: string): string {
  const langKey = (lang || '').toLowerCase()
  const commentAlts = [
    /\/\*[\s\S]*?\*\//.source,
    /\/\/[^\n]*/.source,
    /<!--[\s\S]*?-->/.source,
    HASH_COMMENT_LANGS.has(langKey) ? /#[^\n]*/.source : '',
    DASH_COMMENT_LANGS.has(langKey) ? /--[^\n]*/.source : '',
  ].filter(Boolean).join('|')
  const tokenRe = new RegExp(
    '(' + commentAlts + ')' +
    '|("(?:\\\\.|[^"\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)' +
    '|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)' +
    '|([A-Za-z_$][\\w$]*)' +
    '|([{}()\\[\\];]|[+\\-*/%=<>!&|^~?:@]+)',
    'g',
  )
  let out = ''
  let last = 0
  for (const m of code.matchAll(tokenRe)) {
    const idx = m.index ?? 0
    if (idx > last) out += escHtml(code.slice(last, idx))
    last = idx + m[0].length
    const [full, com, str, num, ident, op] = m
    if (com !== undefined) out += `<span class="md-tok-com">${escHtml(full)}</span>`
    else if (str !== undefined) out += `<span class="md-tok-str">${escHtml(full)}</span>`
    else if (num !== undefined) out += `<span class="md-tok-num">${escHtml(full)}</span>`
    else if (ident !== undefined) {
      const isKw = MD_KEYWORDS.has(ident.toLowerCase())
      const isFn = /^\s*[(]/.test(code.slice(last))
      out += isKw
        ? `<span class="md-tok-kw">${escHtml(full)}</span>`
        : isFn
          ? `<span class="md-tok-fn">${escHtml(full)}</span>`
          : escHtml(full)
    } else if (op !== undefined) out += `<span class="md-tok-op">${escHtml(op)}</span>`
    else out += escHtml(full)
  }
  if (last < code.length) out += escHtml(code.slice(last))
  return out
}

/** The copy affordance icon (12px, stroke currentColor). */
const MD_COPY_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>'

/** One fenced block → the .md-code panel (lang chip + copy button + colored code).
 *  A BARE fence (no language tag) stays un-tokenized — the owner's plain-text
 *  snippets must not light up English words as keywords (not/in/or/do…). */
function renderCodeBlock(info: string, code: string): string {
  const lang = (info.split(/\s+/)[0] || '').toLowerCase()
  const langLabel = lang ? escHtml(lang) : 'text'
  const body = lang ? highlightCode(code, lang) : escHtml(code)
  return (
    `<div class="md-code" data-lang="${langLabel}" dir="ltr">` +
    `<div class="md-code-bar"><span class="md-code-lang">${langLabel}</span>` +
    `<button type="button" class="md-code-copy" data-md-copy aria-label="Copy code" data-i18n-aria-label="md.copy">${MD_COPY_ICON}</button></div>` +
    `<pre><code>${body}</code></pre>` +
    `</div>`
  )
}

export function renderMarkdown(src: string): string {
  let s = String(src ?? '')
  // Fenced code blocks (``` … ```): pulled OUT of the RAW text into placeholders before
  // any other transform and restored last — the inline passes (bold/italic/links…) used to run
  // over the fence body too, so `**x**` inside a code block rendered as a literal
  // <strong> tag instead of verbatim text (found by the S53 vault renderer tests).
  // S88: extraction moved BEFORE escaping so the tokenizer works on real source text;
  // each fence is a full .md-code panel (see renderCodeBlock).
  const fences: string[] = []
  s = s.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, info: string, code: string) => {
    fences.push(renderCodeBlock(String(info || '').trim(), code))
    return `\x03${fences.length - 1}\x03`
  })
  s = escHtml(s)
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
  // S88: inline code gets its own class so the chip styling (mono + bg + < > tag
  // glyphs in the live editor) can target it without touching legacy <code> uses.
  s = s.replace(/`([^`]+)`/g, '<code class="md-ic">$1</code>')
  // Paragraphs: blank-line-separated blocks (skip blocks already wrapped in a block tag
  // or holding a fence placeholder — those restore to .md-code panels and must not gain a <p>).
  s = s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    .map((b) => (/^<(h[1-6]|ul|ol|pre|blockquote|hr|div|\x03)/.test(b) ? b : `<p>${b}</p>`))
    .join('\n')
  // Soft line breaks inside a paragraph (never inside a fence placeholder line).
  s = s.replace(/([^>\n])\n(?=[^<\n])/g, '$1<br>\n')
  // Restore the code fences — after every other pass, so their bodies stay verbatim.
  s = s.replace(/\x03(\d+)\x03/g, (_m, i: string) => fences[Number(i)] ?? '')
  return s
}
