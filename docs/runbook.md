# Hibana — Operator Runbook

> **P3-c (2026-09-10):** This runbook covers the operational procedures a solo operator
> (or a future teammate) needs to keep Hibana running safely. The bus factor is 1 —
> these docs make the system survivable if the primary operator is unavailable.

## Table of Contents
1. [Secret Rotation](#1-secret-rotation)
2. [Restore from Backup](#2-restore-from-backup)
3. [Incident Response](#3-incident-response)
4. [Deploy Procedure](#4-deploy-procedure)
5. [Monitoring & Alerting](#5-monitoring--alerting)
6. [Emergency: Lost Admin Access](#6-emergency-lost-admin-access)

---

## 1. Secret Rotation

### When to rotate
- **Immediately**: if a secret is leaked (committed to git, pasted in a chat, found in a screenshot)
- **Quarterly**: proactive rotation as hygiene
- **On team change**: when anyone with access leaves

### Secrets inventory

| Secret | Where it lives | How to rotate |
|---|---|---|
| `GITHUB_TOKEN` | Wrangler secret + `.secrets.env` | GitHub Settings → Developer settings → Tokens |
| `RESEND_KEY` | Wrangler secret + `.secrets.env` | Resend dashboard → API Keys |
| `TELEGRAM_BOT_TOKEN` | Wrangler secret + `.secrets.env` | @BotFather → `/revoke` |
| `TELEGRAM_SECRET` | Wrangler secret + `.secrets.env` | Generate a new random string |
| `CAPTCHA_SECRET_KEY` | Wrangler secret + `.secrets.env` | Generate a new random string |
| `BACKUP_ENCRYPTION_KEY` | Wrangler secret + offline backup | **CANNOT be rotated without re-encrypting all backups** — see below |
| `OWNER_EMAIL` | Wrangler var (not secret) | Wrangler dashboard or `wrangler.toml` |

### Rotation procedure (per secret)

#### GitHub PAT
1. Go to https://github.com/settings/tokens
2. Generate new token (classic) → scope: `repo` → expiration: 90 days
3. Copy the new token
4. Update the Worker secret:
   ```bash
   cd hibana-audit
   npx wrangler secret put GITHUB_TOKEN           # dev
   npx wrangler secret put GITHUB_TOKEN --env prod # prod
   # Paste the new token when prompted
   ```
5. Update `.secrets.env` locally (for `npm run secrets:set`)
6. Verify: `npx wrangler secret list` shows `GITHUB_TOKEN` bound
7. Revoke the old token at github.com/settings/tokens

#### Telegram Bot Token
1. Message @BotFather in Telegram
2. Send `/revoke` → select `@Hibana_PM_bot`
3. Copy the new token
4. Update the Worker secret:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN --env prod
   ```
5. Re-register the webhook (the old token's webhook is invalidated):
   ```bash
   curl -s "https://api.telegram.org/bot<NEW_TOKEN>/setWebhook" \
     -d "url=https://hibana.ir/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_SECRET>"
   ```

#### BACKUP_ENCRYPTION_KEY (special case)
**This key cannot be rotated without re-encrypting all existing backups.**
- Old encrypted backups are only decryptable with the OLD key
- New backups use the NEW key
- To rotate:
  1. Generate a new key: `openssl rand -base64 32`
  2. Save the OLD key somewhere safe (you need it to read old backups)
  3. Set the new key: `npx wrangler secret put BACKUP_ENCRYPTION_KEY --env prod`
  4. The next backup will use the new key
  5. To read an old backup: `BACKUP_ENCRYPTION_KEY=<OLD_KEY> node scripts/restore.mjs --file <old-snapshot.json>`
- **Keep both keys** until all old backups have aged out of retention (15 days)

---

## 2. Restore from Backup

### When to restore
- D1 database corruption
- Accidental data deletion beyond the 7-day soft-delete window
- Migration disaster (a bad migration destroyed data)

### Prerequisites
- `BACKUP_ENCRYPTION_KEY` (the key that was active when the backup was created)
- The backup file (from the `hibana-safe` GitHub repo, `backups/` directory)
- Wrangler auth (`npx wrangler login`) for D1 restore

### Recommended: Safe restore (canary verification)

**This is the recommended restore procedure.** It restores into DEV first,
verifies no data was lost, checks whether PROD has newer data the backup
would overwrite, and only then — with your explicit confirmation — restores
into PROD. **Zero risk to production data during the restore process.**

```bash
# 1. Find + download the right backup
gh api repos/assadigit/hibana-safe/contents/backups --jq '.[].name' | sort -r | head -10
gh api repos/assadigit/hibana-safe/contents/backups/<filename> --jq '.download_url' | xargs curl -sL -o snapshot.json

# 2. Set the encryption key (must match the key active when the backup was created)
export BACKUP_ENCRYPTION_KEY="<base64-key>"

# 3. Run the safe restore (canary)
npm run restore:safe -- --file snapshot.json

#    Or with flags:
#    npm run restore:safe -- --file snapshot.json --dry-run   # verify only, never touch PROD
#    npm run restore:safe -- --file snapshot.json --force     # skip the "yes" prompt
```

**What it does:**
1. Decrypts + parses the backup
2. Restores into `pm-app-dev` (sacrificial — PROD is untouched)
3. **Check A**: compares restored-DEV row counts vs backup file → "did the restore lose data?"
4. **Check B**: compares restored-DEV vs current PROD → "would this restore lose PROD data?"
5. Prints a summary table showing every table's row count across all three sources
6. If both checks pass, prompts "Type yes to restore into pm-app-prod"
7. Only on explicit "yes" → restores into `pm-app-prod`
8. Verifies PROD row counts match the backup after restore

**What the checks catch:**
- ✅ Restore bugs (Check A — restored-DEV doesn't match backup)
- ✅ Stale backups (Check B — PROD has more rows than the backup)
- ✅ Corrupted backups (decrypt fails or Check A fails)
- ✅ Operator error (the summary table shows you exactly what you're about to do)

### Fallback: Direct restore (faster, no verification)

Only use this if the safe restore is unavailable or you're restoring into a
fresh/empty database where there's no data to lose:

```bash
# ⚠️  This WIPES the target database with NO verification. Use restore:safe instead.
export BACKUP_ENCRYPTION_KEY="<base64-key>"
node scripts/restore.mjs --file snapshot.json --d1 pm-app-prod

# For local Node/SQLite restore:
# node scripts/restore.mjs --file snapshot.json
# (restores into DB_PATH or ./data/hibana.db)
```

### What restore does NOT do
- **Does NOT restore user passwords** (rule 8: `password_hash` is excluded from backups)
- **Does NOT restore sessions** (users must log in again)
- **Does NOT restore the admin account** — run `npm run seed:admin:prod` if the admin was lost

### Restore drill (test the procedure)
```bash
# Run a real drill: pulls the newest backup, verifies rule-8 (no password_hash),
# and round-trips synthetic data through the real buildSnapshot
npm run drill
```

---

## 3. Incident Response

### Severity levels

| Level | Definition | Response time |
|---|---|---|
| **P0** | App is down, data loss in progress | Immediate |
| **P1** | App degraded, no data loss | < 1 hour |
| **P2** | Bug affecting some users | < 1 day |
| **P3** | Cosmetic / minor | When convenient |

### P0: App is down

1. **Check `/api/health`**: `curl https://hibana.ir/api/health`
   - `503` → database issue (D1 outage or DB corrupted)
   - Timeout/no response → Worker crashed or Cloudflare issue
2. **Check Cloudflare dashboard**:
   - Workers → `hibana-prod` → Logs (real-time `wrangler tail`)
   - D1 → `pm-app-prod` → is there an outage?
3. **If Worker crashed**: redeploy
   ```bash
   cd hibana-audit
   npm run deploy:prod
   ```
4. **If D1 is corrupted**: restore from backup (see section 2)
5. **Notify users**: if downtime > 30 min, send a Telegram broadcast to linked users

### P0: Data loss in progress

1. **Stop the bleeding**: if a bad migration is destroying data, immediately redeploy the PREVIOUS version:
   ```bash
   git log --oneline -5  # find the last known-good commit
   git checkout <good-commit>
   npm run deploy:prod
   ```
2. **Assess the damage**: check D1 for missing rows
3. **Restore from the most recent backup** (see section 2)
4. **Post-mortem**: document what happened, why, and how to prevent it

### P1: App degraded (not down)

1. Check `wrangler tail` for error patterns
2. Check `/api/health` — is `db: "up"`?
3. Check Resend quota: `GET /api/admin/email` (owner-only) — are we quota-exhausted?
4. Check GitHub API rate limits: the backup cron uses the Contents API
5. If rate-limited, wait — the limits reset hourly

### Security incident (suspected breach)

1. **Rotate ALL secrets immediately** (see section 1)
2. **Check access logs**:
   - Cloudflare dashboard → Workers → Analytics (for API traffic)
   - GitHub: `gh api repos/assadigit/hibana-safe/commits` (was data exfiltrated?)
   - Telegram: check bot webhook info for unexpected changes
3. **Check for unauthorized users**: `GET /api/admin/users` (owner-only)
4. **If data was exfiltrated**: the backup encryption key protects the GitHub backups, but D1 itself is not encrypted at rest. Consider whether user data was accessed.
5. **Document the incident** for affected users (if any PII was exposed)

---

## 4. Deploy Procedure

### Pre-deploy checklist
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (192+ tests)
- [ ] `npm run smoke` passes
- [ ] `npm run check-cache-bust` passes (if JS/CSS changed)
- [ ] No secrets in the diff: `git diff --staged | grep -iE 'ghp_|re_|bot[0-9]+:|cfut_'`

### Deploy to PROD
```bash
cd hibana-audit

# 1. Build assets (bundles + hashes JS/CSS, generates fabric shim)
npm run build

# 2. Deploy to Cloudflare Workers (prod)
npm run deploy:prod
# This runs: node scripts/build.mjs --prod && wrangler deploy --env prod

# 3. If migrations changed, apply them:
npx wrangler d1 migrations apply pm-app-prod --remote
# ⚠️  NEVER run untested migrations against prod. Test on dev first.

# 4. Verify
curl https://hibana.ir/api/health
# Log in and click through the main flows
```

### Deploy to DEV (for testing)
```bash
npm run deploy  # deploys to the dev worker (hibana)
# Test at https://hibana.aliassadi.workers.dev
```

### Rollback
Cloudflare Workers doesn't have built-in rollback. To roll back:
```bash
git checkout <last-known-good-commit>
npm run deploy:prod
```
If a bad migration was applied, you must restore from backup (see section 2) — you cannot roll back a D1 migration.

### Post-deploy verification
1. `curl https://hibana.ir/api/health` → `{"ok":true,...}`
2. Log in, check the dashboard loads
3. Check the admin console (`/admin.html`) loads and shows user list
4. If canvas/whiteboard changed: test at `/canvas.html` and `/whiteboard.html`
5. Watch `wrangler tail` for 5 minutes for any error spikes

---

## 5. Monitoring & Alerting

### What's monitored
| Signal | How | Alert via |
|---|---|---|
| App uptime | External monitor (UptimeRobot/Better Stack) hitting `/api/health` every 5 min | Email + Telegram webhook |
| Backup failure | `scheduledBackup` catches errors + sends Telegram message to linked owners | Telegram bot |
| DB unreachable | `/api/health` returns 503 | External monitor |
| Resend quota | `GET /api/admin/email` shows `sent_today` / `limit` | Manual check (admin console) |

### Setting up external monitoring
See `docs/uptime-monitoring.md` for step-by-step UptimeRobot/Better Stack setup.

### What's NOT monitored (gaps)
- **No error tracking** (no Sentry/Logflare) — errors are only visible in `wrangler tail`
- **No D1 query performance monitoring** — slow queries are invisible
- **No GitHub API rate limit monitoring** — the backup cron could hit rate limits silently

---

## 6. Emergency: Lost Admin Access

### Scenario: you can't log in (forgot password, admin account corrupted)

#### Step 1: Seed a new admin
```bash
cd hibana-audit

# Seeds a new super-admin into PROD
npm run seed:admin:prod
# Prints: username: admin-<random>, password: <strong-random>
# ⚠️  Save these credentials immediately — they're only shown once
```

#### Step 2: Log in + change password
1. Go to `https://hibana.ir/login`
2. Log in with the printed credentials
3. Go to Settings → Change password
4. Set a memorable password

#### Step 3: Disable the emergency admin
The `seed:admin` script creates a NEW admin user — it doesn't replace the old one.
If the old admin account is still in the DB (just inaccessible), consider:
- Demoting it to `member` via the admin console
- Or deleting it if it's truly orphaned

### Scenario: D1 is completely empty (fresh start)
```bash
# 1. Apply all migrations
npx wrangler d1 migrations apply pm-app-prod --remote

# 2. Seed the admin
npm run seed:admin:prod

# 3. Log in and reconfigure (invites, settings, etc.)
```

---

## Quick Reference

| Task | Command |
|---|---|
| Deploy to prod | `npm run deploy:prod` |
| Deploy to dev | `npm run deploy` |
| Run locally | `npm run dev` |
| Run tests | `npm run test` |
| Run smoke test | `npm run smoke` |
| Typecheck | `npm run typecheck` |
| Build assets | `npm run build` |
| Seed admin (prod) | `npm run seed:admin:prod` |
| Restore backup (safe) | `BACKUP_ENCRYPTION_KEY=<key> npm run restore:safe -- --file <snap.json>` |
| Restore backup (direct) | `BACKUP_ENCRYPTION_KEY=<key> node scripts/restore.mjs --file <snap.json> --d1 pm-app-prod` |
| Run restore drill | `npm run drill` |
| Set secrets | `npm run secrets:set:prod` |
| Check health | `curl https://hibana.ir/api/health` |
| Tail prod logs | `npx wrangler tail --env prod` |
| Apply migrations (prod) | `npx wrangler d1 migrations apply pm-app-prod --remote` |
