# Domain Pitfalls: AI Agent SDLC Orchestrator (MCP + Skills + RAG + HITL, Free-Tier)

**Project:** SDLC AI Agent Playground
**Researched:** 2026-08-18
**Mode:** Ecosystem pitfalls dimension
**Confidence:** MEDIUM-HIGH (drawn from documented Claude Agent SDK behavior, vendor-published rate limits, and well-known orchestrator failure modes; free-tier numbers verified against vendor docs as of 2025-2026 — re-check before each phase ships)

This file is opinionated. Each pitfall names: **what goes wrong, why, warning signs, prevention, phase to address it, and free-tier specifics.** No generic "write tests" filler.

---

## Critical Pitfalls (cause rewrites, silent breakage, or 3am pages)

### C1. MCP server connection silently dies mid-session; agent keeps calling dead tools

**What goes wrong:** MCP servers start on agent boot, but long-running sessions (multi-stage SDLC chains) outlive the stdio/SSE connection. Idle timeout (often 5-10 min on stdio transports), parent process restart, or transient network errors drop the socket. Subsequent tool calls return ECONNRESET or "tool not found" — the agent either hallucinates a response or stalls.

**Why it happens:** Claude Agent SDK manages MCP lifecycle per `query()` call, but the demo's chained stages reuse one agent across many tool invocations. Default reconnect behavior is opt-in, not automatic.

**Warning signs:**
- Tools that worked in stage 1 fail in stage 3 with no obvious error
- Logs show "transport closed" between stages
- Agent narrates tool results it couldn't have actually received

**Prevention:**
- Wrap every MCP tool invocation in a retry-with-reconnect helper (max 2 retries, exponential backoff)
- After any tool error, call `mcp__server__ping` (or a trivial read tool) before retrying the real call — confirms the transport is live
- Persist MCP server health in the agent state; on failure, restart the server subprocess and reissue
- Configure `--max-idle` to a value compatible with stage chaining (raise to 30+ min for this demo)

**Phase to address:** Phase 1 (Foundation — agent runtime + MCP lifecycle wrapper must ship before any tool integration)

**Free-tier gotcha:** MCP servers running on the same free-tier Vercel Hobby instance as the web UI share cold-start windows; a serverless restart kills the stdio socket. Either run MCP servers on a long-lived process (Fly.io free, Railway hobby, or local) or use SSE transport against an always-on endpoint.

---

### C2. OAuth/API token expiration silently breaks demo at the worst time

**What goes wrong:** Notion and Linear personal API tokens do not expire, but **OAuth-granted tokens do** (typically 60 min access + indefinite refresh). Demo starts fine; 90 minutes later the first Notion call returns 401; agent reports "permission denied" with no recovery path. Snyk, CodeRabbit, and Sentry API keys also silently rotate on some plans when the user revokes from the web UI.

**Why it happens:** No token-refresh middleware in the orchestrator. Tokens are loaded once at boot from env vars.

**Warning signs:**
- 401/403 errors that only appear after the session has been running >1 hour
- "Authentication required" prompts from the agent mid-chain
- Demo works perfectly when fresh-forked, breaks when re-run after lunch

**Prevention:**
- Centralize all tokens behind a `TokenProvider` interface that returns a fresh token per request (or per minute), not a static env var
- For OAuth: implement refresh-token rotation with a 5-min safety margin before expiry
- Bake token health into the boot flow: at agent startup, call each MCP server's cheapest read tool (`list_users` for Linear, `search` with empty query for Notion) and fail loudly if any return 401
- Surface token-expiry state to the web UI before a stage runs ("Notion token expires in 4 minutes, click to re-auth")

**Phase to address:** Phase 1 (TokenProvider) + every integration phase (each tool needs its own refresh/validation test)

**Free-tier gotcha:** Personal API tokens for Linear/Notion never expire and are free — prefer them over OAuth for this single-user demo. OAuth only where the tool forces it (Sentry, possibly SigNoz). Snyk free-tier API tokens are issued per-account and never auto-rotate, but the user can revoke from the web UI — log out events, not just 401s.

---

### C3. RAG index drifts from source-of-truth; agent cites stale PRD / old tickets

**What goes wrong:** The RAG layer over project context (PRD, tickets, code, review feedback) is embedded once and rarely re-indexed. By the third SDLC loop, the agent's "current PRD" answer references an earlier draft; the "active tickets" list omits issues created in stage 2.

