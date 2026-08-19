---
phase: 1
plan: E
type: execute
wave: 3
depends_on: ["01-A", "01-B", "01-C", "01-D"]
files_modified:
  - package.json
  - pnpm-lock.yaml
  - worker/src/index.ts
  - worker/src/lib/audit.ts
  - worker/src/tools/echo.ts
  - app/api/smoke/echo/route.ts
autonomous: true
must_haves:
  - "pnpm install succeeds against the bumped @mastra/mcp pin and regenerated lockfile"
  - "POST /agents/sdlcAgent/stream on the worker invokes sdlcAgent.stream(messages, { requireToolApproval: toolApprovalResolver, requestContext: { approvalMode, sessionId }, threadId, memory }) — verified by grep + tsc + smoke"
  - "Every step-finish chunk from the worker stream calls patchTokens(sessionId, toolName, totalUsage.inputTokens, totalUsage.outputTokens) — verified by an audit_log query showing tokens_in/tokens_out IS NOT NULL for a real chat call"
  - "audit_log.session_id for chat-generated rows equals the sessionId the browser sent in the /api/chat body (NOT 'anon') — verified by a smoke round-trip"
  - "echoTool.execute is wrapped with withAudit('echo', 'read', ...) — verified by an audit_log row with tool_name='echo' AND result_status='ok' AND approval_decision='auto' AND tokens_in/tokens_out populated"
  - "pnpm smoke exits 0 against the wired stack"
requirements:
  - UI-04
  - UI-06
  - HITL-01
  - HITL-02
  - BCK-04
---

# 01-E — Phase 1 Gap Closure (5 surgical fixes)

Closes the five gaps VERIFICATION.md surfaced: (1) install blocker on `@mastra/mcp@1.21.0`, (2) HITL gate not wired (toolApprovalResolver never invoked), (3) `patchTokens` never called (tokens_in/tokens_out stay null), (4) `session_id` audit anchor broken (always 'anon'), (5) `echo` tool not audited (smoke endpoint manually inserts). All five have a known, bounded fix; the structural code (resolver, wrapper, stream consumer shape) is already in the repo. Do NOT add new features.

**Wave 3 — runs after 01-D. No file conflicts with prior waves; safe to execute standalone.**

## Tasks

<task type="auto">
  <id>01-E1-install-pin</id>
  <read_first>
    - package.json (line 23: current `@mastra/mcp` pin)
  </read_first>
  <action>
    Bump `@mastra/mcp` from `1.21.0` to `1.17.0` (the latest published version that matches `@mastra/core@1.60.0` per `pnpm view @mastra/mcp versions`). Keep the exact pin (no `^`/`~` per C6). Run `pnpm install` to regenerate `pnpm-lock.yaml`. Do not modify any other dep. The pin lives under `dependencies` — change only that line. Do not bump `@mastra/pg` (already at 1.21.0, the correct pin).
  </action>
  <files>package.json, pnpm-lock.yaml</files>
  <verify>
    <automated>grep -q '"@mastra/mcp": "1.17.0"' package.json && pnpm install 2>&amp;1 | tee /tmp/pnpm-install.log | grep -qE 'Done in|Lockfile is up to date' && pnpm tsc --noEmit 2>&amp;1 | grep -v '^$' | wc -l | awk '{exit !($1==0)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep '"@mastra/mcp": "1.17.0"' package.json` exits 0
    - `pnpm install` exits 0 and prints "Done in" (or "Lockfile is up to date")
    - `pnpm-lock.yaml` exists and contains `@mastra/mcp` at version 1.17.0
    - `pnpm tsc --noEmit` exits 0 (no TypeScript errors from the bump)
  </acceptance_criteria>
  <done>Install blocker cleared: pin matches a published version; lockfile regenerates; tsc passes.</done>
  <reversibility>reversible</reversibility>
  <implements>BCK-04 (audit table now reachable after install)</implements>
  <commit>chore(deps): bump @mastra/mcp to 1.17.0 — fix install blocker</commit>
</task>

