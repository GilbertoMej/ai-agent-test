---
phase: 1
plan: A
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - .env.example
  - tsconfig.json
  - next.config.ts
  - drizzle.config.ts
  - db/schema/index.ts
  - db/schema/audit-log.ts
  - db/schema/sessions.ts
  - db/schema/tool-docs.ts
  - db/schema/approval-grants.ts
  - db/client.ts
  - drizzle/0001_init.sql
  - lib/insforge.ts
  - lib/redact.ts
  - lib/pricing.ts
  - scripts/smoke.sh
  - app/layout.tsx
  - app/page.tsx
  - app/api/chat/route.ts
  - app/api/health/route.ts
  - app/components/ChatPanel.tsx
  - app/components/HealthBanner.tsx
  - app/components/StatusBadge.tsx
  - worker/src/index.ts
  - worker/src/agents/sdlc.ts
  - worker/src/tools/echo.ts
  - worker/src/lib/audit.ts
  - worker/src/lib/health.ts
autonomous: false
must_haves:
  - "pnpm dev boots Next.js on :3000 and the Mastra worker on :4111 via concurrently"
  - "curl http://localhost:4111/api/health returns {worker_up: true, ...} with the WORKER_SHARED_SECRET bearer"
  - "Browser at http://localhost:3000 shows the green health banner within 1s of page load"
  - "Typing 'hello' in chat returns 'echo:hello' in the streaming reply"
  - "audit_log has exactly 1 row for the echo tool call with result_status='ok' and approval_decision='auto'"
  - "audit_log row has tokens_in and tokens_out populated from step-finish.totalUsage (D-22 bearer auth gates /api/health access)"
  - "GET /api/smoke/echo returns { text: 'echo:hello', auditId: '...' }"
  - "pnpm smoke exits 0"
---

# 01-A — Tracer (Walking Skeleton Gate)

The Walking Skeleton. Ships in two sub-tasks: `01-01a-scaffold` (config + schema + migrations + libs, reversible) and `01-01b-runtime` (worker + agent + echo + audit wrapper + SSE relay + health banner + smoke, one-way). The tracer sequence runs against the **combined** 01-01a + 01-01b output. No task in 01-B / 01-C / 01-D runs until the gate lifts.

## Canonical audit_log schema (11 columns, locked here)

`id`, `session_id`, `ts`, `tool_name`, `args_json`, `result_status`, `approval_decision`, `tokens_in`, `tokens_out`, `duration_ms`, `tool_doc_rows_consumed`. Every other plan reads this canonical list.

## Tasks

<task>
  <id>01-01a-scaffold</id>
  <action>Pin every dependency exact (no ^/~ per C6). Scaffold tsconfig.json, next.config.ts, drizzle.config.ts. Write the full Drizzle schema for audit_log (11 columns per the canonical list above), sessions, tool_docs (vector(1536) + HNSW), approval_grants. drizzle/0001_init.sql must run CREATE EXTENSION IF NOT EXISTS vector; first, then every table, then every index. Wire lib/insforge.ts, db/client.ts (postgres-js + Drizzle), lib/redact.ts (M7 regex), lib/pricing.ts (Nemotron $0, DeepSeek V4 Flash $0.077/$0.153 per 1M tok). Layer 1 only — no worker code, no agent code.</action>
  <files>package.json, .env.example, tsconfig.json, next.config.ts, drizzle.config.ts, db/schema/index.ts, db/schema/audit-log.ts, db/schema/sessions.ts, db/schema/tool-docs.ts, db/schema/approval-grants.ts, db/client.ts, drizzle/0001_init.sql, lib/insforge.ts, lib/redact.ts, lib/pricing.ts, scripts/smoke.sh</files>
  <verify>
    <automated>pnpm install && pnpm db:migrate && pnpm tsc --noEmit && psql $DATABASE_URL -tAc "SELECT count(*) FROM pg_extension WHERE extname='vector'" | grep -q '^1$' && psql $DATABASE_URL -c '\d audit_log' | grep -q tool_doc_rows_consumed</automated>
  </verify>
  <done>Every table exists with the canonical 11-column audit_log schema; pgvector extension is installed; tsc passes; deps pinned exact.</done>
  <reversibility>reversible</reversibility>
  <implements>BCK-01, BCK-02, BCK-04</implements>
  <commit>feat(scaffold): phase 1 layer 1 — pinned deps, full schema, migrations, client libs</commit>
