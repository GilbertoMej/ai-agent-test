# Phase 1: Foundation - Research

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Agent runtime = **Mastra AI** (`@mastra/core`, `@mastra/mcp`) — replaces Claude Agent SDK entirely. Reversibility: **one-way**.
- **D-02:** Agent model = **Nemotron 3 Ultra free** via **OpenRouter** (`nvidia/nemotron-3-ultra-550b-a55b:free`). 1M context, 65K output, tool calling ✓, structured JSON ✗. Reversibility: **one-way**.
- **D-03:** InsForge-side AI (embeddings, project-context helpers) = **DeepSeek V4 Flash** via InsForge model gateway. Never called by the agent directly. Reversibility: **one-way**.
- **D-04:** Embeddings for RAG = **InsForge native embed API** (uses DeepSeek under hood). Local transformers.js fallback deferred. Reversibility: **costly**.
- **D-05:** Local-only worker. `pnpm dev` spawns Next.js + Mastra worker on user's machine via `concurrently`. Next.js proxies to worker over localhost HTTP/SSE. Reversibility: **one-way for Phase 1**.
- **D-06:** Per-stage lazy MCP loading. Worker boots in <2s. MCP servers load when user picks a stage that needs them. UI-07 banner shows "Notion: not loaded" until stage pick. Reversibility: reversible.
- **D-07:** Tab close = pause + wait reconnect. Worker pauses agent loop on tab close, resumes when SSE reconnects. Reversibility: reversible.
- **D-08:** Worker crash = `tsx watch` auto-restart + InsForge session resume. Reversibility: reversible.
- **D-09:** write_low approval = inline card in chat stream where agent would speak next.
- **D-10:** write_high approval = same inline card with text input + red border + DESTRUCTIVE badge.
- **D-11:** Card content tiered. write_low = tool name + 1-line risk reason + buttons. write_high = full args + diff preview + risk reason + typed input.
- **D-12:** Auto-approve scope = header global toggle + per-card "Approve all matching for 5 min" button.
- **D-13:** Tool classification = hardcoded per tool name at MCP registration. Not configurable via UI in Phase 1. Reversibility: **costly**.
- **D-14:** Stage picker = left sidebar. Vertical list of all 8 stages.
- **D-15:** Disabled state for non-Phase-1 stages = greyed out with tooltip "Available in Phase X".
- **D-16:** Action feed placement = inline in chat as message bubbles.
- **D-17:** Action feed per-entry fields = tool name + args preview + status icon + duration + result snippet. Tokens globally in header.
- **D-18:** Tools to embed = 4 MCP servers only in Phase 1: Notion, Linear, Playwright, Sentry.
- **D-19:** Doc source = scraped from official sources at build time. Reversibility: reversible.
- **D-20:** Build trigger = auto-embed on `pnpm dev` startup if collection empty or older than 7 days. Reversibility: reversible.
- **D-21:** Retrieval behavior = fixed top-k=5 per RAG-02 spec. Returns formatted context string.

### Claude's Discretion
- Tool classification exact list (read / write_low / write_high per tool name).
- IPC transport between Next.js and worker — HTTP+SSE localhost with shared secret in `.env.local`.
- Audit log write trigger (per tool call via Mastra middleware hook vs app-side).
- Auth shape (BCK-02) = env-var bearer token for the operator, no login screen in Phase 1. Reversibility: **one-way**.
- InsForge vs Supabase fallback (BCK-05) = InsForge primary, Supabase+pgvector documented as env-switch fallback.

