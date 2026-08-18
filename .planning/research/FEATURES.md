# Feature Landscape: SDLC AI Agent Playground

**Domain:** AI agent SDLC orchestrator (web playground, real tool integrations)
**Researched:** 2026-08-18
**Mode:** Ecosystem (feature dimension)
**Confidence:** HIGH for table-stakes/anti-features (anchored to PROJECT.md), MEDIUM for differentiators (recording demonstrative patterns rather than canonical lists)

---

## Summary

The playground proves one thing end to end: a single Claude agent coordinating a real SDLC pipeline (PRD -> tickets -> code -> tests -> review -> deploy -> observe) across multiple third-party SaaS tools via MCP servers, Skills, and RAG. The "features" worth building are the ones that make that loop visible, safe to run, and reproducible.

Three classes emerge:

- **Table stakes** — anything without which the demo fails to prove "an agent can coordinate a real, multi-tool SDLC loop." These are the seams (chat surface, stage picker, MCP lifecycle, approval gate, audit log, error handling).
- **Differentiators** — the things a generic chat wrapper cannot fake (live tool-call visualization, stage chaining, RAG over tool docs + project context, in-UI deployment/test/review surfaces, coding sub-agent). These are what separate an "agent playground" from a "chatbot pointing at a docs site."
- **Anti-features** — explicitly excluded per PROJECT.md "Out of Scope" (RBAC, SSO, billing, mobile, voice, cross-browser persistence, custom MCP authoring, production deployment pipelines). Plus a handful of YAGNI items even within scope (built-in code editor, fine-tuning, webhook receivers, plugin marketplace).

The downstream requirements phase should treat table stakes as the must-ship bar and pick a *vertical slice* of differentiators for each milestone (e.g., one MVP that proves PRD -> ticket -> code -> deploy before adding observability, sub-agents, and RAG).

---

## Table Stakes

Features the demo needs to prove it is an SDLC orchestrator and not just a wrapper. Missing any of these = the "integration pattern" isn't actually demonstrated.

| # | Feature | Why expected | Complexity | Notes |
|---|---------|--------------|------------|-------|
| TS-1 | Web chat surface with streaming responses | Entry point and dominant UX for Claude-based agents | Low | Vercel AI SDK `useChat` + Server-Sent Events; show tokens live |
| TS-2 | Stage picker (PRD / Tickets / Design / Code / Test / Review / Deploy / Observe) | PROJECT.md explicit requirement; without it the user cannot exercise stages independently | Low | Multi-select chips or ordered checklist; supports both single-stage and chained runs |
| TS-3 | MCP server lifecycle (start / stop / status / reconnect) | Claude Agent SDK contract; every integration rides on it | Med | Lifecycle scoped per session; surface status indicators so the user sees which tools are alive |
| TS-4 | Tool configuration via JSON (no authoring UI) | PROJECT.md explicitly excludes an authoring UI; users edit a config file | Low | Schema: name, transport (stdio/http), args/env, optional approval policy |
| TS-5 | Human-in-the-loop approval gate for destructive actions (commit / push / deploy / ticket create) | PROJECT.md explicit; default approved | Med | Modal confirm per action, with side-effect preview (which files, which ticket, which deploy) |
| TS-6 | Auto-approve toggle | PROJECT.md explicit; toggle exists to enable autonomy | Low | Single switch in UI; persists for the session |
| TS-7 | Audit log / action feed in the UI | The core demo value is "watch the agent talk to tools" — without a feed you can't see it | Med | Append-only stream: tool name, action, target, approval status, latency, error, link to artifact |
| TS-8 | Per-tab session with persisted conversation history | PROJECT.md says per-tab is OK; losing context on refresh would break every stage retry | Low-M | In-memory + InsForge write-through keyed by session id |
| TS-9 | Friendly error handling + retry on transient tool failures | Tools fail (rate limits, deploy timeouts). The agent must not look flaky | Med | Exponential backoff with jitter, surface last 3 attempts, allow user to retry or abort |
| TS-10 | Token / cost visibility (Anthropic only) | Anthropic is the sole paid cost; users (you, the operator) need to see spend | Low | Incremental counter fed from streamed usage metadata |
| TS-11 | Resumable sessions after refresh (within session id lifetime) | Standard chat UX; otherwise F5 = lost demo | Low | Hydrate from InsForge on reconnect; do not require re-prompt |
| TS-12 | Configuration health check on startup (which MCP servers connected, which keys missing) | Without this, "why didn't my agent call Notion?" becomes a 30-minute debugging session | Low | Show a status panel: 4/8 tools connected; 2 missing API keys; click to see docs |

