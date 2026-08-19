# ai-agent-test

SDLC AI Agent Playground — Phase 1 walking skeleton.

## Backend provider (BCK-05)

The project supports two Postgres backends via the `BACKEND_PROVIDER` env switch:

| Provider  | Connection env        | Embeddings            | Notes                                                                                |
|-----------|-----------------------|-----------------------|--------------------------------------------------------------------------------------|
| `insforge` (default) | `DATABASE_URL`        | OpenRouter `/v1/embeddings` | Project-managed InsForge Postgres + InsForge SDK for storage/auth. |
| `supabase`| `SUPABASE_DATABASE_URL` | OpenRouter `/v1/embeddings` | Self-hosted Postgres + `pgvector`. Docker test image: `pgvector/pgvector:pg16`. |

Set `BACKEND_PROVIDER=supabase` to switch; `db/client.ts` reads the matching URL
and `lib/insforge.ts` throws if any code path tries to use the InsForge SDK on the
Supabase path. The `pgvector` extension is provisioned by `drizzle/0001_init.sql`
(`CREATE EXTENSION IF NOT EXISTS vector;`) on both paths.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in DATABASE_URL + WORKER_SHARED_SECRET
pnpm db:migrate                    # apply 0001_init.sql (vector, mastra_*, tool_docs, ...)
pnpm dev                           # boots predev -> next dev + worker
```

`pnpm embed:tools` runs the scrape + embed loop against the live MCP server
READMEs (Notion, Linear, Playwright, Sentry) and writes 1536-dim vectors to
`tool_docs`. The predev hook re-runs it when `tool_docs` is empty or older than
7 days (D-20).

## Smoke

```bash
pnpm smoke                         # curl /api/smoke/echo + /api/health
pnpm test:audit                    # node:test suite for audit redact + classify
```

## Phase 1 layout

- `app/` — Next.js 16 App Router (web UI)
- `worker/src/` — Mastra worker (agents, tools, MCP lifecycle)
- `db/` — Drizzle schema + Postgres client (`backendProvider` switch lives here)
- `lib/` — server-side helpers (InsForge SDK, redact, pricing)
- `scripts/` — migration + predev + tool-doc scrape/embed
- `drizzle/` — `0001_init.sql` (canonical Phase 1 schema)

## Status

Phase 1 plan A (walking skeleton) + plan B (storage, MCP lifecycle, audit, RAG)
landed. Plans C (HITL) + D (UI + resilience) ship in the next wave.
