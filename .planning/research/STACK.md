# Technology Stack

**Project:** SDLC AI Agent Playground
**Stack dimension:** Greenfield — free-tier only, single-user demo
**Researched:** 2026-08-18
**Overall confidence:** HIGH (verified against Anthropic, Next.js, Vercel, SigNoz, Sentry, Linear, Snyk, CodeRabbit, Notion, InsForge official docs)

---

## Executive Summary

The standard 2026 stack for an AI agent that orchestrates a real SDLC pipeline is: **Claude Agent SDK** (TypeScript) as the runtime that natively owns the MCP server lifecycle, sub-agents, hooks, sessions, skills, and permissions. **Next.js 16** (App Router) on Vercel Hobby hosts the web UI; **Vercel AI SDK v7** streams Claude responses into the chat surface. **InsForge** is the agent-native backend (Postgres + auth + storage + a model gateway) and is the documented choice for the RAG vector store, with Supabase pgvector as the fallback. Each SDLC tool is exposed to the agent via an MCP server where one exists (Notion, Playwright, Sentry, SigNoz, Vercel) and via its official CLI/API where one does not (Linear, Snyk, v0, CodeRabbit). The only paid cost is Anthropic API spend (user-controlled), defaulting to Sonnet 4.5 for the orchestrator and Haiku 4.5 for sub-agents with prompt caching on the system prompt and tool docs.

---

## 1. Agent Runtime (core)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| **Claude Agent SDK** (TypeScript) | `@anthropic-ai/claude-agent-sdk` ~0.3.x (tracks Claude Code 2.1.x) | Agent loop, MCP server lifecycle, sub-agents, hooks, sessions, permissions, skills, plugins | This is the canonical 2026 runtime. It bundles the same loop Claude Code uses, owns MCP server bootstrap/teardown, and sends `SessionStart`/`Setup` hooks automatically. The SDK gives you `query()`, `tool()`, `createSdkMcpServer()`, `setMcpServers()`, `reconnectMcpServer()`, `toggleMcpServer()`, `permissionMode`, `canUseTool`, `interrupt()`, `setPermissionMode()`, `rewindFiles()`, `setModel()`, `listSessions()`, `getSessionMessages()`, `renameSession()`, `tagSession()`, `persistSession`, `sessionStore`, `outputFormat` (JSON schema), `maxBudgetUsd`, `maxTurns`, `taskBudget`, `sandbox`, and `extractFromBunfs()` in a single API. Anthropic does not allow third-party developers to expose claude.ai login/rate-limits — we use an API key. |
| **Claude Code (bundled binary)** | 2.1.x (matches SDK) | The agent process invoked by the SDK | The SDK ships the native binary as `claude-code-darwin-arm64`, `-linux-x64`, `-linux-x64-musl`, or `-win32-x64` via optional deps. If `npm install` skips optional deps, set `pathToClaudeCodeExecutable`. |
| **`zod`** | `^3` or `^4` (depends on SDK) | Tool input schema definitions | The SDK `tool()` helper takes a Zod schema and emits a type-safe MCP tool. `mcp-handler` v2 takes a Standard Schema (zod v4). |

**Sub-agents.** Define via `options.agents` map; key fields are `description`, `prompt`, `tools`, `model`. Spawn coding sub-agents with a trimmed tool list (Read, Write, Edit, Bash, plus MCP tools that touch the repo). Use `agentProgressSummaries: true` and `forwardSubagentText: true` to surface transcripts in the UI. Nested sub-agent messages carry `parent_tool_use_id` and `parent_agent_id` (requires Claude Code 2.1.202+).

**Permissions.** Use `canUseTool` for the human-in-the-loop gate. Default mode `default`; `acceptEdits` for commit/push; `bypassPermissions` only with `allowDangerouslySkipPermissions: true`. Keep `permissionMode: "default"` for the demo and gate `Bash(rm *)`, `Bash(git push *)`, `mcp__vercel__deploy`, `mcp__linear__create_issue`, `mcp__notion__create_page` etc. explicitly.

**Confidence:** HIGH (verified against `code.claude.com/docs/en/agent-sdk/overview` and `code.claude.com/docs/en/agent-sdk/typescript`).

### What NOT to use

