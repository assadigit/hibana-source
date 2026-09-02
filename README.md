# Hibana

Personal project & idea manager — "a safe for my ideas."

- **Rules for coding agents:** `CLAUDE.md` (non-negotiable)
- **Full spec:** `pm-app-spec.md` · **Why:** `vision.md`
- **Deployment (Cloudflare or any server):** `DEPLOY.md`
- **What's built:** `CHANGELOG.md` · **What's next:** `ROADMAP.md` (start new work here)

## Quick start

```bash
npm install
npm run dev        # wrangler dev — http://localhost:8787
```

## Verify before calling a phase done

```bash
npm test            # 65 vitest cases (local, no Cloudflare account needed)
npm run typecheck   # authoritative tsc --noEmit
npm run smoke       # 19-request in-process end-to-end
npm run drill       # P0 restore drill (needs GITHUB_TOKEN in .secrets.env)
```

## Ops scripts (never print values — read creds in-process via scripts/lib.mjs)

| Command | Purpose |
|---|---|
| `npm run deploy` / `npm run deploy:prod` | Ship to the dev / prod worker |
| `npm run migrate:node` | Apply migrations to local SQLite |
| `npm run restore -- --file <snap>` | Restore a backup snapshot into local SQLite (`--d1 pm-app-*` for D1) |
| `npm run seed:admin[:prod\|:node]` | Create/print the super-admin login once |
| `npm run secrets:set` (+ `:prod`) | Push `.secrets.env` values as Workers secrets |
| `node scripts/test-email.mjs` (+ `--prod`) | Live worker→Resend send check |
| `node scripts/check-emails.mjs --send` | Direct Resend send + delivery status (sending-only key) |
| `node scripts/always-https.mjs --on` | Flip the zone's "Always Use HTTPS" (needs settings-scoped token) |
| `node scripts/zone.mjs` / `custom-domain.mjs` | Zone / custom-domain status & attach |
| `node scripts/browser-check.mjs` (`HIBANA_PASS=…`) | Live headless-Chrome/CDP UI check |
