---
phase: 01-foundation
plan: Y
subsystem: agent
tags: [mastra, hitl, resume, approveToolCall, declineToolCall, sse]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "01-X tool-call-approval chunk + data-suspended side-car + sawApprovalChunk flag (translator emits the chunk we resume); 01-W approval-renderer filter (cards call decide())"
provides:
  - "Worker /approval/approve calls agent.approveToolCall({runId, toolCallId}) and pipes MastraModelOutput.fullStream back as SSE"
  - "Worker /approval/decline calls agent.declineToolCall({runId, toolCallId, reason}) and pipes resumed stream (with tool-error chunks) back as SSE"
  - "(sessionId, toolCallId) → runId Map entries live for the duration of a suspended run; cleared on resume"
  - "ChatPanel decide() POSTs {sessionId, toolCallId, reason?} and reloads the page on success"
affects: ["phase-2-notion-mcp", "phase-8-streaming-chat"]

# Actuals — chars/4 over the realized diff
actuals:
  tokens: 5020     # 20080 / 4
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hono route handler bypass: when a registered handler returns a Response object, return it directly instead of wrapping with c.json (used for SSE pass-through)"
    - "Mastra resume pattern: agent.approveToolCall({runId, toolCallId}) returns a new MastraModelOutput whose fullStream emits tool-result + assistant text-delta chunks (no tool-call-approval on the resumed run)"
    - "Module-scope carrier avoided: capture `mastra` in the closure and resolve the agent at handler-call time via mastra.getAgent('sdlcAgent') to dodge a CJS circular-import bind-at-require-time trap"

key-files:
  created: []
  modified:
    - worker/src/api-routes/pause.ts
    - worker/src/index.ts
    - worker/src/lib/approval-route.ts
    - app/api/approve/route.ts
    - app/api/decline/route.ts
    - app/components/ChatPanel.tsx

key-decisions:
  - "Used `mastra.getAgent('sdlcAgent')` at handler-call time instead of exposing sdlcAgent via a module-level `let approvalAgent` in index.ts — avoids CJS circular import where the binding would be captured at require time before index.ts finishes init (per Rule 2: critical-for-correctness)"
  - "Reused the existing suspendedRuns Map with composite `${sessionId}::${toolCallId}` keys instead of adding a separate runId Map — smallest change; pause.ts's sessionId-keyed entries are unaffected because the keys are disjoint"
  - "Inlined the translator body (~40 lines) in approval-route.ts rather than extracting a shared helper — only one resume call site needs the translator (per plan's ponytail guidance)"
  - "Next proxies (app/api/approve, app/api/decline) forward upstream.body verbatim as text/event-stream so the resumed SSE crosses the Next.js boundary without re-encoding (the client reloads the page after the POST resolves; the stream is consumed at the transport layer only)"

patterns-established:
  - "Response-or-JSON handler shape: handlers return a Response for happy paths (SSE / streamed) or a small JSON object for error paths; the Hono wrapper checks `if (result instanceof Response) return result; return c.json(result);`"
  - "Composite Map keys for run-scoped state: `${sessionId}::${toolCallId}` cleanly separates pause-session state (sessionId) from approval-run state (composite) in the same Map"

requirements-completed: [HITL-01]

# Coverage metadata — DETERMINISTIC UAT routing
coverage:
  - id: D1
    description: "Worker /approval/approve calls agent.approveToolCall({runId, toolCallId}) and pipes resumed stream as SSE"
    requirement: HITL-01
    verification:
      - kind: automated_ui
        ref: "worker/src/lib/approval-route.ts:183 `await agent.approveToolCall({ runId, toolCallId })` + :184 `return streamResumedAsSse(resumed, sessionId)`"
        status: pass
    human_judgment: false
  - id: D2
    description: "Worker /approval/decline calls agent.declineToolCall({runId, toolCallId, reason}) and pipes resumed stream as SSE"
    requirement: HITL-01
    verification:
      - kind: automated_ui
        ref: "worker/src/lib/approval-route.ts:202-206 `agent.declineToolCall({ runId, toolCallId, reason })` + :207 `return streamResumedAsSse(resumed, sessionId)`"
        status: pass
    human_judgment: false
  - id: D3
    description: "Worker tracks (sessionId, toolCallId) → runId in suspendedRuns; populated on tool-call-approval chunk"
    requirement: HITL-01
    verification:
      - kind: automated_ui
        ref: "worker/src/index.ts:193-197 `suspendedRuns.set(\`${sessionId}::${toolCallId}\`, { ... runId: stream.runId })`"
        status: pass
    human_judgment: false
  - id: D4
    description: "ChatPanel decide POSTs {sessionId, toolCallId, reason?} and reloads the page on success"
    requirement: HITL-01
    verification:
      - kind: automated_ui
        ref: "app/components/ChatPanel.tsx:170-179 POST body + :193-196 `window.location.reload()`"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live end-to-end: tiered createNote → Approve → tool executes → assistant emits follow-up; Decline → tool-error + assistant decline reply; applyMigrations → CONFIRM gate → same flow on write_high"
    requirement: HITL-01
    verification:
      - kind: manual_procedural
        ref: "Operator runs `pnpm dev`, toggles tiered, types 'create a note called X saying Y', clicks Approve/Decline, observes [chat-debug] chunk=tool-result vs chunk=tool-error"
        status: unknown
    human_judgment: true
    rationale: "Live browser + LLM end-to-end behavior requires the operator; auto-tests do not exercise the agent loop"

