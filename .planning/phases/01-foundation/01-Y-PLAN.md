---
phase: 1
plan: Y
type: execute
wave: 4
gap_closure: true
gap_ids: [G-1-15]
depends_on: ["01-X"]
files_modified:
  - worker/src/lib/approval-route.ts
  - worker/src/api-routes/pause.ts
  - worker/src/index.ts
  - app/api/approve/route.ts
  - app/api/decline/route.ts
  - app/components/ChatPanel.tsx
autonomous: true
must_haves:
  - "Worker `/approval/approve` handler calls `agent.approveToolCall({ runId, toolCallId })` and pipes the resumed `MastraModelOutput.fullStream` chunks back to the client as SSE"
  - "Worker `/approval/decline` handler calls `agent.declineToolCall({ runId, toolCallId, reason: 'user-declined' })` and pipes the resumed stream (which fires tool-error chunks) back as SSE"
  - "Worker tracks `(sessionId, toolCallId) → runId` in a suspendedRuns Map so the resume handler can find the right runId; populated when the translator fires the `tool-call-approval` chunk"
  - "Worker exposes `agent` (or an approval-resolver bound to it) via a module-level reference so the route handler can call `approveToolCall`/`declineToolCall`"
  - "ChatPanel's `decide('approve', ...)` POSTs `{ sessionId, toolCallId }` to `/api/approve`; the Next proxy forwards to worker `/approval/approve`; on stream end ChatPanel calls `sendMessage` is NOT needed because the resumed stream emits its own assistant text + tool-result chunks"
  - "ChatPanel's `decide('decline', ...)` POSTs `{ sessionId, toolCallId, reason }` to `/api/decline`"
  - "`pnpm tsc --noEmit` introduces no new errors in the listed files"
  - "Live: in tiered mode trigger createNote → card appears → click Approve → tool runs → assistant emits follow-up text → action-feed shows `tool-output-available`; click Decline → assistant emits 'I cannot proceed with that action' style reply, no `tool-output-available` chunk"
requirements:
  - HITL-01
---

# 01-Y — Phase 1 Gap Closure (resume round-trip: worker approveToolCall + ChatPanel POST + decline path)

Closes G-1-15 parts B+C+D: the wire is now self-documenting (plan 01-X emits `data-suspended`), but the resume half is still broken. Today `worker/src/lib/approval-route.ts:44-69` reads `{ sessionId, toolCallId }` from the request body and... does nothing with the agent. The handler returns a 200 with no SSE — the tool never executes, the user sees no follow-up text. ChatPanel.tsx:121-126 (`onApprove={() => decide("approve", approvalPart)}`) does POST to `/api/approve`, but the server side ignores the agent.

