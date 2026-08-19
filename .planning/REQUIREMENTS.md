# Requirements: SDLC AI Agent Playground

**Defined:** 2026-08-18
**Core Value:** Prove an AI agent can coordinate a real, multi-tool SDLC loop using MCP + Skills + RAG in a generic playground.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Web UI

- [x] **UI-01**: User can chat with the agent in a streaming interface (Vercel AI SDK `useChat`)
- [x] **UI-02**: User can pick which SDLC stage(s) to run (Planning, Tickets, Design, Code, Test, Review, Deploy, Observe)
- [x] **UI-03**: User sees a real-time action feed showing every tool call the agent makes
- [x] **UI-04**: User session persists across browser refresh via `localStorage` session id + server-side session resume
- [x] **UI-05**: User sees friendly error toasts with auto-retry for transient failures
- [x] **UI-06**: User sees running token cost estimate in the header
- [x] **UI-07**: App shows a startup health check banner (MCP servers connected, tokens valid)
- [ ] **UI-08**: User can replay any past stage from a snapshot stored in InsForge

### Agent Runtime

- [x] **RT-01**: Agent loop is implemented with the Claude Agent SDK (TypeScript) — owns tool routing, sub-agents, hooks, sessions, permissions
- [x] **RT-02**: Agent runtime worker is a long-lived Node process emitting SSE events to the Next.js API relay
- [x] **RT-03**: MCP server lifecycle (stdio spawn, handshake, tool-list cache, auto-reconnect) is managed by the SDK wrapper with retry-with-reconnect on error
- [ ] **RT-04**: Sub-agent spawning uses a structured `handoff` object (`{ stage, prd_summary, prior_decisions[], relevant_ids[] }`); sub-agent depth capped at 2

### Human-in-the-Loop

- [x] **HITL-01**: Every tool is classified at registration as `read` / `write_low_risk` / `write_high_risk`; `read` is auto-approved, `write_low_risk` shows a prompt, `write_high_risk` requires typed confirmation
- [x] **HITL-02**: User can toggle "auto-approve all" to bypass prompts for the current session (default: off)

### Notion (MCP)

- [ ] **NOT-01**: Agent can read a Notion page (PRD) and return its content
- [ ] **NOT-02**: Agent can write a Notion page (PRD draft, meeting notes) with structured blocks
- [ ] **NOT-03**: Per-session Notion token is validated at boot via `TokenProvider`

### Linear (MCP)

- [ ] **LIN-01**: Agent can read Linear issues from a project
- [ ] **LIN-02**: Agent can create Linear issues with title, description, parent
- [ ] **LIN-03**: Agent can create sub-issues from a PRD section using a deterministic `external_id` derived from PRD section hash (idempotency)

### Design (v0 wrapper)

- [ ] **DSN-01**: Agent can call v0 API to generate UI components from a PRD context
- [ ] **DSN-02**: Generated designs are cached by `(prd_hash, design_intent)` to respect v0 free-tier quota (7 messages/day)

### Code (sub-agent)

- [ ] **COD-01**: Coding sub-agent can read, write, edit files in a per-session sandbox repo
- [ ] **COD-02**: Coding sub-agent can run bash commands and git operations inside the sandbox
- [ ] **COD-03**: Sandbox repo is initialized per session and cleaned at session end
- [ ] **COD-04**: Sandbox repo must be public by default (CodeRabbit free tier requires public repos)

### Test (Playwright MCP)

- [ ] **TST-01**: Agent can generate Playwright E2E test scripts from a description of the target page
- [ ] **TST-02**: Agent can execute generated tests against a deployed preview URL and return pass/fail per test

### Review (CodeRabbit + Snyk wrappers)

- [ ] **REV-01**: Agent can invoke CodeRabbit to review a PR and return structured feedback
- [ ] **REV-02**: Agent can run Snyk scan against the sandbox repo (debounced by lockfile mtime to respect 200 tests/month quota)

### Deploy (Vercel MCP)

- [ ] **DEP-01**: Agent can deploy the sandbox repo to a Vercel preview URL
- [ ] **DEP-02**: Preview URLs older than 24h are pruned by a scheduled job (respect Hobby tier ~100 deploys/day cap)

### Observe (Sentry MCP)

- [ ] **OBS-01**: Agent can pull recent Sentry issues for the deployed project and surface them in the UI

### RAG

- [ ] **RAG-01**: Tool docs (per-MCP server) are embedded once at build into a pgvector collection
- [ ] **RAG-02**: A retrieval tool is exposed to the agent; it embeds the agent's query, fetches top-k=5 from the tool docs collection, returns as context

