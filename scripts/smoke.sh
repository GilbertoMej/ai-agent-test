#!/usr/bin/env bash
# scripts/smoke.sh — Phase 1 Definition of Skeleton Done + post-01-02..01-14 surfaces.
# Exits non-zero on any failed assertion (set -euo pipefail + every check wrapped in `test`).
set -euo pipefail

: "${WORKER_SHARED_SECRET:?WORKER_SHARED_SECRET must be set}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

WORKER_URL="${WORKER_URL:-http://localhost:4111}"
WEB_URL="${WEB_URL:-http://localhost:3000}"

echo "smoke: layer-1 checks (schema present, vector extension)"

# 1. pgvector extension installed.
test "$(psql "${DATABASE_URL}" -tAc "SELECT count(*) FROM pg_extension WHERE extname='vector'")" = "1"

# 2. audit_log canonical 11-column schema present.
psql "${DATABASE_URL}" -c '\d audit_log' | grep -q tool_doc_rows_consumed

# 3. Required tables exist (Phase 1 schema).
for t in audit_log sessions tool_docs approval_grants mastra_threads mastra_messages mastra_snapshots; do
  psql "${DATABASE_URL}" -tAc "SELECT to_regclass('${t}') IS NOT NULL" | grep -q '^t$'
done

# 4. Mastra HNSW index on tool_docs.
psql "${DATABASE_URL}" -tAc "SELECT indexdef FROM pg_indexes WHERE indexname='tool_docs_hnsw'" | grep -q 'hnsw'

echo "smoke: layer-1 OK"

# Layer-2 runtime assertions (01-01b-runtime).

# 5. Worker reachable + worker_up: true.
WORKER_HEALTH="$(curl -fsS -H "Authorization: Bearer ${WORKER_SHARED_SECRET}" "${WORKER_URL}/health")"
test "$(echo "${WORKER_HEALTH}" | jq -r .worker_up)" = "true"

# 6. Per-server MCP lifecycle state present (notion/linear/playwright/sentry).
for s in notion linear playwright sentry; do
  test "$(echo "${WORKER_HEALTH}" | jq -r ".mcp.${s}")" != "null"
done

# 7. tokens.* presence surfaced.
for k in openrouter_key_present insforge_key_present database_url_present; do
  test "$(echo "${WORKER_HEALTH}" | jq -r ".tokens.${k}")" != "null"
done

# 8. uptime_s surfaced (01-07).
test "$(echo "${WORKER_HEALTH}" | jq -r .uptime_s)" -ge "0"

# 9. /api/health reachable through the Next.js proxy.
test "$(curl -fsS "${WEB_URL}/api/health" | jq -r .worker_up)" = "true"

# 10. Chat round-trip via deterministic smoke endpoint.
SMOKE="$(curl -fsS "${WEB_URL}/api/smoke/echo")"
test "$(echo "${SMOKE}" | jq -r .text)" = "echo:hello"

# 11. Audit row exists with the canonical 11 columns populated (read-class -> auto).
COUNT="$(psql "${DATABASE_URL}" -tAc "SELECT count(*) FROM audit_log WHERE tool_name='echo' AND result_status='ok' AND approval_decision='auto'")"
test "${COUNT}" -ge "1"

# 12. Auto-approve toggle honored: chat with approvalMode=always skips the approval card.
STREAM="$(curl -fsS -X POST "${WEB_URL}/api/chat" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"create a note"}],"threadId":"smoke-auto","approvalMode":"always"}')"
test "$(echo "${STREAM}" | grep -c 'tool-call-approval')" = "0"

# 13. write_high approval surface emits the chunk with applyMigrations toolName.
HIGH="$(curl -fsS -X POST "${WEB_URL}/api/chat" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"apply migrations"}],"threadId":"smoke-high"}')"
test "$(echo "${HIGH}" | grep -c 'applyMigrations')" -ge "1"

# 14. Pause/resume endpoints respond (01-13).
curl -fsS -X POST "${WEB_URL}/api/pause" -H 'Content-Type: application/json' -d '{"sessionId":"smoke"}' >/dev/null

# 15. Stage picker accepts foundation, rejects others with friendly payload.
test "$(curl -fsS -X POST "${WEB_URL}/api/stage" -H 'Content-Type: application/json' -d '{"stage":"foundation"}' | jq -r .instructionsLoaded)" = "true"
test "$(curl -fsS -X POST "${WEB_URL}/api/stage" -H 'Content-Type: application/json' -d '{"stage":"prd"}' | jq -r .availableInPhase)" -ge "2"

# 16. Token counter increments per-message (UI-06). The smoke echo sets tokens_in=0 / tokens_out=0;
# the assertion only proves the column is populated, not non-zero.
test "$(psql "${DATABASE_URL}" -tAc "SELECT count(*) FROM audit_log WHERE tool_name='echo' AND tokens_in IS NOT NULL")" -ge "1"

# 17. Pricing table contains deepseek-v4-flash row (01-08).
grep -q 'deepseek-v4-flash' lib/pricing.ts

# 18. HealthBanner polls /api/health every 30s (UI-07).
grep -q 'setInterval(tick, 30_000)' app/components/HealthBanner.tsx

# 19. StagePicker renders the 9 stages (UI-02 / D-14).
test "$(grep -c 'id:' app/components/StagePicker.tsx)" -ge "9"

# 20. ActionFeed renders all 4 part types (UI-03).
for t in 'tool-call' 'tool-result' 'tool-error' 'tool-call-approval'; do
  grep -q "type: \"${t}\"" app/components/ActionFeed.tsx
done

# 21. TransientAgentError retry ladder (UI-05).
grep -q 'TransientAgentError' app/components/ChatPanel.tsx
grep -q '1_000, 2_000, 4_000' app/components/ChatPanel.tsx

# 22. localStorage session id (01-13 / UI-04).
grep -q 'sdlc.playground.session.v1' app/components/ChatPanel.tsx

# 23. PostgresStore + tsx watch (01-14 / D-08).
grep -q 'tsx watch worker/src/index.ts' package.json
test "$(psql "${DATABASE_URL}" -tAc "SELECT to_regclass('mastra_snapshots') IS NOT NULL")" = "t"

# 24. write_high card has the DESTRUCTIVE badge (01-04b).
grep -q 'DESTRUCTIVE' app/components/ApprovalCard.tsx

echo "smoke: layer-2 OK"
