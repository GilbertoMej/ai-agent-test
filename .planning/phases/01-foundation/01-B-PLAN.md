---
phase: 1
plan: B
type: execute
wave: 2
depends_on: ["01-A"]
files_modified:
  - worker/src/index.ts
  - drizzle/0001_init.sql
  - worker/src/lib/agent-memory.ts
  - db/schema/mastra.ts
  - worker/src/mcp-lifecycle.ts
  - worker/src/mcp/health-probe.ts
  - worker/scripts/test-mcp-reconnect.ts
  - app/components/HealthBanner.tsx
  - worker/src/lib/health.ts
  - app/api/health/route.ts
  - worker/src/lib/audit.ts
  - worker/src/lib/audit.test.ts
  - lib/redact.ts
  - db/schema/tool-docs.ts
  - worker/src/lib/embed-bootstrap.ts
  - worker/src/tools/rag-query.ts
  - worker/src/lib/rag.ts
  - scripts/scrape-tool-docs.ts
  - scripts/embed-tool-docs.ts
  - lib/insforge.ts
  - package.json
  - .planning/phases/01-foundation/01-NOTES.md
  - db/client.ts
  - .env.example
  - README.md
autonomous: false
must_haves:
  - "PostgresStore retains sessions and suspended-run snapshots across worker tsx watch restarts"
  - "MCP lifecycle wrapper reconnects within 3 attempts on stdio pipe death (1s/2s/4s backoff)"
  - "Health banner reports per-server status 'connected' | 'failed' | 'not_loaded' from the actual probe, not env-var presence"
  - "audit_log entries redact secrets in args_json and result content"
  - "audit_log.tokens_in and tokens_out patch correctly on step-finish"
  - "rag_query returns a context string referencing the queried tool when 4 tool_docs rows exist"
  - "audit_log.tool_doc_rows_consumed >= 1 after rag_query"
  - "4 tool_docs rows per tool (notion, linear, playwright, sentry) with embedding populated after cold worker boot"
  - "BACKEND_PROVIDER=supabase with pgvector/pgvector:pg16 Docker boots end-to-end; pnpm smoke exits 0 against the Docker URL"
---

# 01-B — Persistence + RAG + MCP Lifecycle

Storage (`@mastra/pg` PostgresStore), MCP lifecycle wrapper (C1 mitigation), audit hardening, and the RAG pipeline (4 MCP server READMEs scraped and embedded). This plan also owns the health-probe that downstream UI consumes.

## Tasks

<task>
  <id>01-02-storage</id>
  <action>Wire PostgresStore({ id: 'mastra', connectionString }) into worker/src/index.ts. worker/src/lib/agent-memory.ts exports memory: { thread, resource: 'operator' } for stream() calls. drizzle/0001_init.sql appends Mastra-PostgresStore tables (mastra_threads, mastra_messages, mastra_snapshots, mastra_workflows, mastra_evals, mastra_traces — names verified by inspecting @mastra/pg/dist/storage/schema after install). Emits checkpoint:decision before this task runs.</action>
  <files>worker/src/index.ts, drizzle/0001_init.sql, worker/src/lib/agent-memory.ts, db/schema/mastra.ts</files>
  <verify>
    <automated>psql $DATABASE_URL -tAc "SELECT count(*) FROM mastra_threads" | grep -qE '^[0-9]+$' && psql $DATABASE_URL -tAc "SELECT count(*) FROM mastra_snapshots WHERE created_at > now() - interval '5 minutes'" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>PostgresStore persists sessions across worker restart; suspend-snapshot table exists; resume after kill -SIGTERM works.</done>
  <reversibility>reversible</reversibility>
  <checkpoint>decision</checkpoint>
  <implements>RT-01, RT-02, BCK-01</implements>
  <commit>feat(storage): wire PostgresStore for sessions and snapshots</commit>
</task>

