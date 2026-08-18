# Architecture Patterns: AI Agent SDLC Orchestrator Playground

**Domain:** Agentic SDLC pipeline orchestrator (greenfield, single-user demo, $0 budget)
**Researched:** 2026-08-18
**Confidence:** HIGH for Claude Agent SDK + MCP + Skills + RAG patterns (sourced from official Anthropic docs via `claude-api` skill); MEDIUM for InsForge specifics (no direct docs surfaced in current toolchain)

---

## Recommended Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser (Next.js + Vercel free tier)                    │
│  Chat UI • Stage picker • Approval modal • SSE stream    │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTPS (SSE for agent events, POST for commands)
┌──────────────────────▼───────────────────────────────────┐
│  Next.js API routes (Vercel serverless)                  │
│  /api/chat (SSE relay) • /api/approve • /api/stage       │
│  Session manager • Approval gate middleware              │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  Claude Agent SDK runtime (long-lived Node worker)       │
│  Agent loop • Tool router • Sub-agent spawning           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ MCP clients (lifecycle-managed by SDK)              │ │
│  │  ├── notion  (stdio child process)                  │ │
│  │  ├── linear  (stdio child process)                  │ │
│  │  ├── v0      (stdio child process)                  │ │
│  │  └── playwright (stdio child process)               │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ Custom tools (REST/CLI wrappers, NO MCP server)     │ │
│  │  ├── CodeRabbit • Snyk • Vercel • Sentry • SigNoz  │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ Coding sub-agent (claude-code-style subagent)       │ │
│  │  reads sandbox repo, writes code, git commit/push   │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ Skills (filesystem-loaded, progressive disclosure)  │ │
│  │  Anthropic pre-built + custom SDLC skills           │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ RAG retrieval tool                                  │ │
│  │  embeds query → top-k from InsForge vector store    │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
   External SaaS   InsForge           Sandbox repo
   (real APIs)     (DB + auth +       (local git for
                    vector store +     coding sub-agent
                    audit log)         commits/pushes)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|---|---|---|
| **Web UI (Next.js)** | Chat surface, stage picker, approval modal, real-time event rendering, session storage in `localStorage` | Next.js API routes over HTTPS |
| **Next.js API routes** | Session bootstrap, SSE relay to browser, command endpoints for approve/stage-pick, server-side secret access (Anthropic key, SaaS tokens) | Agent runtime worker over internal HTTP/SSE |
| **Agent runtime (Claude Agent SDK)** | Owns the agent loop, routes `tool_use` blocks to the correct executor, invokes skills, manages MCP lifecycles, spawns sub-agents, emits structured events upstream | MCP clients, custom tools, coding sub-agent, RAG retrieval tool, InsForge audit writer |
| **MCP clients (4)** | One per SaaS provider with MCP server available. Lifecycle is owned by the SDK (stdio child process or remote SSE). Each independently fails without taking down others | Notion / Linear / v0 / Playwright external APIs |
| **Custom tool wrappers (5)** | REST/CLI wrappers for SaaS without MCP servers. Implemented as in-process tool functions | CodeRabbit, Snyk, Vercel, Sentry, SigNoz external APIs |
| **Coding sub-agent** | A separate agent invocation with its own system prompt + tool subset (file read/write/edit, bash, git). Writes code, runs tests, commits/pushes to sandbox repo | Sandbox repo (local filesystem + git remote), parent agent (returns diff/PR URL + summary) |
| **Skills** | Reusable instruction bundles loaded on-demand by the SDK. Anthropic pre-built skills (`pptx`, `xlsx`, `pdf`, `docx`) for artifact generation + custom SDLC skills (e.g., "code review checklist") | Agent runtime (in-context loading via Skills API) |
| **RAG retrieval tool** | Custom tool that embeds query → fetches top-k from InsForge vector store → returns context chunks. Used by agent when grounding on tool docs OR project history | InsForge vector endpoint, embedding API |
| **InsForge backend** | Auth (single-user for v1), project context storage (PRD, tickets, code summaries, review notes), tool-docs vector index, audit log of all tool calls + approval decisions | Browser (auth + audit view), agent runtime (read/write), RAG tool |
| **Sandbox repo** | Git repository local to the runtime worker, cloned from a template. Coding sub-agent commits/pushes here. Cleaned at session end (per PROJECT.md constraint) | Coding sub-agent, optional Vercel deploy hook |