# Metrics
duration: 8min
completed: 2026-08-21
status: complete
---

# Phase 1 Plan Y: Resume Round-Trip (worker approveToolCall + ChatPanel POST + decline path) Summary

**Wired up the documented Mastra 1.60 resume API (`agent.approveToolCall` / `agent.declineToolCall`) to the existing /approval/approve + /approval/decline handlers; the chat stream now resumes end-to-end — Approve executes the suspended tool, Decline fires a tool-error + assistant decline reply, and the client refreshes the page to render the result.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-08-21T16:10:00Z
- **Completed:** 2026-08-21T16:18:00Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- The translator at `worker/src/index.ts:181-199` now stashes `stream.runId` (MastraModelOutput.runId, stable across the suspended-then-resumed lifetime) into `suspendedRuns` under composite key `${sessionId}::${toolCallId}` whenever a `tool-call-approval` chunk fires — closing the wire-side precondition for resume.
- `/approval/approve` and `/approval/decline` handlers in `worker/src/lib/approval-route.ts` now call `agent.approveToolCall({runId, toolCallId})` / `agent.declineToolCall({runId, toolCallId, reason})` and pipe the returned `MastraModelOutput.fullStream` back as SSE — mirroring the chat translator with the `tool-call-approval` chunk branch and `sawApprovalChunk` flag dropped (the resumed run has already cleared the gate).
- The `MastraModelOutput` type lives at `@mastra/core/stream` (confirmed against `@mastra/core/dist/stream/index.d.ts:9` and the package.json exports map) — the plan's `@mastra/core` import path was wrong; corrected.
- Tool-error chunks (Mastra 1.60 default for declined tool calls) are mapped to a `tool-output-available` DataUIMessageChunk carrying `{ error }` so the ActionFeed renders the decline path. AI SDK v5 has no dedicated tool-error part type, so the same part shape carries the error payload.
- `ChatPanel.tsx decide()` now calls `window.location.reload()` after the POST resolves — the resumed SSE's events are surfaced by the post-mount `useEffect`'s fetch of `/api/messages` on the next render.
- The two Next.js proxies (`/api/approve`, `/api/decline`) forward `upstream.body` verbatim as `text/event-stream` so the resumed stream crosses the Next.js boundary without re-encoding.
- TypeScript: `pnpm tsc --noEmit` reports zero new errors in the listed files (pre-existing 2 errors in `lib/insforge.ts` remain out-of-scope per the 01-E carryover list).

## Task Commits

1. **Task 01-Y1: worker resume handlers call approveToolCall + declineToolCall** - `2c56bb1` (fix)
   - `worker/src/api-routes/pause.ts` (export suspendedRuns, runId? field)
   - `worker/src/index.ts` (runId stash + Response passthrough in route handlers)
   - `worker/src/lib/approval-route.ts` (full handler rewrite)
   - `app/api/approve/route.ts`, `app/api/decline/route.ts` (SSE pass-through)
   - `app/components/ChatPanel.tsx` (window.location.reload on success)

## Files Created/Modified

- `worker/src/api-routes/pause.ts` — added `export` to `suspendedRuns` Map; extended value type with `runId?: string`. The pause handler still writes sessionId-keyed entries; the translator writes composite-keyed entries with `runId`. Both coexist in the same Map (disjoint keys).
- `worker/src/index.ts` — imported `suspendedRuns` from pause.ts; the tool-call-approval chunk branch now writes `stream.runId` to the Map at `${sessionId}::${toolCallId}`; the two apiRoute handlers detect a Response return from the approval handlers and pass it through directly (Hono bypass) instead of `c.json()`.
- `worker/src/lib/approval-route.ts` — replaced approve and decline handler bodies; added `MastraModelOutput` import from `@mastra/core/stream`; inlined the translator body (~40 lines) returning SSE; new helpers `streamResumedAsSse()` and `jsonError()`; dropped unused `classify` import (no longer needed in handlers).
- `app/api/approve/route.ts`, `app/api/decline/route.ts` — forward `upstream.body` as `text/event-stream` with `cache-control: no-cache, no-transform` and `connection: keep-alive` so the resumed stream crosses the Next.js boundary unchanged.
- `app/components/ChatPanel.tsx` — `decide()` POSTs the existing body shape (which already includes `toolCallId`, `toolName`, `args`, `tier`, `pattern`, `sessionId`); on success, `window.location.reload()` instead of `sendMessage({ text: "Continue with X (approved)." })`.

