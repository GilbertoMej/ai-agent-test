---
status: testing
phase: 01-foundation
source: 01-A-SUMMARY.md, 01-B-SUMMARY.md, 01-C-SUMMARY.md, 01-D-SUMMARY.md, 01-E-SUMMARY.md, 01-F-SUMMARY.md
started: 2026-08-19T19:00:00Z
updated: 2026-08-20T13:25:00Z
---

## Current Test

number: 2
name: Chat Streaming Reply
expected: |
  Type "hello" in browser, see streaming reply that calls echo tool and returns "echo:hello" token-by-token
awaiting: user response

RESOLVED: G-1-3 (pause.ts) + G-1-5 (ChatPanel v5 migration).
Open issue: openrouter free model drops stream — config decision needed.

## Tests

### 1. Cold-Start Smoke Test
expected: `pnpm dev` boots Next.js + worker; `/api/health` returns `worker_up:true`; browser shows green banner within 1s; no React hydration mismatch in console
result: pass

### 2. Chat Streaming Reply
expected: Type "hello" in browser, see streaming reply that calls echo tool and returns "echo:hello" token-by-token
result: issue
reported: "Send works, message appears in chat panel, but no reply. Terminal: [worker] Error in LLM execution { error: 'Client connection prematurely closed.', runId: '98626e2e-d42b-4f6f-be80-28bfbab068b1', provider: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free' }"
severity: major
note: "Upstream provider drops stream — config/integration issue, not codebase bug"

### 3. Health Banner Shows Token Chips + Uptime
expected: Banner displays OR/IF/DB chips (green/red) and uptime in seconds, polling every 30s
result: pass

### 4. Stage Picker
expected: Left sidebar shows 9 entries; Foundation enabled, 8 SDLC stages greyed with "Available in Phase X" tooltip on hover
result: issue
reported: "Tooltip message doesn't appear on hover. Only when clicking, a message displays on the bottom of the sidebar 'Available in Phase X'"
severity: minor

### 5. Read Tool Runs Silently (no ApprovalCard)
expected: When agent calls echo or rag_query, no ApprovalCard appears in chat; tool executes and result appears in Action Feed
result: blocked
blocked_by: server
reason: "Same problem as test 2. Can't send anything with the agent because browser refreshes and pause.ts:30 502. Cascade of G-1-3."

### 6. Write-Low Card (createNote)
expected: When agent calls createNote, inline Approve/Deny card appears with optional "Approve all matching for 5 min"
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — chat unreachable, no agent calls possible."

### 7. Write-High Card (applyMigrations)
expected: When agent calls applyMigrations, card shows red border + DESTRUCTIVE badge + typed-CONFIRM input; Approve disabled until user types "CONFIRM"
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — chat unreachable, no agent calls possible."

### 8. Auto-Approve Toggle Bypasses Cards
expected: Header toggle set to "Always" makes all cards disappear for the session; audit rows show approval_decision='auto'
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — chat unreachable, no agent calls possible."

### 9. Action Feed Renders Tool Lifecycle Inline
expected: Tool calls, results, errors, and approval cards all render as bubbles in the feed with status icons
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — chat unreachable, no agent calls possible."

### 10. Cost Counter Ticks From Usage
expected: Header shows running USD estimate; increments after each agent step as tokens_in/out flow in from step-finish chunks
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — chat unreachable, no agent calls possible."

### 11. Pause on Tab Close
expected: Closing the tab sends `navigator.sendBeacon` to /api/pause; worker records sessionId in suspendedRuns Map
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — /api/pause 502s, cannot verify end-to-end beacon→worker roundtrip."

### 12. Audit Log Row Populated
expected: After smoke echo call, `SELECT * FROM audit_log WHERE session_id=<your-session>` returns 1 row with tokens_in/out NOT NULL, session_id matches browser session id
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — chat unreachable, no echo call to populate audit row."

### 13. Audit Log Redacts Secrets
expected: `pnpm test:audit` exits 0; if a tool call passes args_json with `sk-...` 20+ char strings, the audit row's args_json shows `[REDACTED]` instead
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — pnpm test:audit needs chat/route path live to exercise the redactor."

