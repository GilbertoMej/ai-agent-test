-- Phase 1 — initial schema. Run order matters: extension first, tables second, indexes last.

CREATE EXTENSION IF NOT EXISTS vector;

-- audit_log: 11 columns, canonical per BCK-04 / 01-A-PLAN.md.
CREATE TABLE IF NOT EXISTS audit_log (
  id                       text PRIMARY KEY,
  session_id               text NOT NULL,
  ts                       timestamptz NOT NULL DEFAULT now(),
  tool_name                text NOT NULL,
  args_json                text,
  result_status            text NOT NULL,
  approval_decision        text,
  tokens_in                bigint,
  tokens_out               bigint,
  duration_ms              bigint NOT NULL,
  tool_doc_rows_consumed   bigint
);
CREATE INDEX IF NOT EXISTS audit_log_session_ts ON audit_log (session_id, ts);

-- sessions: UI-04 / D-07 / D-08 anchor.
CREATE TABLE IF NOT EXISTS sessions (
  id           text PRIMARY KEY,
  thread_id    text,
  resource_id  text NOT NULL DEFAULT 'operator',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- tool_docs: RAG source, 1536-dim embeddings (D-04 / D-21).
CREATE TABLE IF NOT EXISTS tool_docs (
  id          text PRIMARY KEY,
  tool        text NOT NULL,
  version     text NOT NULL,
  section     text NOT NULL,
  content     text NOT NULL,
  source_url  text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  embedding   vector(1536)
);
CREATE INDEX IF NOT EXISTS tool_docs_hnsw
  ON tool_docs USING hnsw (embedding vector_cosine_ops);
CREATE UNIQUE INDEX IF NOT EXISTS tool_docs_section_uniq
  ON tool_docs (tool, version, section);

-- approval_grants: D-12 "Approve all matching for 5 min".
CREATE TABLE IF NOT EXISTS approval_grants (
  id          text PRIMARY KEY,
  pattern     text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_grants_expires ON approval_grants (expires_at);
