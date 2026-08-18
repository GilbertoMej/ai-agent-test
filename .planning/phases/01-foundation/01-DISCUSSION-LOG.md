# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-18
**Phase:** 1-Foundation
**Areas discussed:** Stack pivot (pre-discussion), Worker topology, HITL approval UX, Chat surface layout, RAG tool docs scope

---

## Pre-discussion: Stack Pivot

The original research and CLAUDE.md specified Claude Agent SDK + Anthropic models (Sonnet 4.5 orchestrator, Haiku 4.5 sub-agents, voyage-3 embeddings). User rejected this stack and pivoted mid-discussion.

**User's direction:**
- Not using Claude models
- Agent model = OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free`
- InsForge-side AI functions = DeepSeek V4 Flash via InsForge model gateway (not via OpenRouter)
- TS agent framework = Mastra AI (if OpenRouter-compatible), else OpenAI SDK package directly
- Embeddings = InsForge vector (with local transformers.js deferred to later)

**Claude's verification (via WebFetch):**
- Nemotron 3 Ultra free exists on OpenRouter; 1M context, 65K output, tool calling ✓, no structured JSON output, free tier data-logging caveat
- DeepSeek V4 Flash 0731 exists on OpenRouter; 1.3M context, 262K output, tool calling + structured JSON ✓, $0.077/$0.153/1M tok
- Mastra supports MCP via `@mastra/mcp` `MCPServer` class + `startStdio()` for stdio
- Mastra supports HITL via `requireApproval` per tool + conditional `requireToolApproval` function on `stream()/generate()`, with `approveToolCall()`/`declineToolCall()` API and suspended-runs resume
- Mastra supports sub-agents, Memory (sessions), Processors, streaming chunks
- Mastra custom gateways feature supports OpenRouter via OpenAI-compatible base URL

**User confirmation:** "Yes to all three" (Mastra + Nemotron + DeepSeek via InsForge) + "use InsForge vector for embeddings, maybe later add local transformer".

**Impact on Phase 1 scope:** Stack table rewrite; D-01..D-04 in CONTEXT.md capture the new stack. No requirements added/removed, but RT-01, HITL-01, RAG-01/02 implementations change.

---

## Worker topology (RT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Local-only worker | `pnpm dev` spawns Next.js + Mastra on user's machine; localhost proxy | ✓ |
| Fly.io / Railway free tier | Worker on free-tier host, Next.js on Vercel Hobby | |
| In-process (single Node) | Mastra runs inside Next.js process; no separate process | |

**User's choice:** Local-only worker (Recommended)
**Notes:** Matches PROJECT.md "demo runs on the user's machine". No public demo URL in Phase 1.

| Option | Description | Selected |
|--------|-------------|----------|
| Per-stage lazy | MCPs load when stage is picked; fast startup, "not loaded" banner | ✓ |
| All MCPs at boot | All MCPs connected at startup; slow (~30s), fragile | |
| Always lazy on first tool use | MCPs load on first tool_use; no banner signal | |

**User's choice:** Per-stage lazy (Recommended)
**Notes:** Maps to UI-07 banner behavior — stages not picked yet show "not loaded".

| Option | Description | Selected |
|--------|-------------|----------|
| Pause + wait reconnect | Worker pauses on tab close; resumes on SSE reconnect | ✓ |
| Continue, drop output | Stage finishes in worker; result discarded | |
| Abort + save partial | Worker aborts; partial state saved to InsForge | |

**User's choice:** Pause + wait reconnect (Recommended)
**Notes:** Matches UI-04 intent ("persists across refresh") and extends to close-reopen.

| Option | Description | Selected |
|--------|-------------|----------|
| tsx watch + InsForge session resume | Auto-restart on crash; session resumes from snapshot | ✓ |
| Auto-restart, lose session | Auto-restart; current session lost | |
| No auto-restart, manual | Worker dies; manual restart required | |

**User's choice:** tsx watch + InsForge session resume (Recommended)
**Notes:** Session persistence is a UI-04 requirement; worker restart must preserve.

---

## HITL approval UX (HITL-01..02)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline card in chat | Chat pauses, card inserts where agent would speak | ✓ |
| Right-side drawer | Drawer slides out listing pending approvals | |
| Bottom toast (non-blocking) | Bottom-of-screen toast, doesn't block scroll | |
| Modal popup | Centered modal, blocks UI | |

**User's choice:** Inline card in chat (Recommended)
**Notes:** write_low case.

| Option | Description | Selected |
|--------|-------------|----------|
| Same inline card + typed input | Consistent placement; red border + DESTRUCTIVE badge | ✓ |
| Modal popup for write_high | Visual escalation, jarring jump mid-chat | |

**User's choice:** Same inline card + typed input (Recommended)
**Notes:** Consistency over visual escalation; risk signaled visually.

| Option | Description | Selected |
|--------|-------------|----------|
| Tiered: terse for low, full info for high | write_low = name + risk reason; write_high = full args + diff + typed | ✓ |
| Terse always | Same fields both tiers | |
| Verbose always | Full info on every card | |
| Tiered: terse default, expand for details | Compact + click-to-expand | |

**User's choice:** Tiered: terse for low, full info for high (Recommended)
**Notes:** write_low stays terse to keep chat flowing; write_high gets full transparency.

| Option | Description | Selected |
|--------|-------------|----------|
| Global toggle + 5-min batch button | Header toggle + per-card "approve all matching 5 min" | ✓ |
| Global toggle only | Just the header toggle, no batch escape | |
| Global + per-stage pre-approval | Toggle + per-stage checkbox at stage pick | |

**User's choice:** Global toggle + 5-min batch button (Recommended)
**Notes:** Best UX for chained stage runs (Code stage = many commits in a row).

---

## Chat surface layout (UI-02, UI-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Left sidebar | Vertical list of 8 stages | ✓ |
| Top bar chips | Horizontal row, crowded on narrow viewports | |
| Right sidebar | Less conventional for LTR flow | |
| Header dropdown | Collapsed, slow stage switching | |

**User's choice:** Left sidebar (Recommended)
**Notes:** Standard chat-with-sidebar pattern; works with 8 stages.

| Option | Description | Selected |
|--------|-------------|----------|
| Greyed + tooltip "Phase X" | Disabled with future-phase hint | ✓ |
| Show only active stages | Only show working stages | |
| Coming-soon badge | Badge instead of tooltip | |
| Clickable + placeholder page | Clickable, fakes functionality | |

**User's choice:** Greyed + tooltip "Phase X" (Recommended)
**Notes:** Communicates full scope without faking.

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in chat | Tool calls as message bubbles | ✓ |
| Right sidebar | Ops dashboard feel | |
| Bottom drawer | Collapsible, easy to miss | |
| Floating overlay | Bottom-right persistent | |

**User's choice:** Inline in chat (Recommended)
**Notes:** Narrative flow; tool calls = conversation.

| Option | Description | Selected |
|--------|-------------|----------|
| Tool name + args preview + result snippet | Terse for low, full info for high; tokens in header | ✓ |
| Terse: name + status | Cleanest, expand for details | |
| Verbose: all fields | Most informative, noisy | |
| Tiered: terse default, expand | Compact + click-expand | |

**User's choice:** Tool name + args preview + result snippet (Recommended)
**Notes:** Tokens shown globally in header (UI-06), not per entry.

---

## RAG tool docs scope (RAG-01..02)

| Option | Description | Selected |
|--------|-------------|----------|
| MCP servers only (4) | Notion, Linear, Playwright, Sentry | ✓ |
| MCP + custom wrappers (9) | All 9 SDLC tools | |
| Notion only (minimal MVP) | Just Notion, expand per phase | |

**User's choice:** MCP servers only (Recommended)
**Notes:** Custom wrappers have their code as docs (project_context, deferred to v2 per RAG-03). SigNoz deferred to Phase 7.

| Option | Description | Selected |
|--------|-------------|----------|
| Scrape official docs | Fetch from official MCP server READMEs + API docs | ✓ |
| Curated markdown in repo | Operator-maintained markdown | |
| Hybrid: curated skeleton + scraped ref | Two sources | |

**User's choice:** Scrape official docs (Recommended)
**Notes:** Less maintenance; risk of scraping fragility acknowledged.

| Option | Description | Selected |
|--------|-------------|----------|
| Auto on `pnpm dev` if stale | Startup check; re-embed if empty or >7 days | ✓ |
| Manual `pnpm embed-docs` script | Operator-driven | |
| CI on commit to main | GitHub Actions step | |
| Auto-embed on every worker boot | Always re-embed | |

**User's choice:** Auto on `pnpm dev` if stale (Recommended)
**Notes:** No CI step needed for local-only worker.

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed top-k=5, formatted context string | Per RAG-02 spec | ✓ |
| Agent-tunable k | Agent specifies k at call time | |
| Adaptive k | Query-length based | |

**User's choice:** Fixed top-k=5, formatted context string (Recommended)
**Notes:** RAG-02 spec; no per-call override in Phase 1.

---

## Claude's Discretion

- Tool classification exact list (read / write_low / write_high per tool name) — defaults per architecture file
- IPC transport between Next.js and worker — HTTP+SSE localhost + shared secret
- Audit log write trigger — Mastra middleware hook
- Auth shape (BCK-02) — env-var bearer token, no login screen (single-user demo)
- InsForge vs Supabase fallback (BCK-05) — InsForge primary, Supabase documented as env-switch fallback

## Deferred Ideas

- Local embedding via transformers.js as RAG fallback — user explicitly deferred
- Per-stage pre-approval UI checkbox — replaced by 5-min batch button
- Vercel deploy story for Phase 1 — local-only; deferred to Phase 8+
- MCP schema drift detection automation — manual version pinning baseline
- SigNoz self-host vs stub (Phase 7 decision per research SUMMARY §Gaps)
- v0 API wrapper design (Phase 4 needs API exploration before planning)
- Linear MCP package selection (Phase 3 — confirm at planning)
