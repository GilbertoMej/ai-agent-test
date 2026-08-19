---
phase: 1
plan: D
type: execute
wave: 2
depends_on: ["01-A"]
files_modified:
  - app/components/HealthBanner.tsx
  - app/components/StatusBadge.tsx
  - worker/src/lib/health.ts
  - app/api/health/route.ts
  - app/components/CostCounter.tsx
  - app/components/ChatPanel.tsx
  - lib/pricing.ts
  - app/components/StagePicker.tsx
  - app/api/stage/route.ts
  - worker/src/lib/stage-config.ts
  - app/page.tsx
  - app/components/ActionFeed.tsx
  - app/components/ActionFeedEntry.tsx
  - app/lib/pause-signal.ts
  - app/api/pause/route.ts
  - worker/src/api-routes/pause.ts
  - worker/src/api-routes/resume.ts
  - package.json
  - scripts/test-restart.sh
  - scripts/smoke.sh
  - README.md
  - .env.example
autonomous: true
must_haves:
  - "Health banner polls /api/health every 30s and reads lifecycle probe state from 01-02b"
  - "Token cost increments in header from step-finish.totalUsage; pricing matches lib/pricing.ts"
  - "Foundation stage is selectable; other 8 stages greyed with tooltip 'Available in Phase X'"
  - "POST /api/stage {stage:'foundation'} returns 200 {ok:true, instructionsLoaded:true}; other stages return 200 with friendly 'stage not yet active in Phase 1' payload"
  - "Action feed renders tool-call, tool-result, tool-error, tool-call-approval bubbles"
  - "Transient tool failures retry 3 times with 1s/2s/4s backoff before surface error toast"
  - "Permanent tool failures surface toast immediately (no retry)"
  - "Browser tab close pauses the agent loop; SSE reconnect re-emits the same tool-call-approval chunk with the same toolCallId"
  - "tsx watch auto-restarts the worker within 2s; PostgresStore retains session and snapshot"
  - "pnpm smoke exits 0 against a fresh boot"
---

# 01-D — UI + Resilience

UI shell (health banner from the 01-02b probe, cost HUD, stage picker with Foundation enabled, action feed with retry), session resume on tab reconnect, worker restart smoke, and the locked smoke script.

## Tasks

<task>
  <id>01-07-health-banner</id>
  <action>Build the HealthBanner component (stubbed in 01-01b) to poll /api/health every 30s, perform an immediate probe on page load, and render the four MCP servers (notion, linear, playwright, sentry) with traffic-light colors (not_loaded=grey, connected=green, failed=red). Implements (D-06 per-stage lazy MCP loading — banner shows "Notion: not loaded" until stage pick; D-22 WORKER_SHARED_SECRET bearer auth on /api/health). The status values come from 01-02b's worker/src/mcp/health-probe.ts — not env-var presence. Extend worker/src/lib/health.ts to include tokens.{openrouter_key_present, insforge_key_present, database_url_present} and uptime_s. The app/api/health/route.ts proxies the worker response.</action>
  <files>app/components/HealthBanner.tsx, app/components/StatusBadge.tsx, worker/src/lib/health.ts, app/api/health/route.ts</files>
  <verify>
    <automated>pnpm dev & sleep 5 && curl -fsS -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:4111/api/health | jq -e '.mcp.notion == "not_loaded" and .mcp.linear == "not_loaded" and .mcp.playwright == "not_loaded" and .mcp.sentry == "not_loaded"' && curl -fsS http://localhost:3000/api/health | jq -e '.worker_up == true'</automated>
  </verify>
  <done>Banner reads lifecycle probe state, not env vars; 30s polling; immediate probe on page load; workers-stopped flips banner red within 30s.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-07</implements>
  <commit>feat(health): 30s polling banner with probe-status MCP colors</commit>
</task>