- **Raw `anthropic-sdk` Client SDK.** No MCP lifecycle, no built-in sub-agents, no hooks. Re-implementing the loop is exactly what the Agent SDK exists to avoid.
- **LangChain / LangGraph / LlamaIndex.** Heavyweight abstractions over a loop the Claude Agent SDK already runs natively. They duplicate the agent-loop mechanism and break MCP-native patterns.
- **Vercel Agent / Claude Managed Agents.** Managed Agents is a hosted, separate product — it doesn't run in your process and doesn't expose MCP server lifecycle hooks the way the SDK does. Wrong tool for a playground that hosts its own sessions.
- **`claude-code` CLI in a subprocess.** Possible fallback for non-TS languages (`cli -p --output-format json`), but the SDK is the supported path for TS.

---

## 2. Web UI (frontend)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| **Next.js** | 16.3.1 (latest, as of 2026-08) | React framework; App Router, Server Actions, streaming | The demo must deploy to Vercel Hobby free tier with zero infra. Next.js 16 is the documented framework for Vercel-native deploy. App Router is the default; Server Components + Server Actions + streaming are all GA. Promotional guidance references "use server components for better performance" in v0 docs — same pattern. |
| **React** | shipped with Next 16 | UI | Standard. |
| **Vercel AI SDK** | `ai` v7 (latest) | Streaming chat, `useChat`, tool UI, harness abstraction | The AI SDK v7 is the unified TS toolkit from Vercel. It has surfaces for Core (generate text, structured objects, tool calls), UI (`useChat`, `useAssistant`), and Harnesses (`HarnessAgent`). The Claude Agent SDK hands back `SDKMessage`s as an async generator; the Next.js Route Handler wraps an AI SDK `streamText` against the orchestrator and pipes tokens into `useChat`. v7 also has a `claude-code` harness if we ever want to swap runtimes. |
| **`@ai-sdk/anthropic`** | latest (provider package) | Anthropic binding inside the AI SDK | Dependency of the AI SDK when calling Anthropic directly. We use the Agent SDK for the heavy loop, but the AI SDK remains the right tool for the chat surface and for non-agent utility calls (embeddings, summarization). |
| **Tailwind CSS** | latest | Styling | Vercel defaults; trivial setup. |
| **shadcn/ui** | latest | Component primitives | Vercel-default component set; copy-in components, no runtime dep. |
| **TypeScript** | ^5.7 | Statically typed client and server | Next 16 + Agent SDK are both TS-first. |

**Streaming.** The Next.js Route Handler returns a `ReadableStream` produced by the SDK `query()` async generator. AI SDK's `streamText` or `useChat` consumes it. Newline-delimited `SDKMessage` events or Server-Sent Events both work.

**Confidence:** HIGH (verified `nextjs.org/docs` shows 16.3.1 as latest; `ai-sdk.dev/docs` shows v7).

### What NOT to use

- **Pages Router.** Legacy; React Server Components only ship in App Router.
- **Remix / Astro / SvelteKit.** All viable for niche cases, but Next 16 is the Vercel-native path and the demo is on Vercel Hobby.
- **tRPC for the chat endpoint.** Server Actions + AI SDK's `useChat` are the canonical streaming path; tRPC is overhead.

---

## 3. Backend & Data (InsForge, with Supabase fallback)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| **InsForge** | `@insforge/sdk` (latest) + `@insforge/cli` (latest) — `npx @insforge/cli create` | Postgres, auth, S3 storage, model gateway, edge functions, realtime, hosting | The project's documented choice. InsForge is positioned as an agent-native open-source backend (Apache-2.0) that uses a CLI rather than a dashboard — a coding agent provisions and runs the full backend. It exposes Postgres (with schema + RLS), auth (users, sessions, OAuth, JWT), S3-compatible storage, Deno-based edge functions, a model gateway, realtime, custom compute, and Vercel-powered hosting. The monorepo is at `github.com/InsForge/InsForge`; docs at `docs.insforge.dev`. |
| **Supabase** | latest (fallback) | Postgres + pgvector + auth + storage | Documented fallback if InsForge free-tier limits bite. Standard free tier: 500 MB DB, 2 active projects, paused after 1 week of inactivity, 50k MAUs, 1 GB storage, 5 GB egress, 200 realtime peak connections, 500k edge function invocations. `pgvector` is bundled with the DB. |
| **Vector store (RAG)** | InsForge Postgres + `pgvector` (or Supabase `pgvector`) | Embedding search over tool docs and project context | One stack instead of two. Embeddings stored as `vector` columns with `ivfflat` or `hnsw` indexes. The agent's RAG layer fetches via SQL. |
| **Embeddings** | Anthropic `voyage-3` (or OpenAI `text-embedding-3-small` as fallback) | Compute embeddings for tool docs and project context | Anthropic recently listed `voyage-3` as a recommended embedding model. For mixed-model setups, OpenAI's small embedding works fine on free credits. |
| **Drizzle ORM** | latest | Typed SQL for the Postgres layer | Lighter than Prisma. Works equally well against InsForge or Supabase. |
| **`pg` / `postgres`** | latest | Postgres driver | Dependency of Drizzle. |

