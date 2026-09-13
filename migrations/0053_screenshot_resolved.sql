-- 0053 (S35, user request 2026-09): screenshots become UI/UX PROBLEM REPORTS —
-- each shot can carry an open/fixed state alongside its note (caption). resolved=0
-- is the default (a fresh shot of a broken thing is an OPEN problem); PATCH
-- /api/screenshots/:id flips it when the fix lands. Plain ADD COLUMN — no
-- constraint changes, safe on both D1 and node:sqlite.
ALTER TABLE screenshots ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0;