---

## Data Flow

### Primary chat loop

```
1. User types message in browser
   → POST /api/chat with {message, stage, session_id}
2. Next.js API route
   → validates session, resolves stage → tool subset + system prompt
   → opens SSE upstream to agent runtime
3. Agent runtime calls Claude with:
     - system prompt (stage-specific)
     - tool list (MCP + custom + sub-agents + RAG)
     - conversation history (from InsForge project_context)
     - top-k RAG chunks for current stage context
4. Claude reasons, emits content blocks including tool_use
5. Agent SDK routes each tool_use:
     - MCP tool name → MCP client → external service
     - Custom tool name → in-process function → REST/CLI
     - sub-agent tool name → spawn sub-agent invocation
     - RAG tool name → embed query → InsForge vector search
6. For DESTRUCTIVE tool calls (see HITL section):
     - Runtime holds the call, emits approval_required SSE event
     - Browser renders modal, user decides
     - POST /api/approve arrives, runtime resumes or denies
7. Tool result blocks stream back into agent context
8. Claude emits end_turn text block
9. SSE stream closes, browser renders final message
10. Runtime writes structured summary to InsForge (project_context table + re-embed for RAG)
```

### RAG retrieval points

- **Tool docs:** embedded into InsForge vector store ONCE during build/setup phase per tool. Never re-embedded at runtime. Retrieved when the agent reasons about which tool to use for an unfamiliar task.
- **Project context:** accumulated per stage transition. After each stage completes (PRD written, tickets created, code committed, review received), the runtime writes a summary to InsForge + embeds it. Future stage agents retrieve top-k from this history to maintain chain coherence.

### Project context persistence

InsForge holds three tables relevant here:
1. **`projects`** — one row per session, holds stage progress, current commit SHA, deployed URL
2. **`project_context_chunks`** — embedded summaries per stage, retrievable via RAG
3. **`audit_log`** — every tool call, every approval decision, every deploy, every external API response (for replay/debugging)

---

## MCP Server Lifecycle and Tool Registration

Claude Agent SDK provides first-class MCP lifecycle management. The agent runtime declares MCP servers in its config block; the SDK handles everything below.

### Transport options

| Transport | When to use | Example in this project |
|---|---|---|
| **stdio** (spawn child process) | npx-hosted MCP servers, single-tenant, lowest latency | Notion, Linear, v0, Playwright |
| **SSE** (connect to remote endpoint) | Hosted MCP service, shared multi-tenant | None for v1; reserved for future |

### Lifecycle phases (managed by SDK)

1. **Config declaration** — runtime config block names each MCP server with `command`, `args`, `env`, optional `transport`. Notion/Linear/v0/Playwright all use `command: "npx", args: ["-y", "<server-package>"]`.
2. **Process spawn (stdio)** — at agent startup, SDK spawns each MCP server as a child process. Stdin/stdout framing for JSON-RPC.
3. **Initialize handshake** — SDK sends `initialize` request, server returns capabilities (tools, resources, prompts).
4. **Tool registration** — SDK calls `tools/list` once. Each returned tool descriptor (`name`, `description`, `inputSchema`) becomes part of the Claude `tools` parameter. Per-tool config (timeout, retry, allowed_hosts) is set on the SDK config, not per-call.
5. **Tool invocation** — when Claude emits `tool_use`, SDK routes to the right MCP client, which sends `tools/call` and returns the result.
6. **Reconnect on failure** — child process exit or SSE drop triggers exponential-backoff reconnect. SDK auto-restarts stdio processes.
7. **Independent failure** — each MCP server has its own lifecycle. One crashing does not kill the others or the agent loop.
8. **Discovery cached for session** — `tools/list` is fetched once per session; tool schema does not change mid-session.

