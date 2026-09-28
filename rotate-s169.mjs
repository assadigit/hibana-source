// rotate-s169.mjs — the S169 docs rotation (sandbox-local helper).
// §1: S169 becomes `## 1.`, S168→1-prev, S159→1-prev-prev, S158→1-prev-prev-prev,
// the S157 block DROPS to git history (chain verified exactly 4 blocks).
// §2: session row 169 appended after row 168.
// Run ONLY after the release chain completes (the block text asserts the deployed state).
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const dry = process.argv.includes('--dry')
const f = '/home/z/hibana/Changelogs.md'
if (dry) copyFileSync(f, '/tmp/Changelogs-s169-dry.md')
const path = dry ? '/tmp/Changelogs-s169-dry.md' : f
let md = readFileSync(path, 'utf8')

// deepest first (each replace must not re-match the next step's source)
md = md.replace('## 1-prev-prev. Current state (v0.3.90.0', '## 1-prev-prev-prev. Current state (v0.3.90.0')
md = md.replace('## 1-prev. Current state (v0.3.91.0', '## 1-prev-prev. Current state (v0.3.91.0')
md = md.replace('## 1. Current state (v0.4.0.0', '## 1-prev. Current state (v0.4.0.0')

const dropStart = md.indexOf('## 1-prev-prev-prev. Current state (v0.3.89.0')
if (dropStart === -1) throw new Error('S157 block not found — rotation aborted, file untouched')
const nextHead = md.indexOf('\n## ', dropStart + 5)
md = md.slice(0, dropStart) + md.slice(nextHead + 1)

const S169 = `## 1. Current state (v0.4.0.1 — Session 169 (the AI-assist wand reaches the Ideas section), 2026-09-28. THE PATCH (the owner's live report on the fresh v0.4.0.0 redesign: "The AI-assist icon doesnt appear for this new ideas page and each fields but it must") — the S161 lean-surface rebuild had opened THREE gaps: (1) spark.html loaded magic-wand.css but NEVER magic-wand.js, so the wand could never appear on the lean idea page; (2) none of its fields carried the [data-magic] opt-in; (3) the redesigned Ideas list lost the wand the old .pc-title cards had (the wand's own charter names spark card titles a supported surface). THE FIX: spark.html loads /js/magic-wand.js?v=17 (same head slot as every other wand surface) + [data-magic] on the title input, the description textarea, the client-rendered tag-add input, and the link-LABEL input — Apply rides the page's own save semantics (the input dispatch feeds the S120 draft store + dirty state, then the explicit Save persists; the wand toast's "review and save" is exactly the page's contract). The link-URL input and the folder select stay wand-free BY DESIGN (polish/translate on a URL or a select corrupts data — no surface anywhere has ever wanded them). THE LIST RESTORED: all four view surfaces stamp data-magic + data-magic-save + data-magic-field on their titles (the .spark-card-title span, the list row's title anchor, the sticky note's strong, the kanban card's strong) — the exact .pc-title PATCH contract; hovering any idea's title anywhere in the section offers Polish/Translate/Ask AI in place. BONUS LIVE CATCH (S169b, the second commit): the live-QA pass surfaced a REAL prod console error the local timing never hit — i18n's async apply() can settle BEFORE the idea fetch resolves (project still null) and the S166 hibana:i18n repaint's unguarded renderPin threw "Cannot read properties of null (reading 'pinned_at')"; the repaint now guards its renders on a LOADED idea (the status-line reset stays unconditional). sw.js VERSION v406→v407 (spark.html is a SHELL-precached page and changed). CACHE-BUST: spark-page v2→v4 — gate PASS. LADDER: typecheck 0 · vitest 539/539 · eslint 0 errors (163-warn baseline) · build 78 · wiring (canonical) · parity 1536/1536 (0 new keys — the wand UI was already fully bilingual). TESTS: targeted blast-radius e2e s161+sparks+s119+s120 28/28 + the s161+s120 re-run 14/14 after S169b (no markup contract changed beyond additive attributes; no new spec — a patch round). AGENT-BROWSER QA (:3017, EN+FA/RTL): the wand appears on hover for all four lean fields + the card/list titles, the popover opens (Polish/Translate/Ask AI + the model badge), the Polish flow driven END-TO-END via a mocked /api/ai/text (preview panes → Apply → "Unsaved changes" → Save "✓ Saved" → reload PERSISTED), the Ask-AI instruction panel runs + applies on the title input, FA/RTL anchors the wand at the inline-start corner with the fully-Persian popover («چوب جادو»), 0 console errors. LIVE GOLDEN PATH (hibana.ir, the owner's account): all 19 real idea titles stamped; a TEST idea captured → lean page → the REAL Workers AI Polish ran ("the ai assist icon live proof" → "The AI assist icon lives proof.") → Apply → "Unsaved changes" → Save "✓ Saved" → reload PERSISTED → test idea deleted (no real data touched); a real idea exercised read-only in a FRESH session — 0 page errors on the guarded v4 build. CHAIN: fix 205454b + fix 48265ed pushed → CI (×2 each — GitHub double-delivered the push events) + CD (×2 each) ALL GREEN → live verified → tag v0.4.0.1 → zip → §1 rotated + §2 row 169. package.json 0.4.0.0→0.4.0.1.\n`
md = md.replace('## 1-prev. Current state (v0.4.0.0', S169 + '## 1-prev. Current state (v0.4.0.0')

const row = `| 169 | 2026-09-28 | v0.4.0.1 — THE WAND PATCH (the owner's live report: the AI-assist icon missing on the new ideas page + its fields): spark.html never loaded magic-wand.js (CSS only) and no field carried [data-magic] — the lean page now wands title/description/tag-add/link-label (URL + folder deliberately excluded: AI polish on a URL/select corrupts data); the Ideas list restores the wand on titles in ALL FOUR views (cards/list/sticky/kanban — the .pc-title PATCH contract); + the live-QA bonus catch: the hibana:i18n repaint's renderPin null-project throw guarded (a real prod console error); sw v407; spark-page v2→v4. Ladder green (539 vitest, 42 targeted e2e across both commits, parity 1536/1536); agent-browser QA EN+FA/RTL drove the full Polish→Apply→Save→reload flow locally (mocked endpoint) AND live (real Workers AI on a test idea, deleted after). Deployed + tag v0.4.0.1. |\n`
const anchor = md.indexOf('\n', md.indexOf('| 168 | 2026-09-28'))
if (anchor === -1) throw new Error('row 168 anchor not found — rotation aborted')
md = md.slice(0, anchor + 1) + row + md.slice(anchor + 1)

writeFileSync(path, md)
const heads = md.split('\n').filter((l) => l.startsWith('## 1') && l.includes('Current state'))
console.log(heads.map((h) => h.slice(0, 60)).join('\n'))
console.log('blocks:', heads.length, '| row 169:', md.includes('| 169 | 2026-09-28'))
console.log(dry ? 'DRY RUN — /tmp/Changelogs-s169-dry.md (real file untouched)' : 'REAL FILE WRITTEN')
