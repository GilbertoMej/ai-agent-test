#!/usr/bin/env bash
# scripts/smoke.sh — Phase 1 Walking Skeleton tracer assertions.
# Stub in 01-01a-scaffold; the runtime checks (worker reachable, echo round-trip,
# audit row populated) are appended in 01-01b-runtime.
set -euo pipefail

: "${WORKER_SHARED_SECRET:?WORKER_SHARED_SECRET must be set}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

echo "smoke: layer-1 checks (schema present, vector extension)"

# 1. pgvector extension installed.
test "$(psql "${DATABASE_URL}" -tAc "SELECT count(*) FROM pg_extension WHERE extname='vector'")" = "1"

# 2. audit_log canonical 11-column schema present.
psql "${DATABASE_URL}" -c '\d audit_log' | grep -q tool_doc_rows_consumed

# 3. Required tables exist.
for t in audit_log sessions tool_docs approval_grants; do
  psql "${DATABASE_URL}" -tAc "SELECT to_regclass('${t}') IS NOT NULL" | grep -q '^t$'
done

echo "smoke: layer-1 OK"