### Tool registration details

- Each tool gets `name` (e.g., `mcp__notion__create_page`) and a flat `inputSchema` JSON Schema.
- The SDK merges MCP tool descriptors with custom tool descriptors before sending to Claude — Claude sees a unified `tools` array.
- Sub-agent tools get the same treatment; parent agent invokes them like any other tool.

---

## Human-in-the-Loop Approval Gate Integration Points

Per PROJECT.md: "Default = human approves destructive actions. Toggle exists to enable auto-approve."

### Tool destructiveness categories

Categorize once at agent runtime startup; gate checks the category at execution time:

| Category | Examples | Default behavior |
|---|---|---|
| **Read-only** | Notion search, Linear list, v0 preview, CodeRabbit summary, Snyk scan, RAG retrieval | Auto-execute |
| **Locally destructive** | `git commit`, `git push`, `npm test`, run E2E in sandbox | Require approval |
| **Externally destructive** | Deploy to Vercel, create Linear ticket, create Notion page, open PR, send to Sentry | Require approval |

### Approval flow (when gate fires)

```
1. Agent emits tool_use for a destructive op
2. Runtime HOLDS the call (does NOT execute)
3. Runtime emits SSE event to browser:
     {type: "approval_required",
      tool_use_id, tool_name, args_preview, risk_summary}
4. Browser renders modal with diff/preview and Approve/Deny buttons
5. User clicks → POST /api/approve {tool_use_id, decision: "allow"|"deny"}
6. Runtime resumes:
     - "allow" → execute tool with original args, inject tool_result normally
     - "deny"  → inject synthetic tool_result:
                  {is_error: true, content: "User denied: <reason>"}
                  Claude adapts its plan
7. Decision lands in InsForge audit_log
```

### Toggle behavior

- User-facing toggle in browser: "Auto-approve destructive actions" (default OFF).
- When OFF: every destructive tool triggers the modal flow above.
- When ON: gate short-circuits, executes immediately, still logs to audit.
- Per-stage pre-approval (future): stage picker can pre-approve a category subset (e.g., "Code stage" pre-approves commit/push but still gates deploy). Not required for v1.

---

## Build Order (Dependency-Driven)

The order is strict — each rung needs the one above it to exist first.

1. **InsForge backend** (schema, auth, vector collection, audit table)
   *Why first:* everything writes to it. Audit log + RAG index need it. Without this nothing else is observable.
2. **Next.js scaffold** (chat UI skeleton, SSE relay endpoint, no agent yet)
   *Why second:* provides the only interaction surface. Can be tested with mock SSE.
3. **Claude Agent SDK runtime worker** (basic agent loop, zero tools, just chat)
   *Why third:* the spine. Everything else hangs off it. Validates SSE ↔ Claude round-trip.
4. **MCP lifecycle plumbing + first MCP integration (Notion)**
   *Why fourth:* proves the stdio child-process pattern. Notion has the simplest data shape (read page, write page). Once this works end-to-end, the other three MCP integrations are copy-paste.
5. **RAG retrieval tool** (InsForge vector endpoint + embed function + tool wrapper)
   *Why fifth:* needs at least one data source (the Notion PRD from step 4) to be useful. Indexes tool docs in parallel.
6. **Remaining MCP servers** (Linear, v0, Playwright) — *parallelizable*
   *Why sixth:* same pattern as Notion. Independent failures mean they can ship together.
7. **Custom REST/CLI wrappers** (CodeRabbit, Snyk, Vercel, Sentry, SigNoz)
   *Why seventh:* orthogonal to MCP. Can be built in any order; grouping them here so all tool wrappers are done before stage logic lands.
8. **Coding sub-agent** (commit + push to sandbox repo, returns diff/PR)
   *Why eighth:* the only step that needs a real filesystem + git. Depends on agent runtime having tools wired up but not on any specific MCP server.
