# Phase 1: Foundation - Context

**Gathered:** 2026-08-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a streaming chat surface, a long-lived Mastra agent worker with managed MCP lifecycle, a 3-tier human-in-the-loop approval gate, a RAG retrieval tool over tool docs, and an InsForge-backed backend (Postgres schema, auth, vector store, audit log) — all wired end-to-end so later phases can drop in MCP integrations and tool wrappers without re-implementing foundations.

Stack pivoted mid-discussion: drop Claude Agent SDK + Anthropic models → use Mastra AI as agent runtime, OpenRouter (Nemotron 3 Ultra free) for the agent loop, InsForge model gateway (DeepSeek V4 Flash) for InsForge-side AI functions, InsForge vector store (DeepSeek under hood) for RAG embeddings.

19 v1 requirements in scope: UI-01..07, RT-01..03, HITL-01..02, RAG-01..02, BCK-01..05.
</domain>

<decisions>
## Implementation Decisions

### Stack (locked at top of phase)
- **D-01:** Agent runtime = **Mastra AI** (`@mastra/core`, `@mastra/mcp`) — replaces Claude Agent SDK entirely. — **Reversibility:** one-way — Phase 1 ships with Mastra as the runtime; switching after Phase 1 means rewriting every tool integration + approval gate.
- **D-02:** Agent model = **Nemotron 3 Ultra free** via **OpenRouter** (`nvidia/nemotron-3-ultra-550b-a55b:free`). 1M context, 65K output, tool calling ✓, structured JSON output ✗. — **Reversibility:** one-way — model is locked into cost calc + prompt patterns.
- **D-03:** InsForge-side AI (embeddings, project-context helpers) = **DeepSeek V4 Flash** via InsForge model gateway. Never called by the agent directly — only by InsForge functions inside its ecosystem. — **Reversibility:** one-way — embedded in InsForge wiring.
- **D-04:** Embeddings for RAG = **InsForge native embed API** (uses DeepSeek under hood). Local transformers.js fallback deferred to later phase. — **Reversibility:** costly — switching to local embeddings means rebuilding the embed pipeline + re-embedding all existing docs.

### Worker topology (RT-02)
- **D-05:** **Local-only worker.** `pnpm dev` spawns both Next.js dev server + Mastra worker on user's machine via `concurrently`. Next.js proxies to worker over localhost HTTP/SSE. No public demo URL in Phase 1. — **Reversibility:** one-way for Phase 1 — adding Fly.io/Railway later is a separate deployment concern, not a refactor.
- **D-06:** **Per-stage lazy MCP loading.** Worker boots in <2s. MCP servers load when user picks a stage that needs them. UI-07 banner shows "Notion: not loaded" until stage pick. — **Reversibility:** reversible — can flip to boot-all later.
- **D-07:** **Tab close = pause + wait reconnect.** Worker pauses agent loop on tab close, resumes when SSE reconnects. State held in worker memory + InsForge session. — **Reversibility:** reversible.
- **D-08:** **Worker crash = `tsx watch` auto-restart + InsForge session resume.** Sessions persist across worker restart via Mastra Memory + InsForge persistent storage. — **Reversibility:** reversible.

### HITL approval UX (HITL-01..02, mapped to Mastra `requireApproval` + conditional `requireToolApproval`)
- **D-09:** **write_low approval** = inline card in chat stream where agent would speak next. Shows tool name, truncated args, Approve/Deny buttons.
- **D-10:** **write_high approval** = same inline card with text input ("type 'CONFIRM' to proceed") + red border + DESTRUCTIVE badge. Same placement as write_low for visual consistency; risk signaled visually.
- **D-11:** **Card content tiered.** write_low = tool name + 1-line risk reason + buttons. write_high = tool name + full args (expandable JSON) + diff preview (for git ops) + risk reason + typed input.
- **D-12:** **Auto-approve scope** = header global toggle ("Auto-approve all", per HITL-02) + per-card "Approve all matching for 5 min" button. No per-stage pre-approval config in Phase 1.
- **D-13:** **Tool classification** = hardcoded per tool name at MCP registration. Not configurable via UI in Phase 1. (HITL-01 spec.) — **Reversibility:** costly — adding a UI config layer touches the registration path.

