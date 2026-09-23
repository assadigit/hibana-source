// src/services/ai.ts — Workers AI text transformations for the Magic Button (idea §1).
//
// Green-lit scope ONLY (idea-parking lot §1): an on-demand wand that polishes, rewrites,
// or translates a piece of editable text. Nothing here is background, automatic, or
// schema-touching — the original is never modified until the user clicks "Apply" in the
// preview popover (public/js/magic-wand.js). Failures surface as a toast and leave the
// original byte-for-byte intact (Mission #1: never lose an idea).
//
// Runtime shape: `cfg.ai` is a structural slice of the Cloudflare `Ai` binding
// (`env.AI.run(model, inputs)`). The Worker entry wires `ai: env.AI`; the Node self-host
// path leaves it undefined, so the route degrades to a friendly "Workers-only" notice
// instead of a 500 (portability requirement — same Hono app, both runtimes).
//
// Free-tier discipline (idea §2): the three free-tier text-gen models below. Default
// `@cf/qwen/qwen3-30b-a3b-fp8` (32k ctx, 119-language claim incl. FA), temperature 0.2,
// non-streaming, response_format text. ~5–8 neurons/call → thousands/day inside the
// 10,000/day free budget. The user picks their model in Settings (localStorage, sent
// per-request) — no schema change, no KV, no cron. Paid-only models (glm-5.x, kimi-k2.6+,
// deepseek-v4) are deliberately NOT in the registry.

/**
 * Default model. Mistral Small 3.1 24B Instruct — a pure INSTRUCT model (no reasoning
 * pass), so it's fast (~1-2s) and cheap (~3-5 neurons/call). Good FA quality on polish;
 * same translation weakness as qwen3 on technical terms (both say توزیع for "deployment").
 *
 * Why not qwen3-30b (the previous default): qwen3 is a REASONING model — it emits a
 * chain-of-thought before the answer, costing ~10-32 neurons and ~10s per call. For simple
 * polish/rewrite/translate of short notes, that's overkill. Ali can still pick qwen3 in
 * Settings for complex rewrites where the reasoning pass helps.
 *
 * Verified live 2026-09: Mistral polish EN 2.7n / FA 5.2n, hibana.ir + numbers preserved,
 * no leading-newline artifact. (idea §6 spike — re-verify before trusting FA long-form.)
 */
export const DEFAULT_AI_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'

/**
 * Free-tier text-generation models the user may pick in Settings (idea §2 table + additions).
 * Every entry is free-tier eligible (no paid overage possible on Workers Free). The `fa` flag
 * is the platform claim — Ali must review real FA output before trusting it (idea §6 resume
 * protocol). `note` is a short, honest one-liner for the settings UI. `reasoning` flags MoE
 * models that emit reasoning_content (need higher max_tokens, slower, costlier).
 */
interface AiModelInfo {
  model: string
  label: string
  note: string
  fa: 'strong' | 'weak'
  /** In/out neurons per M tokens (idea §2) — shown in Settings so cost is visible. */
  inPerM: number
  outPerM: number
}

export const FREE_TIER_MODELS: readonly AiModelInfo[] = [
  {
    model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    label: 'Mistral Small 3.1 24B Instruct',
    note: 'Default — pure instruct (fast, ~3-5n/call). Good FA polish. Best all-rounder.',
    fa: 'strong',
    inPerM: 5800,
    outPerM: 22000,
  },
  {
    model: '@cf/qwen/qwen3-30b-a3b-fp8',
    label: 'Qwen3 30B (A3B, reasoning)',
    note: 'Reasoning model — slower/costlier (~10-32n). Better on complex rewrites.',
    fa: 'strong',
    inPerM: 4625,
    outPerM: 30475,
  },
  {
    model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    label: 'Llama 3.1 8B (Fast)',
    note: 'Lightest + cheapest (~1n/call). WEAK Persian — EN-only recommended.',
    fa: 'weak',
    inPerM: 4119,
    outPerM: 34868,
  },
] as const

/** Whitelist of valid model IDs (for route-level validation). */
const FREE_TIER_MODEL_IDS: readonly string[] = FREE_TIER_MODELS.map((m) => m.model)