**Why it happens:** RAG ingestion is treated as a one-time setup, not a transactional side-effect of every write. InsForge (or any vector store) is not in the write path of Notion/Linear/code commits, so it diverges by construction.

**Warning signs:**
- Agent's answers about "the current spec" contradict what the user just edited in Notion
- "I see 3 tickets in Linear but RAG knows about 7" mismatches
- Re-running a stage produces different RAG-augmented outputs than the first run

**Prevention:**
- Every MCP write tool (Notion page update, Linear issue create/update, git commit) must trigger a re-index of the affected chunk immediately, on the same request path, before the tool returns success
- Use a `project_id` + `last_indexed_at` watermark per source; on read, compare against source mtime — if stale, re-embed synchronously (free tier tolerates this for demo-scale volumes)
- Make the RAG index optional and visible: a `/debug/rag` endpoint that lists what's indexed, when, and for what project_id. If the user can't see staleness, they can't debug it
- Cap RAG recall to top-k=5 per query for this demo — anything more blows context window and amplifies staleness noise

**Phase to address:** Phase 1 (RAG scaffolding with hooks) + every stage that performs writes (re-index must be in the same commit)

**Free-tier gotcha:** InsForge free-tier vector storage has row-count and embedding-call limits. Re-indexing on every write will burn through free embedding quota fast if not debounced. Debounce by `source_id + mtime` — only re-embed when source actually changed. Document the exact free-tier limit and pin it in config; warn at 70%, hard-stop at 95%.

---

### C4. Human-in-the-loop approval dialog gets in the way of every read; users click 200 times per chain

**What goes wrong:** Approval is implemented as a single global toggle around every tool call. Either everything requires approval (death by a thousand "are you sure?" prompts — including `list_issues`, `get_page`, `git status`) or destructive ops are accidentally auto-approved. Users either disable HITL entirely (defeats purpose) or rage-quit.

**Why it happens:** Tool classification (read vs write vs destructive) is conflated. "Approval" is treated as a binary, not a per-tool category.

**Warning signs:**
- Approval prompts for `git log`, `get_me`, `list_tickets` — read-only ops that cannot harm state
- Users toggle auto-approve on after the third prompt because the demo is unusable
- No approval prompt for `delete_database` or `force_push` — true footguns

**Prevention:**
- Classify every tool at registration time: `read` (no prompt), `write_low_risk` (prompt, default allow), `write_high_risk` (prompt, require typed confirm — `delete_*`, `force_push`, deploy to prod, Snyk ignore-file edits). Persist the classification in the tool manifest, not in prompt code
- Batch approvals per stage: stage 2 might emit 6 Linear writes; collect them, show one diff ("6 tickets will be created, here are titles"), single approve
- Show what will change, not just the action name: "Deploy to `vercel.app/pr-abc123` (commit `f3a9b2`, branch `feat/login`)" — not "deploy?"
- Default = prompt for write_high_risk only. Read and write_low_risk fly through. This matches the user's mental model from the PROJECT.md ("Default = human approves destructive actions")
- Persist the last N approval decisions ("approve all Snyk scans for next 10 minutes") to avoid repeat clicks

**Phase to address:** Phase 1 (classification system + batched approval UI scaffold) — must exist before any stage ships with writes

**Free-tier gotcha:** None directly, but Vercel Hobby + free Sentry/SigNoz mean every "destructive" demo action consumes quota. The approval dialog is a natural throttle — make sure the dialog shows the quota cost ("this is your 7th Vercel deploy today; Hobby allows 100").

---

### C5. Sub-agent loses parent context; repeats questions, contradicts decisions

**What goes wrong:** Claude Agent SDK sub-agents (coding sub-agent, test sub-agent, review sub-agent) inherit only the system prompt and a slice of conversation — not the full accumulated state (PRD, prior decisions, ticket IDs). Each sub-agent re-derives context from RAG, which is both expensive and contradicts itself when RAG is stale (see C3).

**Why it happens:** Sub-agents are spawned via `Task` with a `prompt` parameter. Defaults assume small, self-contained tasks. Multi-stage SDLC orchestration is the opposite.

