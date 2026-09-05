# Hibana — Agent Working Rules

These rules govern how AI coding agents work on Hibana. **Read them before starting any task.**
Canonical project rules: `CLAUDE.md` (non-negotiable). Reasoning: `vision.md`. Deploy: `DEPLOY.md`.
This file adds **workflow + behavioral** rules on top of `CLAUDE.md`. Where the two conflict,
`CLAUDE.md` wins on architecture/security; this file wins on cadence + communication style.

---

## Workflow rules

### 1. Commit to GitHub after every modification
After each modification — hotfix, feature, or big change — commit to the source repo
`assadigit/hibana-source` and push. Tag the version (e.g. `v0.1.8`) when the change is
user-facing. Commit message format: `<area>: <change> — <one-line why>`.

**Never commit secrets.** `credentials.md`, `.secrets.env`, `.dev.vars`, `.admin.secrets`
are gitignored — but **verify with `git status` before every commit** that none of them
are staged. If a secret file IS staged, unstage it (`git restore --staged <file>`) and
re-check before committing. A leaked token in git history is effectively permanent.

### 2. Compile a full-project zip after every phase (every few hotfixes)
After a phase — a few hotfixes that form a coherent unit, or a feature-complete milestone —
bump `package.json` version, then compile a full-project zip to
`/home/z/my-project/upload/Hibana-Alpha-V<version>.zip`.

**Include:** `src/`, `migrations/`, `public/`, `scripts/`, all docs (`*.md`), `package.json`,
`package-lock.json`, `bun.lock`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`,
`.gitignore`, `.dev.vars.example`, `.secrets.env.example`, **`credentials.md`** (the owner
stores the zip on their PC for personal reference; this is the ONLY artifact that carries
live credentials).

**Exclude:** `node_modules/`, `.wrangler/`, `.dev.vars`, `.secrets.env`, `.admin.secrets`,
`*.log`, `coverage/`, `dist/`, `data/`, `.git/`, `cookies.txt`, `*.cookies`, `*.sql.tmp`,
`dashboard-check.png`.

**⚠️ Zip-handling rule (critical):** the zip contains live credentials. The owner stores it
on their PC. **Never re-upload a credentials-carrying zip into chat** (it would put tokens
into chat history — same as pasting them). A fresh-sandbox agent gets credentials from the
session prompt, not from a re-uploaded zip.

### 3. Ask to clear ambiguities; assume + proceed only when reversible
- **Ask** when: a request is ambiguous AND high-stakes (deploy, delete, schema change,
  public commit, irreversible action); or multiple reasonable interpretations exist with
  very different outcomes.
- **Assume + proceed** when: information is missing but the path is reversible and low-risk.
  Label the assumption explicitly ("Assuming X, proceeding…") and revisit if it breaks.
- **Never** present an assumption as a fact.

---

## Working principles

Prioritize **accuracy and logic**. Acknowledge uncertainty, distinguish facts from
assumptions and inferences, and **never invent details**. Think deeply about the
underlying objective, not just the literal request. Proactively identify blind spots,
ambiguities, flawed premises, risks, trade-offs, and better alternatives when useful,
without adding unnecessary complexity. Use first-principles reasoning where appropriate.

**Do not agree just to be agreeable.** If the user is wrong, say so directly and explain
why. Prioritize truth and accuracy over comfort. When information is missing, make clearly
labeled reasonable assumptions and proceed when possible. Ask questions only when necessary.
Never present assumptions as facts.

---

## Credentials — where to find them, how to use them

`credentials.md` (**gitignored**, in this tree) holds the live GitHub / Cloudflare / Telegram
tokens + the dev test-admin login. Read it when you need to deploy, back up, verify, or
push to git. **Never echo the values in chat, never commit the file, never include it in a
zip.** If a token has been rotated, update `credentials.md` AND ` /home/z/.hibana-secrets.env`
AND the Cloudflare Worker secrets (`wrangler secret put <NAME> --env prod`).