/** Resolve a client-sent model id to a valid one (or the default). Never throws. */
export function resolveModel(model: string | undefined | null): string {
  if (typeof model === 'string' && FREE_TIER_MODEL_IDS.includes(model)) return model
  return DEFAULT_AI_MODEL
}

/** Back-compat: the original constant name (used by existing tests). Points at the default. */
export const AI_MODEL = DEFAULT_AI_MODEL

/** Hard cap on input length (idea §1 guard). >4000 chars → HTTP 400; never reaches the model. */
export const MAX_INPUT_CHARS = 4000

/** Output token budget. qwen3-30b-a3b-fp8 + glm-4.7-flash are REASONING models (MoE) —
 *  they emit a chain-of-thought in `reasoning_content` BEFORE the answer in `content`.
 *  2048 covers the reasoning pass + a faithful transformation with headroom, without
 *  inviting runaway output. Llama-3.1-8b is not a reasoning model and uses far less. */
const MAX_OUTPUT_TOKENS = 2048

/** The actions the popover exposes. Whitelist at the route boundary. S86 adds
 *  'custom' — the user's OWN instruction, typed into the wand's Ask-AI panel (e.g.
 *  "classify these books into categories"); the note text rides the user message and
 *  the instruction replaces the persona entirely. */
export type AiAction = 'polish' | 'rewrite' | 'translate' | 'custom'
export const AI_ACTIONS: readonly AiAction[] = ['polish', 'rewrite', 'translate', 'custom'] as const

/** Minimal structural slice of the Cloudflare `Ai` binding — enough for one `.run()` call.
 *  Keeping it structural (not importing the real `Ai` type) keeps the service importable
 *  in the Node runtime + unit tests without the workers-types `Ai` global being live. */
export interface AiRunner {
  run(model: string, inputs: AiRunInputs): Promise<AiRunResult>
}

/** Inputs handed to `Ai.run()`. Matches the Workers AI text-generation schema. */
interface AiRunInputs {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
  max_tokens?: number
  response_format?: { type: 'text' }
}

/** The binding returns the result DIRECTLY (not wrapped in `result` like the REST API):
 *  - text-gen: `{ response: string }`
 *  - chat/reasoning: `{ choices: [{ message: { content, reasoning_content } }] }`
 *  The REST API wraps these in `{ result: ... }` — we handle both shapes so the same
 *  service works against the binding (production) AND the REST API (sandbox/tests). */
interface AiRunResult {
  // Direct (binding):
  response?: string
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  // Wrapped (REST API / some binding versions):
  result?: {
    response?: string
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  }
}

// --- Prompt contract (idea §1) ---------------------------------------------------
// One system message per action. All three share the same output discipline: ONLY the
// transformed text, no preamble/quotes/fences, never add or drop facts, keep names,
// numbers, dates, URLs, and code identifiers verbatim. Polish/rewrite keep the language;
// translate flips EN↔FA and preserves formatting/code/URLs.

const COMMON_RULES = [
  'Output ONLY the transformed text.',
  'No preamble, no headings, no commentary, no leading or trailing quotes, no markdown code fences.',
  'Never add facts and never drop meaning.',
  'Names, numbers, dates, URLs, and code identifiers must stay verbatim.',
].join(' ')

