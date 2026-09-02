-- 0025: sadhana_quadrant_names.subtitle — optional editable subheading per quadrant
-- (user request 2026-08-26). Blank subtitle renders an empty line; only a quadrant the
-- user has never renamed falls back to the built-in subtitle.

ALTER TABLE sadhana_quadrant_names ADD COLUMN subtitle TEXT;