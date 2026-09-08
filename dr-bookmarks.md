# Hibana — D1 Time Travel bookmark log (operational)

One line per bookmark, newest last. Created by `npm run bookmark:prod` / `bookmark:dev`
(scripts/pre-migrate-bookmark.mjs) — the pre-migration ritual from runbook §4.
Restore with: `npx wrangler d1 time-travel restore <db> --bookmark <id>` (see runbook §2c
— restore is in-place and destructive to current state).

| UTC timestamp | database | schema | bookmark id | reason |
|---|---|---|---|---|
| 2026-09-07T02:17:02.947Z | pm-app-prod | 43 | 000005ff-00000000-000050df-1931618c922f41a76b7c7562ca95765e | pre-migration bookmark (prod) |
| 2026-09-07T03:39:19.075Z | pm-app-prod | 44 | 00000607-00000002-000050df-b85cfafbd13f7bfecd16248d882d092b | post-0045 healthy state, after transient D1 SQLITE_CORRUPT_VTAB incident (worklog Task 27) |