---

## Differentiators

Features that make this a generic *playground* for the multi-tool/multi-stage pattern, not a one-off demo wired to a fixed scenario. Pick the subset that proves the loop most convincingly per milestone.

| # | Feature | Value proposition | Complexity | Notes |
|---|---------|-------------------|------------|-------|
| D-1 | Stage chaining (run any subset in order; each stage produces input for the next) | The entire point — one prompt can drive PRD -> ticket -> code if the user asks | High | State machine: each stage knows its inputs/outputs and which tools it touches; supports partial chains |
| D-2 | Live tool-call visualization in the action feed | "Which MCP is the agent talking to right now?" is what makes the demo observable | Med | Tool icon + label + payload preview + status: queued / awaiting-approval / running / ok / failed |
| D-3 | RAG over tool documentation (loaded once per tool) | Helps the agent choose the right MCP server and the right action when there are 8+ tools | Med | Embed each tool's public docs into InsForge at first use; retrieve top-k before each agent turn |
| D-4 | RAG over project context (accumulated PRD, tickets, code, review feedback) | Lets later stages (code, review, deploy) reference earlier outputs without re-prompting | Med-High | Each stage writes a structured summary into the vector store; retrieved by stage and by agent decision |
| D-5 | Coding sub-agent for write-code-commit-push | Isolates long, noisy code-edit context from the orchestrator and lets the main loop stay focused on stage coordination | High | Spawn via Claude Agent SDK `Task`; sandbox repo committed/pushed; surfacing diffs in UI is downstream |
| D-6 | Live deployment preview iframe (Vercel preview URL) | "It actually deployed" is the most satisfying single demo beat | Low | Render returned URL in iframe; show deployment status (building / ready / failed) |
| D-7 | In-UI test execution viewer (Playwright) | Lets the reviewer watch E2E tests run without leaving the playground | Med | Stream stdout/stderr + per-test pass/fail; optional screenshot embeds |
| D-8 | In-UI code review panel (CodeRabbit + Snyk output) | Reading raw review text buried in a feed is poor UX; lift it into a side panel | Med | Tabbed view: summary, file-by-file findings, severity filter |
| D-9 | PR diff viewer for the auto-generated commit(s) | Without this, reviewers can't see what the agent actually changed | Med | Render unified diff; link "open in GitHub" for full context |
| D-10 | Observability panels (Sentry + SigNoz) | Closes the loop: after deploy, the agent can *see* what it shipped | Low-M | Embed SigNoz dashboard iframe; list recent Sentry issues for the deployed project |
| D-11 | Approval granularity per server (commit always approve, deploy always approve, issue-create prompt) | Coarse toggle forces the user to either babysit or trust blindly; per-server gives a usable middle ground | Med | Stored in tool config JSON; UI shows "5 of 8 tools require approval" |
| D-12 | Stage replay / re-run from snapshot | Lets the user regenerate a stage without rerunning the whole chain | Med | Snapshot per-stage inputs + model params; restore on replay |
| D-13 | Manual stepping between stages | Lets the audience watch the demo run slowly | Low | "Run next stage only" button per stage in the chain |
| D-14 | Multi-tool parallelism (e.g., CodeRabbit + Snyk + Playwright run concurrently in review) | Mirrors real CI; demonstrates agent orchestration, not just sequential calls | Med | `Promise.all` with cancellation; merge results into a single review summary |
| D-15 | Idle tool discovery ("the agent can reach: Notion, Linear, ...") | Lets the user discover what's wired in without reading code | Low | Render server list on first connection with each tool's capability hint |

---

## Anti-Features

Deliberately NOT built. Includes everything in PROJECT.md "Out of Scope" plus several YAGNI add-ons.