The fix: worker exposes `agent` via a module-level reference set at startup (worker/src/index.ts), the `tool-call-approval` translator branch stashes `runId` from `stream.runId` (MastraModelOutput.runId at output.d.ts:88) into a `(sessionId, toolCallId) → runId` Map (re-using the `suspendedRuns` Map already declared at worker/src/api-routes/pause.ts:18), and the `/approval/approve` handler calls `agent.approveToolCall({ runId, toolCallId })` and pipes the returned `MastraModelOutput.fullStream` back to the client as SSE (mirror of the /chat route's start(controller) closure). The /approval/decline handler does the same with `agent.declineToolCall({ runId, toolCallId, reason })`.

Three coordinated files in worker, two in app, one shared Map. The plan is mechanical — wire up the documented API surface (`approveToolCall`/`declineToolCall` at agent.d.ts:1494/1538) to the existing approval-route handlers.

## Tasks

<task type="auto">
  <id>01-Y1-worker-resume-handlers-call-approveToolCall-declineToolCall</id>
  <read_first>
    - worker/src/lib/approval-route.ts (lines 44-69 — current /approval/approve + /approval/decline handlers; the gap is they return 200 with no SSE; they don't reach into the agent)
    - worker/src/api-routes/pause.ts (lines 18-... — `suspendedRuns` Map declared at module scope; this is the right place to stash (sessionId, toolCallId) → runId)
    - worker/src/index.ts (lines 60-95 — agent construction; module-level `let sdlcAgent: Agent | undefined` not yet declared; need to add it so approval-route.ts can call `approveToolCall`)
    - node_modules/.pnpm/@mastra+core@1.60.0_ai@7.0._6f6d82524998c05318c2ce4d97d92913/node_modules/@mastra/core/dist/agent/agent.d.ts (lines 1494, 1538, 1261 — `approveToolCall({ runId, toolCallId? })`, `declineToolCall({ runId, toolCallId?, reason? })`, `listSuspendedRuns({ threadId?, resourceId? })`)
    - node_modules/.pnpm/@mastra+core@1.60.0_ai@7.0._6f6d82524998c05318c2ce4d97d92913/node_modules/@mastra/core/dist/stream/base/output.d.ts (line 88 — `MastraModelOutput.runId: string`)
    - app/api/approve/route.ts (current Next proxy — POST to worker)
    - app/api/decline/route.ts (current Next proxy — POST to worker)
    - .planning/debug/g-1-15-mastra-gate-bypass.md (full root-cause trace — fix recommendation)
  </read_first>
  <action>
    Six coordinated edits across four worker files and two app files. All surgical.

    **Worker edit 1 — Expose the agent at module scope** (`worker/src/index.ts:60-95`).

    Find the `const agent = new Agent({...})` or `const sdlcAgent = new Agent({...})` line (whatever the local name is) and add a module-level `let` reference immediately before it:

    ```
    // 01-Y — module-level reference so worker/src/lib/approval-route.ts can call
    // agent.approveToolCall({runId, toolCallId}) and agent.declineToolCall({...}).
    // set on construction; never reassigned.
    let _approvalAgent: typeof sdlcAgent | undefined;
    _approvalAgent = sdlcAgent;
    ```

    Replace `typeof sdlcAgent` with the actual local name (e.g. `typeof agent` if the file uses `agent`). Ponytail: the typeof import is unnecessary; just write:

    ```
    // 01-Y — module-level reference so worker/src/lib/approval-route.ts can call
    // agent.approveToolCall({runId, toolCallId}) and agent.declineToolCall({...}).
    let approvalAgent: Agent | undefined;
    ```

    then after the `const agent = new Agent({...})` (or equivalent) line, add:

    ```
    approvalAgent = agent;
    ```

    This is the same pattern `requestContext` already uses in the file (the carrier variables `requestContext`, `currentSessionId`, etc. are module-scope). approval-route.ts imports the symbol.

    **Worker edit 2 — Stash runId in suspendedRuns on `tool-call-approval`** (`worker/src/index.ts:165-170`, the translator branch).

    Inside the `else if (chunk.type === "tool-call-approval")` block from 01-X, AFTER the `sawApprovalChunk = true` line, add:

    ```
    // 01-Y — stash (sessionId, toolCallId) → runId so /approval/approve can call
    // agent.approveToolCall({runId, toolCallId}) to resume the suspended run.
    // MastraModelOutput.runId is stable across the suspended-then-resumed lifetime.
    if (stream.runId) {
      const m = requireSuspendedRuns();
      m.set(`${sessionId}::${toolCallId}`, stream.runId);
    }
    ```

    Ponytail: `requireSuspendedRuns()` is a tiny helper in `worker/src/api-routes/pause.ts` (see edit 3 below) that lazy-inits the Map so we don't have to import it at module-init time (which would create a circular import: pause.ts imports from index.ts; we want approval-route.ts to also import from pause.ts without the reverse). Or, simpler: just `import { suspendedRuns } from "./api-routes/pause";` at the top of index.ts — there is no circular if pause.ts doesn't import from index.ts. Check pause.ts:18-... first; if pause.ts already imports from index.ts, use the require pattern instead.

    **Worker edit 3 — Export the suspendedRuns Map** (`worker/src/api-routes/pause.ts`).

    Current (approximate, read the file to find the exact lines):

    ```
    const suspendedRuns: Map<string, { messages: UIMessage[]; suspendedAt: number }> = new Map();
    ```

    Add `export` before the declaration so worker/src/index.ts and worker/src/lib/approval-route.ts can import it:

    ```
    export const suspendedRuns: Map<string, { messages: UIMessage[]; suspendedAt: number }> = new Map();
    ```

    Also extend the value type to include `runId`. New shape:

    ```
    export const suspendedRuns: Map<string, { messages: UIMessage[]; suspendedAt: number; runId?: string }> = new Map();
    ```

    (The key shape doesn't need to change — we use a composite `${sessionId}::${toolCallId}` string OR a `(sessionId, toolCallId)` pair. Ponytail: use a composite string key for the simplest lookup — `Map<string, ...>` with key `${sessionId}::${toolCallId}`.)

    **Worker edit 4 — Resume handlers call `approveToolCall`/`declineToolCall`** (`worker/src/lib/approval-route.ts:44-69`).

    NOTE — file indirection: on disk, `approval-route.ts` does NOT define the `/approval/approve` handler directly. It exports `registerApprovalRoutes(mastra)` which stashes `{ approve, decline }` handlers on `mastra.__approval`, and `getApprovalHandlers(mastra)` which retrieves them. The actual `/approval/approve` route is mounted in `worker/src/index.ts:58-75` via `registerApiRoute` and calls `getApprovalHandlers(mastra).approve(body)`, returning JSON `c.json({ ok, tier })` — NOT SSE. The wire format is JSON today; this plan upgrades the JSON `approve`/`decline` body to also stash `runId` from the approval chunk and to call `agent.approveToolCall`/`declineToolCall`. The "pipe resumed stream back as SSE" goal is deferred to Phase 2 — for Phase 1 the response stays JSON, with `window.location.reload()` on the client refreshing the chat.

    Replace the `/approval/approve` handler body with one that calls `agent.approveToolCall`. The handler returns JSON `{ok, tier}` (matching today's wire); the client refreshes the page to pick up the resumed run's new messages. The translator logic does NOT need the `sawApprovalChunk` flag from 01-X — the resumed stream does not contain another `tool-call-approval` chunk (the user already approved it); it contains `tool-result`, `text-delta`, `step-finish`, and `finish`. So reuse the inner for-await loop from index.ts:127-208 verbatim and drop the approval chunk branch.

    Concrete structure (pseudo-code; fill in with the actual translator lines):

    ```
    async function handleApprove(req: Request): Promise<Response> {
      const body = (await req.json()) as { sessionId?: string; toolCallId?: string };
      const sessionId = body.sessionId ?? "anon";
      const toolCallId = body.toolCallId ?? "";
      const key = `${sessionId}::${toolCallId}`;
      const runId = suspendedRuns.get(key)?.runId;
      if (!runId) {
        return new Response(JSON.stringify({ error: "no-suspended-run", sessionId, toolCallId }), { status: 404, headers: { "content-type": "application/json" } });
      }
      const agent = approvalAgent; // module-level reference from index.ts
      if (!agent) {
        return new Response(JSON.stringify({ error: "agent-not-ready" }), { status: 503, headers: { "content-type": "application/json" } });
      }
      const resumed: MastraModelOutput = await agent.approveToolCall({ runId, toolCallId });
      // ponytail: clear the Map entry; the run is no longer suspended.
      suspendedRuns.delete(key);
      const encoder = new TextEncoder();
      const sse = new ReadableStream<Uint8Array>({
        async start(controller) {
          // emit `start` chunk
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "start", messageId: crypto.randomUUID(), messageMetadata: { modelId: "opencode-go/hy3" } })}\n\n`));
          for await (const chunk of resumed.fullStream) {
            // reuse the translator from index.ts — emit text-delta, tool-result, step-finish, finish
            // (no tool-call-approval branch — gate already cleared)
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    ```

    Same shape for `/approval/decline` — call `agent.declineToolCall({ runId, toolCallId, reason: "user-declined" })` instead of `approveToolCall`. The resumed stream emits `tool-error` chunks (Mastra 1.60 default for declined tool calls) plus the assistant's follow-up text (the model receives the decline and explains to the user).

    Ponytail extraction (one-time, at the top of approval-route.ts):

    ```
    // 01-Y — extract the translator body from worker/src/index.ts so the resume
    // SSE mirrors the chat SSE without duplication. Either inline the loop here
    // OR import a `translateStreamForSSE(stream: MastraModelOutput, opts: { suspended?: boolean }): Promise<ReadableStream<Uint8Array>>` helper from worker/src/index.ts.
    ```

    Recommended ponytail: inline the translator body here (don't extract). The body is ~40 lines and is only used in two places. Extracting saves ~40 lines but adds a new exported function + a new abstraction the operator has to chase to debug. Inline; keep the diff to "wire up the documented API to the existing handlers".

    Imports to add at the top of approval-route.ts:

    ```
    import { suspendedRuns } from "../api-routes/pause";
    import { approvalAgent } from "../index";
    import type { MastraModelOutput } from "@mastra/core";
    ```

    **App edit 5 — POST `{ sessionId, toolCallId }` from ChatPanel** (`app/components/ChatPanel.tsx`).

    Update the `decide()` function (lines 156-186) to POST the right body shape. Current (approximate):

    ```
    const decide = async (action: "approve" | "decline", part: ToolApprovalPart) => {
      const path = action === "approve" ? "/api/approve" : "/api/decline";
      await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, toolCallId: part.toolCallId }),
      });
    };
    ```

    The existing call sites `decide("approve", approvalPart)` and `decide("decline", approvalPart)` already pass `part.toolCallId` — but the `decide` body must (1) pipe the SSE response back into the chat (use the existing useChat transport, NOT a separate fetch+decode), OR (2) trigger a `sendMessage` after the fetch resolves to ask the agent to continue.

    Ponytail choice: the worker's resumed stream emits `tool-result` + assistant `text-delta` chunks. The AI SDK useChat on the client expects a SINGLE ongoing stream per turn. We cannot easily pipe a second stream through the same useChat. The cleanest ponytail pattern: after POST returns 200 (resume completed server-side), call `sendMessage({ text: "Approved. Continue." })` (or skip the sendMessage entirely if the resumed stream already emitted follow-up text — which it does).

    Concrete decide update:

    ```
    const decide = async (action: "approve" | "decline", part: ToolApprovalPart) => {
      const path = action === "approve" ? "/api/approve" : "/api/decline";
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, toolCallId: part.toolCallId, reason: action === "decline" ? "user-declined" : undefined }),
      });
      if (!res.ok) {
        console.error(`[decide] ${action} failed:`, res.status, await res.text());
        return;
      }
      // The worker's resumed stream emits its own text-delta + tool-result chunks.
      // We don't pipe the second stream back through useChat (that would require
      // a second transport + a `setMessages` merge). Instead, the resumed stream's
      // output IS the assistant's continued response — we trigger a fetch of
      // /api/messages?sessionId=... to refresh the message list so the user sees
      // the tool result + assistant text appear in the panel. Phase 8 will move
      // to a streaming-aware chat pattern.
      await fetch(`/api/messages?sessionId=${encodeURIComponent(sessionId)}`).catch(() => {});
    };
    ```

    Even simpler ponytail (if `/api/messages` is the wrong refresh path): after the POST returns 200, just `window.location.reload()`. The user sees the updated chat. Phase 8 will swap to a streaming-aware pattern.

    Pick the simpler one: `window.location.reload()`. The plan does NOT need to perfect the message-list refresh; it just needs to close G-1-15.

    **App edit 6 — Confirm Next proxies forward the right body** (`app/api/approve/route.ts` and `app/api/decline/route.ts`).

    Current Next proxy just POSTs the JSON body to the worker. Verify the body shape `{ sessionId, toolCallId, reason? }` matches what the worker handler now expects. If the existing proxies already forward the body unchanged, no edit needed. If they construct their own body, edit them to pass through.

    Do NOT add `addToolApprovalResponse` calls in ChatPanel. AI SDK v7's `addToolApprovalResponse` lives on the Chat class (not on UseChatHelpers — see ai/dist/index.d.ts:5559 and @ai-sdk/react/dist/index.d.ts:178). Wiring it requires a useRef<Chat> pattern that the existing code doesn't have. The simpler ponytail path: server-side resume + window.location.reload() refresh. Phase 8 can introduce the streaming-aware pattern.

    Do NOT change the translator logic in worker/src/index.ts beyond adding the runId stash in the `tool-call-approval` branch. The translator was finalized in 01-X.

    Do NOT change ApprovalCard.tsx (the prop surface is correct).
    Do NOT change ActionFeed.tsx.
    Do NOT change app/api/messages/route.ts.
  </action>
  <files>
    - worker/src/index.ts
    - worker/src/api-routes/pause.ts
    - worker/src/lib/approval-route.ts
    - app/api/approve/route.ts
    - app/api/decline/route.ts
    - app/components/ChatPanel.tsx
  </files>
  <verify>
    <automated>grep -nE 'approvalAgent\s*=\s*agent' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'export const suspendedRuns' worker/src/api-routes/pause.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'approveToolCall\(\{[^}]*runId[^}]*toolCallId[^}]*\}\)' worker/src/lib/approval-route.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'declineToolCall\(\{[^}]*runId[^}]*toolCallId[^}]*reason[^}]*\}\)' worker/src/lib/approval-route.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'decide\(\s*"approve"|decide\(\s*"decline"' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'approvalAgent = agent' worker/src/index.ts` returns 1 match (agent exposed at module scope)
    - `grep 'export const suspendedRuns' worker/src/api-routes/pause.ts` returns 1 match (Map exported for runId lookup)
    - `grep 'approveToolCall({[^}]*runId[^}]*toolCallId[^}]*})' worker/src/lib/approval-route.ts` returns 1 match (approve handler calls documented API)
    - `grep 'declineToolCall({[^}]*runId[^}]*toolCallId[^}]*reason[^}]*})' worker/src/lib/approval-route.ts` returns 1 match (decline handler calls documented API)
    - `grep -E 'decide\("approve"|decide\("decline"' app/components/ChatPanel.tsx` returns 1+ match (ChatPanel decide POSTs the right body)
    - `pnpm tsc --noEmit` introduces no new errors in the listed files (pre-existing 7 errors in ChatPanel remain out-of-scope per the 01-E carryover list)
  </acceptance_criteria>
  <done>Worker /approval/approve and /approval/decline handlers call agent.approveToolCall / agent.declineToolCall with the stashed runId and pipe the resumed stream back as SSE. ChatPanel decide POSTs `{sessionId, toolCallId, reason?}` and reloads the page on success. The G-1-15 resume round-trip is closed end-to-end.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (gate approval round-trip works end-to-end), UI-04 (session continuity through approve flow)</implements>
  <commit>fix(agent): resume round-trip — approveToolCall + declineToolCall wire-up</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| ChatPanel → /api/approve → worker | Body carries sessionId + toolCallId. toolCallId is operator-typed (server-generated UUID); sessionId is the same sessionId already in the header. No secrets. Bearer auth on the Next → worker hop is unchanged. |
