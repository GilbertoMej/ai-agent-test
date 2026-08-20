# Roadmap: SDLC AI Agent Playground

**Core value:** Prove an AI agent can coordinate a real, multi-tool SDLC loop using MCP + Skills + RAG in a generic playground.
**Granularity:** standard
**Mode:** mvp
**Phases:** 8
**Coverage:** 40/40 v1 requirements mapped

## Phases

- [x] **Phase 1: Foundation** — Next.js chat UI, Claude Agent SDK runtime, HITL gate, RAG scaffolding, InsForge backend (completed 2026-08-19)
- [ ] **Phase 2: Notion MCP Integration** — Stage picker -> PRD stage (read/write Notion pages, per-stage snapshot)
- [ ] **Phase 3: Linear MCP Integration** — Stage picker -> Tickets stage (create Linear sub-issues from PRD, idempotent)
- [ ] **Phase 4: v0 Design + Coding Sub-agent** — Stage picker -> Design + Code stages (v0 UI generation + sandbox repo commits)
- [ ] **Phase 5: Playwright Test + CodeRabbit/Snyk Review** — Stage picker -> Test + Review stages
- [ ] **Phase 6: Vercel Deploy** — Stage picker -> Deploy stage (preview URL + iframe + prune job)
- [ ] **Phase 7: Sentry Observability** — Stage picker -> Observe stage (recent issues + observability panel)
- [ ] **Phase 8: Stage Chaining + Replay** — End-to-end chain, idempotency, session resume, stage replay

## Phase Details

### Phase 1: Foundation

**Goal**: User can chat with the agent in a streaming web UI, see live tool calls, and have every destructive action gated by a tiered approval flow — all powered by a long-lived Claude Agent SDK runtime with managed MCP lifecycles, an InsForge-backed audit log, and a RAG retrieval tool over tool docs.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, RT-01, RT-02, RT-03, HITL-01, HITL-02, RAG-01, RAG-02, BCK-01, BCK-02, BCK-03, BCK-04, BCK-05
**Success Criteria** (what must be TRUE):

  1. User can open the chat surface, send a message, and see a streaming reply from the agent
  2. User sees a startup health-check banner confirming MCP servers are connected and tokens are valid
  3. User sees a real-time action feed listing every tool the agent invokes with status
  4. Read-only tools run silently; low-risk writes prompt the user; high-risk writes demand typed confirmation; the "auto-approve all" toggle bypasses prompts for the current session
  5. User sees a running token-cost estimate in the header

**Plans**: 4 (A-tracer, B-persistence-and-rag, C-hitl, D-ui-and-resilience) + 5 gap closures (E, G, H, I, J) — all executed; verified PASS-WITH-NOTES
**UI hint**: yes

### Phase 2: Notion MCP Integration

**Goal**: User can run the "PRD" stage — the agent reads a Notion page and returns its content, and writes new pages (PRD drafts, meeting notes) with structured blocks — and every Notion write is captured in a per-stage snapshot for replay.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: NOT-01, NOT-02, NOT-03
**Success Criteria** (what must be TRUE):

  1. User picks the "PRD" stage; the agent reads the selected Notion page and returns its content in the chat
  2. User asks the agent to write a Notion page; the new page appears in Notion with structured blocks
  3. After a stage run, the user can replay the stage from a snapshot stored in InsForge

**Plans**: TBD

### Phase 3: Linear MCP Integration

**Goal**: User can run the "Tickets" stage — the agent reads a PRD from Notion, creates Linear sub-issues with idempotent `external_id`s derived from the PRD section hash, and avoids duplicates on repeat runs.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: LIN-01, LIN-02, LIN-03
**Success Criteria** (what must be TRUE):

  1. User picks the "Tickets" stage; the agent creates Linear issues with title, description, and parent from the PRD
  2. User sees the created issues appear in their Linear project
  3. Running the same PRD section twice does not create duplicate issues (idempotency via external_id)

**Plans**: TBD

### Phase 4: v0 Design + Coding Sub-agent