**Confidence:** MEDIUM-HIGH on InsForge — the platform is documented and live, but free-tier limits are not as crisply published as Supabase's; verify the project's free plan at `insforge.dev/pricing` before relying on a specific quota. HIGH on Supabase and on the embedding/API choices.

### What NOT to use

- **A separate Pinecone / Weaviate / Qdrant instance.** InsForge (or Supabase) Postgres already has `pgvector`. Adding a vector DB is a separate service, separate auth, and redundant with the relational store the project already needs.
- **Prisma.** Heavier than Drizzle, slower cold-starts on edge runtimes, and the schema is more rigid. Drizzle is fine for ~10 tables.
- **Firebase.** No `pgvector`, no Postgres, no SQL. Not aligned with the project.

---

## 4. MCP Servers (one per SDLC tool)

The agent SDK exposes MCP servers via `options.mcpServers`. Each entry is either a server config object (subprocess) or a `createSdkMcpServer()` instance (in-process). Use `strictMcpConfig: true` to ignore `.mcp.json`/user settings and keep the demo deterministic.

| Tool | MCP server | Package / URL | Transport | Status |
|---|---|---|---|---|
| **Notion** | Official | `@notionhq/notion-mcp-server` (v2.0.0) | STDIO or Streamable HTTP | The npm version is being deprioritized in favor of the new remote Notion MCP (`https://mcp.notion.com`). Use the remote MCP during the demo; fall back to the npm package if remote is rate-limited. |
| **Linear** | First-party remote + community | `https://mcp.linear.app/sse` (official remote) *or* `@tacticlaunch/mcp-linear` (most active community) | Streamable HTTP / STDIO | The community `jerhadf/linear-mcp-server` is deprecated. Use the official remote `mcp.linear.app/sse`; the `tacticlaunch` package is the best active alternative if remote is unavailable. |
| **v0** | None official | Use the v0 API directly (see `v0.app/docs/agents.md`) | HTTP from a small custom shell | v0 publishes a `/docs/agents.md` API surface but no MCP server. Wrap the API in an `McpServer` registered via `createSdkMcpServer`. |
| **Coding sub-agent** | None — it's a sub-agent | Use `options.agents.coder` with Bash/Read/Write/Edit + Git MCP | n/a | The "MCP" for code is the bundled Bash/Read/Write/Edit tools plus the Git MCP server (`@modelcontextprotocol/server-git`). |
| **Playwright** | Microsoft official | `@playwright/mcp@latest` | STDIO | Microsoft-maintained (`github.com/microsoft/playwright-mcp`). Drives browser automation for E2E test generation. |
| **CodeRabbit** | None MCP | GitHub Action + CLI | HTTP | No official MCP. Use the GitHub Action (free for public OSS repos) or the `coderabbit` CLI in a wrapper MCP server. |
| **Snyk** | None official found | `snyk` CLI | Process spawn | The MCP-server ecosystem is sparse for Snyk. Spawn the `snyk` CLI via the Bash tool (or wrap it in `createSdkMcpServer`) for `snyk test`, `snyk code test`, `snyk iac test`. |
| **Vercel** | `mcp-handler` (server) | `mcp-handler@^2` + `@modelcontextprotocol/server@^2` + `zod@^4` | Streamable HTTP | `mcp-handler` is a framework-agnostic HTTP adapter for hosting MCP servers in JS/TS apps. Use it to expose deploy endpoints as MCP for the agent. |
| **Sentry** | Official | `@sentry/mcp-server@latest` (or hosted `https://mcp.sentry.dev`) | STDIO | Official under `getsentry/sentry-mcp`. |
| **SigNoz** | Official | `github.com/SigNoz/signoz-mcp-server` (latest) — Go binary or Docker | STDIO | Official under `github.com/SigNoz`. Has a hosted MCP URL `https://mcp.<region>.signoz.cloud/mcp` for SigNoz Cloud. |