### Backend (InsForge)

- [ ] **BCK-01**: InsForge project provisioned with Postgres schema for sessions, audit log, vector store, snapshots
- [ ] **BCK-02**: Auth via InsForge single-user mode (no multi-user)
- [ ] **BCK-03**: Vector store (pgvector) holds two collections: `tool_docs` (build-time) and `project_context` (deferred to v2 — see v2 Requirements)
- [ ] **BCK-04**: Audit log persists every tool call with `stage`, `tool_name`, `args_hash`, `result_status`, `tokens_used`, `timestamp`
- [ ] **BCK-05**: Supabase+pgvector fallback config is documented and deployable in one switch if InsForge free-tier limits bite

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Project Context RAG

- **RAG-03**: Project context collection accumulates PRD, tickets, code, review feedback; re-embedded per stage boundary
- **RAG-04**: Write-time re-index hooks fire on every Notion/Linear/code write to keep the project context collection fresh

### Batched / Per-Server Approvals

- **HITL-03**: User can approve all destructive ops for a stage at once at stage start
- **HITL-04**: Per-server approval granularity (separate toggles per tool)

### Observability Expansion

- **OBS-02**: SigNoz MCP integration for traces + metrics (OSS self-host or stub fallback)
- **OBS-03**: In-UI observability panels (Sentry issues + SigNoz traces side-by-side)

### Multi-tool Parallelism

- **RT-05**: Parallel sub-agent execution capped at 2 concurrent with backoff + jitter

### Idle Tool Discovery

- **UI-09**: Idle tool discovery — surface MCP tools the agent didn't use but could have

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-user accounts / teams / RBAC | Single-user demo |
| Cross-device session persistence | Per-tab sessions only |
| SSO/SAML for connected tools | API tokens only |
| Mobile-native UI | Desktop browser only |
| Voice input / output | Text only |
| Multi-language UI | English only |
| Custom MCP server authoring UI | JSON config only |
| Production deploy pipelines | Vercel Hobby preview only |
| Production observability at scale | Demo traffic only |
| Built-in code editor in UI | Coding happens in sub-agent sandbox |
| Custom model picker | Single model mix per role |
| Plugin marketplace | Demo scope |
| Webhooks from external services | Polling only |
| Fine-tuning | Generic Claude models only |
| SOC2/HIPAA compliance | Demo only |
| Backups / disaster recovery | Ephemeral demo |
| RLS / row-level security | Single-user |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UI-01 | Phase 1 | Complete |
| UI-02 | Phase 1 | Complete |
| UI-03 | Phase 1 | Complete |
| UI-04 | Phase 1 | Complete |
| UI-05 | Phase 1 | Complete |
| UI-06 | Phase 1 | Complete |
| UI-07 | Phase 1 | Complete |
| UI-08 | Phase 8 | Pending |
| RT-01 | Phase 1 | Complete |
| RT-02 | Phase 1 | Complete |
| RT-03 | Phase 1 | Complete |
| RT-04 | Phase 4 | Pending |
| HITL-01 | Phase 1 | Complete |
| HITL-02 | Phase 1 | Complete |
| NOT-01 | Phase 2 | Pending |
| NOT-02 | Phase 2 | Pending |
| NOT-03 | Phase 2 | Pending |
| LIN-01 | Phase 3 | Pending |
| LIN-02 | Phase 3 | Pending |
| LIN-03 | Phase 3 | Pending |
| DSN-01 | Phase 4 | Pending |
| DSN-02 | Phase 4 | Pending |
| COD-01 | Phase 4 | Pending |
| COD-02 | Phase 4 | Pending |
| COD-03 | Phase 4 | Pending |
| COD-04 | Phase 4 | Pending |
| TST-01 | Phase 5 | Pending |
| TST-02 | Phase 5 | Pending |
| REV-01 | Phase 5 | Pending |
| REV-02 | Phase 5 | Pending |
| DEP-01 | Phase 6 | Pending |
| DEP-02 | Phase 6 | Pending |
| OBS-01 | Phase 7 | Pending |
| RAG-01 | Phase 1 | Pending |
| RAG-02 | Phase 1 | Pending |
| BCK-01 | Phase 1 | Pending |
| BCK-02 | Phase 1 | Pending |
| BCK-03 | Phase 1 | Pending |
| BCK-04 | Phase 1 | Pending |
| BCK-05 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-18*
*Last updated: 2026-08-18 after initial definition*
