# SDLC AI Agent Playground

## What This Is

A web-based AI agent playground that orchestrates a real SDLC pipeline across external SaaS tools via MCP servers, Skills, and RAG. The user chats with the agent in a browser, picks which SDLC stage(s) to run, and watches the agent talk to Notion, Linear, v0, Playwright, CodeRabbit, Snyk, Vercel, Sentry, and SigNoz through real APIs — not simulations. Built as a working demo, not a product to ship.

## Core Value

**Prove that an AI agent can coordinate a real, multi-tool SDLC loop using MCP + Skills + RAG in a generic playground.** Every tool integration is real; every action the agent takes (commit, push, deploy, ticket creation) passes through an optional human-approval gate.

## Business Context

Not monetized. Single-user demo for showcasing the integration pattern. No customers, no revenue target. Strategy notes: this is a learning/reference implementation — clarity of pattern matters more than scale or polish.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Web UI chat surface where user sends messages to the agent
- [ ] Agent runtime based on Claude Agent SDK with MCP server lifecycle management
- [ ] MCP server for Notion (PRD + meeting notes)
- [ ] MCP server for Linear (tickets, issues, sub-issues derived from PRD)
- [ ] MCP server for v0 (UI design from PRD or Linear issue context)
- [ ] Coding sub-agent that writes real code, commits, and pushes to a sandbox repo
- [ ] MCP integration for Playwright (E2E test generation and execution)
- [ ] CodeRabbit integration for code review feedback
- [ ] Snyk integration for dependency + code security scanning
- [ ] Vercel integration for deployment of generated code
- [ ] Sentry integration for error monitoring post-deploy
- [ ] SigNoz integration for tracing/observability post-deploy
- [ ] Human-in-the-loop approval toggle per destructive action (commit, push, deploy, create ticket)
- [ ] Stage picker so user can run any SDLC stage independently or chained end-to-end
- [ ] RAG layer over tool documentation (loaded once per tool)
- [ ] RAG layer over project context (accumulated PRD, tickets, code, review feedback)
- [ ] InsForge as backend (DB, auth, vector store for RAG)
- [ ] Free-tier everything — no paid plans required

### Out of Scope

- Multi-user accounts / teams / RBAC — single-user demo
- Persistent long-running sessions across browsers — per-tab sessions only
- Production-grade deployment pipelines — Vercel hobby/preview only
- Real production observability at scale — Sentry/SigNoz ingest for demo traffic only
- SSO/SAML for any connected tool — API tokens only
- Mobile-native UI — desktop browser only
- Billing, usage metering, paywalls — N/A
- Custom MCP server authoring UI — config via JSON
- Voice input / voice output — text only
- Multi-language UI — English only

## Context

- Repo currently empty except `README.md` + git history. Greenfield build.
- Project sits inside an AI development learning path; audience is developers studying agent patterns.
- The user is the operator (single-user). No external collaborators for v1.
- All tools used in the SDLC loop are real, third-party SaaS with free tiers.
- InsForge was chosen over Supabase because it natively targets the AI-agent integration use case (built-in RAG, AI-friendly schema). Supabase is the documented fallback if InsForge free-tier limits bite.

## Constraints

- **Budget**: $0. Free tier for every external service. Anthropic API calls are the only paid cost (user controls this).
- **Stack**: Next.js for web UI (deploys natively to Vercel free tier). Claude Agent SDK for agent runtime. InsForge for backend/DB/vector store.
- **Tooling**: Every SDLC tool connects via MCP server (where MCP exists) or its official CLI/API (where MCP doesn't yet exist). No mocked responses.
- **Demo scope**: One sandbox project per session. Cleanup at session end.
- **Approval**: Default = human approves destructive actions. Toggle exists to enable auto-approve.
- **Compatibility**: Modern Chromium browsers only for the web UI.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web UI over CLI | Better demo surface for showcasing tool integrations | — Pending |
| Generic playground over fixed scenario | User explores stages independently or chained | — Pending |
| Real tool calls over simulations | Demo must prove the integration pattern works | — Pending |
| Human-in-the-loop toggle (default approval) | Safe demo, lets user opt into autonomy | — Pending |
| RAG over both tool docs and project context | Tool docs = grounding for tool selection; project context = grounding for stage chaining | — Pending |
| InsForge over Supabase | Native AI/RAG integration, free tier sufficient for demo | — Pending |
| Claude Agent SDK over raw Messages API | Built-in MCP lifecycle, tool routing, sub-agent spawning | — Pending |
| Next.js + Vercel free tier | Native deploy, no infra to manage | — Pending |
| Free tier only on all services | Demo budget = $0 (excl. Anthropic API) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Business Context check — still single-user demo?
4. Audit Out of Scope — reasons still valid?
5. Update Context with current state

---
*Last updated: 2026-08-19 — Phase 1 (Foundation) complete. Walking Skeleton + persistence + RAG scaffold + HITL gates + UI shell + resilience shipped end-to-end (5/5 plans, 19/19 must-haves verified).*

**Phase 1 deviations worth noting:**
- Runtime pivoted from Claude Agent SDK to Mastra per D-01 (one-way decision, recorded in `01-CONTEXT.md`).
- Backend: InsForge (preferred) + Supabase fallback per D-04 / D-12.
- Free-tier Anthropic API spend is the only paid cost.