const SYSTEM_PROMPTS: Record<Exclude<AiAction, 'custom'>, string> = {
  // NB: avoid the bare word "Polish" in the prompt — Llama-3.1-8b reads it as "translate
  // to Polish" (the language) and outputs Polish. "Fix grammar and spelling" is unambiguous
  // and every model obeys it. The popover button still LABELS this action "Polish" (EN) /
  // "اصلاح" (FA) — only the system prompt is reworded.
  // S115 (owner, sharper contract): polish is a COPY-EDIT — spelling, punctuation,
  // symbols, capitalization, grammar — and NOTHING else. The meaning must survive
  // UNTOUCHED: no rephrasing, no style moves, no sentence reordering, no length drift
  // beyond what the corrections themselves require. (The previous prompt's "clarity"
  // invited paraphrase; a polish that quietly rewrites is a betrayal of "Saved [✓]"
  // trust — the user's words are their ideas, Mission #1.)
  polish: [
    'You are a meticulous copy editor for a developer’s personal notes.',
    'Correct ONLY spelling, punctuation, symbols, capitalization, and grammar — nothing else.',
    'Turn the text into a standard, correctly written piece. Keep the SAME language as the input.',
    'Do NOT rephrase, do NOT change the wording or style, do NOT reorder sentences, do NOT add or remove any information. The meaning must stay EXACTLY the same — leave every already-correct word untouched.',
    COMMON_RULES,
  ].join(' '),
  rewrite: [
    'You are a technical writer. Rewrite the user’s note in a clean, precise technical/developer register.',
    'Keep the SAME language as the input.',
    'Rephrase for clarity and concision; keep the meaning and the key facts.',
    COMMON_RULES,
  ].join(' '),
  translate: [
    'You are a professional translator between English and Persian (Farsi).',
    'CRITICAL RULE: You MUST output in the OPPOSITE language from the input. If the input is English, your ENTIRE output MUST be in Persian/Farsi — NEVER output English. If the input is Persian, your ENTIRE output MUST be in English.',
    'If the input is English and you output English, you have FAILED. Translate every sentence into natural, fluent Persian.',
    'Keep all formatting, code, URLs, numbers, and identifiers untouched — translate ONLY the prose around them.',
    COMMON_RULES,
  ].join(' '),
}

// S86: 'custom' gets a LIGHTER discipline than the fixed actions. COMMON_RULES'
// "never add facts" + "no headings" would fight real instructions (classification
// wants structure; summarization drops detail by design). Only the output hygiene
// is enforced — the user's instruction is the persona and the task.
const CUSTOM_RULES = [
  'Output ONLY the result of the instruction — no preamble, no commentary,',
  'no leading or trailing quotes, no markdown code fences around the whole answer.',
  'The text below is the material to work on; apply the instruction to it faithfully.',
].join(' ')

// --- S77: deterministic translate direction (owner rule, verbatim) ----------------
// "WHEN TEXT IS FARSI > TRANSLATE > ENGLISH. WHEN TEXT IS ENGLISH > TRANSLATE > FARSI."
// Live repro (hibana.ir, mistral-small): a FARSI input got back a FARSI PARAPHRASE
// (پروسس → پردازش) instead of English — the model is unreliable at self-detecting the
// input language, so the CLIENT detects the script and sends target_lang; the server
// then builds a ONE-WAY prompt and VERIFIES the output script (one retry, then an
// honest wrong_language error instead of a same-language “translation”).
export type TranslateTarget = 'fa' | 'en'

const DIRECTION_RULES: Record<TranslateTarget, string> = {
  fa: [
    'CRITICAL DIRECTION RULE: translate the text INTO Persian (Farsi).',
    'Your ENTIRE output MUST be written in Persian (Farsi) script. NEVER output English prose.',
    'English characters are allowed ONLY inside code, URLs, file paths, command names, and brand identifiers that must stay verbatim.',
    'Produce natural, fluent, idiomatic Persian.',
    // S88 (owner report: EN input → the model answered with Persian ADVICE about how
    // to translate instead of the translation — «برای ترجمه متن انگلیسی باید مطمئن
    // شوید…»). The direction check passes (it IS Persian) so the slop reached the
    // preview. The prompt now pins the CONTRACT: the user message is material, never
    // a request for help.
    'The user message is ONLY the material to translate — it is never a question, never a request for help or advice about translation.',
    'Never explain how to translate, never give instructions, tips, steps, or examples. Output ONLY the translation itself.',
  ].join(' '),
  en: [
    'CRITICAL DIRECTION RULE: translate the text INTO English.',
    'Your ENTIRE output MUST be in English. NEVER output Persian/Farsi prose.',
    'Persian script is allowed ONLY inside quoted proper nouns the user must keep verbatim.',
    'Produce natural, fluent, idiomatic English.',
    'The user message is ONLY the material to translate — it is never a question, never a request for help or advice about translation.',
    'Never explain how to translate, never give instructions, tips, steps, or examples. Output ONLY the translation itself.',
  ].join(' '),
}