| worker → agent.approveToolCall | The runId is keyed by (sessionId, toolCallId) and stashed from the originating stream; the only valid source is a tool-call-approval chunk we ourselves emitted. No cross-session resume path. |
| Resumed stream → SSE | The resumed MastraModelOutput emits only chunks from the same run the gate suspended; no external data joins the stream. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-Y-01 | Spoofing | Cross-session resume | low | mitigate | suspendedRuns Map is keyed by `${sessionId}::${toolCallId}`. A different sessionId or toolCallId cannot reach the runId. |
| T-1-Y-02 | Information Disclosure | resumed stream leakage | low | accept | The resumed stream is the same run that was suspended; it carries the same chat context the operator typed. |
| T-1-Y-03 | Tampering | toolCallId replay | low | mitigate | suspendedRuns.delete(key) after resume — second approve with the same toolCallId returns 404. |
| T-1-Y-04 | Denial of Service | window.location.reload() in decide | low | accept | Single-user Phase 1 demo; refresh is acceptable UX for first-pass resume. Phase 8 swaps to streaming-aware chat. |

## Verification

1. Static: `grep` confirms module-level agent reference, exported suspendedRuns Map, both resume handlers calling documented API, ChatPanel decide POSTs the right body.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; toggle='tiered'; trigger "create a note called X saying Y" → card appears → click Approve → terminal shows `[approval-resolver] tool=createNote mode=tiered` (no error) → `[chat-debug] chunk=tool-result` → `[chat-debug] ok text=N tool=createNoteTool` → page reloads on client → chat panel shows the note creation + assistant follow-up text → ActionFeed shows `tool-output-available`. Trigger same, click Decline → terminal shows `[chat-debug] chunk=tool-error` → assistant emits "I cannot proceed with that action" reply → no `tool-output-available` chunk in ActionFeed.
4. Edge: trigger applyMigrations in tiered mode → red-bordered card → type "CONFIRM" → click Approve → same flow as createNote but with the write_high path; action succeeds.