<task>
  <id>01-02b-mcp-lifecycle</id>
  <action>New task. worker/src/mcp-lifecycle.ts wraps MCPClient.listTools() with cache + bounded retry (3 attempts, 1s/2s/4s backoff). worker/src/mcp/health-probe.ts runs per-server ping with 2s deadline; result recorded per server. worker/scripts/test-mcp-reconnect.ts spawns a fake stdio MCP server, kills the pipe mid-call, asserts the lifecycle reconnects within 3 attempts and restores tool cache. This task resolves C1 (RESEARCH PITFALLS.md) and replaces the 01-07 env-var-only check with the actual probe state.</action>
  <files>worker/src/mcp-lifecycle.ts, worker/src/mcp/health-probe.ts, worker/scripts/test-mcp-reconnect.ts, app/components/HealthBanner.tsx, worker/src/lib/health.ts, app/api/health/route.ts</files>
  <verify>
    <automated>pnpm tsx worker/scripts/test-mcp-reconnect.ts | grep -q 'reconnect within 3 attempts' && curl -fsS -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:4111/api/health | jq -e '.mcp.notion == "not_loaded"'</automated>
  </verify>
  <done>Lifecycle wrapper reconnects on stdio death; health probe returns deterministic per-server status; downstream UI surfaces the probe state.</done>
  <reversibility>reversible</reversibility>
  <implements>RT-03, C1</implements>
  <commit>feat(mcp): lifecycle wrapper with retry + per-server health probe (C1)</commit>
</task>

<task>
  <id>01-05-audit-log</id>
  <action>Harden withAudit() from 01-01b. Tighten redact() to apply to both args_json and result content fields. Patch tokens_in/tokens_out on the most recent audit_log row for (session_id, tool_name) after step-finish. Add tool_doc_rows_consumed (already in the canonical 11-column schema from 01-01a) populated by rag_query on success. No schema changes — the schema was locked in 01-01a. Unit-test the regex and the token-patch path.</action>
  <files>worker/src/lib/audit.ts, worker/src/lib/audit.test.ts, lib/redact.ts</files>
  <verify>
    <automated>pnpm vitest worker/src/lib/audit.test.ts | grep -q 'all tests passed' && psql $DATABASE_URL -tAc "SELECT count(*) FROM audit_log WHERE tokens_in IS NOT NULL AND tokens_out IS NOT NULL" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>Redact regex traps sk-/pk-/api-/key-/token-/secret-prefixed strings; tokens_in/tokens_out patch path is testable.</done>
  <reversibility>reversible</reversibility>
  <implements>BCK-04</implements>
  <commit>feat(audit): harden redact + token-patch on existing audit_log schema</commit>
</task>

<task>
  <id>01-06-rag-scaffold</id>
  <action>Ship the RAG pipeline. Implements (D-03 DeepSeek V4 Flash via InsForge model gateway for InsForge-side AI helpers, D-04 InsForge native embed API for embeddings, D-18 4 MCP servers only in Phase 1: Notion/Linear/Playwright/Sentry, D-19 scraped from official sources at build time). scripts/scrape-tool-docs.ts fetch()es the 4 official README URLs (Notion, Linear, Playwright, Sentry MCP servers), splits by section heading, writes (tool, version, section, content, source_url, fetched_at) rows to tool_docs. scripts/embed-tool-docs.ts calls the InsForge /v1/embeddings endpoint for each chunk and writes the embedding vector(1536) column. pnpm embed:tools runs both. Worker boot checks tool_docs.updated_at < now()-7d OR count==0 and triggers the embed script (D-20 — predev hook). worker/src/tools/rag-query.ts + worker/src/lib/rag.ts expose the retrieval tool: embed query, cosineDistance ORDER BY ... LIMIT 5 (D-21), format as context string}.rag_query populates audit_log.tool_doc_rows_consumed on success. Emits checkpoint:decision and checkpoint:human-verify before the migration runs.</action>
  <files>db/schema/tool-docs.ts, worker/src/tools/rag-query.ts, worker/src/lib/rag.ts, scripts/scrape-tool-docs.ts, scripts/embed-tool-docs.ts, package.json, lib/insforge.ts, worker/src/lib/embed-bootstrap.ts, .planning/phases/01-foundation/01-NOTES.md</files>
  <verify>
    <automated>pnpm embed:tools && psql $DATABASE_URL -c "SELECT tool, count(*) FROM tool_docs GROUP BY tool ORDER BY tool" | awk 'NR>2 {print $1}' | sort -u | grep -E '^(notion|linear|playwright|sentry)$' && psql $DATABASE_URL -tAc "SELECT count(*) FROM tool_docs WHERE embedding IS NULL" | grep -q '^0$' && pnpm dev & sleep 8 && curl -fsS -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"how do I create a Notion page"}],"threadId":"rag"}' | grep -qi 'notion' && psql $DATABASE_URL -tAc "SELECT count(*) FROM audit_log WHERE tool_name='rag_query' AND tool_doc_rows_consumed >= 1" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>4 tool_docs rows per tool with embeddings populated; rag_query returns context referencing the queried tool; audit_log.tool_doc_rows_consumed >= 1 after the e2e test; predev hook re-embeds on stale or empty collection.</done>
  <reversibility>reversible</reversibility>
  <checkpoint>decision</checkpoint>
  <checkpoint>human-verify</checkpoint>
  <implements>RAG-01, RAG-02, BCK-03</implements>
  <commit>feat(rag): scrape + embed 4 MCP server READMEs, rag_query tool, boot-time refresh</commit>