const TRANSLATE_PERSONA: Record<TranslateTarget, string> = {
  fa: 'You are a professional English→Persian (Farsi) translator for a developer’s personal notes.',
  en: 'You are a professional Persian (Farsi)→English translator for a developer’s personal notes.',
}

/** Count script-bearing characters: Arabic/Persian code blocks vs Latin letters. */
function countScripts(text: string): { fa: number; en: number } {
  let fa = 0, en = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) fa++
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) en++
  }
  return { fa, en }
}

/** Did the model answer in the REQUESTED script? (Persian output → predominantly FA
 *  letters; English output → predominantly Latin.) Proper nouns/identifiers of the other
 *  script are tolerated — the PROSE decides. Vacuous (no letters at all) passes. */
export function directionOk(text: string, target: TranslateTarget): boolean {
  const { fa, en } = countScripts(text)
  if (fa === 0 && en === 0) return true
  return target === 'fa' ? fa > en : en > fa
}

// --- S88: translation-slop guard -------------------------------------------------
// The direction check verifies the SCRIPT, not the JOB. The owner's live failure: an
// English note → the model returned ~1,400 chars of Persian ADVICE about translation
// («برای ترجمه متن انگلیسی به فارسی باید مطمئن شوید…» + a Google-Translate how-to +
// a python snippet). Persian script → directionOk passes → slop served as a
// "translation". Two signals catch it deterministically:
//   1. RUNAWAY LENGTH — a translation of a note rarely balloons past ~2.5× the input
//      (EN→FA usually SHRINKS); slop multiplies the input several-fold.
//   2. META VOCABULARY — the output talks ABOUT translating (words like ترجمه /
//      "translate" / "make sure" / "Google Translate") while the INPUT never mentioned
//      the topic. A note that IS about translation keeps its words — the input check
//      is what keeps legit translations of translation-themed notes passing.
const SLOP_META_RE =
  /ترجمه|مترجم|دکمه\s*ترجمه|باید\s*مطمئن\s*شوید|در\s*صورت\s*استفاده\s*از|گوگل\s*ترنسلیت|google\s*translate|how\s+to\s+translate|you\s+(?:must|should|can)\s+(?:make\s+sure|set|use|select|press|click)/i

export function looksLikeSlop(output: string, input: string): boolean {
  const inN = Math.max(Array.from(input).length, 1)
  const outN = Array.from(output).length
  const runaway = outN > inN * 2.5 && outN - inN > 120
  const metaOut = SLOP_META_RE.test(output)
  const metaIn = SLOP_META_RE.test(input) || /translate|translation|ترجمه|گوگل|google/i.test(input)
  return (runaway && metaOut) || (metaOut && !metaIn && outN > inN * 1.5)
}

/** Detect the DOMINANT script of the input (the client mirror of the same heuristic —
 *  exported for tests). Farsi wins ties: a mixed note with real Farsi prose is Farsi. */
export function detectLang(text: string): 'fa' | 'en' {
  const { fa, en } = countScripts(text)
  return fa > 0 && fa >= en ? 'fa' : 'en'
}

/** Max length of a user-supplied custom system prompt (Settings → AI instructions).
 *  Generous enough for real customization, bounded to prevent abuse. */
export const MAX_CUSTOM_PROMPT_CHARS = 2000

/** Build the messages array for a given action. Pure + deterministic → unit-testable.
 *
 *  `customPrompt` (optional, from Settings): when provided, it REPLACES the action's
 *  default persona/instructions — but COMMON_RULES (output discipline) is ALWAYS appended
 *  so the format stays clean regardless of what the user writes. Empty → use defaults.
 *
 *  `targetLang` (S77, translate only): the deterministic direction the client detected
 *  (FA input → 'en', EN input → 'fa'). When present, the bidirectional prompt is replaced
 *  by a ONE-WAY prompt, and the DIRECTION RULE is appended even on top of a customPrompt —
 *  the owner's rule is absolute and no custom persona may weaken it. */