| # | Anti-feature | Why avoid | What to do instead |
|---|--------------|-----------|-------------------|
| A-1 | Multi-user accounts / teams / RBAC | Single-user demo (PROJECT.md) | Hard-code single operator; per-session API keys |
| A-2 | Persistent long-running sessions across browsers / devices | Per-tab only (PROJECT.md) | Session id in cookie; in-memory + InsForge write-through |
| A-3 | SSO / SAML / OIDC for any connected tool | API tokens only (PROJECT.md) | Per-tool API keys in local `.env` |
| A-4 | Mobile-native UI (iOS / Android / PWA full-screen) | Desktop browser only (PROJECT.md) | Responsive web only; no native shell |
| A-5 | Billing / paywalls / usage metering | N/A (PROJECT.md) | Show cost counter for transparency, never bill |
| A-6 | Voice input / output | Text only (PROJECT.md) | Plain text chat; no microphone permissions |
| A-7 | Multi-language UI | English only (PROJECT.md) | Hard-coded English strings |
| A-8 | Custom MCP server authoring UI | JSON config only (PROJECT.md) | Edit a JSON file in the repo; document schema in README |
| A-9 | Production-grade deployment pipelines | Vercel hobby/preview only (PROJECT.md) | Preview URLs only; no prod traffic, no CDN config, no custom domains |
| A-10 | Production observability at scale | Demo traffic only (PROJECT.md) | Free tiers with ingest caps; just enough to prove the loop |
| A-11 | Built-in code editor | The point is to show what the agent did, not to author code by hand | "Open in GitHub" link + read-only diff viewer |
| A-12 | Custom model selection UI | Model is a config decision (PROJECT.md `claude_md_path`, model profile) | Change in config / env; document override |
| A-13 | Plugin marketplace / tool discovery registry | Fixed tool list for v1 | JSON config; manual addition when needed |
| A-14 | Webhook receivers / push-based integrations | MCP pull model is the standard | Poll or event-driven via SDK callbacks only when SDK requires it |
| A-15 | Fine-tuning / LoRA / training pipelines | Out of scope for demo | Document model choice in PROJECT.md; pivot if needed |
| A-16 | SOC 2 / HIPAA / GDPR compliance posture | Demo not product | Don't claim compliance; don't handle regulated data |
| A-17 | Backup / disaster recovery | Demo | Ephemeral state in InsForge + Vercel hobby acceptable |
| A-18 | Real-time multi-user collaboration (cursors, presence) | Single user | Don't even stub |
| A-19 | Tenant data isolation, row-level security | Single tenant | Plain tables; one InsForge project |
| A-20 | Approval workflow builder (drag-drop rules) | Per-server approvals is plenty for the demo | JSON policy field per tool |

---

## Feature Dependencies

```
TS-1 Chat surface
  requires TS-8 per-tab session, TS-10 cost counter
  feeds  D-2 tool-call viz into same stream

TS-2 Stage picker
  requires (nothing)
  enables  D-1 chaining, D-13 manual stepping, D-12 replay

TS-3 MCP lifecycle
  requires TS-4 tool config, TS-12 startup health check
  enables  every D-* tool integration

TS-4 Tool config (JSON)
  requires (nothing)
  enables  TS-3, D-11 per-server approvals

TS-5 Approval gate
  requires TS-6 auto-approve toggle, TS-11 approval granularity
  hooks  every destructive action (commit/push/deploy/ticket-create)
  optional D-11 per-server overrides

TS-7 Audit log
  requires TS-3 MCP lifecycle
  feeds   D-2 live viz, D-10 observability panels

D-1 Stage chaining
  requires TS-2 picker, TS-7 log
  orchestrates the entire SDLC loop:
    PRD stage  -> Notion MCP (read/write PRD)
    Tickets    -> Linear MCP (create/update issues)
    Design     -> v0 MCP (UI generation)
    Code       -> D-5 coding sub-agent + sandbox repo
    Test       -> Playwright MCP (D-7 viewer)
    Review     -> CodeRabbit + Snyk (D-8 panel), run in parallel via D-14
    Deploy     -> Vercel MCP/API (D-6 preview iframe)
    Observe    -> Sentry + SigNoz (D-10 panels)

D-3 RAG over tool docs
  requires InsForge vector store (PROJECT.md)
  one-shot ingestion per tool at first connect
  feeds   agent tool-selection decision

D-4 RAG over project context
  requires D-1 chaining (each stage writes summaries)
  read-retrieve across stages: tickets inform code, code informs review

D-5 Coding sub-agent
  requires TS-3 MCP lifecycle + sandbox repo
  optionally uses D-9 PR diff viewer
```

