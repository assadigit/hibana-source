// src/routes/ai.ts — Magic Button route (idea §1, green-lit).
//
// Two endpoints:
//   POST /api/ai/text  → { text, action, model? } → { text }
//   GET  /api/ai/models → { models, default }  (for the Settings model selector)
//
// - Same auth + CSRF surface as every other write route (requireAuth + the global
//   Origin/Referer gate in app.ts). No new schema, no cron, no KV, no secrets.
// - 4000-char guard (idea §1) — rejected with HTTP 400 before the model is touched.
// - `model` is optional; validated against the free-tier whitelist (idea §2). Unknown/
//   paid-only models fall back to the default — a user can never burn paid neurons by
//   sending a hand-crafted id.
// - Node self-host path: `cfg.ai` is undefined → 503 with a friendly "Workers-only"
//   code, so the feature degrades visibly instead of crashing (portability contract).
// - On any model failure the original text is never modified (the client only writes on
//   an explicit Apply of a 200 response — Mission #1: never lose an idea).
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { jsonBody } from '../lib/http'
import { hitRateLimit, RATE_RULES, clientIp } from '../services/ratelimit'
import { localeOf } from '../lib/i18n'
import { ApiError, ErrorCode, apiError } from '../lib/errors'
import type { Config } from '../types'
import {
  AI_ACTIONS,
  DEFAULT_AI_MODEL,
  FREE_TIER_MODELS,
  type AiAction,
  type AiRunner,
  MAX_CUSTOM_PROMPT_CHARS,
  MAX_INPUT_CHARS,
  runAiTransform,
  withinCharBudget,
} from '../services/ai'

// Zod schema (rule 10). `action` is a literal union so an unknown string is a 400, not a
// model call with garbage. `text` is bounded on both ends. `model` is optional + loose
// here (string); the route resolves+validates it against the free-tier whitelist so a
// hand-crafted paid-only id can never reach the binding. `customPrompt` is optional,
// bounded to MAX_CUSTOM_PROMPT_CHARS — the user's Settings-defined system prompt.
const textBodySchema = z.object({
  text: z.string().min(1).max(MAX_INPUT_CHARS),
  action: z.enum(AI_ACTIONS as unknown as [AiAction, ...AiAction[]]),
  model: z.string().optional(),
  customPrompt: z.string().max(MAX_CUSTOM_PROMPT_CHARS).optional(),
  // S77 (owner rule, verbatim): “WHEN TEXT IS FARSI > TRANSLATE > ENGLISH WHEN TEXT IS
  // ENGLISH > TRANSLATE > FARSI”. The client detects the input's script and names the
  // TARGET; the server then builds a one-way prompt and verifies the output script —
  // the model's own language self-detection proved unreliable live (FA input came back
  // as a FA paraphrase instead of English).
  target_lang: z.enum(['fa', 'en']).optional(),
})

export function aiRoutes(cfg: Config): Hono {
  const app = new Hono()

  // GET /api/ai/models — the free-tier registry, for the Settings model selector. Same
  // shape as the service's FREE_TIER_MODELS (model/label/note/fa/in/out) + the default.
  // Auth-gated: the model list itself isn't secret, but keeping it behind requireAuth is
  // consistent with every other /api/* route and avoids a public model-probing surface.
  app.get('/models', requireAuth(cfg), (c) => {
    return c.json({ models: FREE_TIER_MODELS, default: DEFAULT_AI_MODEL })
  })

  app.post('/text', requireAuth(cfg), async (c) => {
    // SWOT T-low: rate-limit the AI Magic Button — 20 req/60s per IP. Stops a runaway
    // script from burning the Workers AI free-tier neuron budget (10k/day).
    if (await hitRateLimit(cfg.db, RATE_RULES.ai, clientIp(c))) {
      throw apiError(ErrorCode.rate_limited, 'Too many AI requests — wait a minute and try again.')
    }
    const body = await jsonBody(c, textBodySchema)
    if (!body) throw apiError(ErrorCode.invalid_input, 'text and action are required')

    // S86: the 'custom' action (the wand's Ask-AI panel) REQUIRES a non-empty
    // instruction — it is the whole persona. 400 with a localized message beats a
    // silent no-op call into the model.
    if (body.action === 'custom' && !(body.customPrompt ?? '').trim()) {
      const lang = localeOf(c)
      throw apiError(
        ErrorCode.invalid_input,
        lang === 'fa' ? 'اول دستور خود را بنویس.' : 'Write your instruction first.',
      )
    }

    // Precise code-point guard (idea §1: reject text > 4,000 chars, HTTP 400). Zod’s
    // .max() counts UTF-16 units; this counts characters the way a user counts them,
    // so FA combining marks aren’t double-counted against the budget.
    if (!withinCharBudget(body.text)) {
      throw apiError(ErrorCode.too_many, `text exceeds ${MAX_INPUT_CHARS} characters`)
    }

    // Node self-host path: no `Ai` binding exists. Degrade to a friendly, localized
    // notice (503) instead of a 500 — the Worker entry wires `ai: env.AI`; the Node
    // entry deliberately omits it (portability requirement).
    const ai = (cfg as Config & { ai?: AiRunner }).ai
    if (!ai) {
      const lang = localeOf(c)
      const msg = lang === 'fa'
        ? 'این قابلیت فقط روی Cloudflare Workers فعال است.'
        : 'This feature is available on the Cloudflare Workers deployment only.'
      throw apiError(ErrorCode.unavailable, msg)
    }

    // `model` is resolved inside runAiTransform (defense in depth): an unknown/paid-only
    // id silently becomes the default, so a hand-crafted request can never reach a paid
    // model. The free-tier whitelist (idea §2) is the single source of truth. `customPrompt`
    // (from Settings) replaces the action's default persona — but COMMON_RULES (output
    // discipline) is always appended so the format stays clean regardless.
    const result = await runAiTransform(ai, body.action, body.text, body.model, body.customPrompt, body.target_lang)
    if (!result.ok) {
      // Map the service’s coarse error to a visible, user-actionable toast. Never 500:
      // a model hiccup is not a server fault, and the free tier has no retry-safe path.
      const lang = localeOf(c)
      const messages: Record<string, Record<string, string>> = {
        en: {
          text_too_long: `Text is too long (limit ${MAX_INPUT_CHARS} characters).`,
          empty_response: 'The model returned no text. Try again.',
          ai_failed: 'The AI request failed. Your text was not changed.',
          wrong_language: 'The model answered in the wrong language — your text was not changed. Try again.',
        },
        fa: {
          text_too_long: `متن خیلی طولانی است (حداکثر ${MAX_INPUT_CHARS} نویسه).`,
          empty_response: 'مدل خروجی نداد. دوباره امتحان کنید.',
          ai_failed: 'درخواست هوش مصنوعی ناموفق بود. متن شما تغییری نکرد.',
          wrong_language: 'مدل به زبان درست پاسخ نداد — متن شما تغییری نکرد. دوباره امتحان کنید.',
        },
      }
      throw new ApiError(ErrorCode.unavailable, messages[lang][result.error] ?? messages.en[result.error], 503)
    }

    // 200 → the client shows original vs suggestion; nothing is persisted here. Apply is
    // a separate write through the note/project’s own route — the wand never writes.
    return c.json({ text: result.text })
  })

  return app
}
