# Project Research Summary

**Project:** SDLC AI Agent Playground
**Domain:** AI agent SDLC orchestrator (greenfield, single-user, $0 budget, free-tier only)
**Researched:** 2026-08-18
**Confidence:** HIGH (overall)

## Executive Summary

This is a web-based AI agent playground that proves one thing end-to-end: a single Claude agent can coordinate a real SDLC pipeline (PRD -> tickets -> code -> tests -> review -> deploy -> observe) across nine third-party SaaS tools via MCP servers, Skills, and RAG. The standard 2026 approach is the **Claude Agent SDK** (TypeScript) as the runtime — it natively owns MCP lifecycle, sub-agents, hooks, sessions, skills, and permissions; **Next.js 16** + **Vercel AI SDK v7** on the Vercel Hobby free tier for the web UI; and **InsForge** (with Supabase+pgvector as documented fallback) as the agent-native backend. Each SDLC tool is exposed via an MCP server where one exists (Notion, Linear, Playwright, Sentry, SigNoz, Vercel) and via its official CLI/API wrapper where one does not (v0, CodeRabbit, Snyk). Anthropic API spend is the only paid cost — Sonnet 4.5 for the orchestrator, Haiku 4.5 for sub-agents, prompt caching on system prompts and tool docs.

The key risks are not technical ceilings — they are **operational quietly breaking things**: MCP stdio connections dying mid-chain, OAuth tokens expiring silently, RAG indices drifting from source-of-truth, and the approval gate clicking the user to death if every read triggers a modal. Every one has a documented prevention (retry-with-reconnect, TokenProvider, write-time re-index, three-tier tool classification) that must land in Phase 1 as foundation before any tool integration ships. The MVP is a single vertical slice — PRD in Notion -> agent reads it -> creates Linear sub-issues — which proves the orchestration pattern without spending the budget on observability or sub-agents.

## Key Findings

### Recommended Stack

The 2026 stack is well-trodden: Anthropic-native agent runtime, Vercel-native UI, agent-native backend, MCP-everywhere the tool supports it. The decision is mostly "pick the documented platform" rather than "evaluate alternatives."

**Core technologies:**
- **Claude Agent SDK** (TypeScript, ~0.3.x) — agent loop, MCP lifecycle, sub-agents, hooks, sessions, permissions. The canonical runtime; bypassing it (raw Messages API, LangChain, Managed Agents) re-implements the loop.
- **Next.js 16** + **Vercel AI SDK v7** — App Router + Server Actions + `useChat` streaming. Vercel Hobby free tier comfortably hosts a single-user chat.
- **InsForge** (Supabase+pgvector fallback) — Postgres + auth + storage + vector store in one. `voyage-3` (or `text-embedding-3-small`) for embeddings; Drizzle ORM for typed SQL.
- **MCP servers per tool** — Notion, Linear, Playwright, Sentry, SigNoz, Vercel have official or community packages. v0, CodeRabbit, Snyk are wrapped as in-process custom tools (no MCP server exists).
- **Anthropic models** — Sonnet 4.5 for the orchestrator, Haiku 4.5 for sub-agents, prompt caching on the system prompt + tool docs (10% input cost, excluded from ITPM).
- **Tailwind + shadcn/ui** — Vercel defaults; no opinion required.

### Expected Features

**Must have (table stakes) — without these the demo fails:**
- Streaming chat surface (TS-1), stage picker (TS-2), MCP lifecycle control (TS-3), JSON tool config (TS-4), approval gate for destructive ops (TS-5), auto-approve toggle (TS-6), audit log/action feed (TS-7), per-tab session persistence (TS-8), friendly error handling + retry (TS-9), cost visibility (TS-10), resumable sessions (TS-11), startup health check (TS-12).

**Should have (differentiators) — what separates a playground from a chatbot:**
- Stage chaining (D-1), live tool-call visualization (D-2), RAG over tool docs (D-3), RAG over project context (D-4), coding sub-agent (D-5), Vercel preview iframe (D-6), Playwright test viewer (D-7), review panel (D-8), PR diff viewer (D-9), observability panels (D-10), per-server approval granularity (D-11), stage replay (D-12), manual stepping (D-13), multi-tool parallelism (D-14), idle tool discovery (D-15).

