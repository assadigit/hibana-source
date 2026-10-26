# Hibana Autopilot — RUNBOOK (deploy, backup, rollback)

> The operational commands behind the PLAYBOOK §3 "Ship Gate". Everything here was
> verified against the real toolchain this phase (wrangler 4.149.0; command syntax
> checked via `--help`, live behavior checked during the Phase 0 deploy drill).
> Credentials: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` from the environment
> or the gitignored `.secrets.env` — never printed, never committed.

## Environments

| Target | Worker | URL | D1 | KV (HIBANA_SHOTS) |
|--------|--------|-----|----|--------------------|
| dev | hibana (default env) | https://hibana.aliassadi.workers.dev | pm-app-dev | 7c6eb81b…899 |
| prod | hibana --env prod | https://hibana.ir | pm-app-prod | 1a64052f…567 |

## The Ship Gate (per PLAYBOOK §3 — every phase)

1. **Local gates**: `npm run verify` (typecheck + eslint 0-warnings + vitest + build + portability check) — must be green.
2. **Both-runtime parity**: `npm run test:workers` (miniflare via wrangler dev --local) + `npm run smoke`.
3. **Merge**: phase branch → main (fast-forward or merge commit; NEVER force-push), push main. CI runs on the push; CD auto-deploys dev→prod after CI green (workflow_run-gated, stale-CI-guarded).
4. **DB safety (only if the phase added migrations)**: backup FIRST (below), then apply to dev, smoke, then prod. Migrations must be additive/expand-only. Never DROP/TRUNCATE/bulk-DELETE user data.
5. **Deploy dev + smoke**: `npm run deploy` (the project's own script: build --wire-html → check-dist-wiring → wrangler deploy → --restore-html; confirm `git status` clean after). Then `npm run smoke:remote -- --target dev` and `npm run shotcheck:dev`.
6. **Deploy prod + smoke** (only if step 5 passed): `npm run deploy:prod`, then `npm run smoke:remote -- --target prod` and `npm run shotcheck:prod`.
7. **Tag**: `git tag autopilot-phase-<N>-done && git push origin autopilot-phase-<N>-done`; update STATE.md/REPORT.md; commit + push.

## Backup commands

### Pre-migration / pre-deploy D1 export (the Ship Gate step 4 backup)

```bash
# dev — into an untracked, git-ignored local folder
mkdir -p backups && npx wrangler d1 export pm-app-dev  --remote --output backups/pm-app-dev-$(date -u +%Y%m%d-%H%M).sql
# prod
mkdir -p backups && npx wrangler d1 export pm-app-prod --remote --output backups/pm-app-prod-$(date -u +%Y%m%d-%H%M).sql
```

(`backups/` is gitignored; verify with `git check-ignore backups/x.sql` before relying on it.)

### The app's own backup system (always-on)

- Cron on the deployed Workers (4× daily) exports D1 → the private GitHub repo `assadigit/hibana-safe` (encrypted; excludes `users.password_hash` + the `sessions` table). Manual trigger: `POST /api/admin/backup` (owner session).
- Restore tooling: `npm run restore -- --file <snapshot>` (add `--d1 pm-app-dev|pm-app-prod` for D1 targets); `npm run restore:safe` (Plan B); restore drills: `npm run drill` / `npm run drill:planb`.
- Pre-migration bookmark ritual: `npm run bookmark:dev` / `npm run bookmark:prod` (writes Changelogs §9).

## Rollback commands

### Workers code rollback (no DB change)

```bash
# list recent deployments, find the last-good version id
npx wrangler deployments list            # dev
npx wrangler deployments list --env prod # prod
# roll the code back to that version
npx wrangler rollback <version-id>             # dev
npx wrangler rollback <version-id> --env prod  # prod
```

Alternative (equally valid): redeploy the last good tag —
`git checkout <last-good-tag> && npm run deploy[:prod]`.

### After a rollback: re-run smoke to confirm recovery

```bash
npm run smoke:remote -- --target dev   # or prod
curl -s https://hibana.ir/api/health | grep '"ok":true'
```

### D1 data rollback (only if a migration went wrong)

Prefer the forward-fix path (additive migrations are expand-only). If data must be
restored: `npm run restore -- --file backups/pm-app-<env>-<ts>.sql --d1 pm-app-<env>`,
or the app's own snapshot from `assadigit/hibana-safe`. NEVER drop/truncate on the
live DB (PLAYBOOK §7 hard stops).

## Remote smoke + storage round-trips

```bash
npm run smoke:remote -- --target dev    # Ship Gate smoke vs the deployed dev URL
npm run smoke:remote -- --target prod
npm run shotcheck:dev                   # live upload → render → delete (KV round-trip)
npm run shotcheck:prod
```

Both scripts seed + purge their own clearly-named throwaway probe users
(`zz-autopilot-smoke+…` / `zzprobe+…@hibana.local`) directly in the target D1 and
assert users row-count parity on exit. The owner's real account is never touched.

## Known-good states (update after every Ship Gate)

- Phase 0: dev + prod running `autopilot-phase-0-done` (commit recorded in STATE.md).
