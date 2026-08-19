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

-- Mastra PostgresStore tables (01-02). Names verified against @mastra/pg v1.21.0.
-- Created before the worker boots so PostgresStore can write on first use.
CREATE TABLE IF NOT EXISTS mastra_threads (
  id          text PRIMARY KEY,
  resource_id text NOT NULL,
  title       text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mastra_threads_resource_idx
  ON mastra_threads (resource_id, updated_at);

CREATE TABLE IF NOT EXISTS mastra_messages (
  id         text PRIMARY KEY,
  thread_id  text NOT NULL,
  role       text NOT NULL,
  content    jsonb NOT NULL,
  type       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mastra_messages_thread_idx
  ON mastra_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS mastra_snapshots (
  id            text PRIMARY KEY,
  run_id        text NOT NULL,
  workflow_name text NOT NULL,
  step_id       text,
  snapshot      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mastra_snapshots_run_idx
  ON mastra_snapshots (run_id, created_at);

CREATE TABLE IF NOT EXISTS mastra_workflows (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mastra_evals (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  result     jsonb NOT NULL,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mastra_traces (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  run_id     text,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