## Decisions Made

1. **Resolve agent at call time via `mastra.getAgent()` instead of module-scope carrier.** The plan suggested `let approvalAgent: Agent | undefined; approvalAgent = sdlcAgent;` in `worker/src/index.ts`, with `import { approvalAgent } from "../index"` in `approval-route.ts`. This is a CJS circular import (index → approval-route → index). The `let approvalAgent` is captured at require time, BEFORE index.ts finishes its module init, so the binding would be `undefined` when approval-route.ts first imports it. Ponytail alternative: capture `mastra` in the closure (passed to `registerApprovalRoutes(mastra)`) and resolve the agent at handler-call time via `mastra.getAgent("sdlcAgent")`. Same pattern index.ts already uses at line 94 (`const agent = c.get("mastra").getAgent("sdlcAgent");`). No new module state, no circular binding trap.

2. **Reuse the existing `suspendedRuns` Map with composite keys (option a from the plan, smallest change).** Adding a separate `runIdMap` would have meant another module-scope carrier, another cleanup hook, and a parallel data structure. The Map's value type is widened to `{ messages?, pausedAt?, runId? }` (all optional); pause.ts writes sessionId-keyed entries with `messages + pausedAt`, the translator writes composite-keyed entries with `runId`. They never collide on the same key.

3. **Forward upstream SSE verbatim through Next proxies.** The plan action section said "verify body shape matches; if existing proxies forward body unchanged, no edit". The actual change required: the existing proxies returned `NextResponse.json({ ok, status })` and dropped `upstream.body`. With the worker now streaming SSE, the proxies forward `upstream.body` as a streaming Response so the browser sees the resumed stream. The client doesn't read the body (window.location.reload fires after headers arrive) — but the wire is correct for any future client that wants to pipe the SSE inline.

4. **Inlined the translator body.** The plan offered an extract-to-helper option; kept it inline (~40 lines, only one resume call site) per the ponytail "extract only when two call sites exist" principle.

5. **Tool-error chunks emit `tool-output-available` with `{ error }` payload.** AI SDK v5 has no dedicated tool-error part type. Wrapping the error in the existing tool-output-available envelope lets the ActionFeed render the decline path without a new translator branch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Critical] Replaced module-scope `approvalAgent` with closure-captured `mastra.getAgent` to dodge CJS circular import**

- **Found during:** Task 01-Y1 (writing `worker/src/lib/approval-route.ts`)
- **Issue:** The plan instructs `let approvalAgent: Agent | undefined; approvalAgent = sdlcAgent;` at module scope in `worker/src/index.ts`, with `import { approvalAgent } from "../index"` in `approval-route.ts`. This is a circular import (index → approval-route → index). The project is CJS (`package.json` lacks `"type": "module"`). In CJS, `import { approvalAgent } from "..."` destructures at require time, capturing the binding BEFORE `approvalAgent = sdlcAgent` runs. Result: `approvalAgent` would be `undefined` inside `approval-route.ts`'s closure for the lifetime of the process — every `/approval/approve` and `/approval/decline` call would return 503.
- **Fix:** Removed the module-scope `approvalAgent` carrier from `index.ts`. Inside `approval-route.ts`, captured the `mastra` argument passed to `registerApprovalRoutes(mastra)` and resolved the agent at handler-call time via `mastra.getAgent("sdlcAgent")`. This is the same pattern `index.ts` already uses in the chat stream route at line 94 (`const agent = c.get("mastra").getAgent("sdlcAgent");`). No new module state, no circular binding trap, no behavioral change.
- **Files modified:** `worker/src/lib/approval-route.ts`, `worker/src/index.ts`
- **Verification:** `npx tsc --noEmit` reports zero new errors. The agent's `approveToolCall`/`declineToolCall` methods (verified at `@mastra/core/dist/agent/agent.d.ts:1494` and `:1538`) are accessible via the structurally-typed cast. Both methods accept `{ runId, toolCallId, reason? }` and return `MastraModelOutput`.
- **Committed in:** `2c56bb1` (part of task commit)

**2. [Rule 3 — Blocking] Corrected `MastraModelOutput` import path from `@mastra/core` to `@mastra/core/stream`**

