# API Coverage — Phase 01 (Foundation)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

## opencode-go (LLM provider via Mastra)

Used for chat + tool-call streaming. Auth: `OPENCODE_API_KEY`.

| capability | decision | reason |
|---|---|---|
| chat (stream + tool-calls) | INTEGRATE | Phase 1 walking skeleton — primary orchestrator path |
| embeddings | OPT-OUT | routed through OpenRouter instead; single source of truth for embedding cost + quota |
| vision / image input | OPT-OUT | not needed yet — Phase 1 is text-only |
| function-calling JSON schema | OPT-OUT | Mastra tool registry handles tool schema; provider-side JSON-mode unused |
| fine-tuning / training endpoints | OPT-OUT | explicitly out of scope |
| batch / async jobs | OPT-OUT | not needed yet |
| usage / billing API | OPT-OUT | UI cost HUD derives from streaming usage deltas, not provider billing API |

## openrouter (Embeddings endpoint)

Used for `embed()` only. Auth: `OPENROUTER_API_KEY`.

| capability | decision | reason |
|---|---|---|
| embeddings (`/api/v1/embeddings`) | INTEGRATE | rag_query + tool-doc ingestion |
| chat completions | OPT-OUT | routed through opencode-go — see notes in 01-J (free-tier models drop stream) |
| function-calling / tools | OPT-OUT | chat path unused here |
| model listing | OPT-OUT | model id hardcoded (`openai/text-embedding-3-small`) |
| credits / key balance | OPT-OUT | not needed yet |

## InsForge Postgres (data plane)

Not flagged by the detector — no external-API verb pairing — listed for completeness so the subtraction record is durable.

| capability | decision | reason |
|---|---|---|
| audit_log (insert + select) | INTEGRATE | Phase 1 audit + tool lifecycle |
| approval_grants (CRUD) | INTEGRATE | AutoApproveToggle 5-min batches |
| suspended_runs (CRUD) | INTEGRATE | pause/resume tab-close recovery |
| rag_documents / tool_docs (vector search) | INTEGRATE | rag_query + tool-doc RAG layer |
| auth (JWT / OAuth) | OPT-OUT | single-user local demo; deferred to a later phase |
| storage (S3) | OPT-OUT | no file uploads in Phase 1 |
| edge functions | OPT-OUT | worker handles orchestration; Deno runtime not used |
| realtime channels | OPT-OUT | SSE handled by worker, not InsForge realtime |