9. **Human-in-the-loop approval gate middleware**
   *Why ninth:* wrapping every destructive tool is the last thing to integrate — by now every tool is known and the destructiveness table is complete. Avoids two-step refactoring.
10. **Stage picker UI** (maps user-selected stage → tool subset + system prompt)
    *Why tenth:* depends on the full tool inventory being stable. Adding/removing stages later is config-only.
11. **End-to-end chain test** (PRD → tickets → UI design → code → E2E → review → security → deploy → monitor)
    *Why last:* integration test that exercises every component. Catches wiring bugs only visible when the whole chain runs.

---

## Patterns to Follow

### 1. One MCP server per service boundary

Match the MCP server count to the SaaS provider count exactly. Do not multiplex Notion + Linear into one MCP server — the lifecycle, error handling, and tool schema differ enough that one wrapper per service is the simpler abstraction.

### 2. Tool docs in RAG, tool calls direct

Agents retrieve tool documentation from RAG when reasoning about unfamiliar tasks. Tool invocations always go direct to MCP/custom — never through RAG. Avoid loading full tool docs into the system prompt: burns context, goes stale, and is duplicated work the RAG layer already does.

### 3. Project context accumulates per tool result, embeds per stage transition

After every tool call, write a structured summary line to InsForge (one row per call). Re-embed into the vector store at stage boundaries (not every call — re-embedding every call is wasteful). This makes multi-stage chains coherent: the "Code" stage agent sees summaries of what the "PRD" and "Tickets" stages produced.

### 4. Skills for reusable patterns, system prompts for stage-specific instructions

Use Skills (filesystem-loaded, progressive disclosure via SDK) for reusable SDLC patterns — "code review checklist", "PR description template", "test naming convention". Use system prompts for stage-specific instructions — "you are the PRD stage agent, your output goes into Notion". Skills save context tokens because they load only when relevant.

### 5. Sub-agent per stage

Each SDLC stage is a separate agent invocation with its own system prompt + tool subset. Do not attempt the entire chain in one mega-agent: context explodes, single point of failure, no isolation between stages. Sub-agents get a focused tool list (e.g., the Code stage sub-agent sees git + file tools + CodeRabbit, not Notion or Linear).

### 6. SSE upstream, POST downstream

Chat events stream one way (SSE from runtime → browser). Approval decisions and stage picks go back via POST. Do not try to use SSE bidirectionally — SSE has no replay, no message IDs, and fights you when you try to send control commands through it.

### 7. Embed tool docs ONCE during build

Tool documentation is embedded into InsForge vector store at build time, not at runtime. Runtime never re-embeds — only retrieves. This bounds embedding cost and keeps the docs index fresh only when the build deliberately updates it.

---

## Anti-Patterns to Avoid

### 1. Loading all tool docs into the system prompt

Burns context window for static content, goes stale when tools change, and duplicates work RAG already does. Use RAG.

### 2. One mega-agent for the entire SDLC chain

Context explodes across stages; any single tool failure halts the whole chain; no isolation between stages. Use sub-agents per stage.

### 3. Mocking any tool

Explicit project rule from PROJECT.md ("No mocked responses"). Every integration is real. If a tool isn't wired up, the stage that needs it isn't ready — don't paper over it with stubs.

### 4. Skipping the approval gate for "obvious" destructive ops

Even `git commit` requires approval by default. "Default-on" means default-on. The toggle exists to opt out per session, not to be the default.

### 5. Storing SaaS tokens in InsForge plaintext

Tokens belong in runtime env vars (server-side secret storage), not in the database. InsForge holds project context + tool docs + audit log — none of which need raw tokens. The runtime reads tokens from env and passes them to MCP clients / custom tools at call time. Never log tokens to the audit table.

### 6. Putting MCP servers in the same process as the agent

Defeats the SDK's lifecycle benefit (auto-restart, independent failure, tool schema isolation). Always spawn as child processes via stdio or connect to remote SSE. The SDK manages this — just declare the config.

### 7. Polling for tool results instead of streaming

