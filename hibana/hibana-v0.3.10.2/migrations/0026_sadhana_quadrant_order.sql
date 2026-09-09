-- 0026: Persist each user's Sadhana quadrant order.
-- The default matches the dedicated board's existing visual order: Q1, Q3, Q2, Q4.
ALTER TABLE users ADD COLUMN sadhana_quadrant_order TEXT NOT NULL DEFAULT '1,3,2,4';
ALTER TABLE users ADD COLUMN dash_show_todo INTEGER NOT NULL DEFAULT 1;