**Reference MCP servers always available** (from `modelcontextprotocol/servers`):
- `@modelcontextprotocol/server-filesystem` — scoped to the sandbox repo path.
- `@modelcontextprotocol/server-git` — for commit, push, diff, log.
- `@modelcontextprotocol/server-fetch` — for tool-doc scraping.
- `@modelcontextprotocol/server-memory` — knowledge graph for cross-stage state.

**MCP config example** (passed to `options.mcpServers`):

```json
{
  "notion":         { "type": "http", "url": "https://mcp.notion.com/mcp" },
  "linear":         { "type": "http", "url": "https://mcp.linear.app/sse" },
  "playwright":     { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] },
  "sentry":         { "command": "npx", "args": ["-y", "@sentry/mcp-server@latest"], "env": { "SENTRY_AUTH_TOKEN": "..." } },
  "signoz":         { "command": "npx", "args": ["-y", "github:SigNoz/signoz-mcp-server"] },
  "vercel":         { "type": "http", "url": "https://mcp.vercel.com/sse" },
  "filesystem":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "./sandbox"] },
  "git":            { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-git", "--repository", "./sandbox"] },
  "fetch":          { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"] }
}
```

`v0`, `snyk`, `coderabbit`, and the coding sub-agent are wired differently (CLI wrappers or sub-agents), not as MCP servers.

**Confidence:** HIGH on Notion, Playwright, Sentry, SigNoz, Vercel, and reference servers (verified GitHub repos and npm pages). MEDIUM on Linear (multiple competing packages, remote server evolving). MEDIUM on v0/CodeRabbit/Snyk (no official MCP — wrapper approach required).

### What NOT to use

- **A custom MCP server to wrap the Anthropic API.** The Agent SDK already runs the loop.
- **The deprecated `jerhadf/linear-mcp-server`.** README explicitly says deprecated.
- **`@modelcontextprotocol/server-everything`.** A test/demo server; not for production paths.
- **Puppeteer MCP server.** Archived in `servers-archived`. Use Playwright MCP instead.

---

## 5. Hosting & Deployment

| Concern | Service | Tier | Notes |
|---|---|---|---|
| Web UI | **Vercel** | Hobby (free) | Next.js native. Free tier: 4 hours Active CPU/month, 360 GB-hr Provisioned Memory, 1M invocations, 5K image transformations, 50K Web Analytics events. **One user = one browser = well below limits.** |
| Sandbox repo | **GitHub** | Free | The acting operator owns the GitHub account and PAT. |
| Coding sandbox | **Local file system** + GitHub push via `git` MCP | n/a | The demo runs on the user's machine; sandbox repo is a local cloned copy plus a remote branch. |
| Generated app deploy | **Vercel** (separate project or branch) | Hobby | Free tier supports preview deployments; the demo deploys each generated app to a Vercel preview URL. |

**Confidence:** HIGH (verified `vercel.com/docs/pricing`).

---

## 6. Anthropic Models (the only paid cost)

| Model | Input / Output per MTok | Cache read | Use for |
|---|---|---|---|
| **Claude Sonnet 5** | $2 / $10 (introductory, now standard) | $0.20 | Primary orchestrator, hardest planning steps |
| **Claude Sonnet 4.5** | $3 / $15 | $0.30 | Default orchestrator model — broadly available, the well-trodden 2026 path |
| **Claude Haiku 4.5** | $1 / $5 | $0.10 | Sub-agents (code review summary, doc summarization, test triage) |
| **Claude Opus 4.5** | $5 / $25 | $0.50 | Reserved for hard synthesis; not needed for the demo |

**Recommended composition.** `claude-sonnet-4-5` for the main orchestrator, `claude-haiku-4-5` for the coding sub-agent and any summarization step. Use `setModel()` at runtime to swap.