<task>
  <id>01-08-cost-hud</id>
  <action>Build the CostCounter component in the header that subscribes to step-finish chunks from the chat stream, accumulates inputTokens/outputTokens per session, and multiplies by the pricing table from lib/pricing.ts (Nemotron $0/MTok, DeepSeek V4 Flash $0.077/$0.153 per 1M tok). Display as ~ $0.000 in Phase 1.</action>
  <files>app/components/CostCounter.tsx, app/components/ChatPanel.tsx, lib/pricing.ts</files>
  <verify>
    <automated>grep -R 'deepseek-v4-flash' lib/pricing.ts && pnpm tsc --noEmit && pnpm dev & sleep 5 && curl -fsS http://localhost:3000/api/smoke/echo | jq -e '.text == "echo:hello"' && curl -fsS http://localhost:3000/api/cost/hud | awk -v n=$(psql $DATABASE_URL -tAc "SELECT sum(tokens_in::bigint) FROM audit_log WHERE tool_name='echo'") '{exit !(n+0>0)}' </automated>
  </verify>
  <done>Header counter increments on every step-finish; pricing table matches lib/pricing.ts.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-06</implements>
  <commit>feat(cost): running token-cost HUD in header with model pricing table</commit>
</task>

<task>
  <id>01-09-stage-picker</id>
  <action>Build the StagePicker left sidebar. Per UI-02 + D-15 + the new Foundation add: the sidebar lists 9 entries — 'Foundation' (enabled) + 8 SDLC stages (PRD, Tickets, Design, Code, Test, Review, Deploy, Observe), where the 8 SDLC stages render greyed with tooltip 'Available in Phase X'. Picking 'Foundation' loads a generic chat-only agent prompt with no MCP. Picking any other stage shows the disabled state. /api/stage/route.ts accepts stage: 'foundation' and routes to the current Mastra agent with stage-specific instructions; other stage values return 200 with a friendly 'stage not yet active in Phase 1' payload that the UI reflects as a toast. Current stage highlight reads from RequestContext (D-14).</action>
  <files>app/components/StagePicker.tsx, app/api/stage/route.ts, worker/src/lib/stage-config.ts, app/page.tsx</files>
  <verify>
    <automated>grep -R 'Available in Phase' app/components/StagePicker.tsx && curl -fsS -X POST http://localhost:3000/api/stage -H 'Content-Type: application/json' -d '{"stage":"foundation"}' | jq -e '.ok == true and .instructionsLoaded == true' && curl -fsS -X POST http://localhost:3000/api/stage -H 'Content-Type: application/json' -d '{"stage":"prd"}' | jq -e '.availableInPhase' && pnpm tsc --noEmit</automated>
  </verify>
  <done>Foundation selectable; 8 SDLC stages greyed with tooltip; /api/stage accepts foundation and rejects others with friendly payload.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-02</implements>
  <commit>feat(stage): left sidebar with Foundation enabled + 8 greyed SDLC stages</commit>
</task>

<task>
  <id>01-10-action-feed</id>
  <action>Build the ActionFeed component that renders inline bubbles for tool-call, tool-result, tool-error, and tool-call-approval chunks per D-16/D-17. Each entry shows tool name, truncated args (expandable), status icon, duration (ms), result snippet (expandable). Errors render in red with a friendly toast (UI-05). Add an explicit bounded-retry policy: TransientAgentError (network/5xx/timeout) retries 3 times with 1s/2s/4s backoff; permanent errors skip retry and surface the toast immediately. Errors fired mid-retry show a single unified toast on the final failure, not three spinners.</action>
  <files>app/components/ActionFeed.tsx, app/components/ActionFeedEntry.tsx, app/components/ChatPanel.tsx</files>
  <verify>
    <automated>grep -R 'TransientAgentError' app/components/ChatPanel.tsx && grep -R 'tool-call-approval' app/components/ChatPanel.tsx && pnpm tsc --noEmit && pnpm dev & sleep 5 && curl -fsS -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hello"}],"threadId":"feed"}' | grep -q 'echo:hello'</automated>
  </verify>
  <done>Action feed renders tool-call/result/error/approval inline; transient errors retry 3 times with backoff; permanent errors surface toast immediately.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-03, UI-05</implements>
  <commit>feat(feed): inline action feed + 3-attempt transient retry (UI-05)</commit>
</task>

