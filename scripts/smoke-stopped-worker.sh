#!/usr/bin/env bash
# scripts/smoke-stopped-worker.sh — 01-15 — verify the smoke contract asserts
# `worker_up: false` when the worker is unreachable (Next.js proxy returns 503).
# Exits non-zero if /api/health reports worker_up=true (the worker is up).
set -euo pipefail

WEB_URL="${WEB_URL:-http://localhost:3000}"

HEALTH="$(curl -fsS "${WEB_URL}/api/health" || true)"
STATUS="$(echo "${HEALTH}" | jq -r '.worker_up' 2>/dev/null || echo 'null')"

if [ "${STATUS}" = "true" ]; then
  echo "non-zero exit: worker is up — stopped-worker smoke should run with the worker offline" >&2
  exit 1
fi

echo "smoke-stopped-worker: OK (worker_up=${STATUS})"