Linear dependencies (A=true blocker, B=hard for, soft for in parens):

- TS-1, TS-2, TS-3, TS-4 — independent foundations.
- TS-5, TS-6, TS-7, TS-8, TS-9, TS-10, TS-11 — depend on TS-1 + TS-3.
- TS-12 — depends on TS-3, TS-4.
- D-1 depends on TS-2, TS-7.
- D-2 depends on TS-7, TS-3.
- D-5, D-7, D-8, D-9, D-10 — independent integrations, each depends on TS-3 + D-1 frame.
- D-3, D-4 — depend on InsForge + D-1.

---

## MVP Recommendation

For the first vertical slice that *proves* the orchestration pattern to a viewer:

**Must ship (MVP v0):**
1. TS-1 Chat surface with streaming
2. TS-2 Stage picker (single + chained)
3. TS-3 MCP lifecycle + TS-12 startup health check
4. TS-4 Tool config (JSON)
5. TS-5 Approval gate + TS-6 auto-approve toggle
6. TS-7 Action feed / audit log
7. TS-8 Per-tab session persistence
8. TS-9 Error handling + retry
9. TS-10 Cost counter
10. The PRD -> Linear ticket end-to-end slice: PRD in Notion -> agent reads it -> creates Linear sub-issues. This single slice proves "agent coordinates real tools via MCP."

**Defer until after MVP:**
- D-1 full chain end-to-end (extend after the first slice lands)
- D-2 live tool-call viz (upgrade the audit log)
- D-3 RAG over tool docs (agent can select tools by name from JSON config initially)
- D-4 RAG over project context (build once chained stages exist)
- D-5 coding sub-agent + D-9 diff viewer
- D-6 Vercel preview iframe
- D-7 Playwright viewer
- D-8 review panel (CodeRabbit + Snyk)
- D-10 Sentry + SigNoz panels
- D-11 per-server approval granularity
- D-12 replay
- D-13 manual stepping
- D-14 multi-tool parallelism
- D-15 idle tool discovery

**Won't build (anti-features):** A-1..A-20, all of them.

---

## Sources

External research providers (Brave, Exa, Tavily, Firecrawl, Ref, Perplexity, Jina) and the built-in WebSearch/WebFetch were unavailable in this environment per `.planning/config.json`. The feature landscape is grounded in:

- `C:/Users/Pichu/Documents/ColimaSoft/Learning/AIdevelopment/Practice/ai-agent-test/.planning/PROJECT.md` — authoritative scope, requirements, and Out of Scope list.
- Model Context Protocol (MCP) — Anthropic's open protocol for connecting agents to tools; the canonical contract every MCP server in the integrations list must implement.
- Claude Agent SDK — Anthropic's reference runtime for Claude-with-tools; underpins MCP lifecycle, sub-agents (`Task` tool), and approval flows.
- Vercel AI SDK `useChat` streaming chat conventions — the standard Next.js pattern for streaming chat UX.
- InsForge — backend chosen for built-in RAG / vector store, per PROJECT.md decision rationale.
- Tool documentation for Notion, Linear, v0, Playwright, CodeRabbit, Snyk, Vercel, Sentry, SigNoz (each tool's free-tier surface area and MCP availability as of mid-2026; revisit per integration if any MCP server is missing at implementation time).

## Gaps to Address

- **MCP coverage check:** confirm which of the nine integrations actually have a public MCP server today (vs. an API or CLI we must wrap). v0, CodeRabbit, Snyk, SigNoz MCP availability is the most likely gap; revisit at integration phase.
- **InsForge free-tier limits:** PROJECT.md flags Supabase as fallback if RAG ingest caps bite; verify before locking architecture.
- **Approval granularity:** D-11 may collapse into TS-6 if the per-server model adds friction for the demo; UX-test during MVP.
- **Coding sub-agent boundary:** D-5 isolation could be skipped initially by running code edits in the same agent context; defer until the simpler path proves limited.