**Defer (v2+):** All fifteen differentiators. MVP ships the full vertical slice — chat surface, stage picker, MCP lifecycle, approval gate, audit log, one real chain (PRD -> Linear ticket) — and proves the orchestration pattern before adding sub-agents, RAG, observability, and advanced UX.

**Anti-features (explicitly NOT built):** Multi-user/RBAC, cross-device persistence, SSO/SAML, mobile UI, billing, voice, multi-language, custom MCP authoring UI, production deploy pipelines, production observability, built-in code editor, custom model picker, plugin marketplace, webhooks, fine-tuning, SOC2/HIPAA, backups, multi-user collaboration, RLS, drag-drop approval builder.

### Architecture Approach

Long-lived Node worker running the Claude Agent SDK owns the agent loop, routes `tool_use` blocks to MCP clients / custom tools / sub-agents, and emits SSE events to a Next.js API route, which relays to the browser. Browser events flow one way (SSE upstream); approvals and stage picks go back via POST. The browser is stateful only for session id; all durable state — sessions, project context, tool docs index, audit log — lives in InsForge. Each SDLC stage is a separate sub-agent invocation with its own system prompt and tool subset. Tool docs are embedded into pgvector once at build; project context is re-embedded at stage boundaries. One MCP server per service boundary; never multiplex providers.

**Major components:**
1. **Web UI (Next.js)** — chat surface, stage picker, approval modal, real-time event rendering, session storage in `localStorage`.
2. **Next.js API routes** — SSE relay, approval endpoint, server-side secret access.
3. **Agent runtime (Claude Agent SDK)** — owns the loop, routes tool calls, manages MCP lifecycles, spawns sub-agents, emits structured events.
4. **MCP clients (4)** — Notion, Linear, v0, Playwright. SDK-managed stdio child processes.
5. **Custom tool wrappers (5)** — CodeRabbit, Snyk, Vercel, Sentry, SigNoz. In-process REST/CLI wrappers.
6. **Coding sub-agent** — separate agent invocation with file read/write/edit, bash, git. Commits/pushes to sandbox repo.
7. **Skills** — filesystem-loaded, progressive disclosure. SDLC-specific bundles (code review checklist, PR template).
8. **RAG retrieval tool** — custom tool, embeds query -> fetches top-k from InsForge vector store.
9. **InsForge backend** — Postgres + auth + vector store + audit log.
10. **Sandbox repo** — local git repo, cleaned at session end.

### Critical Pitfalls

1. **MCP server connection silently dies mid-session (C1)** — stdio/SSE transports drop after 5-10 min idle; subsequent tool calls return ECONNRESET or hallucinate results. Wrap every MCP call in retry-with-reconnect, ping on error, set `--max-idle` to 30+ min for chained stages.
2. **OAuth/API token expiration silently breaks demo (C2)** — Notion/Linear personal tokens don't expire, but OAuth-granted tokens (Sentry, possibly SigNoz) do. Centralize tokens behind a `TokenProvider` interface; bake boot-time health checks; surface expiry to the UI.
3. **RAG index drifts from source-of-truth (C3)** — RAG ingestion treated as one-time setup, diverges from Notion/Linear/code commits. Every write tool must trigger a re-index in the same request path; cap top-k=5; expose a `/debug/rag` endpoint.
4. **HIL approval dialog gets in the way of every read (C4)** — global toggle confuses read vs write vs destructive. Classify every tool at registration: `read` (no prompt), `write_low_risk` (prompt, default allow), `write_high_risk` (prompt + typed confirm). Batch per stage.
5. **Sub-agent loses parent context; repeats questions (C5)** — sub-agents inherit only system prompt + slice of conversation, not full state. Pass a structured `handoff` object (`{ stage, prd_summary, prior_decisions[], relevant_ticket_ids[] }`); cap depth at 2; verify outputs before advancing.
6. **Tool schema drift between MCP versions breaks the agent silently (C6)** — Notion MCP 1.x vs 2.x have different `input_schema`s. Pin every MCP version in `package.json` (exact, no `^`); assert schema hash on boot; `/debug/mcp` endpoint.

## Implications for Roadmap