### Chat surface layout (UI-02, UI-03)
- **D-14:** **Stage picker** = left sidebar. Vertical list of all 8 stages (PRD, Tickets, Design, Code, Test, Review, Deploy, Observe). Current stage highlighted.
- **D-15:** **Disabled state for non-Phase-1 stages** = greyed out with tooltip "Available in Phase X". All 8 stages always visible. — **Reversibility:** reversible — UI-08 (Phase 8) may revise.
- **D-16:** **Action feed placement** = inline in chat as message bubbles. Tool calls render as "🔧 notion.search(args)" then "✓ returned 3 pages". — **Reversibility:** reversible.
- **D-17:** **Action feed per-entry fields** = tool name + args preview (1-line truncated, expandable) + status icon (running/success/fail) + duration (ms) + result snippet (~100 chars, expandable). Tokens shown globally in header (UI-06), not duplicated per entry.

### RAG tool docs scope (RAG-01..02)
- **D-18:** **Tools to embed** = 4 MCP servers only in Phase 1: Notion, Linear, Playwright, Sentry. Custom wrappers (v0, CodeRabbit, Snyk, Vercel) embedded when their wrappers ship (Phase 4-6). SigNoz deferred to Phase 7.
- **D-19:** **Doc source** = scraped from official sources at build time. Notion MCP server README + Notion API docs; same pattern for Linear/Playwright/Sentry. — **Reversibility:** reversible — can swap to curated markdown if scraping proves fragile.
- **D-20:** **Build trigger** = auto-embed on `pnpm dev` startup if collection empty or older than 7 days. No CI step in Phase 1. — **Reversibility:** reversible.
- **D-21:** **Retrieval behavior** = fixed top-k=5 per RAG-02 spec. Returns formatted context string the agent injects into reasoning. No per-call k override in Phase 1.

### Claude's Discretion
- Tool classification exact list (read / write_low / write_high per tool name) — implementation detail, planner decides based on tool inventory at Phase 2-7. Default per architecture file: read = `mcp__*__search|list|get|preview`, write_low = `git commit`, `npm test`, sandbox E2E, write_high = deploy, create-ticket, create-page, open-PR, send-to-Sentry.
- IPC transport between Next.js and worker (HTTP+SSE vs Unix socket) — HTTP+SSE localhost with shared secret in `.env.local` is the obvious pick.
- Audit log write trigger (per tool call via Mastra middleware hook vs app-side) — middleware hook is the cleaner pick.
- Auth shape (BCK-02) = **env-var bearer token for the operator, no login screen in Phase 1.** Single-user demo; no UI auth needed. — **Reversibility:** one-way — adding real auth later means a login screen + token rotation.
- InsForge vs Supabase fallback (BCK-05) = **InsForge primary, Supabase+pgvector documented as env-switch fallback.** Drizzle schema portable; only client init branches. — **Reversibility:** reversible — single env switch.

### Folded Todos
None — no pending todos at phase start.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project artifacts
- `.planning/PROJECT.md` — project definition, constraints ($0 budget, free tiers, single-user demo, HITL default-on, no mocks), key decisions table, "What This Is" anchor
- `.planning/REQUIREMENTS.md` — v1 requirements with traceability matrix (Phase 1 owns UI-01..07, RT-01..03, HITL-01..02, RAG-01..02, BCK-01..05)
- `.planning/ROADMAP.md` §Phase 1 — goal + 5 success criteria + dependency declaration
- `.planning/STATE.md` — current position + accumulated decisions + known risks (C1-C6 critical pitfalls mapped to Phase 1 mitigations)
- `CLAUDE.md` — authoritative stack table, MCP servers table, free-tier limits cheat sheet, "What NOT to use" lists (still references Claude SDK as historical — see D-01 for pivot)

### Research artifacts
- `.planning/research/SUMMARY.md` — exec summary, stack rationale, MVP slicing, critical pitfalls C1-C6 with phase mapping
- `.planning/research/ARCHITECTURE.md` — component diagram, MCP lifecycle phases, HITL approval flow, 11-step build order, patterns to follow, anti-patterns to avoid, scalability notes
- `.planning/research/PITFALLS.md` — full pitfall list with phase-warning matrix
- `.planning/research/STACK.md` — stack verification, version pins
- `.planning/research/FEATURES.md` — table-stakes vs differentiators feature map

