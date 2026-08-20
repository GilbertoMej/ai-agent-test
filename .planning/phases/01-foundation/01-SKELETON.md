# Phase 1 Walking Skeleton

**Gate before:** all other PLAN files (`01-B`, `01-C`, `01-D`). No plan in this phase runs until the skeleton is verified end-to-end.

**Plan files in this phase (under `plans/`):**

- `01-A-tracer.md` — **Walking Skeleton, gate.** Tasks `01-01a-scaffold` + `01-01b-runtime`. Wave 1.
- `01-B-persistence-and-rag.md` — Tasks `01-02-storage`, `01-02b-mcp-lifecycle`, `01-05-audit-log`, `01-06-rag-scaffold`, `01-12-supabase-fallback`. Wave 2 (depends on 01-A).
- `01-C-hitl.md` — Tasks `01-03-tool-classifier`, `01-04a-write-low-gate`, `01-04b-write-high-gate`, `01-11-auto-approve-toggle`. Wave 2 (depends on 01-A).
- `01-D-ui-and-resilience.md` — Tasks `01-07-health-banner`, `01-08-cost-hud`, `01-09-stage-picker`, `01-10-action-feed`, `01-13-tab-reconnect-pause`, `01-14-worker-watch-restart`, `01-15-smoke-script`. Wave 2 (depends on 01-A).

The skeleton is split into two Wave-1 sub-tasks that ship together:

- **`01-01a-scaffold`** — config, env, types, Drizzle schema, migrations, client libs. Reversible.
- **`01-01b-runtime`** — worker boot, agent, `echo` tool, audit wrapper, SSE relay, health banner, smoke. Carries the four one-way decisions (D-01, D-02, D-05, D-22) and is gated by `checkpoint:decision` before it runs.

The tracer sequence runs against the **combined** 01-01a + 01-01b output. Both sub-tasks must pass before the gate lifts.

## User Story

**As a** developer running the playground locally for the first time
**I want to** open `http://localhost:3000`, see a green health banner, type "hello" into the chat, and receive "echo:hello" back from the agent
**so that** I have proof that the Next.js frontend, the Mastra worker, the SSE relay, the audit log, and the persistence layer are all wired correctly before any real MCP integrations are built on top.

## Definition of Skeleton Done

- [ ] `pnpm dev` boots Next.js on `:3000` and the Mastra worker on `:4111` via `concurrently` (single command, single terminal).
- [ ] Worker boots in under 2 seconds with zero MCP servers loaded yet (D-05, D-06).
- [ ] `curl -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:4111/api/health` returns `200` with `{"worker_up": true, ...}`.
- [ ] The Next.js health banner shows `worker_up: true` and the four MCP servers as `not_loaded` (grey state, not red).
- [ ] Typing `hello` in the browser chat returns `echo:hello` in the streaming reply.
- [ ] Exactly one row is written to `audit_log` for the `echo` tool call with `result_status = 'ok'`, `approval_decision = 'auto'`, and `tokens_in` / `tokens_out` populated from `step-finish.totalUsage` (the full 11-column schema ships in 01-01a; the runtime path that fills it ships in 01-01b; 01-05 only hardens the redact + token-patch already in place).
- [ ] `pnpm smoke` exits `0` (the smoke script asserts the above programmatically).
- [ ] No secrets appear in committed `.env` files, in `audit_log.args_json`, or in any console output.

## Run Order (recipe — reproducible on a fresh clone)

1. **Run 01-01a-scaffold first.** It is reversible and lays the foundation. `cp .env.example .env.local` and fill in: `DATABASE_URL`, `OPENROUTER_API_KEY`, `INSFORGE_SERVICE_KEY`, `INSFORGE_BASE_URL`, `WORKER_SHARED_SECRET`. InsForge project is provisioned via `npx @insforge/cli create` (auth required once). `pnpm install` then `pnpm db:migrate`. All tables (`audit_log` x11 columns, `sessions`, `tool_docs` vector(1536) + HNSW, `approval_grants`) exist. `pnpm tsc --noEmit` passes.
2. **Approve the `checkpoint:decision` for 01-01b.** It accepts the four one-way decisions (D-01 Mastra, D-02 Nemotron via OpenRouter, D-05 local-only worker, D-22 env-var bearer auth) in one gate. Default answer `accept` proceeds; alternative `change: D-XX → ...` revises the plan first.
3. **Run 01-01b-runtime.** It builds the worker boot, agent, `echo` tool, audit wrapper, SSE relay, health banner, and the smoke script. After this step the tracer sequence works.
4. **Verify the tracer gate.** Open `http://localhost:3000` — the health banner probes `/api/health` immediately on page load and shows green. Type `hello` in the chat input and press Enter. The text bubble renders, the action feed shows the `echo` tool call and result, and the header token counter increments. `pnpm smoke` exits 0.
5. **Unlock the rest of the phase.** `01-B`, `01-C`, `01-D` may now run in parallel.