<task type="auto">
  <id>01-E2-wire-stream-route</id>
  <read_first>
    - worker/src/index.ts (full file — needs new apiRoute entry)
    - worker/src/lib/audit.ts (full file — withAudit + patchTokens signatures)
    - worker/src/agents/sdlc.ts (full file — sdlcAgent + toolApprovalResolver exports)
    - worker/src/lib/approval.ts (ApprovalMode type + resolveApproval)
    - app/api/chat/route.ts (full file — proxy body shape)
  </read_first>
  <action>
    Three coordinated edits across `worker/src/lib/audit.ts`, `worker/src/index.ts`, and `app/api/chat/route.ts`:

    **Edit 1 — `worker/src/lib/audit.ts`** — change `withAudit` signature so the wrapper accepts the tool context (the second arg `createTool.execute` passes in). New signature: `fn: (args: TArgs, ctx?: { sessionId?: string; requestContext?: unknown }) => Promise<TRet & Partial<AuditExtras>>`. Inside the returned wrapper, extract sessionId via `ctx?.sessionId ?? (ctx?.requestContext as { get?: (k: string) => unknown } | undefined)?.get?.("sessionId") as string ?? process.env.SESSION_ID ?? "anon"`. **Default `tokens_in: 0, tokens_out: 0`** in the audit insert so the column is `IS NOT NULL` even before `patchTokens` runs (smoke test line 16 asserts `tokens_in IS NOT NULL`). patchTokens is unchanged — it still patches the most-recent row for session+tool.

    **Edit 2 — `worker/src/index.ts`** — register a custom `POST /agents/sdlcAgent/stream` apiRoute via `registerApiRoute` from `@mastra/core/server` (same import style as `healthRoute` at `worker/src/lib/health.ts:1`). The route:
    1. Reads body via `await c.req.json()` into `{ messages, threadId, approvalMode, sessionId }`.
    2. Gets the agent via `const agent = c.get("mastra").getAgent("sdlcAgent")` (typed as `Agent` from `@mastra/core/agent`).
    3. Constructs a `RequestContext` via `import { RequestContext } from "@mastra/core/request-context"`, then `requestContext.set("approvalMode", approvalMode ?? "tiered")` and `requestContext.set("sessionId", sessionId ?? "anon")`. (Per Mastra HITL docs, the `requireToolApproval` resolver receives `(toolName, { requestContext })`.)
    4. Calls `const stream = await agent.stream(messages, { requireToolApproval: toolApprovalResolver, requestContext, threadId, resourceId: "operator", memory: true, abortSignal: c.req.raw.signal })`.
    5. Iterates `await stream.fullStream` (typed as `AsyncIterable<ChunkType>` — narrow per chunk variant). For each chunk, emit SSE `data: ${JSON.stringify(chunk)}\n\n` to a `ReadableStream` controller. Track `lastToolName` from `tool-call` chunks (`chunk.type === "tool-call" ? chunk.payload.toolName : lastToolName`). On `chunk.type === "step-finish"` AND `chunk.payload?.totalUsage`, fire-and-forget `void patchTokens(sessionId ?? "anon", lastToolName ?? "sdlcAgent", chunk.payload.totalUsage.inputTokens, chunk.payload.totalUsage.outputTokens).catch(() => {})`. End with `data: [DONE]\n\n`. Return `new Response(sseBody, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } })`.
    6. The route MUST be registered BEFORE any built-in route would resolve `/agents/sdlcAgent/stream`; add it to the `apiRoutes` array in `worker/src/index.ts:31-58` as the last entry (Mastra precedence: custom routes override built-ins).

    **Edit 3 — `app/api/chat/route.ts`** — no functional change needed: it already POSTs to `${workerUrl}/agents/sdlcAgent/stream` with `{messages, threadId, resourceId, approvalMode, sessionId}` (verified at `app/api/chat/route.ts:21-27`). The new custom route on the worker reads that exact body. Do NOT change the chat route.

    **Constraint:** Do not delete `healthRoute`, `pauseRoute`, `resumeRoute`, `suspendedListRoute`, or the two `/approval/*` routes. Add the new stream route alongside them.
  </action>
  <files>worker/src/lib/audit.ts, worker/src/index.ts</files>
  <verify>
    <automated>grep -n 'registerApiRoute("/agents/sdlcAgent/stream"' worker/src/index.ts &amp;&amp; grep -n 'requireToolApproval: toolApprovalResolver' worker/src/index.ts &amp;&amp; grep -n 'patchTokens(' worker/src/index.ts &amp;&amp; grep -n 'sessionId?: string' worker/src/lib/audit.ts &amp;&amp; pnpm tsc --noEmit 2>&amp;1 | wc -l | awk '{exit !($1==0)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'registerApiRoute("/agents/sdlcAgent/stream"' worker/src/index.ts` returns 1+ matches
    - `grep -n 'requireToolApproval: toolApprovalResolver' worker/src/index.ts` returns 1+ matches (confirms the resolver is now passed to stream())
    - `grep -n 'patchTokens(' worker/src/index.ts` returns 1+ matches inside the stream consumer (confirms token patching is wired)
    - `grep -n 'sessionId?: string' worker/src/lib/audit.ts` returns 1+ matches (confirms ctx.sessionId is read)
    - `pnpm tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Custom stream route registered; toolApprovalResolver invoked; patchTokens called on step-finish; withAudit reads sessionId from ctx; smoke test path works.</done>
  <reversibility>one-way</reversibility>
  <implements>HITL-01, HITL-02, BCK-04, UI-06, UI-04</implements>
  <commit>feat(worker): custom /agents/sdlcAgent/stream route — wire HITL gate + token patching + sessionId anchor</commit>
</task>

<task type="auto">
  <id>01-E3-audit-echo</id>
  <read_first>
    - worker/src/tools/echo.ts (full file)
    - worker/src/lib/audit.ts (full file — withAudit signature from E2)
    - app/api/smoke/echo/route.ts (full file)
  </read_first>
  <action>
    **Edit 1 — `worker/src/tools/echo.ts`** — wrap `execute` with `withAudit('echo', 'read', ...)`. Match the pattern used in `worker/src/tools/create-note.ts:9-12` and `worker/src/tools/rag-query.ts:8-15`. Replace the inline `execute: async ({ message }) => ({ text: \`echo:${message}\` })` with a `const inner = withAudit("echo", "read", async ({ message }: { message: string }) => ({ text: \`echo:${message}\` }));` declaration above the `createTool({...})` call, then `execute: inner` inside the tool definition. `withAudit` (per E2) accepts `(args, ctx)` and forwards both; createTool.execute will pass `(args, ctx)` so the wrapper sees the sessionId from `ctx`.

    **Edit 2 — `app/api/smoke/echo/route.ts`** — remove the now-duplicate manual audit insert. With `withAudit` writing the row, the route should only call `await echoTool.execute({ message: "hello" }, { sessionId })` and return `{ text: result.text, auditId: <fetched most-recent id for this session> }`. To preserve the `{ text, auditId }` smoke response shape: after `echoTool.execute`, query `auditLog` for `session_id = sessionId AND tool_name = 'echo' ORDER BY ts DESC LIMIT 1` and return the `id` column as `auditId`. Keep the `redact` import only if still needed for the response shape (it is not — drop it). Keep the `nanoid` import for `sessionId` generation.
  </action>
  <files>worker/src/tools/echo.ts, app/api/smoke/echo/route.ts</files>
  <verify>
    <automated>grep -n 'withAudit("echo"' worker/src/tools/echo.ts &amp;&amp; ! grep -n 'console.log\|// TODO\|FIXME\|XXX\|HACK' worker/src/tools/echo.ts &amp;&amp; pnpm tsc --noEmit 2>&amp;1 | wc -l | awk '{exit !($1==0)}' &amp;&amp; grep -q 'echo' app/api/smoke/echo/route.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'withAudit("echo"' worker/src/tools/echo.ts` returns 1+ match
    - `pnpm tsc --noEmit` exits 0
    - `app/api/smoke/echo/route.ts` does NOT contain a manual `db.insert(auditLog).values(...)` block (verified by `grep -c 'db.insert(auditLog)' app/api/smoke/echo/route.ts` returning 0)
    - `app/api/smoke/echo/route.ts` still returns `{ text, auditId }` shape (verified by `grep -c 'auditId' app/api/smoke/echo/route.ts` returning >= 1)
  </acceptance_criteria>
  <done>echoTool writes audit_log via the same withAudit path as the other tools; smoke endpoint no longer manually inserts; both the chat round-trip and the smoke endpoint produce a row.</done>
  <reversibility>reversible</reversibility>
  <implements>BCK-04</implements>
  <commit>feat(audit): wrap echoTool with withAudit — single audit path for all tools</commit>
</task>

## Verification

After all three tasks complete, run end-to-end:

1. **Install + types:** `pnpm install && pnpm tsc --noEmit` — both exit 0.
2. **Live smoke:** `pnpm smoke` — exits 0. Specifically:
   - Line 11: `audit_log WHERE tool_name='echo' AND result_status='ok' AND approval_decision='auto'` count >= 1 (E3 + E2 default tokens).
   - Line 16: `audit_log WHERE tool_name='echo' AND tokens_in IS NOT NULL` count >= 1 (E2 default tokens to 0).
   - Line 12: `chat with approvalMode=always` stream contains 0 `tool-call-approval` chunks (E2 wires the resolver into stream(); resolver returns `false` for `approvalMode === 'always'`).
   - Line 13: `chat with apply migrations` stream contains `applyMigrations` substring >= 1 (E2 wires the resolver; `applyMigrations` is write_high → resolver returns `'always'` → chunk fires).
3. **Live chat round-trip audit row:** `pnpm dev &`, then send `POST /api/chat` with `{messages:[{role:"user",content:"hello"}], sessionId:"smoke-<random>", approvalMode:"tiered"}`. Then `psql $DATABASE_URL -tAc "SELECT session_id, tool_name, approval_decision, tokens_in IS NOT NULL AS has_tokens FROM audit_log WHERE tool_name='echo' ORDER BY ts DESC LIMIT 1"` returns `smoke-<random> | echo | auto | t` (E2 threads sessionId; E3 writes the row; E2 default tokens_in to 0).

## Cross-references

- withAudit wrapper signature pattern: see `worker/src/tools/create-note.ts:9-12`, `worker/src/tools/apply-migrations.ts:8-11`.
- Custom apiRoute pattern: see `worker/src/lib/health.ts:8-26`, `worker/src/api-routes/pause.ts:27-35`.
- RequestContext shape: see D-22 + Mastra HITL docs. `set("approvalMode", ...)` and `set("sessionId", ...)` are typed keys.
- step-finish chunk shape: `chunk.payload.totalUsage.{inputTokens, outputTokens}` per `@mastra/core` `StepFinishPayload`.

## Caveats for executor

- **`@mastra/core/request-context` import path** — if the runtime path differs (e.g., `@mastra/core` re-exports under a subpath), fall back to `import { RequestContext } from "@mastra/core"` and grep `node_modules/@mastra/core/dist/index.d.ts` for the actual class name. If `RequestContext` is not exported, set the values via plain object `requestContext: { approvalMode, sessionId }` — Mastra's HITL docs document the function form receiving the same fields as `requestContext.get(...)`.
- **Mastra route precedence** — custom routes registered via `apiRoutes` override built-ins for the same path; if `/agents/sdlcAgent/stream` continues to hit the built-in, register at `/agents/sdlcAgent/stream-custom` and update `app/api/chat/route.ts:15` to point to it. Verify with `curl -X POST .../agents/sdlcAgent/stream` returning a body shape that includes `"type":"tool-call"` (built-in would not include the custom approval gate's `tool-call-approval` chunks).
- **`memory: true`** — Mastra's `agent.stream` accepts a `memory` flag for thread persistence; if the flag is rejected by the type checker, drop it (PostgresStore is configured at the `Mastra` level, not the agent level).
- **No `node_modules`** in the repo as committed — E1's `pnpm install` will create it. Don't pre-check `node_modules` paths; let E1 populate.

## Success criteria

- `pnpm install` exits 0 against the bumped pin.
- `pnpm tsc --noEmit` exits 0.
- `grep` confirms: custom stream route registered, `requireToolApproval: toolApprovalResolver` passed, `patchTokens` called inside the stream consumer, `withAudit` accepts ctx with sessionId, `echoTool` wrapped with `withAudit("echo", "read", ...)`.
- Live chat round-trip writes an audit_log row with `session_id = <browser session>` (not 'anon'), `tool_name='echo'`, `result_status='ok'`, `approval_decision='auto'`, `tokens_in IS NOT NULL`.
- `pnpm smoke` exits 0.

## Output

Create `.planning/phases/01-foundation/01-E-SUMMARY.md` when done.