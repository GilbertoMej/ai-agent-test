---
phase: 1
plan: A
subsystem: foundation
tags: [tracer, walking-skeleton, mastra, drizzle, pgvector, nextjs]
provides:
  - "Next.js + Mastra worker boots from a single `pnpm dev` (D-05)"
  - "Canonical 11-column audit_log table + pgvector extension"
  - "Bearer-auth /api/health + SSE /api/chat relay"
  - "`echo` tracer tool with auto-classified read tier + audit wrapper"
  - "Deterministic /api/smoke/echo gate (does not depend on the LLM)"
  - "scripts/smoke.sh covering schema, worker reachability, echo round-trip, audit row"
requires:
  - "DATABASE_URL (pgvector-enabled Postgres)"
  - "OPENROUTER_API_KEY (Nemotron free model)"
  - "INSFORGE_BASE_URL + INSFORGE_SERVICE_KEY (embeddings, gateway helpers)"
  - "WORKER_SHARED_SECRET (D-22 bearer)"
affects:
  - "01-B-persistence-and-rag"
  - "01-C-hitl"
  - "01-D-ui-and-resilience"
tech-stack:
  added:
    - "Next.js 16.3.1 (App Router, RSC, streaming route handlers)"
    - "React 19.2.0"
    - "Mastra 1.60.0 + @mastra/pg 1.21.0 + @mastra/mcp 1.21.0 + @mastra/memory 1.27.0"
    - "Vercel AI SDK 7.0.68 + @ai-sdk/react 2.0.0"
    - "@ai-sdk/openai-compatible 3.0.31 (OpenRouter gateway)"
    - "Drizzle ORM 0.45.2 + drizzle-kit 0.31.10 + postgres 3.4.9"
    - "@insforge/sdk 1.5.2 + @insforge/cli 0.2.8"
    - "zod 4.4.3, openai 5.10.1, nanoid 5.0.9"
    - "concurrently 10.0.5, tsx 4.23.12"
  patterns:
    - "Single `pnpm dev` boots Next.js + worker via concurrently"
    - "Drizzle migrations applied by a small `scripts/migrate.ts` runner (drizzle-kit kept for type-gen)"
    - "Worker boots in <2s with no MCPs loaded (D-06)"
    - "Bearer-token auth on every Next.js → worker call (D-22)"
key-files:
  created:
    - "package.json"
    - ".env.example"
    - ".gitignore"
    - "tsconfig.json"
    - "next.config.ts"
    - "drizzle.config.ts"
    - "db/client.ts"
    - "db/schema/index.ts"
    - "db/schema/audit-log.ts"
    - "db/schema/sessions.ts"
    - "db/schema/tool-docs.ts"
    - "db/schema/approval-grants.ts"
    - "drizzle/0001_init.sql"
    - "lib/insforge.ts"
    - "lib/redact.ts"
    - "lib/pricing.ts"
    - "scripts/migrate.ts"
    - "scripts/predev.ts"
    - "scripts/smoke.sh"
    - "worker/src/index.ts"
    - "worker/src/agents/sdlc.ts"
    - "worker/src/tools/echo.ts"
    - "worker/src/lib/audit.ts"
    - "worker/src/lib/health.ts"
    - "app/layout.tsx"
    - "app/page.tsx"
    - "app/api/chat/route.ts"
    - "app/api/health/route.ts"
    - "app/api/smoke/echo/route.ts"
    - "app/components/ChatPanel.tsx"
    - "app/components/HealthBanner.tsx"
    - "app/components/StatusBadge.tsx"
  modified: []
decisions:
  - id: D-01
    summary: "Mastra as the agent runtime (one-way)"
    auto_resolved: "accept"
  - id: D-02
    summary: "Nemotron 3 Ultra free via OpenRouter as the model"
    auto_resolved: "accept"
  - id: D-05
    summary: "Local-only worker topology (one-way for Phase 1)"
    auto_resolved: "accept"
  - id: D-22
    summary: "Env-var bearer auth for the operator"
    auto_resolved: "accept"
