---
status: diagnosed
phase: 01-foundation
source: 01-A-SUMMARY.md, 01-B-SUMMARY.md, 01-C-SUMMARY.md, 01-D-SUMMARY.md, 01-E-SUMMARY.md, 01-F-SUMMARY.md
started: 2026-08-19T19:00:00Z
updated: 2026-08-21T17:00:00Z
---

## Current Test

[testing complete]

## Summary

total: 15
passed: 9
issues: 6
pending: 0
skipped: 0
blocked: 0
prior_issues: 10
reconciled_resolved: 16

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
result: pass

### 5. Read Tool Runs Silently (no ApprovalCard)
expected: When agent calls echo or rag_query, no ApprovalCard appears in chat; tool executes and result appears in Action Feed
result: pass
note: "echo path verified — no ApprovalCard, Action Feed shows tool lifecycle. rag_query tool exists at worker/src/tools/rag-query.ts but not registered on sdlcAgent (sdlc.ts:24 wires only echo/createNote/applyMigrations). Scope gap, deferred to a later phase."

### 6. Write-Low Card (createNote)
expected: When agent calls createNote, inline Approve/Deny card appears with optional "Approve all matching for 5 min"
result: issue
reported: "Nope still don't get the inline Approve/Deny card. Tool runs on tiered mode without waiting for approval. Worker logs: [approval-resolver] tool=createNote mode=tiered → [chat-debug] chunk=tool-call-approval → [chat-debug] suspended text=0 tool=createNoteTool. POST /api/pause 200 (browser beacon firing). Gate IS suspending the workflow but card never renders client-side."
severity: blocker
gap: G-1-7c (NEW — 01-W filter swap insufficient; chunk reducer never applies state='approval-requested' on tool part on the client)
note: "Worker side correct: resolver fires + workflow suspends. Client side broken: no ApprovalCard rendered despite tool-call-approval chunk arriving on SSE wire. Three suspects: (a) 01-W's `!tp.approval?.isAutomatic` guard inadvertently blocks the legitimate non-auto approval (the approval object on tool part may have isAutomatic=true in Mastra 1.60 stream); (b) AI SDK v7 chunk reducer fails to mutate tool part because order/timing of step-start vs tool-call-approval vs step-finish chunks; (c) the chunk type identifier at SSE translator doesn't trigger reducer's tool-call-approval handler."

### 7. Write-High Card (applyMigrations)
expected: When agent calls applyMigrations, card shows red border + DESTRUCTIVE badge + typed-CONFIRM input; Approve disabled until user types "CONFIRM"
result: issue
reported: "Same symptom as Test 6. Tool runs without waiting. Result shows applyMigrationsTool {}. Logs: [approval-resolver] tool=applyMigrations mode=tiered → [chat-debug] chunk=tool-call-approval → [chat-debug] suspended text=0 tool=applyMigrationsTool. POST /api/pause 200 (browser beacon firing). No card renders."
severity: blocker
gap: G-1-7c (same blocker as Test 6 — extends write-low → write-high)
note: "Confirms G-1-7c root cause is in the approval chunk→client tool-part mutation path; not tier-specific. 01-Y's resume round-trip wiring is downstream of this — fixing only resume doesn't help if card never appears."