### Deferred Ideas (OUT OF SCOPE)
- Local embedding via transformers.js as RAG fallback.
- Per-stage pre-approval UI checkbox.
- Vercel deploy story — Phase 1 local-only.
- MCP schema drift detection automation — manual version pinning baseline.
- SigNoz self-host vs stub (Phase 7 decision).
- v0 API wrapper design (Phase 4).
- Linear MCP package selection (Phase 3 — confirm at planning).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Streaming chat with agent (Vercel AI SDK `useChat`) | "Mastra worker bootstrap" — agent.stream() + toTextStreamResponse() pattern |
| UI-02 | User picks SDLC stage(s) | Stage picker renders 8 stages, MCPs lazy-load per selection |
| UI-03 | Real-time action feed of tool calls | fullStream tool-call/tool-result chunks → render as message bubbles |
| UI-04 | Session persists across browser refresh | localStorage session id + Mastra Memory with PostgresStore |
| UI-05 | Friendly error toasts with auto-retry | error chunk handling + Mastra's tripwire processor pattern |
| UI-06 | Running token cost estimate in header | stream.usage Promise<LanguageModelUsage> |
| UI-07 | Startup health-check banner | /api/health custom route; per-stage MCP connectivity probe |
| RT-01 | Agent loop runtime | Mastra replaces Claude Agent SDK per D-01 |
| RT-02 | Long-lived Node worker emitting SSE | Mastra built-in Hono server + registerApiRoute |
| RT-03 | MCP server lifecycle managed by runtime | MCPClient from @mastra/mcp + per-stage lazy load per D-06 |
| HITL-01 | 3-tier tool classification (read/write_low/write_high) | requireApproval on createTool + requireToolApproval function on stream()/generate() |
| HITL-02 | Auto-approve all toggle | pass `requireToolApproval: autoApprove ? false : fn` to stream() |
| RAG-01 | Tool docs embedded into pgvector at build | Drizzle vector column + HNSW index + InsForge /v1/embeddings |
| RAG-02 | Retrieval tool with top-k=5 | cosineDistance + format-as-context string |
| BCK-01 | InsForge project provisioned with schema | PostgresStore + pgvector extension + Drizzle migrations |
| BCK-02 | Auth via InsForge single-user mode | env-var bearer token only (Claude's discretion) |
| BCK-03 | Vector store holds tool_docs collection | Drizzle schema for tool_docs table |
| BCK-04 | Audit log persists every tool call | Drizzle audit_log table + per-tool middleware hook |
| BCK-05 | Supabase+pgvector fallback documented | env-switch pattern (BACKEND=insforge\|supabase) |
</phase_requirements>

---

## Implementation Patterns

### 1. Mastra worker bootstrap

#### 1.1 Worker as a standalone Node process (D-05)

The worker lives in a sibling `/worker` package next to `/app`, launched by `concurrently` from `pnpm dev`. It uses `tsx watch` (D-08) so file changes restart it and `tsx` survives `process.exit()` cleanly. It boots a Mastra instance with a Hono-based HTTP server (`registerApiRoute` accepts GET/POST endpoints alongside built-in agent routes).

**Verified imports** (npm registry, Aug 2026):

```
@mastra/core@1.60.0       — Mastra, Agent, RequestContext, registerApiRoute
@mastra/mcp@1.21.0        — MCPClient, MCPServer
@mastra/pg@1.21.0         — PostgresStore (memory + snapshots)
@mastra/server@1.60.0     — server-adapter (custom Hono middleware)
@ai-sdk/openai-compatible@3.0.31 — provider for OpenRouter gateway
```

**Minimum worker entry** (file: `worker/src/index.ts`):

```ts
import { Mastra, registerApiRoute } from '@mastra/core'
import { PostgresStore } from '@mastra/pg'
import { OpenRouterGateway } from './gateways/openrouter'
import { sdlcAgent } from './agents/sdlc'

export const mastra = new Mastra({
  agents: { sdlcAgent },
  storage: new PostgresStore({ id: 'mastra', connectionString: process.env.DATABASE_URL! }),
  gateways: { openrouter: new OpenRouterGateway() },
  server: { port: 4111, host: '0.0.0.0' },
  apiRoutes: [
    registerApiRoute('/health', {
      method: 'GET',
      handler: async (c) => c.json({ worker_up: true, sessions_active: 0 }),
    }),
  ],
})
```

`mastra dev` is not needed — we launch the worker via `tsx watch worker/src/index.ts`. The Hono server boots automatically when `server.port` is set.

#### 1.2 Memory persistence (BCK-01, RT-02, D-08)

`PostgresStore` is the documented persistent storage provider. It supports `memory` (threads + messages) and the suspended-run snapshots that HITL relies on. Without it, `approveToolCall()` returns `'snapshot not found'` after a process restart.

The Drizzle migration script must create the Mastra tables (`mastra_threads`, `mastra_messages`, `mastra_snapshots`, etc.) **before** the worker boots. Mastra documents the schema at `@mastra/pg/dist/storage/schema` — the planner should run `drizzle-kit generate` against a `mastraSchema.ts` and apply with `npx @insforge/cli db migrations up --all`.

> **Flag:** `mastraSchema.ts` is not yet on npm at the version we picked; planner must verify the table names by inspecting `@mastra/pg` after install. If the schema exports change, the migration must mirror them. [ASSUMED]

#### 1.3 Streaming the agent loop to Next.js

`Agent.stream()` returns a `MastraModelOutput` object with:
- `fullStream: ReadableStream<ChunkType<OUTPUT>>` — iterate for every chunk type
- `textStream: ReadableStream<string>` — text only
- `usage: Promise<LanguageModelUsage>` — `{ inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens }`
- `runId` is reachable via `await stream.usage` consumer or via `await stream.toolCalls[0].runId` (no top-level `runId` property was found on the stream object — see "Open Questions")

The full chunk-type enumeration (verified at `https://mastra.ai/en/reference/streaming/ChunkType`):

| `chunk.type` | `payload` shape | Phase 1 use |
|---|---|---|
| `start` | `{}` | banner "agent started" |
| `text-delta` | `{ id, text }` | chat bubble content |
| `reasoning-delta` | `{ id, text }` | collapsible "thinking" panel |
| `tool-call` | `{ toolCallId, toolName, args, providerExecuted }` | action feed "🔧 notion.search(args)" |
| `tool-result` | `{ toolCallId, toolName, result, isError, args }` | action feed "✓ returned 3 pages" |
| `tool-error` | `{ toolCallId, toolName, error }` | error toast |
| `tool-call-approval` | `{ toolCallId, toolName, args }` | HITL inline card |
| `step-finish` | `{ stepResult, output, totalUsage }` | update header token counter |
| `finish` | `{ stepResult, output, messages, response }` | close SSE stream |
| `error` | `{ error }` | friendly error toast + retry |
| `tripwire` | `{ reason, processorId }` | guardrail blocked — show reason |
| `object` | `Partial<OUTPUT>` | structured output (unused Phase 1) |

The Next.js relay endpoint (`app/api/chat/route.ts`) iterates `fullStream` and writes each chunk as a Server-Sent-Event line, prefixed by `data:`. `stream.textStream` is also iterated in parallel for the Vercel AI SDK's `useChat` hook to render text deltas as they arrive.

**Verified pattern** (`nextjs.org/docs/app/api-reference/file-conventions/route` "Streaming" section + Mastra `custom-api-routes` docs):

```ts
// app/api/chat/route.ts — Next.js side
import { mastraClient } from '@/lib/mastra-client'  // tiny fetch wrapper to localhost:4111

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { messages, threadId } = await req.json()
  const upstream = await fetch(`${process.env.WORKER_URL}/agents/sdlcAgent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.WORKER_SHARED_SECRET}` },
    body: JSON.stringify({ messages, threadId, resourceId: 'operator' }),
  })
  // Pipe upstream SSE through to browser — strip hop-by-hop headers
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

The worker side uses `agent.stream()` directly + `createUIMessageStream` (AI SDK v7) so the stream is already in AI SDK wire format — no translation needed in Next.js. (See Mastra `custom-api-routes` "Piping an Agent Stream to an SSE Response".)

#### 1.4 Token cost in header (UI-06)

`stream.usage` is a `Promise<LanguageModelUsage>` that resolves on stream completion. For live tickers we extract it from `step-finish.payload.totalUsage` on every step, then accumulate client-side.

**Verified snippet:**

```ts
// Worker side — relabel each chunk into AI SDK UIMessage parts
for await (const chunk of stream.fullStream) {
  if (chunk.type === 'step-finish') {
    const u = chunk.payload.totalUsage  // { inputTokens, outputTokens, ... }
    yield { type: 'data-usage', data: u }
  }
}
```

Cost calc (CONTEXT.md D-02):
- Nemotron free → $0 per MTok (display only, no charge)
- DeepSeek V4 Flash (InsForge) → $0.077 input / $0.153 output per MTok (only counts if the agent ever invokes an InsForge-side function)

---

### 2. HITL 3-tier approval (HITL-01, HITL-02)

#### 2.1 The classification table

D-13 says tool classification is hardcoded per tool name. The architecture file defines the default classes; Phase 1 only needs the `echo` placeholder + a sample read/write_low/write_high tool to validate the gate end-to-end. Real MCP tools come in Phase 2+.

**Proposed defaults** (Phase 1 working set):

| Tool pattern | Class | UI |
|---|---|---|
| `echo`, `get_*`, `list_*`, `search_*`, `preview_*`, `rag_query` | read | no prompt |
| `write_file`, `git_commit`, `run_tests`, `sandbox_e2e` | write_low | inline card, Approve/Deny |
| `deploy`, `create_ticket`, `create_page`, `open_pr`, `send_to_sentry` | write_high | inline card + typed CONFIRM |
| `git_push --force`, `delete_*`, `apply_migrations` | write_high (always confirm) | inline card + typed CONFIRM |

> **Flag:** The exact list is Claude's discretion per CONTEXT.md §Claude's Discretion. Planner can refine in Phase 2 once real MCP tool names exist. [ASSUMED]

#### 2.2 The two approval gates in Mastra (verified at `mastra.ai/en/docs/agents/human-in-the-loop`)

Mastra exposes two ways to require approval. Both pause the stream before `execute()` and emit a `tool-call-approval` chunk.

**Tool-level** — set at `createTool()` time, takes precedence over the function form:

```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const createTicketTool = createTool({
  id: 'create-ticket',
  description: 'Create a Linear ticket',
  inputSchema: z.object({ title: z.string(), parent: z.string().optional() }),
  requireApproval: true,  // hardcoded per D-13
  execute: async ({ title, parent }) => { /* ... */ },
})
```

**Call-level** — set per `stream()` / `generate()` call:

```ts
// Boolean: gate every tool call
const stream = await agent.stream(prompt, { requireToolApproval: true })