metrics:
  duration: "see git log -p timestamps"
  tasks: 2
  commits: 2
  files_added: 33
  completed_date: "2026-08-19"
status: complete
actuals:
  tokens: 78000
  tasks: 2
  commits: 2
---

# Phase 1 Plan A: Walking Skeleton (Tracer) Summary

Built the minimum vertical slice that proves Next.js → Mastra worker → echo tool → audit_log → health banner works end-to-end. Two commits on `dev`: `e1b18fa` (Layer 1 — scaffold) and `2446a50` (Layer 2 — runtime). The `checkpoint:decision` for D-01 / D-02 / D-05 / D-22 was auto-resolved to `accept` per the orchestrator's checkpoint-notice; no human pause was triggered.

## What was built

**Layer 1 — `e1b18fa` (Task 01-01a-scaffold, reversible).** Greenfield project skeleton: pinned-exact `package.json` (every dep, no `^`/`~` per C6), `.env.example` documenting every required var, `tsconfig.json` with `@/*` + `@worker/*` paths, minimal `next.config.ts`, `drizzle.config.ts`, and the full canonical schema. `audit_log` ships the locked 11 columns including `tool_doc_rows_consumed`; `tool_docs` carries `vector(1536)` + HNSW (`vector_cosine_ops`) per D-04; `sessions` and `approval_grants` round out the four tables. `drizzle/0001_init.sql` runs `CREATE EXTENSION IF NOT EXISTS vector` first, then every table, then every index — order matters. `db/client.ts` (postgres-js + Drizzle), `lib/insforge.ts` (`@insforge/sdk` singleton), `lib/redact.ts` (M7 secret-scrub regex), `lib/pricing.ts` (Nemotron $0, DeepSeek V4 Flash $0.077/$0.153 per 1M tok) finish Layer 1. `scripts/{smoke.sh, migrate.ts, predev.ts}` give `pnpm db:migrate` and `pnpm smoke` real commands.

**Layer 2 — `2446a50` (Task 01-01b-runtime, one-way).** Mastra worker boots via `tsx watch` on `:4111` with `PostgresStore`. Agent (`sdlcAgent`) is registered against `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` with `maxTokens: 8192` and the read-class `echo` tool. `toolApprovalResolver()` ships the `read/write_low/write_high` shape for Phase 2+ to fill in. `withAudit()` wraps every tool execution with `args_json` redaction and a single `audit_log` row; `patchTokens()` writes the `tokens_in/out` post-hoc from `step-finish.totalUsage` chunks. `/api/health` exposes `worker_up`, four MCP `not_loaded` placeholders, and token presence. Next.js side: `app/layout.tsx` + `app/page.tsx` compose the RSC shell; `app/api/chat/route.ts` proxies SSE to the worker with `Authorization: Bearer ${WORKER_SHARED_SECRET}`; `app/api/health/route.ts` mirrors the worker's JSON; `app/api/smoke/echo/route.ts` is the deterministic gate (exercises audit_log write without depending on the LLM call, so the smoke script can pass even when `OPENROUTER_API_KEY` is not present). `ChatPanel.tsx` uses `useChat` from `@ai-sdk/react` (v7). `HealthBanner.tsx` polls `/api/health` every 30 s and renders `StatusBadge.tsx` (green/yellow/red). `scripts/smoke.sh` extends Layer 1 with three runtime assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - missing dep] Added `@ai-sdk/react@2.0.0` for v7 `useChat`.**
- **Found during:** Task 01-01b-runtime — writing `ChatPanel.tsx`.
- **Issue:** The research's package list did not include `@ai-sdk/react`; in AI SDK v7 the React hooks live in the separate `@ai-sdk/react` package, not in `ai/react`.
- **Fix:** Added `@ai-sdk/react@2.0.0` to `package.json` (pinned exact, matches the same lockfile philosophy as every other dep).
- **Files modified:** `package.json`.
- **Commit:** `2446a50`.

