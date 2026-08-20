---
status: complete
phase: 01-foundation
source: 01-A-SUMMARY.md, 01-B-SUMMARY.md, 01-C-SUMMARY.md, 01-D-SUMMARY.md, 01-E-SUMMARY.md, 01-F-SUMMARY.md
started: 2026-08-19T19:00:00Z
updated: 2026-08-20T17:44:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold-Start Smoke Test
expected: `pnpm dev` boots Next.js + worker; `/api/health` returns `worker_up:true`; browser shows green banner within 1s; no React hydration mismatch in console
result: pass

### 2. Chat Streaming Reply
expected: Type "hello" in browser, see streaming reply that calls echo tool and returns "echo:hello" token-by-token
result: pass

### 3. Health Banner Shows Token Chips + Uptime
expected: Banner displays OR/IF/DB chips (green/red) and uptime in seconds, polling every 30s
result: pass

### 4. Stage Picker
expected: Left sidebar shows 9 entries; Foundation enabled, 8 SDLC stages greyed with "Available in Phase X" tooltip on hover
result: issue
reported: "Same as prior session — tooltip message doesn't appear on hover. Only on click does 'Available in Phase X' render at the bottom of the sidebar."
severity: minor

### 5. Read Tool Runs Silently (no ApprovalCard)
expected: When agent calls echo or rag_query, no ApprovalCard appears in chat; tool executes and result appears in Action Feed
result: pass
note: "echo path verified — no ApprovalCard, Action Feed shows tool lifecycle. rag_query tool exists at worker/src/tools/rag-query.ts but not registered on sdlcAgent (sdlc.ts:24 wires only echo/createNote/applyMigrations). Scope gap, deferred to a later phase."

### 6. Write-Low Card (createNote)
expected: When agent calls createNote, inline Approve/Deny card appears with optional "Approve all matching for 5 min"
result: issue
reported: "createNoteTool executed and echoed args back: {\"text\":\"test-note: hello world\"}. No ApprovalCard rendered. No Approve/Deny buttons. No 'Approve all matching for 5 min' option. Tool ran as if no approval gate."
severity: major

### 7. Write-High Card (applyMigrations)
expected: When agent calls applyMigrations, card shows red border + DESTRUCTIVE badge + typed-CONFIRM input; Approve disabled until user types "CONFIRM"
result: issue
reported: "Model did not invoke applyMigrations. Replied with text: 'I can run the migrations via applyMigrations, but per the Phase 1 rules this requires a typed CONFIRM approval before I execute it. Please reply with exactly: CONFIRM...' Model hallucinated a typed-CONFIRM gate that does not exist in the agent instructions (sdlc.ts) or approval code (approval.ts/classify.ts). The tool call never fires, so the ApprovalCard never renders."
severity: minor
note: "Model hallucinated a gate. Real fix path: (a) tighten agent instructions to forbid invented gating, (b) or actually wire the write_high card (currently ChatPanel hardcodes tier='write_low' for all approvals — would not show red/CONFIRM even if it fired)."

### 8. Auto-Approve Toggle Bypasses Cards
expected: Header toggle set to "Always" makes all cards disappear for the session; audit rows show approval_decision='auto'
result: issue
reported: "Cannot verify the tiered→always contrast. ApprovalCard never renders in tiered mode either (same symptom as G-1-7). Switched toggle to Always and triggered createNote — tool ran, but since it was already running un-gated in tiered, the contrast (cards disappearing) is invisible. No way to confirm the resolver actually consults approvalMode."
severity: major
note: "Inherits G-1-7 root cause. Even if cards fired in tiered, the toggle comparison would need a working tiered gate to compare against."

### 9. Action Feed Renders Tool Lifecycle Inline
expected: Tool calls, results, errors, and approval cards all render as bubbles in the feed with status icons
result: pass
note: "Tool call + input bubble + result bubble render. Approval-card sub-bullet unverifiable due to G-1-7."

### 10. Cost Counter Ticks From Usage
expected: Header shows running USD estimate; increments after each agent step as tokens_in/out flow in from step-finish chunks
result: issue
reported: "Cost counter stays at $0 after agent replies. Two plausible causes: (a) step-finish chunk's totalUsage payload missing/zero; (b) pricing table (lib/pricing.ts) has no entry for opencode-go/hy3 — lookup returns undefined → estimateCostUsd crashes or returns NaN/0."
severity: minor

### 11. Pause on Tab Close
expected: Closing the tab sends `navigator.sendBeacon` to /api/pause; worker records sessionId in suspendedRuns Map
result: issue
reported: "Beacon side works: terminal logs /api/pause POST on tab close. Resume side broken: reopening tab loads same sessionId (localStorage persists) but chat panel is empty, previous messages lost. Either worker doesn't persist messages to suspended_runs, or ChatPanel doesn't fetch prior messages on mount."
severity: major