Based on the architecture's strict build order (InsForge first, then UI, then agent runtime, then MCP plumbing, then per-tool integrations), the feature MVP (single vertical slice first), and the pitfall phase-warning matrix (C1-C6 must be addressed in Phase 1), the suggested phase structure is:

### Phase 1: Foundation
**Rationale:** InsForge is the audit log + RAG backend everything writes to; the Claude Agent SDK is the spine everything hangs off; the MCP lifecycle wrapper, TokenProvider, tool classification, RAG scaffolding, and sub-agent handoff schema are the foundation every tool integration needs. Without these, every later phase re-implements them badly.
**Delivers:** InsForge schema + auth + vector collection; Next.js chat surface with mock SSE; Claude Agent SDK runtime worker with zero tools; MCP lifecycle wrapper + first MCP (Notion) boot; TokenProvider with boot-time health check; three-tier tool classification + batched approval gate; RAG retrieval tool with hooks for write-time re-index; sub-agent handoff schema; cost counter; `/debug/mcp` + `/debug/rag` endpoints.
**Addresses:** TS-1 through TS-12, D-11, M8, M9, all six critical pitfalls.
**Avoids:** C1 (retry wrapper), C2 (TokenProvider), C3 (RAG hooks), C4 (3-tier classification), C5 (handoff schema), C6 (version pinning + schema hash), M7 (pre-commit secret scrub), M8 (context caps).

### Phase 2: Notion MCP integration
**Rationale:** Notion has the simplest data shape (read page, write page) and the PRD lives there. Proves the stdio child-process pattern end-to-end. Once Notion works, the other three MCP integrations are copy-paste.
**Delivers:** Stage picker -> "PRD" stage; agent reads from Notion, writes to Notion; agent transcript logged to InsForge; per-stage snapshot for replay.
**Addresses:** PRD stage of D-1.
**Avoids:** C2 (per-tool token check), C3 (re-index on every page write), C6 (schema hash assertion), M7 (PRD pages must not contain secrets).

### Phase 3: Linear MCP integration (completes MVP vertical slice)
**Rationale:** Completes the "PRD -> tickets" slice that proves the orchestration pattern. Linear has official remote MCP plus a community package — the package selection is the main decision.
**Delivers:** Stage picker -> "Tickets" stage; agent reads PRD from Notion, creates sub-issues in Linear; idempotency via `external_id` = PRD section hash; per-tenant dedupe; usage per Linear API's 1500 req/hr guard.
**Addresses:** D-1 partial chain (PRD -> Tickets).
**Avoids:** C2 (token check), C3 (re-index on ticket write), C6 (schema hash), M10 (idempotency via dedupe keys, addressed fully in Phase 8 but the basic gate lives here).

### Phase 4: v0 + Coding sub-agent (Design + Code stages)
**Rationale:** v0 has no official MCP — wrap its API as a custom tool. The coding sub-agent is the only step needing a real filesystem + git; isolate it so the orchestrator stays focused on stage coordination. Sandbox repo committed/pushed via Git MCP.
**Delivers:** "Design" stage calling v0 API; "Code" stage spawning a coding sub-agent with file read/write/edit + bash + git + CodeRabbit MCP; PR diff viewer; sandbox repo on a public GitHub branch; structured handoff from orchestrator to coding sub-agent.
**Addresses:** D-5 (coding sub-agent), D-9 (PR diff viewer).
**Avoids:** C5 (handoff schema), M2 (Playwright TOS — public repo only), m2 (v0 quota — cache by `(prd_hash, design_intent)`).

### Phase 5: Playwright + Snyk + CodeRabbit (Test + Review stages)
**Rationale:** Three independent integrations; all consume the same redacted codebase post-commit. Bundle as a "Review" stage that runs in parallel via `Promise.all` and merges results into a single summary. CodeRabbit requires public repo; Snyk free tier is tight (200 tests/month) — debounce scans by lockfile mtime.
**Delivers:** "Test" stage invoking Playwright MCP against the deployed preview URL; "Review" stage running CodeRabbit + Snyk in parallel; in-UI test execution viewer (D-7); in-UI review panel (D-8); multi-tool parallelism (D-14).
**Addresses:** D-7, D-8, D-14.
**Avoids:** M3 (CodeRabbit public-repo requirement), M4 (Snyk quota debounce).

