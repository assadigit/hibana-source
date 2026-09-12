-- 0049 (2026-09-12, S29): persist text-box/note rotation (mtr handle) on both boards.
-- canvas_elements.angle REAL DEFAULT 0 — degrees, fabric convention (clockwise, y-down).
-- No table rebuild: no CHECK constraint touches angle, and SELECT * round-trips it.
ALTER TABLE canvas_elements ADD COLUMN angle REAL DEFAULT 0;