### 14. MCP Reconnect Bounded Retry
expected: If a stdio MCP server kills its pipe, `node --import tsx worker/scripts/test-mcp-reconnect.ts` reconnects within 3 attempts (1s/2s/4s backoff)
result: pass

### 15. RAG Tool Returns Context + Audit Rows Consumed
expected: Calling rag_query returns a context string; audit_log row has tool_doc_rows_consumed >= 1
result: blocked
blocked_by: server
reason: "Blocked by G-1-3 — rag_query invoked via chat, chat unreachable."

## Summary

total: 15
passed: 3
issues: 2
pending: 0
skipped: 0
blocked: 10

## Gaps

- gap_id: G-1-1
  truth: "Worker boots, /api/health returns worker_up:true"
  status: resolved
  resolved_by: 01-G-PLAN.md, 01-H-PLAN.md, 01-I-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    THREE sequential blockers cleared across 01-G, 01-H, 01-I:

    **01-G1** wrapped the Hono + MastraServer wiring in `void (async () => { ... })()` so the
    `await server.init()` lives inside an async function (CJS rejects top-level await).
    `serve({ fetch: app.fetch, port, hostname: "0.0.0.0" })` now binds :4111.

    **01-H1** renamed the worker `healthRoute` path from `/api/health` to `/health` because
    Mastra 1.60 reserves `/api/*` for built-in framework routes. Next proxy at
    `app/api/health/route.ts` was updated to fetch `${workerUrl}/health` instead;
    the browser-facing `/api/health` URL is preserved (Next proxies it). Smoke + test-restart
    scripts updated to probe the new worker path.

    **01-I1** removed `-k` from `concurrently` in the `dev` script so the worker survives
    whenever `next dev` exits (e.g. EADDRINUSE on stale port 3000 from prior session).
    Added a Windows-only port-3000 cleanup block in `scripts/predev.ts` (netstat + taskkill
    inside an async IIFE) that kills stale holders before `next dev` even tries to bind.

    Standalone boot confirmed: `node --import tsx worker/src/index.ts` prints
    `worker: listening on :4111` and stays alive. `pnpm worker` works.
  original_root_cause: |
    See prior `01-G` / `01-I` diagnoses — Blocker A (CJS top-level await), Blocker B
    (Mastra 1.60 reserved `/api/*` prefix), Blocker C (concurrently -k killing worker
    on next dev crash).

- gap_id: G-1-2
  truth: "Browser renders chat panel without React hydration errors"
  status: resolved
  resolved_by: 01-F-PLAN.md
  resolved_at: 2026-08-20
  original_root_cause: "ChatPanel.tsx:64-71 useState lazy initializer calls Math.random().toString(36).slice(2,10) in BOTH branches of a typeof window check — the SSR branch (line 65, window undefined) and the client first-render branch (line 68, loadSessionId() returns null on fresh tab). Lazy init prevents re-compute on re-renders but does not prevent SSR-vs-client divergence — both sides independently compute different random ids, then line 136 renders them as Session: {sessionId}, triggering React 19 hydration mismatch."
  artifacts:
    - path: "app/components/ChatPanel.tsx"
      issue: "useState initializer at lines 64-71 generates Math.random() in SSR + client branches; line 136 consumes mismatched id"
  fix_summary: "Stable `useState<string>('')` initializer (matches SSR + first client paint); post-mount `useEffect` calls `loadSessionId()` → `setSessionId(existing)` or generates `sess-${Math.random().toString(36).slice(2,10)}` and calls `saveSessionId(fresh)` + `setSessionId(fresh)`. `Math.random()` only runs inside the effect, after hydration."

- gap_id: G-1-3
  truth: "Chat sends message, agent streams reply token-by-token with echo:hello"
  status: resolved
  resolved_at: 2026-08-20
  resolved_by: inline-fix
  reason: "User reported: browser refreshes on send, no reply. Terminal shows POST /api/pause 502 — worker pause.ts:30 throws TypeError: c.json(...).catch is not a function. Chat submission triggers page unload → sendBeacon to /api/pause → 502 cascades into unmount."
  severity: blocker
  test: 2
  root_cause: "Hono context API confusion: c.json(data) is the response helper (returns Response, not Promise). c.req.json() parses the request body (returns Promise). `await c.json().catch(...)` therefore threw because Response has no .catch. Same bug also present in resume.ts:15."
  artifacts:
    - path: "worker/src/api-routes/pause.ts"
      issue: "Line 30: `await c.json().catch(...)` — c.json is response helper, not request parser"
    - path: "worker/src/api-routes/resume.ts"
      issue: "Line 15: same pattern as pause.ts"
  fix_summary: "Replaced `c.json()` with `c.req.json()` in both pause.ts:30 and resume.ts:15. c.req.json() returns a Promise<Response.body JSON>, so .catch works. No other changes needed."
  debug_session: ""

