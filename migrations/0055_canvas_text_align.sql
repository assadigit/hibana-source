-- 0055: canvas text alignment (S40, 2026-09-13).
-- The text tool's toolbar gains alignment (left / center / right). fabric.Textbox.textAlign
-- has no storage home, so it joins font_size/angle as a first-class column on
-- canvas_elements. NULL = 'left' (the fabric default — legacy rows need no backfill).
-- Plain ADD COLUMN: canvas_elements was last rebuilt in 0031 and plain adds are the
-- established pattern (0049 angle, 0051 text search) — no CHECK constraints touch it.

ALTER TABLE canvas_elements ADD COLUMN text_align TEXT DEFAULT NULL;
