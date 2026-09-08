# Uptime Monitoring — Hibana

Hibana exposes a public health endpoint at `GET /api/health` that returns JSON:
```json
{ "ok": true, "service": "hibana", "environment": "prod", "db": "up", "schema_version": "42", "time": "..." }
```
- Returns `503` if the database is unreachable.
- `Cache-Control: no-store` — monitors never get a stale cached success.

## H6 fix (2026-09-10): External Uptime Monitor Setup

The app has no external uptime monitoring — you'd discover an outage by noticing
hibana.ir is broken. This runbook sets up a free external monitor that checks
`/api/health` every 5 minutes and alerts you via email + Telegram if it goes down.

### Option A: UptimeRobot (recommended — free, simple)

1. Go to https://uptimerobot.com → sign up (free tier: 50 monitors, 5-min intervals)
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `Hibana Prod`
   - URL: `https://hibana.ir/api/health`
   - Monitoring Interval: **5 minutes**
   - Alert Contacts: add your email + (optionally) a Telegram webhook
3. **Advanced Settings**:
   - Keyword Monitor: **YES** — keyword `"ok":true` — so a 200 with `db: "down"` also alerts
   - Timeout: 30 seconds
   - Custom HTTP Headers: none needed (the endpoint is public)

### Option B: Better Stack (richer alerts, free tier)

1. Go to https://betterstack.com/better-uptime → sign up
2. Create a monitor:
   - URL: `https://hibana.ir/api/health`
   - Check frequency: 5 min
   - Expected status: `200`
   - Response body contains: `"ok":true`
3. Set up an on-call schedule + incident escalation (SMS/phone call on the paid tier)

### Telegram Alert Integration (both options)

Most uptime monitors support a webhook integration. To route alerts into Telegram:

1. Create a Telegram bot via @BotFather (or reuse the existing Hibana bot)
2. Get the bot token + your chat ID (message @userinfobot to get your chat ID)
3. In UptimeRobot/Better Stack, add a "Webhook" alert contact:
   - URL: `https://api.telegram.org/bot<TOKEN>/sendMessage`
   - Method: POST
   - Body: `{"chat_id": "<YOUR_CHAT_ID>", "text": "Hibana is DOWN - check https://hibana.ir/api/health", "parse_mode": "HTML"}`

### What to check when alerted

1. **First**: visit `https://hibana.ir/api/health` in your browser — is it 503 or timing out?
2. **If 503 (db down)**: check Cloudflare dashboard -> D1 -> `pm-app-prod` -> is there an outage?
3. **If timeout/no response**: check Cloudflare dashboard -> Workers -> `hibana-prod` -> Logs (wrangler tail)
4. **If the Worker itself crashed**: `cd hibana-audit && npx wrangler deploy --env prod` to redeploy
5. **If D1 is corrupted**: restore from the latest encrypted backup:
   ```bash
   BACKUP_ENCRYPTION_KEY=<key> node scripts/restore.mjs --file <snapshot.json> --d1 pm-app-prod
   ```

### Backup-failure alerts (already implemented)

The Telegram-direct backup-failure alert (H6 partial, implemented 2026-09-10) covers a
different failure mode: if the scheduled backup cron fails, you get a Telegram message
from the bot directly. This is independent of the external uptime monitor — the monitor
checks if the *app* is up; the Telegram alert checks if *backups* are working. Both are
needed for full coverage.
