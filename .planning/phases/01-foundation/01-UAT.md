---
status: testing
phase: 01-foundation
source: 01-A-SUMMARY.md, 01-B-SUMMARY.md, 01-C-SUMMARY.md, 01-D-SUMMARY.md, 01-E-SUMMARY.md, 01-F-SUMMARY.md
started: 2026-08-19T19:00:00Z
updated: 2026-08-20T18:30:00Z
---

## Current Test

[testing complete]

## Summary

total: 15
passed: 9
issues: 6
pending: 0
skipped: 0
blocked: 1
prior_issues: 10
reconciled_resolved: 9

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
reported: "ApprovalCard never renders. SSE wire shows tool-approval-request chunk emitted with correct approvalId+toolCallId — translator path works. Tool still executes un-gated. ChatPanel ignores tool-approval-request chunks. Also sessionId:'' empty in payload — G-1-12 cross-link."
severity: major
gap: G-1-7b (NEW — original G-1-7 was inconclusive between resolver/translator; both work now; failure is ChatPanel renderer)
note: "Fix plan 01-N added observability only. The actual root cause was downstream: ChatPanel must render the card on the tool-approval-request chunk type. Also empty sessionId in payload likely defeats G-1-12 even with R fix in place."

### 7. Write-High Card (applyMigrations)
expected: When agent calls applyMigrations, card shows red border + DESTRUCTIVE badge + typed-CONFIRM input; Approve disabled until user types "CONFIRM"
result: issue
reported: "Model DID call the tool this time (01-M fix worked for description). SSE wire shows tool-approval-request emitted. BUT tool still executed (terminal: 'ok text=0 tool=applyMigrationsTool'). Worker logs: [approval-resolver] tool=applyMigrationsTool mode=tiered → [chat-debug] chunk=tool-call-approval → [chat-debug] ok tool=applyMigrationsTool. Chunk is emitted but doesn't pause execution."
severity: major
gap: G-1-15 (NEW — gate mechanism doesn't pause in Mastra 1.60; supersedes G-1-7b renderer hypothesis for the actual blocking)
note: "01-M successfully removed the model-bias in tool description — model called applyMigrations. 01-N observability proved resolver+translator fire. The actual blocking is upstream: Mastra 1.60 emits tool-call-approval chunk then auto-resumes tool execution regardless of resolver return value, because the streaming flow has no way to await a client response. Renderer (G-1-7b) is downstream of this — fixing renderer alone won't gate execution."

### 8. Auto-Approve Toggle Bypasses Cards
expected: Header toggle set to "Always" makes all cards disappear for the session; audit rows show approval_decision='auto'
result: blocked
blocked_by: other
reason: "Cannot test tiered→always contrast — tiered card never appears (G-1-15 gate mechanism doesn't pause in Mastra 1.60 streaming). Resolver fix (01-O) cannot be observed from UI without a working tiered gate to compare against. Re-test after G-1-15 resolves."

### 9. Action Feed Renders Tool Lifecycle Inline
expected: Tool calls, results, errors, and approval cards all render as bubbles in the feed with status icons
result: pass
note: "Re-verified 2026-08-20: tool call bubble + result bubble render in feed. Approval-card sub-bullet still unverifiable (G-1-15 unresolved)."

### 10. Cost Counter Ticks From Usage
expected: Header shows running USD estimate; increments after each agent step as tokens_in/out flow in from step-finish chunks
result: issue
reported: "Counter displays '~ $0.0000' but value does not change at all across multiple replies. 01-P made the display not crash (no TypeError) but data-usage chunks either not emitted or not summed by CostCounter."
severity: minor
gap: G-1-16 (NEW — 01-P resolved crash but data wire incomplete)
note: "Possibilities: (a) worker step-finish not actually emitting data-usage chunks; (b) CostCounter not finding data-usage parts in m.parts; (c) opencode-go/hy3 is genuinely free so $0.0000 is correct but stable. Check worker terminal for usage log lines; inspect m.parts in devtools for data-usage entries."

### 11. Pause on Tab Close
expected: Closing the tab sends `navigator.sendBeacon` to /api/pause; worker records sessionId in suspendedRuns Map
result: issue
reported: "Beacon fires (POST /api/pause 200). ChatPanel fetches /api/messages on mount (200). BUT chat remains empty after reopen. Either worker doesn't store messages snapshot OR returns empty from suspendedRuns OR ChatPanel doesn't seed useChat from fetch result."
severity: major
gap: G-1-11b (NEW — 01-Q shipped GET endpoint + fetch but round-trip incomplete)
note: "Network path works on both sides (pause 200, messages 200). Three suspects: (a) beacon payload omits messages array; (b) worker suspendedRuns Map key collision / wrong key; (c) ChatPanel receives empty array and discards it; (d) useChat initialMessages not actually setting on hydrate."

### 12. Audit Log Row Populated
expected: After smoke echo call, `SELECT * FROM audit_log WHERE session_id=<your-session>` returns 1 row with tokens_in/out NOT NULL, session_id matches browser session id
result: issue
reported: "audit_log still empty after echo call ('No Records Found'). 01-R's module-scope carrier didn't reach INSERT — or INSERT fails and console.error not surfacing."
severity: blocker
gap: G-1-12b (NEW — 01-R didn't reach INSERT path)
note: "Need worker terminal logs to see whether console.error fires (INSERT failure) or whether withAudit execute wrapper isn't even invoked. Check /api/health for worker liveness; check worker terminal during echo call for any audit-related log lines."

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
reported: "ragQueryTool is now registered (model calls it) but two failures stack: (1) Resolver fires for read tool — '[approval-resolver] tool=ragQueryTool mode=tiered' should NOT gate read tools, but it does; (2) SSE stream ends after tool-approval-request with no tool-output chunk — '[chat-debug] ok text=8 tool=ragQueryTool' shows tool ran but result never reached client. User sees: 'I'll look up...' text + tool call bubble, but NO context string and NO tool result rendered."
severity: blocker
gap: G-1-14b (extends G-1-14 — wiring works, but resolver+stream are wrong for read tools)
note: "Tool Docs ingested (3 sections, notion/local). Model correctly chose to call rag_query. Two new defects: (a) classify('rag_query')='read' but resolver still gates it — resolver code path may not consult classify output. (b) Even when tool runs, its result is not forwarded as tool-output-available chunk on SSE. Both rooted in G-1-15 gate mechanism. Also: empty sessionId in payload prevents G-1-12b from associating any audit row with browser session."

## Summary

total: 15
passed: 6
issues: 0
pending: 9
skipped: 0
blocked: 0
prior_issues: 10
reconciled_resolved: 9

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
  status: failed
  reason: "User reported 2026-08-20: ApprovalCard never renders despite tool-approval-request chunk arriving on SSE wire with correct approvalId+toolCallId. Translator works. Failure is downstream in ChatPanel renderer."
  severity: major
  test: 6
  root_cause: "ChatPanel does not subscribe to or render on `tool-approval-request` chunk type. G-1-7 originally inconclusive between (A) resolver never fires and (B) chunk translator drops. 01-N added observability — wire evidence proves translator emits the chunk. New failure is (C) ChatPanel ignores the chunk. May also overlap with sessionId='' empty in payload (G-1-12 cross-link)."
  artifacts:
    - path: "app/components/ChatPanel.tsx"
      issue: "Renders text/tool parts but no handler for tool-approval-request SSE chunk"
    - path: "app/components/ApprovalCard.tsx"
      issue: "Component exists; never invoked because no caller feeds it the approval-request payload"
  missing:
    - "ChatPanel must subscribe to tool-approval-request chunks and route through tool-approval-request message part → ApprovalCard component"
    - "Investigate why sessionId='' is empty in payload (likely /api/chat route or ChatPanel useChat transport options)"
    - "Verify with createNote in tiered mode → card renders, Approve sends to /api/approve, tool runs"
  debug_session: ""

- gap_id: G-1-15
  truth: "When toolApprovalResolver returns true (gating), Mastra 1.60 pauses tool execution until client sends approval; without client response, tool does NOT run"
  status: failed
  reason: "User reported 2026-08-20: terminal log '[approval-resolver] tool=applyMigrationsTool mode=tiered' confirms resolver fires; then '[chat-debug] chunk=tool-call-approval' (translator emits tool-approval-request); then '[chat-debug] ok text=0 tool=applyMigrationsTool' — tool ran anyway. Chunk is a notification, not a pause."
  severity: blocker
  test: 7
  root_cause: "Mastra 1.60's tool-approval gate emits a tool-call-approval chunk for client-side UI rendering but does NOT actually halt the underlying tool execution in streaming mode. The resolver return value is informational only — once the stream is flowing, the LLM/agent runtime calls the tool regardless of the resolver decision. Likely fix path: drop reliance on Mastra's approval gate; implement manual gate in worker/src/index.ts stream translator — buffer tool-call chunks until client posts /api/approve with matching approvalId, then flush; on timeout/abort, drop and emit error chunk. Or use agent.generate() in non-streaming mode for write_low/write_high tools with a request-scoped approval map."
  artifacts:
    - path: "worker/src/index.ts"
      issue: "Stream translator must intercept tool-call-approval chunks and buffer instead of forwarding"
    - path: "worker/src/agents/sdlc.ts"
      issue: "toolApprovalResolver return is informational only in streaming; gate logic needs to live in translator"
    - path: "node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs"
      issue: "Mastra 1.60 streaming flow doesn't block on approval resolver"
  missing:
    - "Implement explicit per-approvalId gate in worker stream translator: on tool-call-approval chunk, suspend stream, write tool-approval-request to SSE, await POST /api/approve?approvalId=... from client; on Approve: resume stream; on Deny: emit tool-output-error chunk and resume; on 60s timeout: emit tool-output-error"
    - "ApprovalCard Approve/Deny buttons POST to /api/approve with approvalId"
    - "Drop dependence on toolApprovalResolver streaming flow; keep classifier + resolveApproval for audit-decision recording only"
  debug_session: ""

- gap_id: G-1-16
  truth: "After each chat reply, cost counter ticks to a non-zero (or updated) USD value derived from token usage"
  status: failed
  reason: "User reported 2026-08-20: counter shows '~ $0.0000' static, value never changes across multiple replies. 01-P prevented the TypeError crash but data wire is incomplete."
  severity: minor
  test: 10
  root_cause: "Three suspects. (a) Worker step-finish handler not actually emitting data-usage DataUIMessageChunk to SSE — must_haves claim says it does, runtime shows it doesn't. (b) CostCounter not finding data-usage parts in m.parts — maybe wrong part-type string ('data-usage' vs 'usage' vs 'data:usage'). (c) opencode-go/hy3 pricing table row exists but all rates are 0 — counter correct, just free model."
  artifacts:
    - path: "worker/src/index.ts"
      issue: "Verify step-finish handler emits data-usage DataUIMessageChunk — check worker terminal for usage log line"
    - path: "app/components/CostCounter.tsx"
      issue: "Verify part-type filter matches what worker emits"
    - path: "lib/pricing.ts"
      issue: "Verify opencode-go/hy3 PRICING row has non-zero rates or note that it is genuinely free"
  missing:
    - "Confirm with user: does worker terminal show usage log line per reply?"
    - "Inspect m.parts in browser devtools after a reply — look for any data-* type parts"
    - "If opencode-go/hy3 is free, document this as expected behavior and accept minor status"
  debug_session: ""

- gap_id: G-1-11b
  truth: "After close+reopen of tab with same sessionId, prior chat messages reappear in the chat panel"
  status: failed
  reason: "User reported 2026-08-20: POST /api/pause 200 (beacon fires), GET /api/messages?sessionId=... 200 (fetch fires), sessionId persists in localStorage — but chat panel stays empty. Round-trip incomplete."
  severity: major
  test: 11
  root_cause: "01-Q shipped the GET endpoint and ChatPanel mount-fetch, but three possible breaks. (a) Beacon payload in pause-signal.ts may still omit `messages` array even after 01-Q — verify the field is actually serialized. (b) Worker pause.ts may not store the messages field in suspendedRuns Map value type — verify type allows it. (c) ChatPanel useEffect may fetch but not seed useChat's initialMessages (returns are ignored)."
  artifacts:
    - path: "app/lib/pause-signal.ts"
      issue: "Verify beacon payload includes messages: messagesRef.current"
    - path: "worker/src/api-routes/pause.ts"
      issue: "Verify suspendedRuns.set stores messages field"
    - path: "app/components/ChatPanel.tsx"
      issue: "Verify fetch result seeds useChat initialMessages"
  missing:
    - "Curl worker /sessions/sess-k4609nex/messages → check response body shape"
    - "In devtools network tab, inspect /api/messages response body — is it {messages: []} or missing?"
    - "If empty array: worker has no stored snapshot; trace beacon → worker pause handler → suspendedRuns write"
    - "If non-empty array: ChatPanel fetch but not seeding useChat; verify setMessages or initialMessages wiring"
  debug_session: ""

- gap_id: G-1-12b
  truth: "After echo call, audit_log contains at least 1 row with session_id set and tokens_in/out populated"
  status: failed
  reason: "User reported 2026-08-20: audit_log still 'No Records Found' on InsForge after echo call. 01-R's module-scope carrier did not result in a successful INSERT."
  severity: blocker
  test: 12
  root_cause: "01-R may have only refactored sessionId plumbing but withAudit still not invoked on the tool-execute path (Mastra 1.60 createTool({execute}).execute() may not even reach the withAudit wrapper, instead invoking the inner raw execute directly). Or INSERT is failing and the new console.error isn't surfacing (worker not running, db connection dropped, schema drift). Empty sessionId='' in payload cross-link suggests withAudit may also be writing with bad session_id."
  artifacts:
    - path: "worker/src/lib/audit.ts"
      issue: "Verify withAudit wrapper is invoked on echo tool execute path; verify INSERT reaches db"
    - path: "worker/src/index.ts"
      issue: "Verify stream route calls setAuditSessionId before agent.stream()"
    - path: "lib/insforge.ts"
      issue: "Verify db client connection is live and audit_log schema matches INSERT columns"
  missing:
    - "Worker terminal log scan during echo call: any '[withAudit]' or INSERT error lines?"
    - "Direct curl to worker /health: is worker alive?"
    - "Direct insert from worker into audit_log: does it succeed or fail?"
  debug_session: ""

- gap_id: G-1-14b
  truth: "rag_query returns context string and renders as tool result in chat; resolver does NOT gate read-tier tools"
  status: failed
  reason: "User reported 2026-08-20: model calls ragQueryTool correctly but '[approval-resolver] tool=ragQueryTool mode=tiered' fires (read tool should not gate); tool runs but SSE ends after tool-approval-request with no tool-output chunk; user sees no context result in chat."
  severity: blocker
  test: 15
  root_cause: "Two stacked defects. (a) toolApprovalResolver fires for ALL tools regardless of classify tier — it gates read tools too. classify('rag_query')='read' should make resolveApproval return false; the resolver code may be ignoring the tier. (b) When tool-call-approval chunk is emitted in Mastra 1.60 streaming, the tool-result chunk never reaches SSE because the gate is not closed by client — same root as G-1-15. Tool runs (Mastra default) but client never sees result."
  artifacts:
    - path: "worker/src/agents/sdlc.ts"
      issue: "toolApprovalResolver must consult classify(toolName) and short-circuit return false for read tier"
    - path: "worker/src/index.ts"
      issue: "Stream translator must forward tool-output-available chunk regardless of approval chunk emission"
  missing:
    - "Resolver: `const tier = classify(toolName); if (tier === 'read') return false;` before any approvalMode logic"
    - "Translator: tool-input-available → wait for tool result → tool-output-available chunk must be emitted (currently dropped after tool-approval-request)"
    - "Verify rag_query after fix: returns context string referencing notion-guides-mcp-overview.md"
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
  root_cause: "StagePicker.tsx:72 uses native HTML title= attribute on disabled buttons. Native browser tooltips have 500ms–1s delay and can be suppressed by browser/OS settings, so they appear 'missing' on quick hover. Click path drives immediate React state toast (lines 89-101) so the message does appear on click."
  artifacts:
    - path: "app/components/StagePicker.tsx"
      issue: "Line 72: title= attribute is the entire hover mechanism; needs Radix/shadcn Tooltip primitive (shadcn/ui already in stack per CLAUDE.md)"
  missing:
    - "Replace title= with Radix Tooltip wrapper around each disabled button"
    - "Tooltip should render on hover with no delay and clear on mouseleave"
  debug_session: ".planning/debug/g-1-4-stage-picker-tooltip.md"

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
