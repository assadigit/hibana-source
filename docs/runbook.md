# Hibana — Operator Runbook

> **P3-c (2026-09-10):** This runbook covers the operational procedures a solo operator
> (or a future teammate) needs to keep Hibana running safely. The bus factor is 1 —
> these docs make the system survivable if the primary operator is unavailable.

## Table of Contents
1. [Secret Rotation](#1-secret-rotation) — incl. encryption-key custody checklist (v0.3.0)
2. [Restore from Backup](#2-restore-from-backup)
2b. [Restore from Plan B (Telegram)](#2b-restore-from-plan-b-telegram)
2c. [Restore via D1 Time Travel](#2c-restore-via-d1-time-travel-point-in-time--v030)
3. [Incident Response](#3-incident-response)
4. [Deploy Procedure](#4-deploy-procedure) — incl. the pre-migration bookmark ritual
5. [Monitoring & Alerting](#5-monitoring--alerting) — incl. dead-man's switch setup
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
| `TELEGRAM_BOT_TOKEN` | Wrangler secret + `.secrets.env` | @BotFather → `/revoke` (safe for Plan B history — §2b) |
| `TELEGRAM_SECRET` | Wrangler secret + `.secrets.env` | Generate a new random string |
| `CAPTCHA_SECRET_KEY` | Wrangler secret + `.secrets.env` | Generate a new random string |
| `BACKUP_ENCRYPTION_KEY` | Wrangler secret + offline backup | **CANNOT be rotated without re-encrypting all backups** — see below |
| `HEALTHCHECK_PING_URL` | Wrangler secret (prod only) | healthchecks.io → check settings → regenerate URL (v0.3.0, §5) |
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

### Encryption-key custody (liveness) checklist — v0.3.0

**The blunt fact:** every encrypted backup on BOTH channels is only as alive as the
offline copy of `BACKUP_ENCRYPTION_KEY`. Cloudflare-account death + key loss = every
backup is random bytes forever. Rotation is impossible without re-encrypting everything,
so *custody*, not rotation, is the mitigation — and custody is a PEOPLE risk (bus factor).

1. **Two independent offline locations** — e.g. printed in the safe AND in a password
   manager on a device that is not the laptop the repo lives on. NOT on any cloud that
   shares a fate with Cloudflare/GitHub. NOT `.secrets.env` alone (machine-local).
2. **Quarterly drill (the liveness test):**
   ```bash
   BACKUP_ENCRYPTION_KEY=<offline copy> npm run drill        # GitHub channel
   BACKUP_ENCRYPTION_KEY=<offline copy> npm run drill:planb  # Telegram channel
   ```
   A key that has never decrypted anything is a hope, not a key. This also regression-
   tests the exact writer/reader drift bug class fixed on 2026-09-11 (three file shapes).
3. **If the drill fails with `decrypt` errors**: treat it as **P1** — all backups are
   effectively lost. While the Worker still runs, see the lost-key recovery path below.
4. **Lost-key recovery path** (the asymmetry worth memorizing):
   - Worker still running: immediately (a) export data via the app's own export API
     (Settings → export), (b) set a NEW `BACKUP_ENCRYPTION_KEY` secret — fresh backups
     become readable again; old ones are forfeit.
   - Worker gone too: the data is gone. That asymmetry is why this checklist exists.

---

## 2. Restore from Backup

### When to restore
- D1 database corruption
- Accidental data deletion beyond the 7-day soft-delete window
- Migration disaster (a bad migration destroyed data)

> **v0.3.0:** for corruption / bad-migration / mass-delete scenarios where **D1 itself is
> still alive**, check §2c (D1 Time Travel) FIRST — minute-granularity point-in-time
> recovery, no file handling, works even if no snapshot was taken. The snapshot paths
> below remain the answer when D1 is destroyed/unavailable.

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
```

> **Format note (2026-09-11):** the file you download this way is the **raw-binary
> HIBENC1 blob** (the GitHub Contents API decodes the base64 we PUT before storing).
> `restore.mjs` handles this shape natively since the 2026-09-11 fix — before that, the
> binary file crashed `JSON.parse` (every encrypted GitHub backup since C3 was affected).
> All three shapes — raw-binary, base64-text (Telegram Plan B documents), legacy
> plaintext JSON — are auto-detected by `scripts/lib-backup.mjs`, shared by every
> restore path.

```bash
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

## 2b. Restore from Plan B (Telegram)

> **v0.2.0 (migration 0044, 2026-09-11):** Hibana now has a SECOND backup channel. On the
> same 4×/day tick, the worker also pushes the encrypted snapshot as a Telegram document
> to every opted-in owner's chat. Full design: `docs/perf-and-data-safety.md` §1.
> **The document is byte-identical in format to a GitHub snapshot file** (base64 of the
> HIBENC1 AES-GCM blob), so the SAME `restore.mjs` / `restore:safe` machinery handles it.

### What's in the chat

- Files named `hibana-backup-<UTC-timestamp>.bin` (the encrypted snapshot, ~100 KB).
- One line under each file: `🗄 Hibana backup (Plan B) · schema … · sha256 <hash> · …`.
- The NEWEST backup is **pinned** at the top of the chat.
- Retention: newest ~60 documents are kept (≈ 15 days, matching the GitHub channel).

### Which channel should I restore from? (decision tree)

```
Is D1 damaged/lost?
├─ NO, but I need an older copy (bad migration, accidental delete beyond 7 days)
│    → TIME TRAVEL FIRST (§2c, v0.3.0): minute-granularity, in-place, no files —
│      this is exactly the failure class it exists for. Use the pre-migration
│      bookmark from dr-bookmarks.md if you made one; otherwise --timestamp.
│    → If the damage is older than 30 days: PRIMARY (GitHub) snapshot, §2.
│
├─ YES, and GitHub still works
│    → Still PRIMARY: newest snapshot + canary verification. Use §2.
│      (Plan B is the same data, same encryption — GitHub is simply faster to list.)
│
└─ YES, and GitHub is ALSO unavailable / compromised / token lost
     → PLAN B (this section): the Telegram documents are independent of both
       Cloudflare AND GitHub. Zero data loss up to the last 4×/day tick.
```

**Zero-loss window:** both channels snapshot at 03:17 / 09:17 / 15:17 / 21:17 UTC.
Worst-case data loss from a D1 destruction = time since the last tick (≤ 6 hours),
independent of which channel you restore from.

### Automated drill (verify the channel end-to-end — run periodically)

```bash
# Requires in .secrets.env (or env): TELEGRAM_BOT_TOKEN, BACKUP_ENCRYPTION_KEY,
# CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID, optional prod DB override).
# Reads the newest planb_backups row from prod D1 → downloads the document via the
# Bot API → verifies sha256 + HIBENC1 → decrypts → checks rule 8 → round-trips the
# snapshot through the REAL restore.mjs into a scratch SQLite DB.
npm run drill:planb
```

The drill is **read-only** against prod (nothing is sent or deleted); it never prints
secrets or snapshot contents.

### Manual restore (works with ZERO Cloudflare/GitHub/D1 access)

This is the true disaster path: D1 gone, GitHub gone, only Telegram + your offline key left.

1. **Get the file** — open the bot chat (@Hibana_PM_bot), find the pinned
   `hibana-backup-…bin` (newest), tap it, **Download** / save it.
2. **Verify integrity (optional but recommended)** — the caption under the file carries
   its sha256:
   ```bash
   sha256sum hibana-backup-….bin    # compare with the sha256 in the caption
   ```
3. **Restore** — the file is the same format `restore.mjs` expects:
   ```bash
   BACKUP_ENCRYPTION_KEY=<base64-key> node scripts/restore.mjs --file hibana-backup-….bin --d1 pm-app-prod
   # or the canary path (recommended when anything at all is still alive):
   BACKUP_ENCRYPTION_KEY=<base64-key> npm run restore:safe -- --file hibana-backup-….bin
   ```
4. **Post-restore** — same as §2: no passwords/sessions are restored (rule 8); re-seed the
   admin on a fresh database (`npm run seed:admin:prod`) and re-link your Telegram chat.

### Plan B facts an operator must know

- **The key is the SAME one** (`BACKUP_ENCRYPTION_KEY`) — rotating it would orphan every
  backup on BOTH channels. Do not rotate it casually (see §1).
- **Opt-in lives in the bot**: ⚙️ Settings → 🗄 Backup to this chat (owner-only). If the
  row of buttons is gone, send `/menu` → ⚙️ Settings.
- **telegram_paused does NOT pause Plan B** — pausing reminder noise must never silently
  disable the disaster-recovery channel.
- **Rotating the bot token is safe for history**: `@BotFather /revoke` re-issues a token
  for the SAME bot; old documents remain in the chat and `getFile` keeps working with the
  new token. Deleting/recreating the bot (a NEW bot) is the only thing that orphans old
  file_ids for API access — and even then the chat files remain manually downloadable.
- **Manual trigger** (e.g. right before risky maintenance):
  ```bash
  # as the owner (session cookie), or from the app:
  curl -X POST https://hibana.ir/api/admin/backup/planb   # owner-only
  ```
- **Failure alerting**: a failed Plan B push logs `planb_failed` and emails the owner
  (via Resend — deliberately NOT via Telegram, which may itself be down).

---

## 2c. Restore via D1 Time Travel (point-in-time) — v0.3.0

> **First choice for corruption / bad migration / mass delete when D1 is ALIVE.**
> Time Travel is D1's built-in continuous undo log: restore to any point in the last
> **30 days** at minute granularity — no backup files, no decryption, no re-seeding. It
> works even if no snapshot was ever taken, and it covers damage noticed up to 30 days
> back (the snapshot channels keep 15 days live).

### Facts an operator must know (verified on wrangler 4.7)

- Commands live under `wrangler d1 time-travel`:
  - `info <db> [--timestamp <unix|RFC3339>] --json` → returns a **bookmark** for that
    moment (read-only, instant — used by the pre-migration ritual).
  - `restore <db> --bookmark <id> | --timestamp <t>` → restores **IN PLACE**.
- **Restore is destructive to CURRENT state** — the database as it is right now is
  overwritten by the point-in-time copy. Bookmark FIRST if anything in the current
  state matters (it usually does — that's the evidence).
- It lives inside Cloudflare's D1 → **unavailable in exactly the scenarios where the
  GitHub/Telegram snapshot channels are the only option** (account compromise/billing,
  regional catastrophe). That's why it's channel #3, not channel #1: different failure
  class, fastest recovery.
- Time Travel retention: **30 days** rolling.

### The pre-migration ritual (mandatory before applying migrations)

```bash
cd hibana-audit
npm run bookmark:prod        # creates + records a bookmark (dr-bookmarks.md)
npx wrangler d1 migrations apply pm-app-prod --remote
```

`bookmark:prod` (scripts/pre-migrate-bookmark.mjs) appends one line — UTC time,
bookmark id, schema version, reason — to `dr-bookmarks.md` at the repo root. Bookmark
IDs are not secrets. If the migration goes wrong:

```bash
npx wrangler d1 time-travel restore pm-app-prod --bookmark <id-from-dr-bookmarks.md>
```

### Restoring to an arbitrary timestamp (no bookmark made)

```bash
# 1. Find the exact moment (must be ≤ 30 days ago)
npx wrangler d1 time-travel info pm-app-prod --timestamp 2026-09-11T11:30:00Z --json
#    → {"bookmark":"00000…"}

# 2. Restore to it (destructive — current state is overwritten)
npx wrangler d1 time-travel restore pm-app-prod --bookmark 00000…
#    (or --timestamp directly on restore)
```

### After a Time Travel restore

- Sessions/passwords are restored *as they were* at that moment (this is a raw database
  copy, not a rule-8 snapshot) — users may need to re-login if their session was created
  after the restore point. The seed-admin procedure is NOT needed (unlike snapshot
  restores) unless the restore point predates the admin's creation.
- Verify: `curl https://hibana.ir/api/health` → `schema_version` should match the
  pre-migration schema (from `dr-bookmarks.md`).
- **Then make a fresh bookmark + trigger a backup** so the snapshot channels catch up:
  `curl -X POST https://hibana.ir/api/admin/backup` (owner session).

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
- [ ] `npm run test` passes (220+ tests)
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
# This runs: build --prod --wire-html (rewrites HTML to hashed /dist/ URLs, canonical
#             HTML backed up) + check-dist-wiring (deploy gate) + wrangler deploy
#             + restore-html (working tree back to the ?v= source form)

# 3. If migrations changed — BOOKMARK FIRST (§2c), then apply:
npm run bookmark:prod
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
If a bad migration was applied: **restore via D1 Time Travel (§2c)** — bookmark first if
the current state holds anything worth keeping, then `time-travel restore --bookmark` to
the pre-migration bookmark in `dr-bookmarks.md`. Snapshot restore (§2) is the fallback
when D1 itself is unavailable.

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
| **Backup cron liveness (dead-man's switch)** — v0.3.0 | Prod cron pings a healthchecks.io URL on every successful 4×/day backup tick; `/fail` on a failed/skipped backup | **healthchecks.io email (independent of CF + Resend)** — alerts after 2 missed ticks (12 h) |
| Backup failure | `scheduledBackup` catches errors + sends Telegram message to linked owners | Telegram bot |
| DB unreachable | `/api/health` returns 503 | External monitor |
| Resend quota | `GET /api/admin/email` shows `sent_today` / `limit` | Manual check (admin console) |
| **Runtime errors** — v0.3.0 | `error_log` table (migration 0045): unhandled throws + ApiErrors, 7-day retention | **Admin console → Errors tab** (owner-only); `GET /api/admin/errors` |

### Dead-man's switch setup (healthchecks.io) — one-time, ~5 minutes

1. Create a free account at https://healthchecks.io (or self-host — but then it must run
   OUTSIDE Cloudflare, or it shares the failure domain it watches).
2. **Add check**: Name `hibana-backup-cron`; **Period = 6 hours** (backup runs 4×/day);
   **Grace = 6 hours** (alert after 2 missed ticks = 12 h); Schedule = simple.
3. (Optional) Integrations → add Telegram or more emails — the default email is enough.
4. Copy the **Ping URL** (`https://hc-ping.com/<uuid>`) and set the prod secret:
   ```bash
   cd hibana-audit
   npx wrangler secret put HEALTHCHECK_PING_URL --env prod
   # paste the URL, Enter
   ```
5. Done. The dev worker never pings (prod-only). Manual backups never ping (a heartbeat
   must only beat for the automated path). Until the secret is set, the feature is off.

### Setting up external monitoring
See `docs/uptime-monitoring.md` for step-by-step UptimeRobot/Better Stack setup.

### Incident note (2026-09-07, v0.3.0 day one)
A transient D1 `SQLITE_CORRUPT_VTAB` broke the 03:17 UTC cron backup. The email + Telegram
alert paths ALSO failed silently — they query D1 (quota/users) and hit the same transient
error inside their best-effort catches. **The healthchecks.io ping was the only surviving
signal** (it failed the check with `/fail`). Every statement read clean minutes later; a
manual backup + a `wrangler dev --remote --test-scheduled` repro both succeeded and the
success ping arrived. If SQLITE_CORRUPT recurs or persists: §2c (Time Travel) is the
documented remedy — bookmarks exist in `dr-bookmarks.md`. This is also why the dead-man's
switch must be OUTSIDE Cloudflare: every in-band alert shares D1's fate.

### What's NOT monitored (gaps)
- **D1-down errors are invisible to `error_log`** (the recorder writes to D1): if the
  database is the failure, `wrangler tail` + `/api/health` are the surface.
- **Raw 403/429 JSON responses that bypass `app.onError`** (CSRF middleware, owner gates,
  rate limits answer directly) are not persisted — visible in `wrangler tail`.
- **No D1 query performance monitoring** — slow queries are invisible (`npm run perf:explain`
  is the manual harness).
- **No GitHub API rate-limit monitoring** — the backup cron could hit rate limits silently
  (the dead-man's switch catches it within 12 h, though: a failing backup pings `/fail`).
- Sentry-class error aggregation — deliberately rejected for a solo-user app
  (reasoning in `docs/dr-integrity-closeout.md` §4.1).

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
| Run Plan B drill (Telegram) | `npm run drill:planb` |
| Pre-migration bookmark (prod) | `npm run bookmark:prod` |
| Restore via Time Travel | `npx wrangler d1 time-travel restore pm-app-prod --bookmark <id>` (§2c) |
| View recent errors | Admin console → Errors tab, or `GET /api/admin/errors` (owner) |
| Trigger Plan B backup now | `curl -X POST https://hibana.ir/api/admin/backup/planb` (owner session) |
| D1 hot-path perf report | `npm run perf:explain` |
| Set secrets | `npm run secrets:set:prod` |
| Check health | `curl https://hibana.ir/api/health` |
| Tail prod logs | `npx wrangler tail --env prod` |
| Apply migrations (prod) | `npx wrangler d1 migrations apply pm-app-prod --remote` |
