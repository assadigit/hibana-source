-- 0013: canvas_elements.font_size — manual text resize persistence (user request).
-- Text-tool elements can be resized by dragging their handles like Paint/Photoshop; the
-- effective size is baked into this column on save (scale normalized to 1) so the size
-- survives reloads. Sticky-note boxes and strokes keep NULL.
ALTER TABLE canvas_elements ADD COLUMN font_size INTEGER;