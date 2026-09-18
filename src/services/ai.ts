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

/** The three actions the popover exposes. Whitelist at the route boundary. */
export type AiAction = 'polish' | 'rewrite' | 'translate'
export const AI_ACTIONS: readonly AiAction[] = ['polish', 'rewrite', 'translate'] as const

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

const SYSTEM_PROMPTS: Record<AiAction, string> = {
  // NB: avoid the bare word "Polish" in the prompt — Llama-3.1-8b reads it as "translate
  // to Polish" (the language) and outputs Polish. "Fix grammar and spelling" is unambiguous
  // and every model obeys it. The popover button still LABELS this action "Polish" (EN) /
  // "اصلاح" (FA) — only the system prompt is reworded.
  polish: [
    'You are a meticulous copy editor for a developer’s personal notes.',
    'Fix grammar, spelling, punctuation, and clarity. Keep the SAME language as the input.',
    'Preserve the meaning and the approximate length. Do not rewrite for style — only correctness and readability.',
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
  ].join(' '),
  en: [
    'CRITICAL DIRECTION RULE: translate the text INTO English.',
    'Your ENTIRE output MUST be in English. NEVER output Persian/Farsi prose.',
    'Persian script is allowed ONLY inside quoted proper nouns the user must keep verbatim.',
    'Produce natural, fluent, idiomatic English.',
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
 *  against the requested direction. A same-language answer (the live FA→FA paraphrase
 *  failure) gets ONE amplified retry; a second failure returns `wrong_language` — an
 *  honest error beats a “translation” that didn't translate.
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
    // S77: verify the translate direction. Wrong script → ONE amplified retry; still
    // wrong → wrong_language (the route shows a clear, localized “did not translate”
    // toast — never a silent same-language suggestion).
    if (action === 'translate' && targetLang && !directionOk(raw, targetLang)) {
      const amplified =
        targetLang === 'fa'
          ? 'IMPORTANT: your previous answer was NOT in Persian. Answer AGAIN, entirely in Persian (Farsi) script. This is a translation task — every sentence of prose must be Persian.'
          : 'IMPORTANT: your previous answer was NOT in English. Answer AGAIN, entirely in English. This is a translation task — every sentence of prose must be English.'
      const retry = await ai.run(resolved, {
        messages: [
          ...buildMessages(action, text, customPrompt, targetLang),
          { role: 'assistant', content: raw },
          { role: 'user', content: amplified + '\n\n' + text },
        ],
        temperature: 0.2,
        max_tokens: MAX_OUTPUT_TOKENS,
      })
      const retryRaw = extractAnswer(retry)
      if (typeof retryRaw !== 'string' || retryRaw.trim() === '' || !directionOk(retryRaw, targetLang)) {
        return { ok: false, error: 'wrong_language' }
      }
      raw = retryRaw
    }
    return { ok: true, text: stripAccidentalWrappers(raw) }
  } catch {
    // Free tier has no paid overage — a failed request never costs the original text. The
    // route turns this into a visible toast; the caller's draft is untouched.
    return { ok: false, error: 'ai_failed' }
  }
}