**Warning signs:**
- Coding sub-agent asks "what's the PRD?" when it was just summarized in the parent
- Code review sub-agent flags code that the test sub-agent already accepted
- Two sub-agents create tickets with the same title in Linear because they both derived from the same RAG chunk

**Prevention:**
- Pass a structured `handoff` object on sub-agent spawn: `{ stage, prd_summary, prior_decisions[], relevant_ticket_ids[], code_refs[], rag_query_results[] }` — not free-form prose
- Pin a single source of truth (the RAG `project_id` namespace) so all sub-agents read from the same indexed state
- Cap sub-agent depth at 2 (parent → worker). Recursion makes context control impossible and Claude Agent SDK doesn't expose per-level budgets
- After every sub-agent returns, the parent must verify the output (ticket IDs, commit SHAs) actually exist before advancing the chain

**Phase to address:** Phase 1 (handoff schema) + every stage that spawns a sub-agent

**Free-tier gotcha:** Sub-agent invocations multiply Anthropic API costs (the only paid cost in the demo). Every sub-agent spawn = another full conversation round-trip. Set a hard cap (e.g., 4 sub-agents per stage) in code, not just in the prompt — costs will surprise otherwise.

---

### C6. Tool schema drift between MCP server versions breaks the agent silently

**What goes wrong:** Notion MCP, Linear MCP, and community MCP servers ship breaking changes in minor versions. A `create_page` tool that took `parent_id` now requires `parent.type` + `parent.page_id`. The agent calls with the old shape; the server returns 400; the agent either retries with the same shape or hallucinates a success.

**Why it happens:** MCP servers don't have a stable version contract for tool schemas. `@notionhq/notion-mcp-server@1.x` and `2.x` have different `input_schema`s. The orchestrator pins nothing.

**Warning signs:**
- Identical demo flow works on Monday, fails on Wednesday after `npm update`
- Tool returns 400 with schema-validation error that the agent doesn't surface
- "Works on my machine" — different team members have different MCP versions

**Prevention:**
- Pin every MCP server version in `package.json` (exact, no `^`). Upgrade intentionally, in a dedicated PR per server
- On MCP server boot, call `list_tools` and assert the schema hash matches a known-good hash; mismatch = refuse to start the agent
- Add a `/debug/mcp` endpoint listing each server's version, transport, tool count, last health check

**Phase to address:** Phase 1 (version pinning) + every integration phase (schema hash assertion before the first call)

**Free-tier gotcha:** None directly, but a broken MCP server on free tier means you have no paid support channel — debugging is on you. The version pin + schema hash is your insurance policy.

---

## Moderate Pitfalls (cost time, cause rework, don't break demos alone)

### M1. Vercel Hobby preview deployments accumulate; free tier storage exhausted in days

**What goes wrong:** Each agent-driven deploy creates a new Vercel preview URL. Vercel Hobby allows ~100 deploys/day and a soft cap on concurrent preview deployments (the exact number has varied; recheck docs). The demo runs many stages, each potentially triggering a deploy; within a week the project is full of stale previews.

**Prevention:**
- After each demo run, prune previews older than 24 hours via Vercel API (`DELETE /v1/projects/{id}/deployments`)
- Default the deploy stage to `dry_run` mode (build + URL but no expose) unless the user opts in
- Show a deploy quota indicator in the UI: "7/100 deploys today; Hobby allows 100"

**Phase to address:** Deploy stage (Phase 6)

---

### M2. Playwright free-tier restrictions vary by repo visibility

**What goes wrong:** Playwright (the browser automation, not the test framework) has licensing terms that restrict commercial use of the hosted browser service. The demo runs against a public sandbox repo so it's fine — but the moment a user runs against a private repo or a hosted production URL, terms-of-service risk.

**Prevention:**
- Document the Playwright license in `PROJECT.md` Out of Scope section
- Run Playwright only against the sandbox Vercel preview URL, never against production or private hosts
- If the user wants Playwright against their own app, surface a TOS warning in the UI

**Phase to address:** Test stage (Phase 4)

---

### M3. CodeRabbit free tier requires public repos

**What goes wrong:** CodeRabbit's free / OSS plan reviews public GitHub repos only. A demo sandbox repo that's private won't get free CodeRabbit reviews; the user gets a 403 and the agent reports "review unavailable."

