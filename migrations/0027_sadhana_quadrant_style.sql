-- 0027: user-customizable dashboard quadrant icon and accent token.
ALTER TABLE sadhana_quadrant_names ADD COLUMN icon_id TEXT;
ALTER TABLE sadhana_quadrant_names ADD COLUMN accent_color TEXT;