## Smoke Test

```bash
# scripts/smoke.sh — pasteable, idempotent
#!/usr/bin/env bash
set -euo pipefail

# 1. Worker reachable
test "$(curl -fsS -H "Authorization: Bearer ${WORKER_SHARED_SECRET}" \
  http://localhost:4111/api/health | jq -r .worker_up)" = "true"

# 2. Chat round-trip
test "$(curl -fsS -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}],"threadId":"smoke"}' \
  | jq -r '.text')" = "echo:hello"

# 3. Audit row exists with tokens populated
test "$(psql "${DATABASE_URL}" -tAc \
  "SELECT count(*) FROM audit_log WHERE tool_name='echo' AND result_status='ok' AND tokens_in IS NOT NULL AND tokens_out IS NOT NULL")" -ge "1"
```

## Files Created (minimum surface, ~25 files across 01-01a + 01-01b)

### 01-01a-scaffold (Layer 1 — reversible)

| File | Purpose |
|---|---|
| `package.json` | Scripts: `dev`, `db:migrate`, `embed:tools`, `smoke`, `worker`. Every dependency pinned exact. |
| `.env.example` | Template documenting every required var |
| `tsconfig.json` | TS config for the Next.js + worker split |
| `next.config.ts` | Next.js 16 config (App Router, no extra plugins) |
| `drizzle.config.ts` | Drizzle Kit config pointing at `db/schema` |
| `db/schema/index.ts` | Drizzle table exports |
| `db/schema/audit-log.ts` | `audit_log` — full 11-column schema per BCK-04 |
| `db/schema/sessions.ts` | `sessions` table |
| `db/schema/tool-docs.ts` | `tool_docs` with `vector(1536)` + HNSW index |
| `db/schema/approval-grants.ts` | `approval_grants` table |
| `db/client.ts` | Drizzle init + connection |
| `drizzle/0001_init.sql` | `CREATE EXTENSION vector` + every table + every index |
| `lib/insforge.ts` | `@insforge/sdk` singleton |
| `lib/redact.ts` | M7 secret scrubber |
| `lib/pricing.ts` | Nemotron + DeepSeek pricing table constant |
| `scripts/smoke.sh` | Stub (extended in 01-01b) |

### 01-01b-runtime (Layer 2 — one-way, gated by `checkpoint:decision`)

| File | Purpose |
|---|---|
| `app/layout.tsx` | RSC root layout |
| `app/page.tsx` | Shell composing the chat panel + banner |
| `app/api/chat/route.ts` | SSE relay → worker `/agents/sdlcAgent/stream` |
| `app/api/health/route.ts` | Proxies to worker `/health` |
| `app/components/ChatPanel.tsx` | `useChat` from `ai/react` |
| `app/components/HealthBanner.tsx` | Polls `/api/health` every 30s |
| `app/components/StatusBadge.tsx` | Single green/yellow/red indicator used by the banner |
| `worker/src/index.ts` | `new Mastra({...})` + Hono server boot on `:4111` |
| `worker/src/agents/sdlc.ts` | Agent definition with `requireToolApproval` function |
| `worker/src/tools/echo.ts` | The `echo` tool (read-class, no approval) |
| `worker/src/lib/audit.ts` | `withAudit()` wrapper applied to every tool |
| `worker/src/lib/health.ts` | `/api/health` handler |
| `scripts/smoke.sh` | Extend stub with the tracer assertions above |

## What Skeleton Does NOT Include (deferred to expansion tasks)

- Real MCP servers (Notion, Linear, Playwright, Sentry) — covered by 01-02 (lazy load) + Phase 2+
- The RAG `rag_query` tool with real embeddings — `tool_docs` table exists with full schema; the scrape + embed pipeline ships in 01-06-rag-scaffold
- The stage picker sidebar — ships in 01-09-stage-picker
- The HITL approval cards (write_low + write_high) — flows through `requireToolApproval` but the inline UI ships in 01-04a-write-low-gate and 01-04b-write-high-gate
- The token-cost HUD header — ships in 01-08-cost-hud
- The auto-approve toggle — ships in 01-11-auto-approve-toggle
- Supabase fallback wiring + Docker test — ships in 01-12-supabase-fallback
- Tab-reconnect pause + SSE approval re-emit — ships in 01-13-tab-reconnect-pause
- `tsx watch` restart smoke — ships in 01-14-worker-watch-restart
- The full smoke script with all paths — locked in 01-15-smoke-script