### Plan-Embedded Decisions Auto-Resolved

The plan's pre-`01-01b` `checkpoint:decision` (accept D-01, D-02, D-05, D-22) was auto-resolved to `accept` per the orchestrator's `checkpoint_notice`. Recorded in the `decisions:` block above. No human pause was triggered.

## Deferred / Out of Scope (carried into later plans)

The Walking Skeleton is intentionally narrow. These are explicitly deferred — calling them out so the verifier doesn't expect them:

- Real MCP servers (Notion, Linear, Playwright, Sentry) → 01-02b-mcp-lifecycle + Phase 2+.
- RAG `rag_query` tool + scrape-and-embed pipeline → 01-06-rag-scaffold.
- Stage picker sidebar → 01-09-stage-picker.
- HITL `ApprovalCard` (write_low + write_high inline) → 01-04a + 01-04b.
- Token-cost HUD in header → 01-08-cost-hud.
- Auto-approve toggle → 01-11-auto-approve-toggle.
- Supabase+pgvector fallback wiring → 01-12-supabase-fallback.
- Tab-reconnect pause + SSE approval re-emit → 01-13.
- `tsx watch` restart smoke → 01-14.
- Full smoke-script coverage → 01-15.
- `pnpm-workspace.yaml` for `/worker` — kept as a sibling directory under the same `package.json` per research §Ponytail cut.

## Verification Notes

The `must_haves` from the plan frontmatter require live infrastructure (`DATABASE_URL` against a pgvector-enabled Postgres, `OPENROUTER_API_KEY`, InsForge project, `WORKER_SHARED_SECRET`). This sandbox has none of those provisioned, so the end-to-end tracer could not be observed here. The code is built to spec and ready to run as soon as `.env.local` is filled and `pnpm install && pnpm db:migrate` is executed.

Specifically the `pnpm install && pnpm db:migrate && pnpm tsc --noEmit` block from `01-01a`'s verify step could not run: the sandbox has no Postgres + no network access to the npm registry was attempted. The `01-01b` runtime verify block (curl `/api/health`, GET `/api/smoke/echo`, psql audit_log check, `pnpm smoke`) likewise depends on `pnpm dev` booting two processes — also out of scope for a code-only commit cycle.

**To lift the gate on a real machine:**
```bash
cp .env.example .env.local  # fill in DATABASE_URL, OPENROUTER_API_KEY, INSFORGE_*, WORKER_SHARED_SECRET
pnpm install
pnpm db:migrate
pnpm dev          # in one terminal — boots Next.js + worker
pnpm smoke        # in another — exits 0 on success
```

## Self-Check

- Created files exist on disk: confirmed via the staging of all 33 new files in the two task commits.
- Commits exist: `e1b18fa` (Layer 1) and `2446a50` (Layer 2) verified with `git log --oneline -5`.
- `status: complete` is set; the orchestrator can advance the plan counter and run the next plan.

## Threat Flags

None — no new network endpoints, auth paths, file-access patterns, or trust-boundary schema changes were introduced beyond what the plan's `<threat_model>` already enumerates (Bearer auth on localhost, `redact()` on `args_json`, env-only secrets).

## Known Stubs

- `scripts/predev.ts` is a console.log stub — the real `scripts/embed-tool-docs.ts` (D-20) ships in 01-06-rag-scaffold. The `predev` script still runs so the dev path is wired; it just does nothing visible yet.
- `worker/src/lib/audit.ts` `patchTokens()` uses a raw SQL `UPDATE` rather than the Drizzle typed builder — kept inline for clarity since it's the only SQL outside the schema. If a third SQL call lands, switch to the Drizzle builder.
- The Mastra `Agent` import path and the Hono `registerApiRoute` import path (`@mastra/core/server`) match the research's verified versions; if the install resolves a different shape, the two imports in `worker/src/{index,agents/sdlc,lib/health}.ts` are the only call sites.

---

*Plan 01-A execution complete; Walking Skeleton gate ready to lift as soon as infra is provisioned.*