### 12. Audit Log Row Populated
expected: After smoke echo call, `SELECT * FROM audit_log WHERE session_id=<your-session>` returns 1 row with tokens_in/out NOT NULL, session_id matches browser session id
result: issue
reported: "audit_log table on InsForge exists but is empty after echo call. withAudit wrapper either not executing INSERT, or insert is failing silently (likely session_id mismatch — requestContext.sessionId not reaching withAudit, or wrong table/column names)."
severity: blocker

### 13. Audit Log Redacts Secrets
expected: `pnpm test:audit` exits 0; if a tool call passes args_json with `sk-...` 20+ char strings, the audit row's args_json shows `[REDACTED]` instead
result: issue
reported: "pnpm test:audit fails: `redactString traps sk-/pk-/api-/key-/token-/secret-prefixed strings` AssertionError. Failing case: `header api_key=AbCdEfGhIjKlMnOpQrStUvWxYz012345` — 32-char value with underscore separator passes through unredacted. Redactor regex likely matches hyphenated prefixes only (api-key, secret-key) not underscored (api_key, secret_key)."
severity: blocker

### 14. MCP Reconnect Bounded Retry
expected: If a stdio MCP server kills its pipe, `node --import tsx worker/scripts/test-mcp-reconnect.ts` reconnects within 3 attempts (1s/2s/4s backoff)
result: pass

### 15. RAG Tool Returns Context + Audit Rows Consumed
expected: Calling rag_query returns a context string; audit_log row has tool_doc_rows_consumed >= 1
result: issue
reported: "rag_query tool exists at worker/src/tools/rag-query.ts but is not registered on sdlcAgent — worker/src/agents/sdlc.ts:24 wires only echo/createNote/applyMigrations. Cannot trigger via chat, cannot verify context retrieval or audit row tool_doc_rows_consumed."
severity: blocker

## Summary

total: 15
passed: 6
issues: 10
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-1-7
  truth: "When agent calls createNote, inline Approve/Deny card appears with optional 'Approve all matching for 5 min'"
  status: failed
  reason: "User reported: createNoteTool executed and echoed args back. No ApprovalCard rendered. No Approve/Deny buttons. No 'Approve all matching for 5 min' option. Tool ran as if no approval gate."
  severity: major
  test: 6
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-8
  truth: "When agent calls applyMigrations, card shows red border + DESTRUCTIVE badge + typed-CONFIRM input; Approve disabled until user types CONFIRM"
  status: failed
  reason: "Model did not invoke applyMigrations. Hallucinated a typed-CONFIRM gate that does not exist in agent instructions or approval code. Tool call never fires, so ApprovalCard never renders. Even if it fired, ChatPanel hardcodes tier='write_low' for all approvals — red/CONFIRM check would not surface."
  severity: minor
  test: 7
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-9
  truth: "Auto-Approve Toggle set to Always makes all cards disappear for the session"
  status: failed
  reason: "Cannot verify contrast — ApprovalCard never renders in tiered mode (G-1-7). Auto-approve path looks identical to broken tiered path. Resolver consult on approvalMode is un-observable from the UI without working tiered gate."
  severity: major
  test: 8
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-10
  truth: "Cost counter increments after each agent step as tokens flow in from step-finish chunks"
  status: failed
  reason: "Cost counter stays at $0. Likely lib/pricing.ts has no entry for opencode-go/hy3 — current model after G-1-6 switch."
  severity: minor
  test: 10
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-11
  truth: "Closing tab sends beacon to /api/pause and worker records session; reopen resumes cleanly with prior messages"
  status: failed
  reason: "Beacon fires (terminal logs /api/pause POST). Reopening tab restores sessionId via localStorage but chat is empty — messages not persisted. Either worker pause handler does not store messages, or ChatPanel does not fetch prior messages on mount."
  severity: major
  test: 11
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-12
  truth: "After echo call, audit_log row exists with tokens_in/out populated and matching session_id"
  status: failed
  reason: "audit_log table on InsForge exists but is empty. withAudit wrapper either not executing INSERT or insert failing silently — likely session_id propagation gap from requestContext to withAudit, or table/column mismatch."
  severity: blocker
  test: 12
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-13
  truth: "pnpm test:audit exits 0 — redactString traps sk-/pk-/api-/key-/token-/secret-prefixed strings"
  status: failed
  reason: "Failing case `header api_key=AbCdEfGhIjKlMnOpQrStUvWxYz012345` not redacted. Redactor regex matches hyphenated prefixes only."
  severity: blocker
  test: 13
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-1-14
  truth: "rag_query is wired on sdlcAgent and returns a context string with tool_doc_rows_consumed >= 1 in audit_log"
  status: failed
  reason: "rag_query tool implemented (worker/src/tools/rag-query.ts) but not registered on sdlcAgent — sdlc.ts:24 wires only echo/createNote/applyMigrations. Cannot trigger via chat."
  severity: blocker
  test: 15
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

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