**Prevention:**
- Make the sandbox repo public by default (it contains no secrets — see M7)
- If privacy is required, document the paid plan requirement in PROJECT.md Out of Scope
- On CodeRabbit 403, fall back to a local lint pass and tell the user clearly

**Phase to address:** Review stage (Phase 5)

---

### M4. Snyk free tier caps: 200 tests/month per org as of 2025; easy to exhaust

**What goes wrong:** Every Snyk scan is a "test" against the quota. The demo runs many stages, each triggering a `snyk test` + `snyk code` scan. Free tier exhausts in <50 demo runs.

**Prevention:**
- Debounce Snyk scans: only scan if `package.json` / `package-lock.json` mtime changed since last scan
- Show Snyk quota in the UI before each scan
- Cache scan results per dependency hash; reuse for unchanged lockfiles
- On quota exhaustion, fall back to local-only `npm audit` and tell the user

**Phase to address:** Review stage (Phase 5)

---

### M5. Sentry free tier: 5K events/month, 7-day retention

**What goes wrong:** Every deployed preview app generates Sentry events for any uncaught error or warning. A buggy preview can burn 5K events in hours. The 7-day retention means demo data vanishes before the user revisits.

**Prevention:**
- Configure Sentry's `beforeSend` to drop events matching a known-noise pattern (404s for missing assets, etc.)
- Set `sampleRate: 0.1` on non-error transactions for demo traffic
- Display Sentry quota in the UI; warn at 70%, hard-cap demo at 80%

**Phase to address:** Observability stage (Phase 7)

---

### M6. SigNoz OSS requires self-hosted infra — not "free" in the no-effort sense

**What goes wrong:** SigNoz's free tier is the OSS self-hosted version, which requires a Docker Compose deployment (or similar). Free-tier SaaS tiers of competing tools (Honeycomb, Datadog) are limited or gone. The demo budget is $0 and the user is one person — running a SigNoz cluster is real ops work.

**Prevention:**
- Document the SigNoz self-host requirement up front in PROJECT.md; estimate ~30 min to deploy
- Offer an "observability stub" fallback: if SigNoz is unreachable, the agent reports trace data via console logs only
- Don't gate the demo on SigNoz being live — observability is the last stage, not the foundation

**Phase to address:** Observability stage (Phase 7)

---

### M7. Secrets end up in the public sandbox repo, in commit messages, or in RAG embeddings

**What goes wrong:** The agent writes `.env` files, commits `service_role` keys, or pushes a Linear ticket title containing an API key. Worse: the agent's chat transcript (which becomes RAG context) accidentally contains a token from a tool response. Tokens leak via git history, public repo visibility, or vector store rows.

**Prevention:**
- Pre-commit hook that scrubs `.env*`, blocks keys matching `(sk|pk|api|key|token|secret)[-_]?[A-Za-z0-9]{20,}` patterns
- RAG ingestion pipeline that redacts known-secret patterns before embedding AND that scrubs re-retrieved chunks before they're surfaced back to the UI
- Sandbox repo is public (per M3), so treat every byte that lands in it as world-readable
- Anthropic API key + every integration token loaded server-side from env vars only — never client-side, never committed, never logged

**Phase to address:** Phase 1 (secret-scrubbing pre-commit hook) + Phase 7 (RAG redaction)

**Free-tier gotcha:** Free-tier services often have weaker audit logs. There's no "show me where this token was used" trail on Notion/Linear free tiers. Assume leaks are irreversible once made.

---

### M8. Agent over-uses tools, blows context window mid-chain

**What goes wrong:** The SDLC chain involves 6+ MCP integrations, each with verbose tool descriptions and large result sets (a Linear `list_issues` call returning 200 issues dumps them all into context). By stage 4 the conversation history has consumed 80%+ of context, and the agent starts forgetting earlier decisions, repeating steps, or refusing to continue.

**Prevention:**
- Configure every `list_*` MCP tool to return summaries (id + title only) by default; require explicit `?include=description,comments` opt-in
- Set hard caps in the agent prompt: "after 15 tool calls in this stage, summarize and stop; ask the user to continue"
- Use Claude Agent SDK's session resume + compaction pattern: every N stages, summarize prior context into a checkpoint and start a fresh sub-conversation
- Display context-window usage in the UI as a progress bar — if the user sees it filling, they can intervene before breakage