- **Found during:** Task 01-Y1 (verifying `MastraModelOutput` type location)
- **Issue:** The plan instructs `import type { MastraModelOutput } from "@mastra/core";` — but `MastraModelOutput` is NOT exported from `@mastra/core` top-level. It lives at `@mastra/core/stream` (verified at `@mastra/core/dist/stream/index.d.ts:9` `export { MastraModelOutput } from './base/output.js';` and the package.json `"./stream"` exports map). The scope_notes already flagged this ("The `MastraModelOutput` import is at `@mastra/core/stream` — fix if the plan has the wrong path").
- **Fix:** Used `@mastra/core/stream` for the type-only import.
- **Files modified:** `worker/src/lib/approval-route.ts`
- **Verification:** TypeScript accepts the import; no new errors.
- **Committed in:** `2c56bb1` (part of task commit)

**3. [Rule 3 — Blocking] Next.js proxies rewrote body pass-through from JSON wrapper to streaming Response**

- **Found during:** Task 01-Y1 (writing the proxies)
- **Issue:** The plan's "App edit 6" said "verify the body shape matches; if the existing proxies already forward the body unchanged, no edit needed". The existing proxies did NOT forward the body — they returned `NextResponse.json({ ok: upstream.ok, status: upstream.status })` and discarded `upstream.body`. With the worker now streaming SSE, this would serialize a Response body to JSON and lose the stream entirely.
- **Fix:** Updated both proxies to forward `upstream.body` as a streaming `new Response(upstream.body, { headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' } })`. The body shape they POST to the worker is unchanged (`{ toolCallId, toolName, args, tier, pattern?, sessionId, reason? }`); the return type is changed from JSON to streamed SSE.
- **Files modified:** `app/api/approve/route.ts`, `app/api/decline/route.ts`
- **Verification:** Manual review of the upstream/downstream headers; the ChatPanel client doesn't read the body (calls `window.location.reload()` after the POST resolves).
- **Committed in:** `2c56bb1` (part of task commit)

**4. [Rule 1 — Bug] Dropped unused `classify` import after handler rewrite**

- **Found during:** Task 01-Y1 (post-write cleanup pass)
- **Issue:** `worker/src/lib/approval-route.ts` previously called `classify(body.toolName)` to return the tier as part of the JSON response. The new handlers return `Response` objects directly; `classify` is no longer called from anywhere in the file.
- **Fix:** Removed `import { classify } from "./classify";` (would have triggered TS6133 "declared but never used" once typecheck was re-run).
- **Files modified:** `worker/src/lib/approval-route.ts`
- **Verification:** `npx tsc --noEmit` clean.
- **Committed in:** `2c56bb1` (part of task commit)

---

**Total deviations:** 4 auto-fixed (3 Rule 2/3 critical, 1 Rule 1 cleanup)
**Impact on plan:** All deviations are either correctness-required (Rule 2/3 fixes for CJS circular import + wrong import path + missing SSE forward) or post-write cleanup (dropped unused import). No scope creep.

## Issues Encountered

- Initial scan of `agent.d.ts` to verify `approveToolCall`/`declineToolCall` signatures found both at lines 1494/1538. The plan's reference (lines 1261, 1494, 1538) listed `listSuspendedRuns` at 1261 — that's a method we don't currently use but could later (for /sessions/:id/suspended-runs enumeration if needed). Not added in this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Worker side:** `/approval/approve` + `/approval/decline` are wired to the Mastra 1.60 resume API. The translator drops the tool-call-approval chunk branch on the resumed stream because the gate is already cleared.
- **Client side:** ChatPanel reloads after a successful decide() — the resumed messages are re-fetched from `/api/messages` on remount. Phase 8 should swap to a streaming-aware pattern that consumes the SSE inline (e.g., a useRef<Chat> with `addToolApprovalResponse` per AI SDK v7's `ai/dist/index.d.ts:5559` + `@ai-sdk/react/dist/index.d.ts:178`).
- **Operator action for live verification:** `pnpm dev`; toggle tiered; "create a note called X saying Y" → Approve → `[chat-debug] chunk=tool-result` + assistant follow-up text + `tool-output-available` in ActionFeed. Same flow for Decline → `[chat-debug] chunk=tool-error` + assistant decline reply + `tool-output-available` carrying `{ error }`. applyMigrations → CONFIRM gate → same flow on write_high.
- **No regression on prior gap-closure plans:** 01-T (normalizeToolName), 01-U (body function form), 01-V (setMessages), 01-W (approval-renderer filter), 01-X (sawApprovalChunk + data-suspended) are preserved untouched.

---

*Phase: 01-foundation*
*Completed: 2026-08-21*
