# Hibana

Personal project & idea manager — "a safe for my ideas."
EN/FA bilingual (RTL/LTR) · Jalali + Gregorian · Cloudflare Workers (D1) or plain Node 24+ (SQLite).

- **Agent rules (read first):** `Agents.md`
- **History · current state · ops runbook · open items:** `Changelogs.md`
- **Deployment:** `Changelogs.md` §4 (Cloudflare default; Node self-host path included)

## Quick start

```bash
npm install
npm run dev        # wrangler dev — http://localhost:8787
```

## Verify before calling a phase done

```bash
npm test           # 244 vitest cases (local, no Cloudflare account needed)
npm run typecheck  # authoritative tsc --noEmit
npm run smoke      # 19-request in-process end-to-end
npm run drill      # P0 restore drill (needs GITHUB_TOKEN in .secrets.env)
```

Credentials live in `credentials.md` (gitignored, local-only). Never commit secrets.