**Prompt caching.** Enable `cache_control: { type: "ephemeral" }` on the system prompt and the tool docs block. Cache reads are **10% of base input** and **do not count toward ITPM rate limits** (except Haiku 3.5). For repeated SDLC tool definitions, this is the single biggest cost lever.

**Batch API.** 50% discount for non-interactive workloads (e.g., bulk doc ingestion for RAG). Not needed for the demo loop but available.

**Rate limits (Start tier, default for new accounts).** 1,000 RPM, 2M ITPM, 400k OTPM for Sonnet 4.5/Haiku 4.5 ($500 monthly spend cap). Far above what a single-user demo generates.

**Spend guard.** `options.maxBudgetUsd` per query, `options.maxTurns` per query, and a custom Spend tool that calls `setMaxBudgetUsd` dynamically. The user controls the Anthropic API key and the cap.

**Confidence:** HIGH (verified `platform.claude.com/docs/en/about-claude/pricing` and `.../rate-limits`).

### What NOT to use

- **Claude Opus 4.5 / 4.8 / 5 for the orchestrator.** Sonnet 4.5 is sufficient for tool orchestration and 5-7x cheaper than Opus 4.5.
- **OpenAI / Gemini / open-source models for the agent loop.** The Agent SDK is purpose-built for Claude. Mixing providers wastes the native hooks and the cache-aware ITPM advantage.
- **Embedding models with proprietary tokenization.** Use `voyage-3` (Anthropic-aligned) or OpenAI `text-embedding-3-small` to keep retrieval cost predictable.

---

## 7. Free-tier Limits Cheat Sheet

| Service | Free tier limit | What it means for the demo |
|---|---|---|
| **Vercel Hobby** | 4 h Active CPU, 360 GB-hr Memory, 1M invocations, 5K image transforms, 50K Web Analytics events / month | Single-user chat = a few hundred invocations/month. Far below limits. |
| **GitHub Free** | 500 MB repo storage, 2,000 Actions min/month (private), unlimited for public | Sandbox repo is tiny; no Actions needed (CodeRabbit runs as Action on its own quota). |
| **InsForge** | Free tier (verify with current website) | Open-source; you can self-host the control plane if free tier throttles. |
| **Supabase (fallback)** | 500 MB DB, 1 GB storage, 50k MAUs, 5 GB egress, 2 active projects, paused after 1 week inactive | Sufficient for a demo. Watch the 1-week inactivity pause. |
| **Linear Free** | 2 teams, 250 issues, unlimited members, free AI/Agent platform | Demo fits in 2 teams. |
| **Notion** | API per-integration rate limits (~3 req/s); workspace plan governs blocks | Free plan is fine for a demo workspace. |
| **Snyk Free** | 200 SCA tests, 100 SAST, 300 IaC, 100 Container tests / month | One demo runs ~3 of each. Plenty of headroom. |
| **CodeRabbit** | Free for public OSS GitHub/GitLab repos | Sandbox repo on a public GitHub account. |
| **v0 Free** | $5 credits/month, 7 messages/day, generates with rate/credit limits | Tight. Use the API sparingly; cache generated components. |
| **Sentry Developer** | 5K errors, 5 GB logs, 5M spans, 50 replays, 30-day retention, 1 user, unlimited projects | Demo ingest is well below 5K errors. |
| **SigNoz Community (self-hosted)** | Free (Apache-2.0), unlimited ingest, but you pay for the host | Run on a $5/mo VM or local Docker; cloud is $49/mo. |

**Confidence:** HIGH for Vercel, Sentry, Linear, Snyk, CodeRabbit, v0, Supabase (verified pricing pages). MEDIUM-HIGH for InsForge (limit detail is less public than Supabase — verify at `insforge.dev`).

---

## 8. RAG Architecture (recommended)

The project calls for two RAG layers: **tool docs** (loaded once per tool) and **project context** (accumulated PRD, tickets, code, review feedback).

| Layer | Store | Index | When to query |
|---|---|---|---|
| **Tool docs** | `pgvector` table `tool_docs(tool, version, content, embedding)` | `hnsw` index on `embedding` (768 dims for voyage-3) | Stage selection: pick the right MCP tool from the user's request. |
| **Project context** | `pgvector` table `project_context(session_id, stage, source, content, embedding)` | `hnsw` index | Stage chaining: pass prior-stage outputs to the next stage. |
| **Conversation history** | Postgres JSONB table `sessions(id, parent_id, messages, summary)` | n/a | Resume / fork sessions; mirror via `sessionStore` SDK option. |

