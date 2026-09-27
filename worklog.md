# Hibana — Session Worklog (durable handover)

> Purpose: the sandbox-local session journal, **committed to git** so a fresh clone
> inherits the handover (S156 was lost to a sandbox reset once — never again).
> Append per session; never overwrite. NEVER put credentials/tokens in this file —
> the owner supplies them per-session; `credentials.md` is gitignored.
> The durable per-release record lives in `Changelogs.md` (§1 = the 4-block chain,
> §2 = the full session index). This file is the working memory between sessions.

---

Task ID: wrap-up
Agent: Z.ai (closing session of the v0.3.8x line)
Task: wrap up the project — commit everything to GitHub, confirm the latest deploy to Cloudflare is live, leave the repo self-contained for a fresh-clone session.

Work Log:
- Verified the two outstanding owner reports were ALREADY shipped (the compaction summary was stale):
  - S156 / v0.3.88.0 — board-page overflow (`.clip-2` overflow-wrap:anywhere + min-inline-size:0 belt) + the "No tasks yet" empty state centered (`.pd-board-empty` justify-items:center + text-align:center).
  - S157 / v0.3.89.0 — headings dropped a weight: `--text-h1-weight`/`--text-h2-weight` 600→500, base h4 600→500, the dead `.precent-head h2` 700→token, markdown-reader h1/h2/h3 onto the tokens. S106 owner-approved bold labels deliberately untouched.
- Verified the full S157 chain was complete: feature 2c2c8e2 + docs 681a443 pushed; CI run 36328343741 + CD run 36329135572 green; tag v0.3.89.0 on remote; zip hibana.0.3.89.0.zip (536 entries) in /home/z/upload/; Changelogs §1 exactly 4 blocks (S157→S156→S155→S154); package.json 0.3.89.0.
- Live spot byte-verify on hibana.ir: variables.5befc2ab.css, dashboard.192ccc19.css, quicknotes.3a8eb154.css all sha-identical to local public/dist/; /api/health ok (prod, schema 60, kv).
- Committed the three untracked release helpers → **91408b1** ("chore: track the release-chain helpers — repo self-contained for a fresh clone"): make-zip.mjs (the per-version zip generator) + rotate-s156.mjs/rotate-s157.mjs (§1 rotation recipes). Secret-scanned (clean). CI run 36339304859 + CD run 36340121882 green on the push; CD redeployed the same bits to Cloudflare successfully.
- Wrote this worklog.md and committed it so the fresh clone starts with full context.

Stage Summary:
- Repo state: main @ worklog commit, working tree clean, everything on https://github.com/assadigit/hibana-source, tags through v0.3.89.0 on remote.
- Live: hibana.ir serves v0.3.89.0 (byte-verified). Deploy = push to main → GitHub Actions CD (Cloudflare Workers, KV storage, schema 60).
- Next session's owner directive: **fix UI/UX quirks + work on the ideas (sparks) pages.**
- Sparks pointers: `public/sparks.html` (page shell), `src/routes/projects/index.ts` + `src/routes/projects/helpers.ts` (server render + folder chips `data-sf`), `src/routes/projects/detail-helpers.ts`; e2e lessons from S156 in `e2e/s156-card-overflow.spec.ts` (the flat shelf = /sparks.html + click `[data-sf="all"]`; `/projects.html?status=spark` is NOT the ideas card surface; `?folder=all` is not honored on hard load). Sparks e2e precedent: `e2e/s120-draft-flush-sel.spec.ts`.
- Standing law: **Agents.md is non-negotiable** (verification ladder, `?v=` cache-bust on every touched CSS/JS, EN+FA i18n parity, design tokens only — hex/rgba only inside CSS custom properties, RTL logical properties, reduced-motion support, the §7 REJECTED list is never re-proposed). Typography: General Sans 400/500/600 (700 reserved), weights via `--text-*` tokens. Never leave a round half-shipped: commit → CI+CD green → byte-verify live → tag → make-zip.mjs → Changelogs §1 rotation (exactly 4 blocks) + §2 row → worklog.
- Ops creds (repo, CF, Telegram, healthcheck, Workers AI, test account) come from the owner's prompt each session — never commit them.