Burns latency budget. SDK streams `tool_result` messages back into agent context as they arrive. Polling adds seconds per call that compound across a stage.

### 8. Re-embedding tool docs at runtime

Already embedded at build time. Runtime re-embedding is pure cost with no benefit — the docs don't change between agent invocations.

### 9. Per-stage approval modal fatigue

If every tool in a stage needs approval, the user clicks "approve" 20 times per stage. Mitigate with category-level batching ("Code stage: approve all commits/pushes for the next 5 minutes") — not required for v1 but call it out as future work.

---

## Scalability Considerations

The playground is single-user, $0 budget — all "100 sessions" column applies for v1. The other columns are research notes for if the project ever becomes multi-user.

| Concern | 100 sessions (v1 target) | 10K sessions | 1M sessions |
|---|---|---|---|
| **Agent runtime** | One long-lived Node worker per session on Vercel; idle timeout acceptable | Move to Vercel serverless; cold-start ~1s acceptable for SDLC latency | Managed Agents (CMA) with hosted containers |
| **MCP servers** | stdio per-agent (one MCP child per session) works fine | stdio explodes — switch to remote SSE MCP or shared connection pool with circuit breakers | Dedicated MCP gateway service with rate limiting per upstream SaaS |
| **InsForge (DB + vectors)** | Free tier fine | Hit rate limits → migrate to Supabase (documented fallback) | Dedicated Postgres + pgvector / dedicated vector DB (Pinecone, Weaviate) |
| **RAG retrieval latency** | Inline retrieval in agent loop OK | Add embedding cache + retrieval result cache keyed by query hash | Pre-compute retrievals async, ship top-k into context window pre-emptively |
| **SSE connection count** | Browser SSE per tab fine | WebSocket gateway for fan-out to multiple consumers per session | Edge SSE via CDN + Cloudflare Workers streaming |
| **Approval gate state** | In-memory per session | Move to Redis with TTL matching session length | Postgres-backed audit + decision store; replayable |
| **Coding sub-agent sandbox** | Local git dir per session, cleaned at session end | Isolated container per session (Docker or Firecracker) | Ephemeral VM per session with network egress controls |
| **Audit log volume** | InsForge handles fine | Move audit to append-only log store (CloudWatch, Loki) with InsForge keeping only recent window | Distributed tracing backend (Jaeger, SigNoz at scale) |
| **Tool doc index size** | All tool docs fit in one vector collection | Split per-stage collections; pre-filter before embedding search | Hierarchical retrieval with tool-category routing |

---

## Sources

- `claude-api` skill → `shared/agent-design.md` — Tool surface design, MCP lifecycle, sub-agents, Skills, memory, context management
- `claude-api` skill → `shared/managed-agents-tools.md` — MCP server config, vault credentials, Skills API
- `claude-api` skill → `shared/prompt-caching.md` — Cache breakpoint placement (relevant for RAG retrieval result caching)
- `claude-api` skill → `shared/managed-agents-overview.md` — Agent → Session flow, persistent agent configs (relevant for per-stage sub-agents)
- `claude-api` skill → `python/claude-api/tool-use.md` — Tool runner pattern, MCP tool conversion helpers
- `.planning/PROJECT.md` — Project constraints (free tier, single-user, real integrations, HITL default-on, $0 budget, Claude Agent SDK runtime, InsForge backend, Next.js + Vercel UI)
- `.planning/config.json` — Workflow flags (security enforcement on, AI integration phase on, research mode enabled)

**Confidence notes:**
- Claude Agent SDK + MCP + Skills patterns: HIGH — sourced directly from official Anthropic documentation via the `claude-api` skill.
- RAG retrieval timing + InsForge schema: MEDIUM — pattern follows standard retrieval-augmented generation architecture; InsForge-specific endpoints not directly verified in available docs (treated as opaque REST/vector surface).
- Scalability column for 10K / 1M: LOW — extrapolated from general distributed-systems principles, not from observed benchmarks of this exact stack.