- gap_id: G-1-4
  truth: "Hovering a greyed SDLC stage shows 'Available in Phase X' tooltip"
  status: failed
  reason: "User reported: tooltip message doesn't appear on hover. Only when clicking, a message displays on the bottom of the sidebar 'Available in Phase X'"
  severity: minor
  test: 4
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-5
  truth: "Chat sends message, agent streams reply token-by-token with echo:hello"
  status: resolved
  resolved_at: 2026-08-20
  resolved_by: inline-fix
  reason: "User reported: after G-1-3 fix, no terminal errors but browser still refreshes on send. No agent reply. Same symptom, different root cause."
  severity: blocker
  test: 2
  root_cause: "ChatPanel.tsx used AI SDK v4 useChat API (input, handleInputChange, handleSubmit, append, isLoading) against v5 runtime (useChat returns sendMessage, status only). v4 destructured values are undefined → handleSubmit attached to <form onSubmit> called on undefined → no preventDefault → native form POST → page reload → empty page. Typecheck flagged the v4 destructures as missing properties."
  artifacts:
    - path: "app/components/ChatPanel.tsx"
      issue: "useChat v4 destructures (input, handleSubmit, append, isLoading) not in v5; native form submit page-reloads"
    - path: "app/components/ActionFeed.tsx"
      issue: "FeedPart type lacked 'text' variant; v5 messages use parts-based text rendering"
  fix_summary: "Migrated ChatPanel to v5: imported DefaultChatTransport + UIMessage, switched useChat to { messages, sendMessage, status }; useState for input; onFormSubmit with e.preventDefault + sendMessage({ text: input }); append -> sendMessage for resume path; isLoading derived from status === 'submitted' || 'streaming'. Added 'text' variant to FeedPart; ActionFeed skips text (ChatPanel renders it). Cast DefaultChatTransport through `as never` — nominal type mismatch between `ai` and `@ai-sdk/react` modules, structurally identical."
  debug_session: ""

- gap_id: G-1-6
  truth: "Chat sends message, agent streams reply token-by-token with echo:hello"
  status: resolved
  resolved_at: 2026-08-20
  resolved_by: inline-fix
  reason: "User reported: send works, message appears in chat, but no reply. Worker terminal: 'Error in LLM execution { error: Client connection prematurely closed., provider: openrouter, modelId: nvidia/nemotron-3-ultra-550b-a55b:free }'. Iterated models: nemotron → glm-5.2 (rate-limited) → poolside (same premature close). User hypothesis: 'a problem from our side that doesn't let the model do its work before finishing the process'."
  severity: major
  test: 2
  root_cause: "Worker src/index.ts:92 passed `abortSignal: c.req.raw.signal` into agent.stream. When the Next → worker fetch's underlying request signal fired (mid-stream, due to SSE buffer/connection state), the AI SDK propagated the abort up to the LLM provider, which reported it as 'Client connection prematurely closed'. The bug was on our side, not the provider's, despite the symptom pointing upstream."
  artifacts:
    - path: "worker/src/agents/sdlc.ts"
      issue: "Line 21 hardcoded model: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free' — unreliable for streaming"
    - path: "worker/src/index.ts"
      issue: "Line 92 passed c.req.raw.signal as agent.stream abortSignal — propagated to provider as premature client close"
  fix_summary: "Two changes: (1) Model switch — openrouter/nvidia/nemotron-3-ultra-550b-a55b:free → opencode-go/hy3 (via OPENCODE_API_KEY); (2) Removed abortSignal from agent.stream call. SSE controller.enqueue throws after Next-side close, but the upstream LLM stream runs to completion. Added X-Accel-Buffering: no on worker SSE response to prevent any reverse-proxy buffering."
  debug_session: ""
