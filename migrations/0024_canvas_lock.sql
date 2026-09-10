-- 0024: canvas_elements.locked — per-element lock (user request 2026-08-26). A locked
-- element stays visible and selectable (findable, Figma-style) but move/resize/rotate/
-- text-edit/delete are blocked, and it is excluded from select-all and bulk delete.
-- Plain ADD COLUMN — the table's CHECK constraint is untouched, so no rebuild is needed.

ALTER TABLE canvas_elements ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