**Embedding flow.** Server-side: fetch context, embed with `voyage-3` (or `text-embedding-3-small`), upsert to `pgvector`. `SET ivfflat.probes = 10` (or use HNSW for higher recall). Keep chunks ≤ 800 tokens with 100-token overlap.

**Prompt caching wins.** Put the system prompt, the active tool docs RAG block, and the prior-stage summary behind a single `cache_control` breakpoint. Subsequent turns within the 5-minute window (or 1-hour window) read at 10% input cost.

**Confidence:** HIGH on the pattern; MEDIUM on specific embedding model choice (Anthropic's `voyage-3` is documented but verify it ships on the agent's API tier).

---

## 9. Recommended `package.json` Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.191",
    "@ai-sdk/anthropic": "latest",
    "ai": "^7",
    "next": "^16.3.1",
    "react": "latest",
    "react-dom": "latest",
    "@insforge/sdk": "latest",
    "drizzle-orm": "latest",
    "postgres": "latest",
    "mcp-handler": "^2",
    "@modelcontextprotocol/server": "^2",
    "zod": "^4",
    "tailwindcss": "latest"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "@types/node": "latest",
    "@types/react": "latest",
    "drizzle-kit": "latest",
    "eslint": "latest"
  }
}
```

Ad hoc (`npx -y`):
- `@notionhq/notion-mcp-server` — Notion
- `@tacticlaunch/mcp-linear` — Linear (or use the remote `mcp.linear.app/sse`)
- `@playwright/mcp@latest` — Playwright
- `@sentry/mcp-server@latest` — Sentry
- `github.com/SigNoz/signoz-mcp-server` — SigNoz (or the hosted URL)
- `@modelcontextprotocol/server-filesystem`, `@modelcontextprotocol/server-git`, `@modelcontextprotocol/server-fetch`, `@modelcontextprotocol/server-memory` — reference servers

---

## 10. Sources

- **Claude Agent SDK.** `code.claude.com/docs/en/agent-sdk/overview`, `code.claude.com/docs/en/agent-sdk/typescript` (HIGH).
- **MCP protocol and reference servers.** `modelcontextprotocol.io/introduction`, `modelcontextprotocol.io/examples.md`, `github.com/modelcontextprotocol/servers` (HIGH).
- **Notion MCP.** `github.com/makenotion/notion-mcp-server` (HIGH).
- **Linear MCP.** `github.com/jerhadf/linear-mcp-server` (deprecated), `github.com/tacticlaunch/mcp-linear` (HIGH).
- **Playwright MCP.** `github.com/microsoft/playwright-mcp` (HIGH).
- **Sentry MCP.** `github.com/getsentry/sentry-mcp` (HIGH).
- **SigNoz MCP.** `github.com/SigNoz/signoz-mcp-server` (HIGH).
- **Vercel `mcp-handler`.** `github.com/vercel/mcp-adapter` (HIGH).
- **Next.js 16.** `nextjs.org/docs` (HIGH).
- **Vercel AI SDK v7.** `ai-sdk.dev/docs` (HIGH).
- **Vercel pricing (Hobby).** `vercel.com/docs/pricing` (HIGH).
- **Anthropic pricing.** `platform.claude.com/docs/en/about-claude/pricing` (HIGH).
- **Anthropic rate limits.** `platform.claude.com/docs/en/api/rate-limits` (HIGH).
- **SigNoz pricing.** `signoz.io/pricing/` (HIGH).
- **Sentry pricing.** `sentry.io/pricing/` (HIGH).
- **Linear pricing.** `linear.app/pricing` (HIGH).
- **Snyk pricing.** `snyk.io/plans/`, `snyk.io/pricing/` (HIGH).
- **CodeRabbit free OSS.** `coderabbit.ai/pricing` (HIGH).
- **v0 pricing.** `v0.app/docs/pricing` (HIGH).
- **Supabase free tier.** `supabase.com/pricing` (HIGH).
- **InsForge.** `insforge.dev/`, `github.com/InsForge/InsForge` (MEDIUM-HIGH).