**Goal**: User can run the "Design" stage (agent calls v0 to generate UI components, cached by `prd_hash + design_intent` to respect v0 free-tier quota) and the "Code" stage (coding sub-agent reads, writes, edits files, runs bash and git operations in a per-session public sandbox repo, and pushes a branch) — with a PR diff viewer in the UI.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: DSN-01, DSN-02, COD-01, COD-02, COD-03, COD-04, RT-04
**Success Criteria** (what must be TRUE):

  1. User picks the "Design" stage; the agent returns generated UI components from v0 in the chat
  2. Repeating the same design request hits the `(prd_hash, design_intent)` cache instead of re-calling v0
  3. User picks the "Code" stage; the coding sub-agent reads, writes, and edits files in the sandbox, runs bash and git, commits, and pushes to a public branch
  4. User sees a PR diff viewer showing the files the sub-agent changed
  5. The sandbox repo is initialized per session and cleaned at session end

**Plans**: TBD
**UI hint**: yes

### Phase 5: Playwright Test + CodeRabbit/Snyk Review

**Goal**: User can run the "Test" stage (Playwright generates and runs E2E tests against the deployed preview URL, returning per-test pass/fail) and the "Review" stage (CodeRabbit returns structured PR feedback, Snyk scans the sandbox repo, debounced by lockfile mtime to respect the 200 tests/month quota).
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: TST-01, TST-02, REV-01, REV-02
**Success Criteria** (what must be TRUE):

  1. User picks the "Test" stage; the agent generates Playwright tests from a description and runs them against the preview URL, returning per-test pass/fail
  2. User sees the test execution viewer in the UI with pass/fail per test
  3. User picks the "Review" stage; the agent returns CodeRabbit feedback and a Snyk scan summary in the review panel
  4. Snyk does not re-run when the lockfile mtime has not changed since the last scan

**Plans**: TBD
**UI hint**: yes

### Phase 6: Vercel Deploy

**Goal**: User can run the "Deploy" stage — the sandbox repo deploys to a Vercel Hobby preview URL, the user sees the live site in an iframe, and previews older than 24h are pruned automatically to respect the Hobby tier ~100 deploys/day cap.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: DEP-01, DEP-02
**Success Criteria** (what must be TRUE):

  1. User picks the "Deploy" stage; the sandbox repo deploys to a Vercel preview URL
  2. User sees the deployed site rendered in an iframe in the UI
  3. Preview URLs older than 24h are pruned by a scheduled job

**Plans**: TBD
**UI hint**: yes

### Phase 7: Sentry Observability

**Goal**: User can run the "Observe" stage — the agent pulls recent Sentry issues for the deployed project and surfaces them in an in-UI observability panel, closing the SDLC loop.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: OBS-01
**Success Criteria** (what must be TRUE):

  1. User picks the "Observe" stage; the agent returns recent Sentry issues for the deployed project
  2. User sees the observability panel in the UI listing the issues

**Plans**: TBD
**UI hint**: yes

### Phase 8: Stage Chaining + Replay

**Goal**: User can chain every SDLC stage end-to-end (PRD -> Tickets -> Design -> Code -> Test -> Review -> Deploy -> Observe), replay any past stage from a stored snapshot, resume the session across a browser refresh, and step through stages manually.
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: UI-08
**Success Criteria** (what must be TRUE):

  1. User can run the full chain PRD -> Tickets -> Design -> Code -> Test -> Review -> Deploy -> Observe end-to-end
  2. User can replay any past stage from a snapshot stored in InsForge
  3. User's session persists across a browser refresh and the chat resumes where it left off
  4. User can manually step through stages one at a time

**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 5/5 | Complete    | 2026-08-19 |
| 2. Notion MCP Integration | 0/TBD | Not started | - |
| 3. Linear MCP Integration | 0/TBD | Not started | - |
| 4. v0 Design + Coding Sub-agent | 0/TBD | Not started | - |
| 5. Playwright Test + CodeRabbit/Snyk Review | 0/TBD | Not started | - |
| 6. Vercel Deploy | 0/TBD | Not started | - |
| 7. Sentry Observability | 0/TBD | Not started | - |
| 8. Stage Chaining + Replay | 0/TBD | Not started | - |

---

*Roadmap created: 2026-08-18*
*Mode: mvp | Granularity: standard | Coverage: 40/40*
*Phase 1 plan verified 2026-08-19: 5/5 PLANs executed, 0 blockers; gap-closure (01-E) closed 5 must-haves*
*Phase 1 plan D complete 2026-08-19: 7/7 tasks (UI shell + resilience + locked smoke script) landed.*
*Phase 1 plan E complete 2026-08-19: 3/3 surgical gap-closure tasks (install pin + custom stream route + echo audit wrap).*