### Phase 6: Vercel deploy (Deploy stage)
**Rationale:** Vercel Hobby preview URLs are the demo's most satisfying single beat. Risk is preview accumulation (~100 deploys/day cap).
**Delivers:** "Deploy" stage deploying the sandbox repo to a Vercel preview URL; live deployment preview iframe (D-6); preview prune job (delete previews >24h old); deploy quota indicator in UI.
**Addresses:** D-6.
**Avoids:** M1 (preview prune), M7 (env-var scrub before deploy).

### Phase 7: Sentry + SigNoz observability (Observe stage)
**Rationale:** Observability closes the loop — agent can see what it shipped. SigNoz free tier is OSS self-hosted (real ops work); offer a stub fallback so the demo doesn't gate on infra.
**Delivers:** "Observe" stage pulling recent Sentry issues and SigNoz traces for the deployed project; observability panels (D-10); Sentry `beforeSend` filter + sampleRate 0.1; SigNoz self-host deployment doc OR observability stub fallback.
**Addresses:** D-10.
**Avoids:** M5 (Sentry quota), M6 (SigNoz self-host reality).

### Phase 8: Stage chaining + idempotency + replay
**Rationale:** With every tool wired, the missing piece is the orchestration layer that ties stages together with idempotency, replay, and session resume. This is the integration phase that exposes wiring bugs only visible when the whole chain runs.
**Delivers:** Full D-1 chain (PRD -> Tickets -> Design -> Code -> Test -> Review -> Deploy -> Observe); per-stage run ledger with `dedupe_keys[]`; session resume on refresh (m6); D-13 manual stepping; D-15 idle tool discovery; end-to-end chain test.
**Addresses:** D-1, D-12, D-13, D-15.
**Avoids:** M10 (idempotency), m6 (browser refresh resume).

### Phase Ordering Rationale

- **Strict dependency chain.** InsForge and the agent runtime are foundations; nothing else can write to the audit log or run the agent loop without them. The architecture file's 11-step build order explicitly enforces this.
- **MVP-first slicing.** The PRD -> Linear ticket slice (Phases 2-3) proves the orchestration pattern before sub-agents, RAG, or observability consume budget. Defer those to Phase 4+.
- **Pitfall phase-warning matrix alignment.** The PITFALLS.md matrix maps C1-C6 to Phase 1 — they must be addressed before any tool integration. Each subsequent phase gets the moderate/minor pitfalls it triggered.
- **MCP-first, custom-wrappers-second.** Tools with MCP servers (Notion, Linear, Playwright, Sentry, SigNoz, Vercel) go first because the SDK handles lifecycle. v0, CodeRabbit, Snyk (no MCP) are wrapped as custom tools and grouped where they fit semantically.
- **Avoid the deferred-everything trap.** Phase 8 is explicitly the integration phase, not a "later" milestone — the chain test lives there because that's when every component is wired.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** InsForge specifics (free-tier limits, exact vector endpoint, auth surface) — Supabase+pgvector fallback path is documented but InsForge endpoints are not directly verified in this research. SigNoz is deferred but its self-host requirements should be confirmed early.
- **Phase 3:** Linear MCP package selection — official remote (`mcp.linear.app/sse`) vs community (`@tacticlaunch/mcp-linear`); the remote is evolving. Confirm which one is recommended at integration time.
- **Phase 4:** v0 API surface — no MCP, no detailed API doc in research; wrapper design needs API exploration before planning.
- **Phase 7:** SigNoz OSS self-host deployment — confirm Docker Compose setup is realistic for a single-user demo (or commit to the observability stub fallback up front).

