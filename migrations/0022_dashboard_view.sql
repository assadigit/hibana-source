-- Dashboard view options (user request 2026-08-26): which sections show on the
-- dashboard and in what order. 1 = visible, 0 = hidden; dash_order is a CSV of the
-- visible sections' ids (header, projects, notebook, activity). Server-validated.
ALTER TABLE users ADD COLUMN dash_show_header INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN dash_show_projects INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN dash_show_notebook INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN dash_show_activity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN dash_order TEXT NOT NULL DEFAULT 'header,projects,notebook,activity';