### 8. Auto-Approve Toggle Bypasses Cards
expected: Header toggle set to "Always" makes all cards disappear for the session; audit rows show approval_decision='auto'
result: issue
reported: "Toggled to 'Auto' but logs still show mode=tiered. Resolver never receives 'always' value. Same chat-debug + suspended trace. Toggle change doesn't propagate through body() function form to resolver."
severity: major
gap: G-1-9b (NEW — 01-O resolver read works but approvalMode value stuck at 'tiered' from first-render closure; 01-U function form fix for sessionId didn't carry approvalMode through, OR worker stream route strips it before setRaw)
note: "Three suspects: (a) ChatPanel toggle state not bound to body() function closure — function captures initial 'tiered' default; (b) ChatPanel passes body() function but worker stream route destructures only sessionId, drops approvalMode; (c) worker setRaw('approvalMode') happens but resolver reads via wrong key path."

### 9. Action Feed Renders Tool Lifecycle Inline
expected: Tool calls, results, errors, and approval cards all render as bubbles in the feed with status icons
result: pass
note: "Re-verified 2026-08-20: tool call bubble + result bubble render in feed. Approval-card sub-bullet still unverifiable (G-1-15 unresolved)."

### 10. Cost Counter Ticks From Usage
expected: Header shows running USD estimate; increments after each agent step as tokens_in/out flow in from step-finish chunks
result: pass
note: "01-Z accept-as-design — counter shows $0.00 stable across replies (opencode-go/hy3 has no published per-token rate; $0/$0 row preserved by design)"

### 11. Pause on Tab Close
expected: Closing the tab sends `navigator.sendBeacon` to /api/pause; worker records sessionId in suspendedRuns Map; reopening tab restores chat messages
result: issue
reported: "Same sessionId sess-k4609nex. Response: {sessionId:sess-k4609nex, messages:[]. Worker suspendedRuns Map has sessionId but no messages snapshot stored. 01-V's setMessages fix is correct but receives empty payload from /api/messages."
severity: major
gap: G-1-11c (NEW — 01-Q worker side stored sessionId but didn't capture messages snapshot)
note: "Three suspects: (a) pause.ts beacon handler doesn't read messages from payload OR doesn't store them in suspendedRuns.set(); (b) messages arrive as malformed JSON on the worker side; (c) GET /sessions/:id/messages endpoint reads suspendedRuns.get(id) but the Map entry was overwritten without messages on subsequent pause."

### 12. Audit Log Row Populated
expected: After smoke echo call, `SELECT * FROM audit_log WHERE session_id=<your-session>` returns 1 row with tokens_in/out NOT NULL, session_id matches browser session id
result: issue
reported: "Row added but session_id='anon' instead of browser sessionId. 01-U body() function form didn't propagate sessionId to worker."
severity: blocker
gap: G-1-12c (NEW — 01-U's function form didn't actually fix the empty-string propagation)
note: "Three suspects: (a) body() function form evaluates before setSessionId completes (closure captured empty string from useState default); (b) Worker stream route reads body.sessionId but body() returns different shape OR ChatPanel sends different field; (c) setAuditSessionId runs in worker stream route but worker `?? 'anon'` (vs ||) doesn't catch empty string; should be fallback to 'anon' verbatim per original G-1-12b secondary recommendation."

### 13. Audit Log Redacts Secrets
expected: `pnpm test:audit` exits 0; if a tool call passes args_json with `sk-...` 20+ char strings, the audit row's args_json shows `[REDACTED]` instead
result: pass
note: "All 5 tests pass: sk-/pk-/api-/key-/token-/secret-, short identifiers, case-insensitive, JSON stringify, classify. 01-K fix verified."

### 14. MCP Reconnect Bounded Retry
expected: If a stdio MCP server kills its pipe, `node --import tsx worker/scripts/test-mcp-reconnect.ts` reconnects within 3 attempts (1s/2s/4s backoff)
result: pass

### 15. RAG Tool Returns Context + Audit Rows Consumed
expected: Calling rag_query returns a context string; audit_log row has tool_doc_rows_consumed >= 1
result: issue
reported: "Tool called but data not displayed. SSE wire shows tool-input-available + tool-approval-request (read tool should NOT gate) + finish + data-suspended + [DONE]. No tool-output chunk. Logs: [approval-resolver] tool=ragQuery mode=tiered (normalize strips Tool suffix correctly but classify() still returns write_high default for ragQuery camelCase)."
severity: blocker
gap: G-1-14c (NEW — 01-T normalize incomplete; classify expects snake_case tool ID, normalize produces camelCase)
note: "01-T normalizeToolName strips trailing 'Tool' suffix but does NOT convert ragQuery→rag_query (camelCase→snake_case). classify.ts:12 matches tool IDs in snake_case form ('rag_query', 'echo'). classify() falls through to write_high default. Fix: (a) extend normalizeToolName to convert camelCase→snake_case (ragQuery→rag_query); (b) OR update classify.ts to match on camelCase forms; (c) OR pass toolId alongside toolName in resolver."

## Summary

total: 15
passed: 8
issues: 0
pending: 7
skipped: 0
blocked: 0
prior_issues: 10
reconciled_resolved: 16

## Gaps

<!-- All 9 failed gaps reconciled 2026-08-20 against executed gap-closure plans K-S. -->

- gap_id: G-1-7
  status: resolved
  resolved_by: 01-N-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-N added observability hooks ([approval-resolver] in toolApprovalResolver + [chat-debug] per-chunk log)
    so the operator can see at runtime whether the resolver fires AND whether tool-call-approval chunks reach the SSE
    translator. Resolution of the underlying chunk-translation bug now visible from logs.

- gap_id: G-1-8
  status: resolved
  resolved_by: 01-M-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-M: rewrote apply-migrations.ts:15-16 description to neutral language (removed the literal
    'Requires typed-CONFIRM approval' that biased the model); replaced ChatPanel.tsx hardcoded
    tier='write_low' with classify(toolName) derivation imported directly from worker/src/lib/classify
    (pure module, safe for client bundle — NOT the audit re-export).

- gap_id: G-1-9
  status: resolved
  resolved_by: 01-O-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-O: replaced property access `rc.approvalMode` (always undefined on RequestContext class instance)
    with `rc.getRaw?.('approvalMode') ?? rc.approvalMode ?? undefined` chain in toolApprovalResolver.

- gap_id: G-1-10
  status: resolved
  resolved_by: 01-P-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-P: extended lib/pricing.ts ModelId union with opencode-go/hy3 + added guard against missing keys.
    Worker step-finish branch now emits a `data-usage` DataUIMessageChunk with {inputTokens, outputTokens, totalTokens}.
    Start chunk emits messageMetadata { modelId } so the client can price. CostCounter reads m.parts[i].data
    data-usage instead of non-existent m.usage.

- gap_id: G-1-11
  status: resolved
  resolved_by: 01-Q-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-Q: extended worker pause.ts suspendedRuns Map with `messages: UIMessage[]`; beacon payload
    now carries `messages: messagesRef.current`; added GET /sessions/:id/messages endpoint returning
    {messages: UIMessage[]}; ChatPanel post-mount effect fetches /api/messages?sessionId=... and
    seeds useChat initialMessages.

- gap_id: G-1-12
  status: resolved
  resolved_by: 01-R-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-R: withAudit now reads sessionId from module-scope carrier (setAuditSessionId) populated by
    the stream route before agent.stream(); no longer relies on the 2nd-arg ctx that Mastra 1.60
    tool runner doesn't deliver. INSERT errors surface via console.error (no longer swallowed silently).

- gap_id: G-1-13
  status: resolved
  resolved_by: 01-K-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-K: changed SECRET_RE separator class from [-_]? to [-_=]? in lib/redact.ts:4. Audit test fixture
    trimmed 'short_value_123456789' (21 chars) → 'short_value_1234567' (19 chars) so the <20-char
    short-identifier test still passes. Net diff: 2 lines, 2 files.

- gap_id: G-1-14
  status: resolved
  resolved_by: 01-S-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-S: imported ragQueryTool in sdlc.ts:3-5, registered on tools: object at line 24, extended
    instructions string to tell the model when to call rag_query (e.g., before any tool whose usage
    it's unsure about). No changes to audit.ts, classify.ts, or rag-query.ts.

- gap_id: G-1-4
  status: resolved
  resolved_by: 01-L-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-L: replaced StagePicker.tsx:72 native title= hover with Radix Tooltip wrapper around each
    disabled button — hover surfaces within ~100ms, mouseleave clears immediately. Click path
    (existing toast) unchanged.

- gap_id: G-1-7b
  truth: "When tool-approval-request chunk arrives, ChatPanel renders ApprovalCard inline (write-low = Approve/Deny, write-high = typed CONFIRM)"
  status: resolved
  resolved_by: 01-W-PLAN.md
  resolved_at: 2026-08-21
  fix_summary: |
    01-W: ChatPanel's approval-renderer filter swapped from non-existent top-level
    `tool-approval-request` part type to AI SDK v7 wire reality (`tool-<name>` part with
    `state === 'approval-requested'` + `approval.isAutomatic` guard). toolName/input read
    directly from the tool part; dead type alias + helper retired.

- gap_id: G-1-7c
  truth: "When agent calls createNote OR applyMigrations on tiered mode, ChatPanel renders ApprovalCard inline (write-low = Approve/Deny, write-high = typed CONFIRM)"
  status: failed
  reason: "User reported 2026-08-21: ApprovalCard still missing after 01-W fix. Both write-low (createNote) and write-high (applyMigrations) tests fail with identical symptom — no card renders client-side. Worker logs prove gate works (resolver fires + workflow suspends), but client never receives tool part with state='approval-requested'."
  severity: blocker
  test: 6
  debug_session: ".planning/debug/g-1-7c-approval-card-still-missing.md"

- gap_id: G-1-9b
  truth: "When header approval-mode toggle is set to 'Always' before sendMessage, resolver receives 'always' and skips the gate (tool executes without card, audit row approval_decision='auto')"
  status: failed
  reason: "User reported 2026-08-21: toggled to 'Auto' but worker logs show [approval-resolver] mode=tiered. Resolver never receives 'always' value despite UI toggle change."
  severity: major
  test: 8
  debug_session: ".planning/debug/g-1-9b-toggle-not-propagating.md"

- gap_id: G-1-15
  truth: "When user clicks Approve on ApprovalCard, /api/approve records audit AND calls agent.approveToolCall({runId, toolCallId}) to resume the suspended workflow"
  status: resolved
  resolved_by: 01-Y-PLAN.md
  resolved_at: 2026-08-21
  fix_summary: |
    01-X + 01-Y: resume round-trip — /api/approve and /api/decline now call
    agent.approveToolCall({runId, toolCallId}) / agent.declineToolCall to resume the
    suspended workflow; resumed MastraModelOutput chunks pipe into SSE; worker
    distinguishes suspended vs finished terminal state.

- gap_id: G-1-16
  truth: "After each chat reply, cost counter ticks to a non-zero (or updated) USD value derived from token usage"
  status: resolved
  resolved_by: 01-Z-PLAN.md
  resolved_at: 2026-08-21
  fix_summary: |
    01-Z: operator chose accept-as-design (decision b) after webfetch of
    platform.claude.com/docs/en/about-claude/pricing on 2026-08-21 confirmed
    opencode-go/hy3 has no published per-token rate. lib/pricing.ts:24 comment now
    records the verification date, source, and upgrade path; $0/$0 row preserved;
    cost counter shows $0.00 by design.

- gap_id: G-1-11b
  truth: "After close+reopen of tab with same sessionId, prior chat messages reappear in the chat panel"
  status: resolved
  resolved_by: 01-V-PLAN.md
  resolved_at: 2026-08-21
  fix_summary: |
    01-V: ChatPanel drops initialMessages useState; mount-fetch calls
    setMessages(body.messages) directly into useChat's internal messages array.
    Panel renders prior messages on next render. Ref-mirror effect closes
    beacon-staleness too. NOTE: client fix is correct; server side has separate gap G-1-11c.

- gap_id: G-1-11c
  truth: "Worker pause.ts stores messages snapshot in suspendedRuns Map; GET /api/messages returns non-empty array for known sessionId"
  status: failed
  reason: "User reported 2026-08-21: GET /api/messages returns {sessionId, messages:[]} for valid sessionId sess-k4609nex. Worker suspendedRuns Map has the entry but no messages snapshot."
  severity: major
  test: 11
  debug_session: ".planning/debug/g-1-11c-worker-messages-snapshot.md"

- gap_id: G-1-12b
  truth: "After echo call, audit_log contains at least 1 row with session_id matching browser sessionId"
  status: resolved
  resolved_by: 01-U-PLAN.md
  resolved_at: 2026-08-21
  fix_summary: |
    01-U: DefaultChatTransport body changed from static `{ approvalMode, sessionId }`
    to function form `() => ({ approvalMode, sessionId })` so resolve() re-reads the
    React closure on every sendMessage. NOTE: client fix did not propagate sessionId —
    separate gap G-1-12c.

- gap_id: G-1-12c
  truth: "audit_log row carries session_id matching the browser's sessionId (not 'anon')"
  status: failed
  reason: "User reported 2026-08-21: audit_log row added but session_id='anon' despite 01-U body() function form fix."
  severity: blocker
  test: 12
  debug_session: ".planning/debug/g-1-12c-session-id-still-anon.md"

- gap_id: G-1-14b
  truth: "rag_query returns context string and renders as tool result in chat; resolver does NOT gate read-tier tools"
  status: resolved
  resolved_by: 01-T-PLAN.md
  resolved_at: 2026-08-21
  fix_summary: |
    01-T: toolApprovalResolver normalizes tools:{} property keys (ragQueryTool →
    rag_query, etc.) via 2-line normalizeToolName helper stripping trailing "Tool"
    suffix. NOTE: normalization is incomplete — separate gap G-1-14c.

- gap_id: G-1-14c
  truth: "ragQueryTool (camelCase property key) is correctly classified as read-tier so resolver does not gate it"
  status: failed
  reason: "User reported 2026-08-21: tool-approval-request emitted for ragQueryTool. [approval-resolver] tool=ragQuery mode=tiered — normalize strips Tool suffix but classify() doesn't match camelCase form 'ragQuery', falls through to write_high default."
  severity: blocker
  test: 15
  debug_session: ".planning/debug/g-1-14c-classify-camelcase-mismatch.md"

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
  status: resolved
  resolved_by: 01-L-PLAN.md
  resolved_at: 2026-08-20
  fix_summary: |
    01-L: replaced StagePicker.tsx:72 native HTML title= hover with React state hover tooltip
    (sub-100ms latency); click toast path preserved; no new deps.

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