### External docs (Mastra + OpenRouter + InsForge)
- Mastra MCP overview — https://mastra.ai/en/docs/mcp/overview — `MCPServer` class, `startStdio()` for stdio MCP servers, registration via `new Mastra({ mcpServers })`
- Mastra HITL — https://mastra.ai/en/docs/agents/human-in-the-loop — `requireApproval` per tool, `requireToolApproval` (boolean or function) on `stream()/generate()`, `approveToolCall()`/`declineToolCall()` API, suspended runs API for resume
- OpenRouter Nemotron 3 Ultra free — https://openrouter.ai/models/nvidia/nemotron-3-ultra-550b-a55b:free — 1M context, 65K output, free tier data-logging caveat, no `response_format`
- OpenRouter DeepSeek V4 Flash 0731 — https://openrouter.ai/deepseek/deepseek-v4-flash-0731 — 1.3M context, 262K output, $0.077/$0.153/1M tok, tool calling + structured JSON ✓

### InsForge ecosystem
- InsForge docs — https://docs.insforge.dev — Postgres + auth + S3 + edge functions + model gateway + vector store. Free tier limits not publicly detailed (MEDIUM confidence per research SUMMARY).
- InsForge GitHub — https://github.com/InsForge/InsForge — reference for CLI workflows (`npx @insforge/cli create`)

</canonical_refs>

<code_context>
## Existing Code Insights

Greenfield project — no existing code, no codebase maps, no prior CONTEXT.md. Repo contains only `README.md` + git history. No `src/`, no `app/`, no `package.json` yet.

### Reusable Assets
- None — greenfield.

### Established Patterns
- None — greenfield. Conventions will be populated by gsd-doc-writer as patterns emerge.

### Integration Points
- Phase 1 establishes the integration points future phases will hang off:
  - `/api/chat` SSE relay endpoint (Next.js → worker)
  - `/api/approve` approval endpoint (browser → worker)
  - `/api/stage` stage picker endpoint
  - `audit_log` Postgres table (every tool call + approval decision)
  - `tool_docs` pgvector collection (RAG source)
  - `sessions` Postgres table (UI-04 resume anchor)

</code_context>

<specifics>
## Specific Ideas

- **Caveman mode + Ponytail style enforced** (system hooks). Code/comments normal; user-facing prose terse. No impact on agent runtime.
- **System reminder "no direct edits outside GSD workflow"** is honored — all file changes go through `/gsd-plan-phase` + `/gsd-execute-phase` after this CONTEXT.md is locked.
- **Mastra Memory persistent storage = InsForge** (not local file system). Sessions survive worker restart.
- **Worker health check** = Mastra built-in via `/api/health` on worker side; Next.js polls every 30s for UI-07 banner status.
- **Vercel deploy story** = Phase 1 ships local-only. Vercel deploy becomes "UI-only" mode until worker is hosted externally (separate phase, not in scope here).
- **Cost calc (UI-06)** uses model pricing table — Nemotron free ($0/1M tok), DeepSeek V4 Flash ($0.077/$0.153/1M tok via InsForge). Token counts come from Mastra streaming chunks (`usage` field in response shape).
</specifics>

<deferred>
## Deferred Ideas

- **Local embedding via transformers.js** as RAG fallback — user explicitly deferred ("maybe later"). Adds 50MB model download + 200ms/embed overhead. Reconsider when InsForge free-tier limits bite.
- **Per-stage pre-approval UI** (checkbox at stage pick "approve destructive ops for this stage") — more config-y than per-card 5-min batch button. Could replace D-12 if user feedback prefers.
- **Vercel deploy story** — Phase 1 local-only; how UI behaves when deployed to Vercel with no worker is a Phase 8+ concern (UI shows "Worker offline — run `pnpm worker` locally" or similar).
- **MCP schema drift detection** (C6 pitfall) — version pinning required by research; automated schema hash assertion on boot deferred. Manual pinning in `package.json` is the Phase 1 baseline.
- **SigNoz self-host vs stub** (Phase 7 deferred decision per research SUMMARY §Gaps).
- **v0 API wrapper design** (Phase 4 deferred — no MCP, API surface needs exploration before planning).
- **Linear MCP package selection** (Phase 3 deferred — confirm official remote vs community at planning).
</deferred>

---

*Phase: 1-Foundation*
*Context gathered: 2026-08-18*
</content>
</invoke>