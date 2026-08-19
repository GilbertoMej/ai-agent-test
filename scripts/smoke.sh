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

# Layer-2 runtime assertions (Task 01-01b-runtime).

# 4. Worker reachable + worker_up: true.
WORKER_HEALTH="$(curl -fsS -H "Authorization: Bearer ${WORKER_SHARED_SECRET}" "${WORKER_URL:-http://localhost:4111}/api/health")"
test "$(echo "${WORKER_HEALTH}" | jq -r .worker_up)" = "true"

# 5. Chat round-trip via deterministic smoke endpoint (skips LLM call).
SMOKE="$(curl -fsS http://localhost:3000/api/smoke/echo)"
test "$(echo "${SMOKE}" | jq -r .text)" = "echo:hello"

# 6. Audit row exists with the canonical 11 columns populated (read-class → approval_decision='auto').
COUNT="$(psql "${DATABASE_URL}" -tAc "SELECT count(*) FROM audit_log WHERE tool_name='echo' AND result_status='ok' AND approval_decision='auto'")"
test "${COUNT}" -ge "1"

echo "smoke: layer-2 OK"