export function buildMessages(
  action: AiAction,
  text: string,
  customPrompt?: string,
  targetLang?: TranslateTarget,
): AiRunInputs['messages'] {
  // S86 'custom': the user's typed instruction IS the system prompt (the Settings
  // customPrompt is deliberately NOT layered on top — the panel speaks for itself).
  // An empty instruction is rejected at the route; here it degrades to the plain
  // CUSTOM_RULES so the call can never silently no-op.
  if (action === 'custom') {
    const instruction = (customPrompt ?? '').trim()
    const system = instruction ? `${instruction} ${CUSTOM_RULES}` : CUSTOM_RULES
    return [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ]
  }
  let base: string
  if (action === 'translate' && targetLang) {
    base = customPrompt && customPrompt.trim()
      ? customPrompt.trim()
      : [TRANSLATE_PERSONA[targetLang], DIRECTION_RULES[targetLang]].join(' ')
    if (customPrompt && customPrompt.trim()) base += ' ' + DIRECTION_RULES[targetLang]
    base += ' Keep all formatting, code, URLs, numbers, and identifiers untouched — translate ONLY the prose around them.'
  } else {
    base = customPrompt && customPrompt.trim() ? customPrompt.trim() : SYSTEM_PROMPTS[action]
  }
  const system = base.includes(COMMON_RULES) ? base : base + ' ' + COMMON_RULES
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]
}

// --- Output cleanup --------------------------------------------------------------
// The prompt forbids fences/quotes/commentary, but models occasionally wrap output in
// ```…``` or surrounding quotes anyway. Strip exactly those accidental wrappers so the
// user never sees formatting artifacts in their note. The body itself is never altered.

function stripAccidentalWrappers(s: string): string {
  let out = s
  // A leading ```lang and trailing ``` (with optional trailing newline) — only when the
  // WHOLE output is fenced, so we never strip an in-text code block the user intended.
  const fence = out.match(/^```[a-zA-Z0-9]*\n?([\s\S]*?)\n?```$/)
  if (fence) out = fence[1]
  // Surrounding double or single quotes that wrap the entire output.
  if (out.length >= 2) {
    const first = out[0]
    const last = out[out.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      // Only strip if they are the only occurrences on the boundary (avoid stripping
      // legitimate quotes that are part of the content).
      out = out.slice(1, -1)
    }
  }
  // Reasoning models (qwen3-30b, glm-4.7-flash) prefix their answer with "\n\n" after the
  // chain-of-thought. Trim both leading + trailing whitespace so the user never sees blank
  // lines around the transformed text. (Previously only trailing newlines were stripped —
  // qwen3's leading "\n\n" leaked into the suggestion preview.)
  return out.trim()
}

/** Is `text` within the char budget? Exposed so the route + tests share one definition. */
export function withinCharBudget(text: string): boolean {
  // Array.from counts code points (FA digraphs/combining marks still cost neurons; this
  // is the user-facing "characters" count, not UTF-16 units).
  return Array.from(text).length <= MAX_INPUT_CHARS
}

/** Extract the answer from either response shape Workers AI returns:
 *  - chat/reasoning models (qwen3, glm, mistral): `choices[0].message.content` (the answer;
 *    `reasoning_content` is the chain-of-thought, discarded)
 *  - legacy text-gen: `response`
 *  Checks the DIRECT shape first (binding: `{ response }` / `{ choices }`), then the
 *  WRAPPED shape (REST API: `{ result: { response } }` / `{ result: { choices } }`). */
function extractAnswer(res: AiRunResult): string | null {
  // Direct (binding): { response } or { choices }
  if (typeof res?.response === 'string') return res.response
  const directChoice = res?.choices?.[0]?.message?.content
  if (typeof directChoice === 'string') return directChoice
  // Wrapped (REST API): { result: { response } } or { result: { choices } }
  const r = res?.result
  if (!r) return null
  if (typeof r.response === 'string') return r.response
  const wrappedChoice = r.choices?.[0]?.message?.content
  return typeof wrappedChoice === 'string' ? wrappedChoice : null
}

