-- 0033: backlog plan docs — the «برنامه آتی» ("upcoming plan") tab. Long-form planning
-- entries per project: the dev-board's quick items are the short-form layer, these are
-- the documents. Every write keeps a full revision row (kind 'create' on POST,
-- 'update' on PATCH) so the tab's history feed can show what changed and when;
-- revisions die with their doc (ON DELETE CASCADE), docs die with their project.

CREATE TABLE backlog_docs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_backlog_docs_project ON backlog_docs(project_id);

CREATE TABLE backlog_doc_revisions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES backlog_docs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('create','update')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Rule 9: the history feed joins revisions through the doc's project.
CREATE INDEX idx_backlog_doc_revisions_doc ON backlog_doc_revisions(doc_id);