**Phase to address:** Phase 1 (cap configuration) + every integration phase (per-tool response shaping)

**Free-tier gotcha:** None directly, but context-window exhaustion correlates with high Anthropic API spend (more tokens per turn = more cost). This pitfall is the cost-control lever.

---

### M9. Skill descriptions are too vague; agent picks the wrong skill or none

**What goes wrong:** Skills (Claude Agent SDK's `Skill` mechanism — slash commands / named capability bundles) get registered with descriptions like "Helps with deployment." The agent at stage-picker time can't tell "Deploy via Vercel" from "Deploy via Docker" or "Run a build locally" and either picks arbitrarily or skips the skill entirely.

**Prevention:**
- Each Skill's `description` field must be specific, action-oriented, and include the trigger phrase users would say: "Deploy the current branch to Vercel preview — use when user says 'deploy', 'preview deploy', 'push to vercel', or chains the Deploy stage"
- Test each Skill by phrasing the trigger 5 different ways and asserting the agent picks it
- Keep Skill count ≤10 for this demo; beyond that, the agent's tool-selection accuracy drops

**Phase to address:** Phase 1 (Skill registry) + every stage that wraps a Skill

---

### M10. Stage chaining has no idempotency; re-running creates duplicate tickets / deploys

**What goes wrong:** The user runs the chained end-to-end pipeline, hits a timeout or error at stage 5, and retries. Now stages 1-4 re-run, creating duplicate Linear tickets, duplicate Notion pages, and a second Vercel deploy of the same commit.

**Prevention:**
- Every write tool in the chain must be idempotent or must check for prior state: "create Linear ticket for PRD section X" first searches for an existing ticket with the same `external_id` (the PRD section hash)
- The chain orchestrator persists a per-session run ledger: `{ stage, tool_calls[], outputs[], dedupe_keys[] }`. On retry, skip stages whose `dedupe_key` matches a successful prior run
- Surface "this stage already ran successfully at HH:MM; skip?" in the UI on retry

**Phase to address:** Phase 8 (Stage chaining) — the integration phase that ties stages together

---

## Minor Pitfalls (irritants, not blockers)

### m1. InsForge free-tier row-count limits bite silently at the RAG table

**What goes wrong:** InsForge free tier (or Supabase fallback) has row-count or storage limits. RAG chunks accumulate faster than expected because each write re-embeds.

**Prevention:** Monitor row count, alert at 70%. Configure RAG to use one row per `source_id` (upsert on re-embed) rather than append-only.

**Phase:** Phase 1 (RAG scaffold)

---

### m2. v0 free-tier generation limits are low

**What goes wrong:** v0's free tier allows a small number of UI generations per month. Multiple design iterations in the design stage exhaust the quota.

**Prevention:** Cache v0 outputs by `(prd_hash, design_intent)` so repeated requests don't burn quota. Show quota in the UI.

**Phase:** Design stage (between Phase 2 and Phase 3)

---

### m3. Anthropic API rate limits (free credits, tier-based RPM)

**What goes wrong:** New Anthropic API keys start on a low RPM tier. Multi-stage SDLC chains with sub-agents can hit 429 rate limits within minutes.

**Prevention:** Backoff with jitter on 429; surface remaining quota in the UI; cap parallel sub-agent spawns at 2 for the demo.

**Phase:** Phase 1 (Anthropic client config)

---

### m4. Time-zone mismatch between Vercel deploy timestamps and agent clock

**What goes wrong:** Vercel timestamps in UTC; agent logs in local time; user is confused about whether the deploy happened "now."

**Prevention:** All agent-side timestamps in UTC + ISO 8601; UI formats per user locale only at the edge.

**Phase:** Phase 1 (logging convention)

---

### m5. Linear `team_id` vs Notion `database_id` confusion across stages

**What goes wrong:** The agent passes a Linear `team_id` to a Notion tool by mistake, or vice versa. Errors are confusing because the IDs look similar.

**Prevention:** Strongly typed handoff objects (see C5); each ID prefixed in logs: `linear:team:abc`, `notion:db:xyz`.

**Phase:** Phase 1 (handoff schema) + every integration phase

---

### m6. Browser refresh during a long chain loses session

**What goes wrong:** The PROJECT.md says "Persistent long-running sessions across browsers — per-tab sessions only" — explicitly out of scope. But users refresh the browser mid-chain. The chain dies; partial work is lost.

**Prevention:** Persist run state to InsForge on every stage completion; on page load, offer "Resume incomplete chain from stage 4?" if a partial run exists in the last 24h.

**Phase:** Phase 8 (session resume)

---

## Phase-Specific Warning Matrix

| Phase topic | Likely pitfall | Mitigation in plan |
|-------------|----------------|--------------------|
| Phase 1 Foundation | C1, C2, C3, C4, C5, C6, M8, M9 | Plan must include: TokenProvider, MCP lifecycle wrapper, version pinning, RAG scaffolding with write-time re-index, tool classification, sub-agent handoff schema, context-window caps |
| Phase 2 Notion MCP | C2 (token), C3 (RAG), C6 (schema), M7 (secrets in PRD pages) | Per-tool rate-limit guard; re-index on every page write; pre-commit scrub |
| Phase 3 Linear MCP | C2 (token), C3 (RAG), C6 (schema), M10 (idempotency) | Dedupe tickets by PRD section hash; 1500 req/hr guard |
| Phase 4 v0 + Coding sub-agent | C5 (sub-agent), M2 (Playwright TOS), m2 (v0 quota) | Handoff schema; v0 cache; sandbox repo public by default |
| Phase 5 Playwright tests | M2 (Playwright TOS), M4 (Snyk quota) | Sandbox-only E2E; Snyk debounce by lockfile mtime |
| Phase 6 CodeRabbit + Snyk review | M3 (CodeRabbit public-repo), M4 (Snyk quota) | Public repo; local lint fallback on quota; pre-commit hook |
| Phase 7 Vercel deploy | M1 (Hobby quota), M7 (secrets in deploy env) | Preview prune job; deploy quota UI; env-var scrub |
| Phase 8 Sentry + SigNoz observability | M5 (Sentry events), M6 (SigNoz self-host) | `beforeSend` filter; sample rate 0.1; observability stub fallback |
| Phase 9 Stage chaining | M10 (idempotency), m6 (browser refresh) | Run ledger; session resume; per-stage dedupe keys |
| Every phase | m3 (Anthropic rate limits) | Backoff + jitter; parallel cap = 2 sub-agents |

---

## Free-Tier Cheat Sheet (numbers recheck before each phase ships)

| Service | Free-tier limit that bites | Source-of-truth to recheck |
|---------|---------------------------|----------------------------|
| Notion API | 3 req/sec average; per-token | Notion API reference |
| Linear API | 1500 req/hr per user (auth), 2500/hr API key | Linear API docs |
| Vercel Hobby | ~100 deploys/day, concurrent preview cap varies, no commercial | Vercel docs |
| Snyk free | ~200 tests/month per org (varies by plan year) | Snyk pricing page |
| Sentry free | 5K events/month, 7-day retention | Sentry pricing page |
| SigNoz | OSS = self-host; SaaS free tier if any | SigNoz docs |
| v0 | Limited generations/month | v0 pricing page |
| CodeRabbit | Public repos only on free tier | CodeRabbit pricing |
| Playwright | TOS restricts commercial hosted use | Playwright license |
| InsForge | Storage + embedding-call caps (specifics TBD per plan) | InsForge dashboard |
| Anthropic API | Tier-based RPM/TPM; the only paid cost | Anthropic console |

---

## Out of Scope Pitfalls (worth knowing, not addressing)

- **MCP server supply-chain attacks:** real concern for production, not this single-user demo. Note in security review, don't build defenses.
- **Multi-tenant isolation:** PROJECT.md says single-user, so no cross-user RAG leakage to defend against.
- **SSO/SAML rotation:** explicitly out of scope per PROJECT.md.
- **Mobile UX for approval:** desktop-browser only per PROJECT.md, so touch-friendly dialogs not needed.

---

## Confidence Note

Numbers and behaviors marked "recheck before ship" are accurate as of early 2026 against vendor documentation but free-tier terms change quarterly. Each phase plan must include a "verify free-tier limits still apply" step before relying on the values in this file. Behavior-based pitfalls (C1-C6, M7-M10) are MEDIUM-HIGH confidence based on observed Claude Agent SDK and MCP server failure modes — these patterns are stable; the specific error messages and APIs evolve.