/** Run one transformation. Throws nothing — returns `{ ok, text?, error? }` so the route
 *  can map errors to the right HTTP status without try/catch soup. The original text is
 *  the caller’s responsibility; this never sees or mutates it.
 *
 *  `model` is resolved via `resolveModel()` before reaching the binding — an unknown id
 *  silently falls back to the default (the route already validates, this is defense).
 *
 *  `targetLang` (S77, translate): after the first response, the OUTPUT SCRIPT is verified
 *  against the requested direction, and (S88) the output is checked for translation-SLOP
 *  — advice about translating instead of a translation. A same-language answer or slop
 *  gets ONE amplified retry; a second failure returns `wrong_language` /
 *  `not_a_translation` — an honest error beats a "translation" that didn't translate.
 *
 *  NB: `response_format` is deliberately NOT set. qwen3-30b-a3b-fp8 rejects
 *  `{ type: 'text' }` (it only accepts json_object/json_schema), and the prompt already
 *  enforces plain-text output discipline, so it’s redundant. */
export async function runAiTransform(
  ai: AiRunner,
  action: AiAction,
  text: string,
  model: string = DEFAULT_AI_MODEL,
  customPrompt?: string,
  targetLang?: TranslateTarget,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  // Defensive: even though the route guards this, the service is the last line.
  if (!withinCharBudget(text)) {
    return { ok: false, error: 'text_too_long' }
  }
  const resolved = resolveModel(model)
  try {
    const res = await ai.run(resolved, {
      messages: buildMessages(action, text, customPrompt, targetLang),
      temperature: 0.2,
      max_tokens: MAX_OUTPUT_TOKENS,
    })
    let raw = extractAnswer(res)
    if (typeof raw !== 'string' || raw.trim() === '') {
      return { ok: false, error: 'empty_response' }
    }
    // S77 + S88: verify the translate direction AND the job itself. Wrong script OR
    // slop (advice about translating) → ONE amplified retry; still bad → an honest
    // error (the route shows a clear, localized toast — never a silent fake
    // "translation").
    if (action === 'translate' && targetLang) {
      const dirBad = !directionOk(raw, targetLang)
      const slopBad = !dirBad && looksLikeSlop(raw, text)
      if (dirBad || slopBad) {
        const amplify = dirBad
          ? targetLang === 'fa'
            ? 'IMPORTANT: your previous answer was NOT in Persian. Answer AGAIN, entirely in Persian (Farsi) script. This is a translation task — every sentence of prose must be Persian.'
            : 'IMPORTANT: your previous answer was NOT in English. Answer AGAIN, entirely in English. This is a translation task — every sentence of prose must be English.'
          : targetLang === 'fa'
            ? 'IMPORTANT: your previous answer was NOT the translation — it was advice ABOUT translating. This is not a help request. Do not explain, instruct, or advise. Answer AGAIN with ONLY the Persian (Farsi) translation of the text, nothing else.'
            : 'IMPORTANT: your previous answer was NOT the translation — it was advice ABOUT translating. This is not a help request. Do not explain, instruct, or advise. Answer AGAIN with ONLY the English translation of the text, nothing else.'
        const retry = await ai.run(resolved, {
          messages: [
            ...buildMessages(action, text, customPrompt, targetLang),
            { role: 'assistant', content: raw },
            { role: 'user', content: amplify + '\n\n' + text },
          ],
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
        })
        const retryRaw = extractAnswer(retry)
        if (typeof retryRaw !== 'string' || retryRaw.trim() === '') {
          return { ok: false, error: dirBad ? 'wrong_language' : 'not_a_translation' }
        }
        if (!directionOk(retryRaw, targetLang)) return { ok: false, error: 'wrong_language' }
        if (looksLikeSlop(retryRaw, text)) return { ok: false, error: 'not_a_translation' }
        raw = retryRaw
      }
    }
    return { ok: true, text: stripAccidentalWrappers(raw) }
  } catch {
    // Free tier has no paid overage — a failed request never costs the original text. The
    // route turns this into a visible toast; the caller's draft is untouched.
    return { ok: false, error: 'ai_failed' }
  }
}
