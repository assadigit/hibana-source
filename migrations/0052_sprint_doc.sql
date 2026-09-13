-- 0052 (2026-09-13, Session 33 — user request: project page CTA «اسپرینت جدید» →
-- a modal asking name / version number / description → «enter sprint» → a FULL-SCREEN
-- rich-text editor with code blocks).
--
-- Two plain ADD COLUMNs on sprints — no constraint changes, no new tables:
--   version      — the sprint's version number label ("12.1"), free text, nullable;
--                  renders as a chip next to the sprint name.
--   description  — the sprint's rich document (markdown subset: headings, bold/italic,
--                  lists, quotes, links, fenced code blocks — same renderer family as
--                  the backlog plan docs). Seeded by the modal's description box, then
--                  edited in the full-screen editor. NULL = empty.
-- The draft flow (0034) is unchanged: POST creates the draft, /start promotes it.

ALTER TABLE sprints ADD COLUMN version TEXT;
ALTER TABLE sprints ADD COLUMN description TEXT;