</task>

<task>
  <id>01-01b-runtime</id>
  <action>Wire the runtime on top of 01-01a. Implements (D-01 Mastra as agent runtime, D-02 Nemotron 3 Ultra free via OpenRouter, D-05 local-only worker via concurrently). worker/src/index.ts boots new Mastra({...}) with the Hono server on :4111 and the PostgresStore. worker/src/agents/sdlc.ts defines the agent on OpenRouter Nemotron 3 Ultra free with modelSettings.maxTokens=8192 and maxSteps=4. worker/src/tools/echo.ts ships the tracer tool. worker/src/lib/audit.ts exposes withAudit() that fills tool_name, args_json, result_status, approval_decision, duration_ms, and patches tokens_in/tokens_out from step-finish.totalUsage. worker/src/lib/health.ts returns /api/health JSON. app/api/chat/route.ts proxies SSE. app/api/health/route.ts proxies to /api/health. app/api/smoke/echo/route.ts (deterministic smoke endpoint) returns { text, auditId } from the echo tool. app/components/ChatPanel.tsx uses useChat. app/components/HealthBanner.tsx + StatusBadge.tsx render the banner. scripts/smoke.sh extends the 01-01a stub with the tracer assertions. Emits checkpoint:decision before this task runs.</action>
  <files>app/layout.tsx, app/page.tsx, app/api/chat/route.ts, app/api/health/route.ts, app/api/smoke/echo/route.ts, app/components/ChatPanel.tsx, app/components/HealthBanner.tsx, app/components/StatusBadge.tsx, worker/src/index.ts, worker/src/agents/sdlc.ts, worker/src/tools/echo.ts, worker/src/lib/audit.ts, worker/src/lib/health.ts, scripts/smoke.sh</files>
  <verify>
    <automated>pnpm dev & sleep 5 && curl -fsS -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:4111/api/health | jq -e .worker_up && curl -fsS http://localhost:3000/api/smoke/echo | jq -e '.text == "echo:hello"' && psql $DATABASE_URL -tAc "SELECT count(*) FROM audit_log WHERE tool_name='echo' AND result_status='ok' AND tokens_in IS NOT NULL AND tokens_out IS NOT NULL" | awk '{exit !($1>=1)}' && pnpm smoke</automated>
  </verify>
  <done>Tracer sequence works end-to-end: chat round-trip, audit row with tokens populated, health banner green, smoke script exits 0.</done>
  <reversibility>one-way</reversibility>
  <checkpoint>decision</checkpoint>
  <implements>UI-01, UI-07, RT-01, RT-02, RT-03</implements>
  <commit>feat(runtime): phase 1 layer 2 — Mastra worker, agent, echo tracer, SSE relay, smoke endpoint</commit>
</task>

## Decision gate (before 01-01b runs)

`checkpoint:decision` — accept the four one-way runtime decisions (D-01, D-02, D-05, D-22).
- Mastra as the agent runtime (D-01).
- Nemotron 3 Ultra free via OpenRouter as the model (D-02).
- Local-only worker topology (D-05).
- Env-var bearer auth for the operator (D-22).

Default: `accept`. Alternative: `change: D-XX → ...` (revises the plan first).

## Cross-references

- Mastra runtime + PostgresStore shape: see 01-B-persistence-and-rag.md §01-02.
- Tool classification + approval cards: see 01-C-hitl.md §01-03 / §01-04a.
- Health banner probe state: see 01-B-persistence-and-rag.md §01-02b.