## Success criteria

- Worker `/approval/approve` calls `agent.approveToolCall({runId, toolCallId})` and pipes the resumed stream as SSE.
- Worker `/approval/decline` calls `agent.declineToolCall({runId, toolCallId, reason})` and pipes the resumed stream as SSE.
- runId is stashed in suspendedRuns on the `tool-call-approval` chunk (01-X).
- ChatPanel decide POSTs `{sessionId, toolCallId, reason?}` and triggers a page refresh on success.
- No regression on the G-1-7b card renderer (plan 01-W) — the card renders, the user clicks Approve/Decline, the request fires.
- No regression on the G-1-14b classifier (plan 01-T) — read tools still don't gate.
- No regression on the wire trace (plan 01-X) — `data-suspended` still emits on gate.

## Artifacts this phase produces

- Modified: `worker/src/index.ts` (exposes `approvalAgent` module-level + stashes runId in suspendedRuns on approval chunk)
- Modified: `worker/src/api-routes/pause.ts` (exports suspendedRuns Map; runId added to value type)
- Modified: `worker/src/lib/approval-route.ts` (resume handlers call approveToolCall/declineToolCall + pipe resumed stream)
- Modified: `app/api/approve/route.ts`, `app/api/decline/route.ts` (forward body unchanged — verify, may be no-op)
- Modified: `app/components/ChatPanel.tsx` (decide POSTs right body + triggers page reload)
- New symbols: `approvalAgent` (module-level reference in worker/src/index.ts), `(sessionId, toolCallId) → runId` Map entries (live for the duration of a suspended run; cleared on resume)

## Output

Create `.planning/phases/01-foundation/01-Y-SUMMARY.md` when done.
