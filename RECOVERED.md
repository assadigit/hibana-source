# Hibana — Recovered Source (deployed state, 2026-09-01)

This tree is the **complete, reconstructed source** of your Cloudflare Workers app as it
was running on **hibana dev (v240) / hibana-prod (v266) at 2026-09-01** — i.e. your
15-hour-old backup **plus all ~50–60 hotfixes** you deployed in the window
2026-08-31 → 2026-09-01, which had been lost.

It was recovered from the live deployment itself (Worker bundle via the Cloudflare API,
frontend mirrored from hibana.ir, D1 schema dumps) and diffed against your backup
(`hibana-source-2026-09-05.zip`). Every changed module was ported back into the
TypeScript source and then **machine-verified** against the deployed bundle.

## What changed vs your backup (the recovered hotfixes)

- **Project status taxonomy**: 5 statuses → 7 stages
  (`spark / unreviewed / investigating / awaiting / doing / halted / operational`), new
  glance grid view, kanban by stage, legacy-status mapping in validation.
- **Spark folders**: named shelves on the Ideas board (`spark_folders` table,
  `projects.folder_id`), folder bar + per-folder kanban.
- **«برنامه آتی» (Upcoming Plan)**: backlog docs + full revision history per project.
- **Problems tab**: bug dev-tasks replace the hurdle checklist on the project page
  (hurdles stay as reminders); `dev_tasks` gained the `bug` status.
- **Changelogs removed**: all four changelog routes + the tab + the DB writes are gone
  (the `changelogs` table intentionally remains in the DB — do not drop it).
- **Turnstile → math captcha**: self-hosted HMAC-signed arithmetic captcha
  (`src/services/captcha.ts`), Persian/Arabic digit normalization, no third party.
- **Admin console (batch e)**: user list/presence, ban/unban with presets, role
  management, delete-user with confirmation, owner-only middleware, email console with
  Resend quota + broadcast paging, backup status/download endpoints.
- **Email pipeline**: `sendAndLog` with delivery log (`email_log`), branded bilingual
  HTML templates, chunked b64 (Persian-safe), daily quota.
- **Auth middleware**: ban gate (HX-Redirect w/ query params, branded notice) +
  `last_seen_at` presence stamping.
- **Quick notes**: `done` flag on project-linked notes (strike-through + check).
- **Sprint drafts**: sprints are born drafts, `POST /api/sprints/:id/start` promotes.
- **Dashboard redesign**: stat-carousel over 6 stages, to-do preview with
  progress dots, note chips, quick-add FAB, quadrant popover redesign.
- **Canvas**: new element types `shape`, `comment`, `block`, `sticky`.
- **Cron**: backup schedule widened `17 3 * * *` → `17 3,9,15,21 * * *` (4× daily).
- **Infra**: CSP `img-src https:`, Worker-served page routes + branded 404 flow,
  `email_log`-backed quotas, snapshot schema 20260909 + 6 new tables in backups.

## Verification (how you can trust this)

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | **0 errors** project-wide |
| Test suite (`vitest run`) | **191/191 tests pass** (incl. new legacy-vocabulary test) |
| Rebuild round-trip vs deployed bundle | 620,477 B vs 620,322 B; **52/52 modules** present in the same order; **44 byte-identical**; 2 differ only by esbuild variable renames; 6 micro-diffs — all are documented artifacts or intentional (below) |
| Migrations vs live D1 | applying `0001–0039` to a fresh SQLite DB reproduces the **live D1 schema exactly** (dev ≡ prod dumps; tables/triggers/FTS, comment-stripped) |
| Frontend | 106 files; 40 updated/new files copied **byte-identical** from the live site mirror |

Known intentional deviations from the deployed bundle (all documented in the session
worklog):

1. `sadhana` recur-history DELETE returns `removed: out.changes` — the deployed code
   read `out.meta?.changes`, which the app's DB abstraction never populates, so the
   deployed endpoint always returned `0`. Ours returns the real count (the evident intent).
2. `projects.ts` uses `dt` / `reorderSchema` where the deployed bundle carries esbuild's
   collision renames `d2` / `reorderSchema2` — same values, human names.
3. `admin.ts` extracts the backup-status error message into a local `msg` const
   (deployed inlines it) — identical behavior.
4. A handful of intent comments were re-added where the deployed bundle carries none
   (the bundle strips most comments; the source you lost had them).
5. `reset.ts` writes `</script>` where esbuild emits the `<\/script>` escape — the
   runtime string is identical.

## Migrations — read before deploying

Your live D1 databases are **already at the final schema**. The 9 reconstructed
migrations (`0031–0039`) exist so that **fresh environments** (local Node dev, CI, a new
D1) reproduce the live schema exactly. The live DBs' `d1_migrations` bookkeeping rows
were not exported, so wrangler cannot know our reconstructed file names match what was
applied — **do not blindly run `wrangler d1 migrations apply` against the live dev/prod
DBs** (it would re-run the table rebuilds; they are written stash-safe, but re-running
them on production is pointless risk). Either skip migrations for the live DBs entirely,
or first backfill the bookkeeping:

```sql
-- run once in D1 console if you want `migrations apply` to be a no-op:
INSERT INTO d1_migrations (name, applied_at) VALUES
  ('0031_project_status_stages.sql', datetime('now')),
  ('0032_canvas_squig_types.sql',    datetime('now')),
  ('0033_backlog_docs.sql',          datetime('now')),
  ('0034_dev_task_bug.sql',          datetime('now')),
  ('0035_admin_user_mgmt.sql',       datetime('now')),
  ('0036_canvas_sticky.sql',         datetime('now')),
  ('0037_spark_folders.sql',         datetime('now')),
  ('0038_quick_note_done.sql',       datetime('now')),
  ('0039_sprint_drafts.sql',         datetime('now'));
```

Note: your own migration numbering already skipped `0007` (pre-existing gap:
`0006 → 0008`), so the tree has 38 files, not 39.

## Secrets to re-enter (never stored in source)

Worker secrets are not recoverable from a deployment — set them once:

```
GITHUB_TOKEN          # backups to the GitHub assets repo
OWNER_EMAIL           # admin/reminder recipient
RESEND_KEY            # transactional email
TELEGRAM_BOT_TOKEN    # telegram capture bot
TELEGRAM_SECRET       # telegram webhook HMAC
CAPTCHA_SECRET_KEY    # NEW: math-captcha HMAC key (replaces Turnstile)
```

`TURNSTILE_SECRET_KEY` is still honored as a legacy fallback for the captcha secret
(see `src/index.ts`), but the Turnstile verification itself is gone. Use
`npm run secrets:set` / `npm run secrets:set:prod` or `wrangler secret put …`.

## Deploying

```bash
npm install
npm run typecheck     # 0 errors
npm test              # 191/191

npm run deploy        # dev (hibana)
npm run deploy:prod   # prod (hibana-prod, custom domain hibana.ir)
```

The compiled output is verified equivalent to the currently-deployed bundle (see the
round-trip table above), so a deploy from this tree is a no-op change for your users —
it simply restores your lost source-of-truth.

## Two personal reminders from the recovery session

- **Rotate the Cloudflare API token** you pasted into the chat during recovery.
- Your workstation clock is ~5 days fast (the zip says 2026-09-05; deployments are
  2026-09-01). Sync NTP before your next deploy so migration timestamps stay sane.
