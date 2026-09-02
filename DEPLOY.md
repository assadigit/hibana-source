# Deploying Hibana

Two supported targets from one codebase. Cloudflare is the current host (free tier);
the Node target exists so the app can move anywhere without a rewrite (hard requirement).

## Option A — Cloudflare (default)

1. Prereqs: Node 20+, `npm install`, and `npx wrangler login`.
2. Create the two databases, then paste the ids into `wrangler.toml`:
   - `npx wrangler d1 create pm-app-dev` → `database_id` (top-level)
   - `npx wrangler d1 create pm-app-prod` → `database_id` (`[env.prod]`)
3. Set `GITHUB_OWNER` in `wrangler.toml` (your GitHub username).
4. Secrets (rule 5): `npx wrangler secret put GITHUB_TOKEN` and
   `npx wrangler secret put GITHUB_TOKEN --env prod`.
   For local dev only: copy `.dev.vars.example` → `.dev.vars` and fill in.
5. Migrations: `npx wrangler d1 migrations apply pm-app-dev --local` (dev database
   used by `wrangler dev`), then `--remote` when you're ready to touch the live dev DB.
   Production: `npx wrangler d1 migrations apply pm-app-prod --remote` — never run
   untested migrations against prod.
6. Create your super-admin (Q3 decision): `npm run seed:admin` (dev) or
   `npm run seed:admin:prod` (prod). Save the printed credentials.
7. Run locally: `npm run dev` → http://localhost:8787 — log in with the admin credentials,
   then hit the "GitHub pipeline ping" button on the shell page.
8. Deploy: `npm run deploy` (uses dev DB) or `npm run deploy:prod`. Attach the custom
   domain (pm.sedanama.com) in the Cloudflare dashboard → Workers → Routes.

## Option B — Any server (Node + SQLite)

Requires Node 24+ (uses the built-in `node:sqlite` module — zero native dependencies).

1. `npm install`
2. Environment variables:
   ```
   DB_PATH=./data/hibana.db
   GITHUB_OWNER=your_github_username
   GITHUB_REPO=hibana-safe
   GITHUB_TOKEN=ghp_...
   RESEND_KEY=re_...
   NODE_ENV=production
   ```
3. `npm run migrate:node` — applies the same numbered migrations to local SQLite.
4. `npm run seed:admin:node` — creates the super-admin (prints credentials once).
5. `npm run start:node` — serves the app (static files + API) on port 3000.
6. Point any reverse proxy (caddy, nginx, apache) at `127.0.0.1:3000` with HTTPS.
   No build step; no Cloudflare account required anywhere in this path.

## Backups (database protection)
- Structured data is exported as versioned JSON snapshots (`schema_version` field,
  excludes `users.password_hash` and `sessions`) and committed to the GitHub assets repo
  by a scheduled cron once Phase 1 lands.
- Restore: `npm run restore -- --file snapshot.json --db <path-or-D1-name>` (manual, per spec §10).
- Screenshots/changelogs already live in GitHub, which versions them for free.
