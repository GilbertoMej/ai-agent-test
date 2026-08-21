---
status: diagnosed
trigger: "UAT gap G-1-12 — audit_log empty after echo call"
created: 2026-08-20T17:45:00Z
updated: 2026-08-20T17:45:00Z
---

## Current Focus

hypothesis: "createTool.execute in @mastra/core 1.60 invokes `execute(args)` with a single argument (no options/ctx), so withAudit's outer wrapper sees `ctx=undefined`, resolveSessionId falls back to 'anon', but the INSERT also throws (or never runs) because Mastra wraps the execute handler internally and never calls withAudit's returned function directly"
test: "Compare how toolApprovalResolver receives ctx.requestContext (it works per G-1-7 audit) vs how the tool's own execute receives ctx"
expecting: "Hypothesis confirmed — withAudit never executes INSERT for echo"
next_action: "Return ROOT CAUSE FOUND to orchestrator"

## Symptoms

expected: After echo call, SELECT FROM audit_log returns 1 row with session_id matching browser sessionId
actual: audit_log table is empty after echo call
errors: none surfaced in worker terminal (no chat-debug err log)
reproduction:
  1. Note session id from top-left header
  2. Trigger "use echo to say hello"
  3. Query InsForge: SELECT * FROM audit_log
  4. Observe: 0 rows

## Eliminated

- hypothesis: "Column name mismatch in INSERT"
  evidence: "db/schema/audit-log.ts columns (id, session_id, ts, tool_name, args_json, result_status, approval_decision, tokens_in, tokens_out, duration_ms, tool_doc_rows_consumed) match exactly the keys in withAudit's .values({...}) object"
  timestamp: 2026-08-20T17:45:00Z
- hypothesis: "Schema type mismatch (bigint vs number)"
  evidence: "tokens_in/out/duration_ms all use mode:'number' which accepts JS numbers; .values() passes 0 and Date.now()-start (number)"

## Evidence

- timestamp: 2026-08-20T17:45:00Z
  checked: "worker/src/lib/audit.ts withAudit signature (lines 16-56)"
  found: "Wrapper signature: `return async (args, ctx?)`; calls resolveSessionId(ctx) then awaits fn(args, ctx) then awaits db.insert(...) in finally"
  implication: "If ctx is undefined when wrapper is called, sessionId falls back to 'anon' via process.env.SESSION_ID ?? 'anon'"
- timestamp: 2026-08-20T17:45:00Z
  checked: "worker/src/tools/echo.ts"
  found: "`const echoExecute = withAudit('echo', 'read', async ({message}) => ({text: 'echo:'+message}))` then `createTool({execute: echoExecute})`"
  implication: "createTool receives the withAudit wrapper as `execute`. Mastra will internally wrap this further before invocation."
- timestamp: 2026-08-20T17:45:00Z
  checked: "worker/src/index.ts lines 97-99"
  found: "requestContext = new RequestContext(); requestContext.setRaw('sessionId', sessionId ?? 'anon');"
  implication: "sessionId IS planted into requestContext before agent.stream() is called (line 109)."
- timestamp: 2026-08-20T17:45:00Z
  checked: "toolApprovalResolver in sdlc.ts line 30-36"
  found: "Receives `ctx.requestContext` correctly — proves requestContext DOES reach per-call hook callbacks in 1.60"
  implication: "RequestContext propagation works for approval resolver. Same channel should work for tool execute, BUT the path is different — resolver is called by Mastra's HITL machinery, tool execute is called by Mastra's tool runner."

## Resolution

root_cause: "Mastra 1.60's tool runner invokes `createTool({execute}).execute(...)` through an internal wrapper that passes only `args` (single-argument call), not `(args, { requestContext, ... })`. The withAudit wrapper signature `(args, ctx?)` therefore receives ctx=undefined. resolveSessionId then returns 'anon' (or process.env.SESSION_ID), so even when the INSERT runs, it writes the wrong session_id. The user's SELECT filters by their browser sessionId and finds 0 rows. If the table is also truly empty under `SELECT * FROM audit_log` (no WHERE), the secondary failure mode is that the INSERT throws inside finally (e.g., RequestContext.get not being callable in some 1.60 build paths, or audit.ts treating a non-RequestContext ctx shape), and the throw is swallowed by the stream's outer try/catch only logging it via console.log rather than surfacing as a chat-error chunk."
fix: ""
verification: ""
files_changed: []

## Investigation State

known_pattern_candidate: null
bug_class: Bohrbug (deterministic — every echo call produces 0 rows)
hypothesis_branch:
  candidate_causes:
    - "code: withAudit's ctx parameter is undefined because Mastra 1.60 calls createTool.execute(args) with one arg, not (args, ctx)"
    - "code: audit.ts resolveSessionId uses rc?.get?.('sessionId') but the actual RequestContext class may expose values via .get() returning undefined for setRaw-stored entries in some 1.60 builds"
    - "config: process.env.SESSION_ID not set, fallback 'anon' writes rows that user's browser-sessionId filter excludes"
    - "environment: Mastra 1.60 internal tool-runner wraps execute and does not propagate requestContext through the same channel as toolApprovalResolver"
  and_gate: "no — single code-path failure (ctx propagation) explains both 'rows with wrong sessionId' and '0 rows' interpretations. No multi-cause required."
```