Phases with standard patterns (skip research-phase):
- **Phase 2:** Notion MCP — official `@notionhq/notion-mcp-server` or remote `mcp.notion.com`, well-documented.
- **Phase 5:** Playwright + Snyk + CodeRabbit — standard CLI invocations, well-trodden.
- **Phase 6:** Vercel deploy — `mcp-handler` for the deploy endpoint, well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against Anthropic, Next.js, Vercel, SigNoz, Sentry, Linear, Snyk, CodeRabbit, Notion, InsForge official docs. Free-tier specifics verified per vendor pricing pages. |
| Features | HIGH | Table stakes anchored to PROJECT.md active requirements; differentiators recorded as demonstrative patterns. Web research providers were unavailable, so feature landscape is grounded in PROJECT.md + ecosystem knowledge rather than fresh competitive scans. |
| Architecture | HIGH | Claude Agent SDK + MCP + Skills + RAG patterns verified against official Anthropic documentation via the `claude-api` skill. InsForge specifics are MEDIUM — pattern follows standard RAG architecture but InsForge endpoints not directly verified. |
| Pitfalls | MEDIUM-HIGH | Drawn from documented Claude Agent SDK behavior, vendor-published rate limits, well-known orchestrator failure modes. Free-tier numbers verified against vendor docs as of 2025-2026; recheck before each phase ships. |

**Overall confidence:** HIGH.

### Gaps to Address

- **InsForge free-tier limits** — verify before Phase 1 plans land. If quotas are too tight, the documented fallback is Supabase + pgvector (same Drizzle + `pgvector` schema).
- **Linear MCP package selection** — confirm official remote vs community at Phase 3 planning. The remote may have shifted since research.
- **v0 API wrapper design** — no MCP; needs API exploration before Phase 4 planning. If the API is unstable, defer v0 to v2 and ship the rest of the chain.
- **SigNoz self-host vs stub** — decide at Phase 7 planning. OSS self-host is real ops work; the stub fallback keeps the demo deployable.
- **CodeRabbit public-repo requirement** — sandbox repo must be public by default. If the operator needs a private repo, CodeRabbit is blocked and we fall back to local lint.
- **MCP version pinning** — pin every version in `package.json` exactly (no `^`); schema hash assertion on boot. Recheck at the start of each integration phase, since community packages churn.
- **Anthropic API rate limits** — new keys start on Start tier (1,000 RPM, 2M ITPM). Backoff with jitter, cap parallel sub-agents at 2, surface quota in UI.

## Sources

### Primary (HIGH confidence)
- Anthropic Claude Agent SDK — `code.claude.com/docs/en/agent-sdk/overview`, `code.claude.com/docs/en/agent-sdk/typescript`
- Model Context Protocol — `modelcontextprotocol.io/introduction`, `modelcontextprotocol.io/examples.md`, `github.com/modelcontextprotocol/servers`
- Notion MCP — `github.com/makenotion/notion-mcp-server`
- Linear MCP — `github.com/jerhadf/linear-mcp-server` (deprecated), `github.com/tacticlaunch/mcp-linear`
- Playwright MCP — `github.com/microsoft/playwright-mcp`
- Sentry MCP — `github.com/getsentry/sentry-mcp`
- SigNoz MCP — `github.com/SigNoz/signoz-mcp-server`
- Vercel `mcp-handler` — `github.com/vercel/mcp-adapter`
- Next.js 16 — `nextjs.org/docs`
- Vercel AI SDK v7 — `ai-sdk.dev/docs`
- Anthropic pricing — `platform.claude.com/docs/en/about-claude/pricing`
- Anthropic rate limits — `platform.claude.com/docs/en/api/rate-limits`
- Vercel pricing (Hobby) — `vercel.com/docs/pricing`
- SigNoz pricing — `signoz.io/pricing/`
- Sentry pricing — `sentry.io/pricing/`
- Linear pricing — `linear.app/pricing`
- Snyk pricing — `snyk.io/plans/`
- CodeRabbit free OSS — `coderabbit.ai/pricing`
- v0 pricing — `v0.app/docs/pricing`
- Supabase free tier — `supabase.com/pricing`

### Secondary (MEDIUM confidence)
- InsForge — `insforge.dev/`, `github.com/InsForge/InsForge` (MEDIUM-HIGH) — documented platform, free-tier limits less publicly detailed than Supabase.

### Tertiary (LOW confidence — needs validation)
- Scalability columns for 10K / 1M sessions (ARCHITECTURE.md) — extrapolated from general distributed-systems principles, not benchmarked.
- Specific MCP server version compatibility at integration time — pin exact versions at the start of each integration phase.

---
*Research completed: 2026-08-18*
*Ready for roadmap: yes*