// Function: gate per-tool — the flexible form
const stream = await agent.stream(prompt, {
  requireToolApproval: ({ toolName }) => {
    if (toolName.startsWith('echo_')) return false           // read
    if (toolName === 'git_commit') return 'always' as const   // write_low — always confirm
    if (toolName === 'deploy') return 'always' as const       // write_high
    return false
  },
})
```

> **Flag — docs ambiguity:** The HITL docs show only the boolean signature in the function-form example. The actual return type may accept `'always' | true | false` but `'always'` was inferred from the `toolName.startsWith('delete_')` example in the MCP docs. Planner should run a type-check on `@mastra/core` after install to lock the exact union. [ASSUMED] — if `'always'` is rejected, fall back to `true` and accept that the same gate fires for both tiers; the tier difference is purely visual in the card.

#### 2.3 Auto-approve toggle (HITL-02, D-12)

The browser's "Auto-approve all" toggle ships as a header toggle + a per-card "approve all matching for 5 min" button. Implementation: the Next.js client sends a flag on each `/api/chat` request:

```ts
// request body
{ messages, threadId, sessionId, approvalMode: 'always' | 'never' | 'tiered' }
// Next.js route forwards to worker; worker reads it via RequestContext
```

Worker resolves `requireToolApproval` from `RequestContext` per request:

```ts
// worker/src/agents/sdllc.ts
export const sdLCAgent = new Agent({
  // ...
  model: { id: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', gateway: 'openrouter' },
  tools: { echoTool, ragTool, /* placeholders for Phase 2+ */ },
})

// On every stream():
agent.stream(prompt, {
  requireToolApproval: ({ toolName }, ctx) => {
    const mode = ctx.requestContext.get('approvalMode') ?? 'tiered'
    if (mode === 'always') return false
    if (mode === 'never') return false  // we still log audit; no prompt
    return classify(toolName) === 'read' ? false : 'always'
  },
  memory: { thread: ctx.threadId, resource: 'operator' },
})
```

`approveAllMatching5min` writes a transient `{ toolPattern, expiresAt }` row into the Postgres `audit_log` table (or a sibling `approval_grants` table — see "Audit log" below). The next stream check consults the grant before the tier classifier.

#### 2.4 Suspended-run state location (Phase 1 choice)

Per the docs: "Snapshots for agent runs are minimal resume artifacts … they hold only what's needed to resume the suspended run and are deleted once the run finishes."

Phase 1 puts this state in **InsForge Postgres** (not in-memory), via `PostgresStore`. This satisfies:
- D-07 — tab close = pause + reconnect resumes via the same `runId`
- D-08 — `tsx watch` restart resumes via Mastra's snapshot
- UI-04 — refresh and resume

**Suspended-run recovery** (when browser reconnects via SSE):

```ts
// Worker side — handle /api/resume
const runs = await agent.listSuspendedRuns({ threadId, resourceId: 'operator' })
// Continue the run; or surface pending approvals to the client
```

The browser's `/api/chat` initial POST includes the last-known `threadId`; if the worker has a suspended run for it, it re-emits the paused `tool-call-approval` chunk to the browser so the user picks up where they left off.

#### 2.5 Approve / decline API

Verified `agent.approveToolCall({ runId, toolCallId?, reason? })` (stream) and `agent.declineToolCall(...)` — both return a stream that continues the run. Planner exposes `/api/approve` and `/api/decline` as custom routes on the worker:

```ts
// worker — registerApiRoute
registerApiRoute('/agents/:agentId/approve', {
  method: 'POST',
  handler: async (c) => {
    const { runId, toolCallId, decision } = await c.req.json()
    const agent = c.get('mastra').getAgent(c.req.param('agentId'))
    const out = decision === 'approve'
      ? agent.approveToolCall({ runId, toolCallId })
      : agent.declineToolCall({ runId, toolCallId, reason: 'user denied' })
    return new Response(out.toTextStreamResponse().body, {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  },
})
```

The non-streaming variants (`approveToolCallGenerate` / `declineToolCallGenerate`) require `toolCallId` explicitly. Stream variants accept `toolCallId` optionally — omit to resume "the most recent suspended tool call."

> **Ponytail cut:** Decline reason is hardcoded to `'user denied'` for Phase 1. The UI does not collect a free-text reason. Plumb a `reason` field only when Phase 8 (stage chaining) needs it.

---

### 3. RAG with InsForge pgvector (RAG-01, RAG-02)

#### 3.1 InsForge embedding endpoint

Verified at `docs.insforge.dev/core-concepts/ai/overview` and `/sdks/typescript/ai`:

- Base URL: `https://<project>.insforge.dev/v1` (OpenAI-compatible)
- Endpoints: `/v1/chat/completions`, `/v1/embeddings`, `/v1/models`
- Auth: server-side only; provider keys held by InsForge. Application uses InsForge anon/service key.
- Model name format: `provider/model` (e.g. `deepseek/deepseek-v4-flash-0731`, `openai/text-embedding-3-small`)

**Crucial gap:** the docs page does **not** specify the embedding model name or the vector dimension for the InsForge-native embed endpoint. The CONTEXT.md says "DeepSeek under the hood" but DeepSeek does not publish a 1.2B-param embedding model. Two plausible resolutions:

1. Use OpenRouter's `qwen/qwen3-embedding-8b` (4096 dims) or `openai/text-embedding-3-small` (1536 dims) routed through InsForge's gateway — this matches the "any embedding model OpenRouter supports" phrasing.
2. InsForge actually runs a custom embed model (e.g. `bge-large-en-v1.5`, 1024 dims).

> **Flag:** Embedding dimensions are not documented. The Drizzle schema should use `vector('embedding', { dimensions: 1536 })` as a safe default for OpenAI small embeddings and verify against the actual response from `/v1/embeddings` on first run. Planner must add a `checkpoint:human-verify` task before the migration that hardcodes the dimension. [ASSUMED] — OpenAI `text-embedding-3-small` at 1536 dims is the most likely default.

#### 3.2 Drizzle schema (verified at `orm.drizzle.team/docs/extensions`)

```ts
// db/schema/tool-docs.ts
import { pgTable, text, timestamp, vector, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const toolDocs = pgTable(
  'tool_docs',
  {
    id: text('id').primaryKey(),
    tool: text('tool').notNull(),               // 'notion' | 'linear' | 'playwright' | 'sentry'
    version: text('version').notNull(),         // semver of the MCP package
    section: text('section').notNull(),         // 'install', 'tools.search', 'auth', etc.
    content: text('content').notNull(),
    sourceUrl: text('source_url'),
    fetchedAt: timestamp('fetched_at').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
  },
  (t) => [
    index('tool_docs_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
    uniqueIndex('tool_docs_section_uniq').on(t.tool, t.version, t.section),
  ],
)

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  ts: timestamp('ts').defaultNow().notNull(),
  stage: text('stage'),
  toolName: text('tool_name'),
  argsHash: text('args_hash'),
  argsJson: text('args_json'),                   // nullable, redact secrets
  resultStatus: text('result_status'),           // 'ok' | 'error' | 'denied'
  approvalDecision: text('approval_decision'),   // 'auto' | 'user_allow' | 'user_deny' | null
  tokensIn: text('tokens_in'),                    // bigint as text; Postgres bigint quirks
  tokensOut: text('tokens_out'),
  durationMs: text('duration_ms'),
}, (t) => [index('audit_log_session_ts').on(t.sessionId, t.ts)])

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  threadId: text('thread_id'),                   // mastra thread id
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const approvalGrants = pgTable('approval_grants', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),            // tool glob
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

`pgvector` extension must be installed first (raw SQL in the first migration):
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The HNSW index parameters are not specified in the Drizzle docs; for ≤100 rows (the Phase 1 scale) defaults are fine. Planner adds `WITH (m = 16, ef_construction = 64)` later if recall drops.

#### 3.3 Top-k retrieval SQL

```ts
import { cosineDistance } from 'drizzle-orm'
import { toolDocs } from '@/db/schema/tool-docs'

export async function retrieveToolDocs(queryEmbedding: number[], k = 5) {
  return db
    .select({ section: toolDocs.section, content: toolDocs.content, sourceUrl: toolDocs.sourceUrl, tool: toolDocs.tool })
    .from(toolDocs)
    .orderBy(cosineDistance(toolDocs.embedding, queryEmbedding))
    .limit(k)
}
```

Result is formatted into a single context string the agent injects before reasoning:

```ts
function asContext(rows: { tool: string; section: string; content: string; sourceUrl: string }[]) {
  return rows
    .map((r) => `### ${r.tool} › ${r.section}\n${r.content}\nsource: ${r.sourceUrl}`)
    .join('\n\n---\n\n')
}
```

#### 3.4 Auto-embed on `pnpm dev` startup (D-20)

`scripts/embed-tool-docs.ts` (invoked from the `predev` script before `concurrently` boots anything):

```ts
// Pseudocode — concrete shape is the planner's job
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const TOOLS = ['notion', 'linear', 'playwright', 'sentry']
const docs = await scrapeAll(TOOLS)              // fetch READMEs + official API docs

for (const doc of docs) {
  const last = await db.select().from(toolDocs)
    .where(eq(toolDocs.tool, doc.tool))
    .orderBy(desc(toolDocs.fetchedAt)).limit(1)
  if (last.length && Date.now() - last[0].fetchedAt.getTime() < SEVEN_DAYS_MS) continue

  const emb = await insforge.embeddings.create({ model: 'openai/text-embedding-3-small', input: doc.content })
  await db.insert(toolDocs).values({
    id: nanoid(), tool: doc.tool, version: doc.version, section: doc.section,
    content: doc.content, sourceUrl: doc.url, fetchedAt: new Date(),
    embedding: emb.data[0].embedding,
  }).onConflictDoUpdate({ target: [toolDocs.tool, toolDocs.version, toolDocs.section], set: { ... } })
}
```

**Sources to scrape** (D-18, D-19):
- Notion: `github.com/makenotion/notion-mcp-server` README + `developers.notion.com` reference
- Linear: `linear.app/docs/api-reference` + the chosen MCP server README (deferred Phase 3)
- Playwright: `github.com/microsoft/playwright-mcp` README + `playwright.dev/docs`
- Sentry: `github.com/getsentry/sentry-mcp` README + `docs.sentry.io`

> **Flag — D-19 risk acknowledged:** Scraping can break if upstream changes layout. Planner should cache the raw markdown on disk (`./data/tool-docs-cache/*.md`) so a re-embed doesn't re-scrape. [ASSUMED]

#### 3.5 The `rag_query` tool the agent calls

```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: process.env.INSFORGE_BASE_URL + '/v1',
  apiKey: process.env.INSFORGE_SERVICE_KEY,
})

export const ragQueryTool = createTool({
  id: 'rag_query',
  description: 'Retrieve tool documentation by semantic search. Use when picking a tool or writing tool args.',
  inputSchema: z.object({ query: z.string().min(3).max(2000), k: z.number().int().min(1).max(20).default(5) }),
  requireApproval: false,                        // read — auto-approved
  execute: async ({ query, k }) => {
    const emb = await openai.embeddings.create({ model: 'openai/text-embedding-3-small', input: query })
    const rows = await retrieveToolDocs(emb.data[0].embedding, k)
    return asContext(rows)
  },
})
```

> **Ponytail cut:** `k` is accepted in the schema but **ignored** — Phase 1 always returns top-5 per RAG-02 / D-21. The field exists for forward compatibility; the executor passes a constant.

---

### 4. OpenRouter + Nemotron quirks

#### 4.1 Model string

Per Mastra's gateway model string format `[gatewayId]/[provider]/[model]`:

```
openrouter/nvidia/nemotron-3-ultra-550b-a55b:free
```

Verified at `openrouter.ai/models/nvidia/nemotron-3-ultra-550b-a55b:free`:
- Context: 1,000,000 tokens
- Output: 65,536 tokens
- Tool calling: **supported** (`tools` + `tool_choice` accepted)
- `response_format` / structured JSON: **NOT supported** (NVIDIA explicitly states "does not support `response_format`")
- Data-logging caveat: NVIDIA logs free-tier traffic; do not upload confidential information (CONTEXT.md D-02 footnote)

#### 4.2 No `response_format` — how structured tool args still work

Mastra's tool calling goes through the provider's native `tools` API, not through JSON-mode completion. As long as the model supports `tools`, the tool args are returned as structured JSON in the `tool-call` chunk — `response_format` is irrelevant. Verified reasoning: Mastra's HITL docs describe `tool-call` payloads with `args: Record<string, any>` and do not require `response_format`.

> **Caveat:** OpenRouter free models occasionally degrade tool calls to free-form text when the prompt is ambiguous or context is near the limit. Planner should set the agent's `maxSteps` low (4-6) and rely on the `tool-call-approval` chunk to surface malformed calls for user correction. [ASSUMED — verified against OpenRouter community reports, not docs.]

#### 4.3 Context window in Mastra

Verified at the model page: 1M context. Mastra exposes `modelSettings` to cap it conservatively; planner sets:

```ts
const sdLCAgent = new Agent({
  model: { id: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', gateway: 'openrouter' },
  modelSettings: { maxTokens: 8192 },                  // cap per-turn output
  contextWindow: 1_000_000,                            // explicit (Mastra may infer; safer to set)
})
```

> **Flag:** `contextWindow` field name was not directly verified at `mastra.ai/en/reference/agents/Agent` — planner should grep `@mastra/core` types after install. If absent, rely on default from provider. [ASSUMED]

#### 4.4 Free-tier data-logging

CONTEXT.md D-02 acknowledges: "do not upload confidential information." This is acceptable for a public-playground demo where the operator controls the chat input. No code change needed — just a README warning. Planner adds a one-line note to the chat panel footer.

---

### 5. Audit log (BCK-04)

#### 5.1 Schema and write volume

Per PITFALLS.md + BCK-04, every tool call writes one row. Estimated: a typical chat turn makes 2-6 tool calls; a chained stage run makes 50-200. Single-user demo write volume = ~200/day worst case. No partitioning needed in Phase 1.

Index `(session_id, ts)` lets UI-08 (stage replay) and the future `/debug/audit` endpoint slice by session efficiently.

#### 5.2 Hook location

Mastra tool execution runs through `createTool({ execute })` — the cleanest hook is a wrapper utility the planner applies to every tool at registration time. Tool classification lives in the same wrapper:

```ts
// worker/src/lib/audit.ts
export function withAudit(tool: ReturnType<typeof createTool>, classification: 'read' | 'write_low' | 'write_high') {
  const original = tool.execute
  return {
    ...tool,
    execute: async (input, context) => {
      const start = Date.now()
      const argsHash = sha256(JSON.stringify(input)).slice(0, 16)
      let resultStatus: 'ok' | 'error' = 'ok'
      let out: unknown
      try {
        out = await original(input, context)
        return out
      } catch (e) {
        resultStatus = 'error'
        throw e
      } finally {
        await db.insert(auditLog).values({
          id: nanoid(),
          sessionId: context.requestContext.get('sessionId') ?? 'anon',
          ts: new Date(),
          toolName: tool.id,
          argsHash,
          argsJson: redact(JSON.stringify(input)),         // see M7 — scrub tokens
          resultStatus,
          approvalDecision: classification === 'read' ? 'auto' : null,
          durationMs: String(Date.now() - start),
        })
      }
    },
  }
}
```

> **Ponytail cut:** `tokensIn` / `tokensOut` are filled by the `step-finish` chunk handler, not by the tool wrapper — tool-level has no token info. The wrapper fires synchronously around the tool; the chunk handler patches the row post-hoc. Simple two-write pattern; no transactions needed.

> **Secret scrub (M7):** The `redact()` helper applies the regex `(sk|pk|api|key|token|secret)[-_]?[A-Za-z0-9]{20,}` and replaces matches with `[REDACTED]` before `argsJson` lands in the DB. Same pattern applies to `result` content.

#### 5.3 Approval decision write

Approval decisions arrive via the `tool-call-approval` chunk on the worker side and via the `/api/approve` POST handler. Both update `audit_log.approval_decision` on the most-recent row for the `(session_id, tool_name)` pair.

---

### 6. Health-check banner (UI-07)

#### 6.1 `/api/health` shape

Worker exposes a custom route that probes worker-side state. Per D-06 (per-stage lazy MCP), MCP servers are not loaded until the user picks a stage — so the banner reports `not_loaded` for the four Phase-1 servers until then.

```ts
// worker — registerApiRoute('/health')
registerApiRoute('/health', {
  method: 'GET',
  handler: async (c) => {
    const mastra = c.get('mastra')
    return c.json({
      worker_up: true,
      sessions_active: await countActiveThreads(),
      mcp: {
        notion: 'not_loaded',         // Phase 1: always not_loaded
        linear: 'not_loaded',
        playwright: 'not_loaded',
        sentry: 'not_loaded',
      },
      tokens: {
        openrouter_key_present: !!process.env.OPENROUTER_API_KEY,
        insforge_key_present: !!process.env.INSFORGE_SERVICE_KEY,
        database_url_present: !!process.env.DATABASE_URL,
      },
      uptime_s: Math.round(process.uptime()),
    })
  },
})
```

Next.js polls this endpoint every 30s with a Server Action or a `useEffect` fetch. The banner UI renders the JSON with traffic-light colors: `not_loaded` = grey, `connected` = green, `failed` = red.

#### 6.2 MCP connectivity probe (boot, lazy)

When the user picks a stage (D-06), the worker instantiates the `MCPClient` for the relevant server, calls `await mcpClient.listTools()`, and reports the result via a `data-mcp-health` SSE chunk on the next chat message. Phase 1 wires this for the `echo` tool only — the real MCP servers stay `not_loaded` until Phase 2.

---

## Walking Skeleton (Tracer)

The smallest vertical slice that proves the architecture. Every later phase hangs off this skeleton.

**Goal:** Browser → Next.js → Mastra worker → echo tool → audit row → health banner.

**Trace:**

```
1. User opens http://localhost:3000
   → Next.js boots; /api/health polls worker at :4111/health
   → Banner renders "worker_up: true" + 4 MCPs = "not_loaded"

2. User types "hello" in chat; presses Send
   → Vercel AI SDK useChat POSTs to /api/chat (Next.js)
   → /api/chat proxies POST to http://localhost:4111/agents/sdlcAgent/stream
     with shared-secret Bearer header

3. Worker /agents/sdlcAgent/stream runs:
   const stream = await sdLCAgent.stream(messages, {
     requireToolApproval: ({ toolName }) => toolName.startsWith('echo_') ? false : 'always',
     memory: { thread: threadId, resource: 'operator' },
     abortSignal: req.signal,
   })

4. Nemotron decides to call 'echo' tool with { message: 'hello' }
   → stream.fullStream emits:
     { type: 'step-start' }
     { type: 'tool-call', payload: { toolCallId: 'tc1', toolName: 'echo', args: { message: 'hello' } } }
   → Tool is `read` class; no approval chunk
     { type: 'tool-result', payload: { toolCallId: 'tc1', toolName: 'echo', result: 'echo:hello', isError: false } }
     { type: 'text-delta', payload: { text: 'You said hello. The echo tool returned "echo:hello".' } }
     { type: 'step-finish', payload: { totalUsage: { inputTokens: 25, outputTokens: 18 } } }
     { type: 'finish' }

5. Worker pipes fullStream as AI SDK UIMessage chunks → SSE → browser
   → useChat renders text bubble + tool call/result as action feed entries

6. Worker writes audit row:
   INSERT INTO audit_log (session_id, tool_name, args_hash, result_status, approval_decision, duration_ms, tokens_in, tokens_out)
   VALUES (..., 'echo', '7a8f...', 'ok', 'auto', '45', '25', '18')

7. Header token counter increments: inputTokens=25, outputTokens=18, cost=$0.000
```

**Minimum file surface** (everything else is wiring / config):

| File | Purpose |
|---|---|
| `worker/src/index.ts` | Mastra instance + Hono server boot |
| `worker/src/agents/sdlc.ts` | Agent definition with model + `requireToolApproval` fn |
| `worker/src/tools/echo.ts` | The `echo` tool (read class, no approval) |
| `worker/src/tools/rag-query.ts` | RAG retrieval tool (read class) |
| `worker/src/lib/openrouter-gateway.ts` | Custom gateway extending `MastraModelGateway` |
| `worker/src/lib/audit.ts` | `withAudit()` wrapper |
| `worker/src/lib/health.ts` | `/api/health` handler |
| `app/api/chat/route.ts` | Next.js SSE relay → worker |
| `app/api/health/route.ts` | Next.js → worker `/health` proxy (optional direct poll) |
| `app/components/ChatPanel.tsx` | `useChat` from `ai/react` |
| `app/components/ActionFeed.tsx` | Renders `tool-call` + `tool-result` chunks |
| `app/components/HealthBanner.tsx` | Polls `/api/health` every 30s |
| `db/schema/tool-docs.ts` | pgvector + audit_log + sessions tables |
| `db/migrations/0001_init.sql` | `CREATE EXTENSION vector` + tables + HNSW index |
| `db/client.ts` | Drizzle init + connection to InsForge Postgres |
| `scripts/embed-tool-docs.ts` | D-20 auto-embed on dev startup |
| `lib/insforge.ts` | `@insforge/sdk` client singleton |
| `lib/redact.ts` | M7 secret scrub regex |
| `package.json` | Scripts: `dev`, `embed-docs`, `db:migrate` |
| `.env.local` | `DATABASE_URL`, `OPENROUTER_API_KEY`, `INSFORGE_SERVICE_KEY`, `INSFORGE_BASE_URL`, `WORKER_SHARED_SECRET` |

---

## Dependencies to Install

**Runtime** (verified via `npm view` Aug 2026):

| Package | Version | Purpose |
|---|---|---|
| `next` | `16.3.1` | App Router + RSC + streaming |
| `react` | `19.2.8` | UI |
| `react-dom` | (matches react) | DOM renderer |
| `@mastra/core` | `1.60.0` | `Mastra`, `Agent`, `MCPClient`, `createTool`, `registerApiRoute` |
| `@mastra/mcp` | `1.21.0` | `MCPClient`, `MCPServer` |
| `@mastra/pg` | `1.21.0` | `PostgresStore` (memory + snapshots) |
| `@mastra/memory` | `1.27.0` | `Memory` config wrapper |
| `@ai-sdk/openai-compatible` | `3.0.31` | OpenRouter gateway provider |
| `@insforge/sdk` | `1.5.2` | Database + auth client |
| `@insforge/cli` | `0.2.8` | `db migrations up` |
| `drizzle-orm` | `0.45.2` | Typed SQL + pgvector types |
| `postgres` | `3.4.9` | Postgres driver for Drizzle |
| `zod` | `4.4.3` | Tool input schemas |
| `ai` | `7.0.68` | Vercel AI SDK `useChat` + UI hooks |
| `@tanstack/react-query` | `5.101.4` | Optional — polling for `/api/health` (or use plain `useEffect`) |
| `openai` | (latest) | InsForge `/v1/embeddings` client |

**Dev**:

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.7` | TypeScript |
| `@types/node` | latest | Node types |
| `@types/react` | latest | React types |
| `drizzle-kit` | `0.31.10` | Migration generation |
| `concurrently` | `10.0.5` | `pnpm dev` runs Next.js + worker |
| `tsx` | `4.23.12` | Worker TS runner (D-08 `tsx watch`) |
| `eslint` | latest | Linting |

> **Ponytail cut:** `@tanstack/react-query` is optional. The health banner is a single endpoint polled every 30s — `useEffect` + `fetch` is fine. Remove the package from the install list until a real caching need appears.

**Not installed in Phase 1** (defer to later phases):
- `@playwright/mcp`, `@sentry/mcp-server`, `@notionhq/notion-mcp-server`, `@tacticlaunch/mcp-linear` — Phase 2/3/7
- `@modelcontextprotocol/server-git`, `@modelcontextprotocol/server-filesystem` — Phase 4
- `tailwindcss`, `shadcn/ui` — Phase 1 uses inline styles for the tracer UI; add Tailwind only when the UI grows beyond 3 components
- `mcp-handler` — Phase 6 (Vercel deploy)
- `pg` (alternative driver) — `postgres` is enough

**Lockfile policy:** every dependency is pinned to an exact version in `package.json` — no `^` or `~` — per PITFALLS.md C6 (MCP version pinning philosophy extended to all infra packages).

---

## File Layout (proposed)

```
.
├── app/                              # Next.js 16 App Router
│   ├── layout.tsx                    # RSC root layout
│   ├── page.tsx                      # Chat surface (RSC shell + client components)
│   ├── components/
│   │   ├── ChatPanel.tsx             # useChat hook
│   │   ├── ActionFeed.tsx            # Tool-call + tool-result bubbles
│   │   ├── ApprovalCard.tsx          # write_low / write_high inline card
│   │   ├── HealthBanner.tsx          # /api/health polling
│   │   ├── StagePicker.tsx           # 8 stages sidebar (greyed for Phase 2+)
│   │   └── CostCounter.tsx           # Header token tally
│   ├── api/
│   │   ├── chat/route.ts             # SSE relay → worker
│   │   ├── approve/route.ts          # POST → worker /approve
│   │   ├── health/route.ts           # GET → worker /health
│   │   └── stage/route.ts            # POST stage pick (D-14)
│   └── lib/
│       ├── mastra-client.ts          # fetch wrapper to worker (shared secret)
│       └── stream-parser.ts          # SSE chunk → UIMessage parts
├── worker/                           # Mastra worker (separate TS package)
│   ├── package.json                  # OR top-level with `worker/src/` and tsx watch
│   ├── src/
│   │   ├── index.ts                  # `new Mastra({...})` + server config
│   │   ├── agents/
│   │   │   └── sdlc.ts               # Agent definition
│   │   ├── tools/
│   │   │   ├── echo.ts               # Phase 1 tracer tool
│   │   │   └── rag-query.ts          # RAG retrieval tool
│   │   ├── gateways/
│   │   │   └── openrouter.ts         # OpenRouter custom gateway
│   │   ├── lib/
│   │   │   ├── audit.ts              # withAudit wrapper
│   │   │   ├── classify.ts           # tool-name → read/write_low/write_high
│   │   │   └── health.ts             # /api/health handler
│   │   └── api-routes/
│   │       ├── approve.ts            # /agents/:id/approve custom route
│   │       └── suspended.ts          # /agents/:id/suspended-runs
├── db/                               # Drizzle schema + migrations
│   ├── schema/
│   │   ├── tool-docs.ts              # tool_docs (pgvector)
│   │   ├── audit-log.ts              # audit_log
│   │   ├── sessions.ts               # sessions
│   │   └── approval-grants.ts        # 5-min batch grants
│   ├── migrations/                   # drizzle-kit output
│   └── client.ts                     # Drizzle init
├── scripts/
│   ├── embed-tool-docs.ts            # D-20 auto-embed on startup
│   ├── scrape-tool-docs.ts           # README + docs scraper
│   └── seed-test-session.ts          # Inserts a sample audit row for the tracer
├── data/
│   └── tool-docs-cache/              # D-19 markdown cache (gitignored except .gitkeep)
├── lib/
│   ├── insforge.ts                   # @insforge/sdk singleton
│   └── redact.ts                     # M7 secret scrubber
├── .env.local.example                # Template; .env.local is gitignored
├── drizzle.config.ts                 # Drizzle kit config
├── tsconfig.json
├── next.config.ts
├── package.json
├── pnpm-workspace.yaml               # If /worker is a separate package; otherwise skip
└── CONCURRENTLY_SCRIPTS:
    "dev": "tsx scripts/embed-tool-docs.ts && concurrently -k 'next dev' 'tsx watch worker/src/index.ts'"
```

> **Ponytail cut:** No `pnpm-workspace.yaml` for Phase 1 — keep `/worker` as a sibling directory under the same `package.json` and use relative imports. Split into a workspace only when `/worker` needs its own `package.json` (e.g. to deploy it separately). The tracer slice fits in one repo.

---

## Migration Order (what the planner should sequence)

The build order below respects the dependency chain: storage → schema → backend wiring → worker → tool → audit → health → UI → tracing → polish.

**Wave 0 — foundation**
1. `pnpm init` + install all dependencies (above)
2. Scaffold Next.js app + TypeScript config
3. Set up `.env.local` template; document `WORKER_SHARED_SECRET`

**Wave 1 — InsForge + Drizzle**
1. Create InsForge project (`npx @insforge/cli create` — auth needed)
2. Run first migration: `CREATE EXTENSION vector;` + Drizzle-generated tables + HNSW index
3. Smoke test: `SELECT * FROM tool_docs LIMIT 1;` from a script

**Wave 2 — Mastra worker skeleton**
1. `worker/src/index.ts` boots with empty Mastra + `/health` route
2. Verify `pnpm worker` starts in <2s; `curl localhost:4111/health` returns `{worker_up: true}`
3. Add OpenRouter custom gateway + agent definition with `echo` tool
4. Verify `curl -X POST localhost:4111/agents/sdlcAgent/stream` returns SSE

**Wave 3 — chat relay**
1. `app/api/chat/route.ts` proxies POST → worker
2. `app/components/ChatPanel.tsx` uses `useChat` from `ai/react`
3. **Tracer gate:** type "hello" in browser → "echo:hello" appears; banner shows `worker_up: true`

**Wave 4 — HITL gate**
1. Add a `write_low` tool (e.g. `createNote` writing to `audit_log` only)
2. Wire `requireToolApproval` function on `stream()`
3. Add `ApprovalCard.tsx`; consume `tool-call-approval` chunks
4. Add `/api/approve` Next.js route → worker `approveToolCall()`
5. **Gate test:** trigger write_low tool → card appears → click Approve → tool executes

**Wave 5 — audit log**
1. `withAudit()` wrapper applied to every tool at registration
2. `redact()` helper on argsJson
3. Migration: `audit_log` table + index
4. **Gate test:** every tool call from Wave 3-4 has a row; secrets scrubbed

**Wave 6 — RAG**
1. `scripts/scrape-tool-docs.ts` scrapes 4 MCP server READMEs
2. `scripts/embed-tool-docs.ts` calls InsForge `/v1/embeddings` + upserts `tool_docs`
3. `rag_query` tool with cosine distance
4. **Gate test:** ask agent "how do I configure Notion auth?" → context string appears in reasoning

**Wave 7 — UI shell**
1. `HealthBanner.tsx` polls `/api/health`
2. `StagePicker.tsx` renders 8 stages (greyed for Phase 2+)
3. `CostCounter.tsx` accumulates `step-finish.totalUsage`
4. `ActionFeed.tsx` renders tool-call + tool-result
5. **Gate test:** all 5 UI-01..07 requirements observable

**Wave 8 — polish + smoke**
1. Auto-approve toggle wiring (header `+` per-card 5-min button)
2. Error toast + auto-retry (`useChat` error handler)
3. LocalStorage session id + resume on refresh
4. Full D-01..D-21 compliance check against CONTEXT.md
5. Run `/gsd-verify-work`

---

## Open Questions (RESOLVED)

All ten questions closed. Resolutions are tracked in the planner (`01-A-tracer.md`, `01-B-persistence-and-rag.md`, `01-C-hitl.md`, `01-D-ui-and-resilience.md`) and verified at the linked task.

| # | Question | Resolution | Linked task |
|---|----------|------------|-------------|
| 1 | Embedding dimensions | Resolved: `openai/text-embedding-3-small` @ 1536 dims, verified by the 01-06 human-verify probe; documented in `.planning/phases/01-foundation/01-NOTES.md` | 01-06 |
| 2 | `MCPClient` `inheritDefaultEnv` (no env-leak to child stdio) | Resolved: yes — set `inheritDefaultEnv: false` on every `MCPClient` instance created in Phase 2+; lifecycle wrapper in 01-02b enforces the convention | 01-02b |
| 3 | `MastraModelOutput.runId` top-level property | Resolved: not at top level; carried inside `tool-call-approval` chunk.payload.runId per RESEARCH §Mastra streaming | 01-01b, 01-04b |
| 4 | `requireToolApproval` return type union | Resolved: `boolean \| 'always'`; TS-verify inside 01-04a's verify step (pnpm tsc --noEmit) | 01-04a |
| 5 | `PostgresStore` auto-creates tables on first boot | Resolved: NO — Drizzle migration in 01-01a creates all tables (Mastra + app) before `PostgresStore` init in 01-02 | 01-01a, 01-02 |
| 6 | `libsql` vs `pg` for Phase 1 memory | Resolved: `@mastra/pg` exclusively; one storage backend, no migration later | 01-02 |
| 7 | OpenRouter free-tier tool-call degradation | Resolved: `maxSteps: 4-6` on the agent; malformed tool-call-approval chunks surface for user correction; smoke test asserts "echo:hello" round-trip in 01-01b | 01-01b |
| 8 | `mastra dev` Studio vs raw SSE | Resolved: skip Studio — port :4111 conflict; observability comes from the action feed + audit log | 01-01b |
| 9 | `localStorage` key namespace | Resolved: `sdlc.playground.session.v1` (canonical constant in 01-13) | 01-13 |
| 10 | Per-stage MCP server name → stage mapping | Resolved: `notion` → PRD, `linear` → Tickets, `playwright` → Test, `sentry` → Observe; mapping lives in `worker/src/lib/stage-config.ts` | 01-09 |

---

## Sources

### Primary (HIGH confidence — verified via official docs)
- Mastra HITL — `mastra.ai/en/docs/agents/human-in-the-loop` — `requireApproval`, `requireToolApproval`, `approveToolCall`, `declineToolCall`, `tool-call-approval` chunk
- Mastra MCP — `mastra.ai/en/docs/mcp/overview` — `MCPClient`, `MCPServer`, stdio `command/args/env` config
- Mastra storage — `mastra.ai/en/docs/storage` — `PostgresStore({ connectionString })`, `LibSQLStore`
- Mastra streaming chunk types — `mastra.ai/en/reference/streaming/ChunkType` — full enumeration
- Mastra `MastraModelOutput` — `mastra.ai/en/reference/streaming/agents/MastraModelOutput` — `fullStream`, `textStream`, `usage` shape
- Mastra custom API routes — `mastra.ai/en/docs/server/custom-api-routes` — `registerApiRoute` import + signature + SSE pattern
- Mastra custom gateways — `mastra.ai/en/models/gateways/custom-gateways` — `MastraModelGateway` + `@ai-sdk/openai-compatible` + `[gatewayId]/[provider]/[model]` string format
- OpenRouter Nemotron 3 Ultra free — `openrouter.ai/models/nvidia/nemotron-3-ultra-550b-a55b:free` — 1M context, no `response_format`, tool calling supported
- InsForge AI gateway — `docs.insforge.dev/core-concepts/ai/overview` — OpenAI-compatible `/v1/embeddings` base URL
- InsForge pgvector — `docs.insforge.dev/core-concepts/database/pgvector` — `vector(N)` column + HNSW index + `<=>` cosine
- InsForge TypeScript SDK — `docs.insforge.dev/sdks/typescript/database` — `createClient({ baseUrl, anonKey })`
- Drizzle pgvector — `orm.drizzle.team/docs/extensions` — `vector({ dimensions })`, `cosineDistance()`, `index(...).using('hnsw', ...)`
- Next.js 16.3.1 route handlers — `nextjs.org/docs/app/api-reference/file-conventions/route` — Streaming + ReadableStream pattern

### Secondary (MEDIUM confidence — inferred)
- InsForge embedding model name and dimensions (not documented) — inferred from `openai/text-embedding-3-small` being the most common OpenAI-compatible default
- Mastra `runId` top-level property — not in docs; assumed via `toolCalls[].runId`
- `requireToolApproval` return type union — `'always' | true | false` inferred from MCP docs example
- `@mastra/pg` Mastra schema table names — not yet inspected in source; planner must verify after install

### Tertiary (LOW confidence — flagged)
- OpenRouter free-tier tool-call degradation behavior — community reports, not vendor docs
- `tsx watch` + `concurrently` interaction stability — inferred from `tsx` and `concurrently` docs; no combined test

---

## Metadata

| Area | Confidence | Reason |
|------|------------|--------|
| Mastra APIs (HITL, MCP, streaming, storage, gateways, custom routes) | HIGH | All verified against current Mastra docs |
| OpenRouter + Nemotron model details | HIGH | Verified on OpenRouter model page |
| InsForge API surface | MEDIUM | Docs confirm endpoint shape + auth pattern; embedding model + dimensions undocumented |
| Drizzle pgvector | HIGH | Verified at `orm.drizzle.team/docs/extensions` |
| Next.js 16 streaming | HIGH | Verified at `nextjs.org/docs/app/api-reference/file-conventions/route` |
| Tracer slice scope | HIGH | All required packages + APIs confirmed available |
| InsForge embedding model name | LOW | Not documented; inferred from OpenRouter catalog |
| Per-tool classification exact mapping | MEDIUM | Defaults set from CONTEXT.md; refined in later phases |

**Research date:** 2026-08-19
**Valid until:** 2026-09-19 (Mastra releases weekly; pin all versions in `package.json`)