</task>

<task>
  <id>01-12-supabase-fallback</id>
  <action>Add a BACKEND_PROVIDER=insforge|supabase env switch that branches lib/insforge.ts and db/client.ts. When supabase, the connection uses postgres-js against SUPABASE_DATABASE_URL and the pgvector extension is enabled via the same migration (CREATE EXTENSION IF NOT EXISTS vector; is already in 01-01a's migration, so the Supabase path inherits it). Document the switch in .env.example and README.md. The Docker fallback test uses pgvector/pgvector:pg16 (NOT postgis/postgis:16-3.4).</action>
  <files>db/client.ts, lib/insforge.ts, .env.example, README.md</files>
  <verify>
    <automated>grep -R 'BACKEND_PROVIDER' lib/insforge.ts db/client.ts && pnpm dev & sleep 5 && curl -fsS http://localhost:3000/api/health | jq -e '.worker_up == true' && (docker run --rm -d --name pgvector-test -p 5499:5432 -e POSTGRES_PASSWORD=test pgvector/pgvector:pg16 && sleep 5 && BACKEND_PROVIDER=supabase SUPABASE_DATABASE_URL=postgres://postgres:test@localhost:5499/postgres pnpm db:migrate && BACKEND_PROVIDER=supabase SUPABASE_DATABASE_URL=postgres://postgres:test@localhost:5499/postgres pnpm smoke && docker stop pgvector-test) ; echo "Phase 1 proves the env switch is wired; the production Supabase project (with row-level auth, quotas, etc.) is not in scope here."</automated>
  </verify>
  <done>Env switch wired; Docker-backed Supabase path boots end-to-end with pnpm smoke exiting 0; README documents the switch.</done>
  <reversibility>reversible</reversibility>
  <implements>BCK-05</implements>
  <commit>feat(backend): Supabase+pgvector fallback via BACKEND_PROVIDER env switch (Docker-tested)</commit>
</task>

## Decision gates

`checkpoint:decision` BEFORE 01-02 runs — accept PostgresStore as the persistence backend (D-04). Default: `accept`. Alternative: `change: libsql`.

`checkpoint:decision` BEFORE 01-06 runs — accept the embedding pipeline:
- InsForge native embed API (D-04, costly).
- `[ASSUMED]` model name `openai/text-embedding-3-small` at 1536 dims from RESEARCH Open Questions #1.

Default: `accept`. Alternative: `model: <provider>/<name>`.

`checkpoint:human-verify` BEFORE the 01-06 migration runs — before any pnpm db:migrate:
- POST $INSFORGE_BASE_URL/v1/embeddings with the bearer and a one-shot payload.
- Read back data[0].embedding.length.
- If different from 1536, patch db/schema/tool-docs.ts and re-run pnpm db:migrate --force.
- Document the actual model + dims in .planning/phases/01-foundation/01-NOTES.md (executor creates alongside).

The executor halts on this checkpoint until the probe completes and the NOTES file is written.

## Cross-references

- Mastra runtime + PostgresStore shape: see 01-A-tracer.md §01-01b.
- Audit schema (11 columns): see 01-A-tracer.md §Canonical schema.
- UI consumption of the probe state: see 01-D-ui-and-resilience.md §01-07.