<task>
  <id>01-13-tab-reconnect-pause</id>
  <action>Wire the browser's beforeunload event to send a pause signal to the worker over a lightweight POST endpoint; the worker pauses the agent loop on the active threadId. On reconnect, the Next.js SSE relay re-establishes the stream and the worker resumes via listSuspendedRuns (D-07). Store the session id in localStorage under sdlc.playground.session.v1 (UI-04). After resume, the worker MUST re-emit the tool-call-approval chunk on the resumed stream with the same toolCallId as the pre-disconnect card (verified by inspecting the SSE byte stream over curl -N).</action>
  <files>app/lib/pause-signal.ts, app/api/pause/route.ts, worker/src/api-routes/pause.ts, worker/src/api-routes/resume.ts, app/components/ChatPanel.tsx</files>
  <verify>
    <automated>grep -R 'sdlc.playground.session.v1' app/components/ChatPanel.tsx && pnpm dev & sleep 5 && curl -fsS -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"create a note"}],"threadId":"reconnect"}' -N | grep -q 'tool-call-approval' && psql $DATABASE_URL -tAc "SELECT count(*) FROM mastra_snapshots WHERE created_at > now() - interval '1 minute'" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>Tab close pauses; SSE reconnect re-emits the same tool-call-approval chunk with the same toolCallId; resumed run completes when the user approves.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-04, D-07</implements>
  <commit>feat(session): pause-on-disconnect + SSE resume re-emits approval chunk</commit>
</task>

<task>
  <id>01-14-worker-watch-restart</id>
  <action>Confirm the tsx watch worker/src/index.ts script in package.json's dev script auto-restarts on file change. Verify that an in-progress chat session resumes after a manual kill -SIGTERM of the worker: PostgresStore retains the snapshot, the next SSE call lists the suspended run and resumes per listSuspendedRuns.</action>
  <files>package.json, scripts/test-restart.sh</files>
  <verify>
    <automated>bash scripts/test-restart.sh && grep -R 'tsx watch' package.json && psql $DATABASE_URL -tAc "SELECT count(*) FROM mastra_snapshots WHERE created_at > now() - interval '5 minutes'" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>Worker restarts within 2s of file change; session resumes after SIGTERM; snapshot table records the snapshot.</done>
  <reversibility>reversible</reversibility>
  <implements>D-08, RT-02</implements>
  <commit>chore(dev): tsx watch restart confirmed with session resume</commit>
</task>

<task>
  <id>01-15-smoke-script</id>
  <action>Extend scripts/smoke.sh (stubbed in 01-01a, extended in 01-01b) to assert the full Phase 1 Definition of Skeleton Done plus the post-01-02..01-14 surfaces: PostgresStore session resume, MCP lifecycle reconnect, auto-approve toggle honored, rag_query tool callable, health banner states correct, token counter increments, write_high card renders DESTRUCTIVE badge. Lock the script so it exits non-zero on any failed assertion.</action>
  <files>scripts/smoke.sh, scripts/smoke-stopped-worker.sh, package.json</files>
  <verify>
    <automated>pnpm smoke && grep -c 'exit 1' scripts/smoke.sh | grep -qE '^[0-9]+$' && bash scripts/smoke-stopped-worker.sh 2>&1 | grep -qE '^(.+: )?non-zero exit'</automated>
  </verify>
  <done>pnpm smoke exits 0; the script asserts every Definition-of-Skeleton-Done bullet; the script is non-zero on any failure.</done>
  <reversibility>reversible</reversibility>
  <implements>Skeleton lock-in</implements>
  <commit>test(smoke): full Phase 1 definition-of-done smoke script</commit>
</task>

## Cross-references

- Mastra runtime + canonical audit_log schema: see 01-A-tracer.md §01-01b / §Canonical schema.
- Audit hardening (redact + token patch): see 01-B-persistence-and-rag.md §01-05.
- Tool classification for approved/rejected entries: see 01-C-hitl.md §01-03 / §01-04a / §01-04b.
- Smoke endpoint that 01-08 + 01-15 depend on: see 01-A-tracer.md §01-01b (GET /api/smoke/echo).
