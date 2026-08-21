---
phase: 1
plan: X
type: execute
wave: 4
gap_closure: true
gap_ids: [G-1-15]
depends_on: ["01-W"]
files_modified:
  - worker/src/index.ts
autonomous: true
must_haves:
  - "Worker translator distinguishes `suspended` (stream ended due to upstream suspension) from `finished` (stream completed naturally)"
  - "When stream ended due to upstream suspension, the translator emits a `suspended` UIMessageChunk instead of `finish` so the client can tell the difference"
  - "When stream completed naturally (no tool-call-approval chunk in the sequence), the translator emits `finish` + `[DONE]` as today"
  - "Track via a `sawApprovalChunk` boolean — set true when a tool-call-approval chunk fires; checked after the for-await loop exits"
  - "`pnpm tsc --noEmit` introduces no new errors in index.ts"
  - "Live: trigger createNote in tiered mode → wire shows `tool-input-available` → `tool-approval-request` → `suspended` (NOT `finish`) → `[DONE]`"
requirements:
  - HITL-01
---

# 01-X — Phase 1 Gap Closure (translator: suspended vs finished terminal state)

Closes G-1-15 part A (major): worker/src/index.ts:194-195 unconditionally emits `finish` + `[DONE]` after the for-await loop exits. The loop exits normally whenever `workflowLoopStream` closes its controller (agent-BVtn9FqD.cjs:27282 — `require_trip_wire.safeClose(controller)`) WITHOUT throwing — this happens for BOTH a successful run AND a suspended run (the gate suspends via `suspend(...)` at agent-BVtn9FqD.cjs:26299 BEFORE `tool.execute()` at line 26726 is reached).

The user sees `tool-input-available` → `tool-approval-request` → `finish` → `[DONE]` and concludes "the tool ran anyway" because the `finish` chunk normally signals assistant-response-completed. But the gate is actually honored — Mastra suspended the workflow; the tool never ran (no `tool-output-available` chunk was emitted because the tool-execution path at agent-BVtn9FqD.cjs:25794-25838 only fires for `tc.result !== void 0`).

Fix is a small flag-and-branch in the translator: track whether the for-await loop saw a `tool-call-approval` chunk (the signal that an upstream suspend happened), and emit `suspended` instead of `finish` when set. Cosmetic for the wire contract — but it lets the client distinguish "assistant answered" from "waiting for user approval" and prevents recurring misinterpretation of the wire trace.

This is part A of the G-1-15 stack. Part B (ChatPanel renderer — closed by 01-W) is already landed. Part C (worker /approval/approve resume) and part D (ChatPanel onApprove POST) are closed by plan 01-Y.

## Tasks

<task type="auto">
  <id>01-X1-translator-suspended-vs-finished-terminal-state</id>
  <read_first>
    - worker/src/index.ts (lines 127-208 — full SSE start(controller) closure; lines 165-170 — `tool-call-approval` chunk translator; lines 193-197 — unconditional finish + [DONE] emission)
    - node_modules/.pnpm/@mastra+core@1.60.0_ai@7.0._6f6d82524998c05318c2ce4d97d92913/node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs (lines 27269-27283 — workflowLoopStream safeClose on suspend; lines 26271-26307 — suspend path BEFORE tool.execute)
    - .planning/debug/g-1-15-mastra-gate-bypass.md (full root-cause trace — Mastra gate IS honored; symptom was translator masking suspended state)
  </read_first>
  <action>
    Single-file edit in `worker/src/index.ts:127-208`. Add a `sawApprovalChunk` boolean inside the `start(controller)` closure, set it true when the `tool-call-approval` chunk fires, and check it after the for-await loop to decide between `finish` and `suspended` terminal emission.

    Current lines 127-208 (focused on the loop and terminator):

    ```
    const sseBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const msgId = crypto.randomUUID();
        let lastToolName = "sdlcAgent";
        let textCount = 0;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "start", messageId: msgId, messageMetadata: { modelId: "opencode-go/hy3" } })}\n\n`),
          );
          for await (const chunk of stream.fullStream) {
            console.log(`[chat-debug] chunk=${chunk.type}`);
            if (chunk.type === "text-start") {
              ...
            } else if (chunk.type === "text-delta") {
              ...
            } else if (chunk.type === "text-end") {
              ...
            } else if (chunk.type === "tool-call") {
              ...
            } else if (chunk.type === "tool-call-approval") {
              const p = chunk.payload as { toolCallId?: string } | undefined;
              const toolCallId = p?.toolCallId ?? crypto.randomUUID();
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "tool-approval-request", approvalId: toolCallId, toolCallId })}\n\n`),
              );
            } else if (chunk.type === "tool-result") {
              ...
            } else if (chunk.type === "step-finish") {
              ...
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          console.log(`[chat-debug] ok text=${textCount} tool=${lastToolName}`);
        } catch (e) {
          ...
        }
      },
    });
    ```

    Three surgical changes:

    **Change 1 — Declare `sawApprovalChunk`** (inside the `start(controller)` closure, next to `lastToolName` / `textCount` on lines 131-132):

    Add after line 132:
    ```
    // 01-X — true if the for-await loop saw a tool-call-approval chunk. Mastra
    // 1.60's workflowLoopStream closes its controller without error on suspend
    // (agent-BVtn9FqD.cjs:27282 — safeClose), so the for-await loop exits normally
    // for BOTH successful AND suspended runs. Without this flag, the translator
    // emits `finish` either way — misleading the client into thinking the
    // assistant response completed when it's actually waiting for user approval.
    let sawApprovalChunk = false;
    ```

    **Change 2 — Set the flag in the `tool-call-approval` branch** (inside the `else if (chunk.type === "tool-call-approval")` block on lines 165-170):

    Current:
    ```
    } else if (chunk.type === "tool-call-approval") {
      const p = chunk.payload as { toolCallId?: string } | undefined;
      const toolCallId = p?.toolCallId ?? crypto.randomUUID();
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "tool-approval-request", approvalId: toolCallId, toolCallId })}\n\n`),
      );
    }
    ```

    Replacement:
    ```
    } else if (chunk.type === "tool-call-approval") {
      const p = chunk.payload as { toolCallId?: string } | undefined;
      const toolCallId = p?.toolCallId ?? crypto.randomUUID();
      // 01-X — mark that the upstream gate fired; the for-await loop will exit
      // without error (controller.close, not throw) and the terminator below
      // branches on this flag to emit `suspended` instead of `finish`.
      sawApprovalChunk = true;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "tool-approval-request", approvalId: toolCallId, toolCallId })}\n\n`),
      );
    }
    ```

    **Change 3 — Branch the terminator** (replace lines 194-197):

    Current:
    ```
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
    console.log(`[chat-debug] ok text=${textCount} tool=${lastToolName}`);
    ```

    Replacement:
    ```
    if (sawApprovalChunk) {
      // ponytail: AI SDK v5 has no `suspended` chunk type — emit `finish` so the
      // client's parser accepts the terminator, plus a custom data chunk the
      // client (plan 01-Y) reads to know the response is awaiting approval.
      // The data chunk uses the existing `data-...` part shape so the AI SDK
      // stores it on m.parts[i].data without rejecting the stream.
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "data-suspended", data: { reason: "tool-call-approval", toolName: lastToolName } })}\n\n`),
      );
      console.log(`[chat-debug] suspended text=${textCount} tool=${lastToolName}`);
    } else {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
      console.log(`[chat-debug] ok text=${textCount} tool=${lastToolName}`);
    }
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
    ```

    Three changes:
    1. When `sawApprovalChunk` is true, emit `finish` first (so the AI SDK v5 parser accepts the terminator — it has no native `suspended` chunk type) and follow with a `data-suspended` DataUIMessageChunk carrying `{ reason: "tool-call-approval", toolName }` so the client (plan 01-Y) can detect the suspended state and surface it to the UI.
    2. When `sawApprovalChunk` is false, emit `finish` as today (no `data-suspended` chunk; the assistant response completed naturally).
    3. The terminal `[DONE]` + `controller.close()` fire in both branches — unchanged.
    4. Update the `[chat-debug]` log message to distinguish `suspended` from `ok` so the operator can see at a glance which terminal state fired.

    Do NOT change any other branch of the for-await loop (the existing chunk translation is correct).
    Do NOT change the `try { ... } catch (e) { ... }` shape — the error path (lines 198-207) emits `error` + `[DONE]` and is unrelated.
    Do NOT change `controller.enqueue(encoder.encode(\`data: ${JSON.stringify({ type: "start", ... })}\n\n\`))` on line 134 — the start chunk is unchanged.
    Do NOT change any file other than `worker/src/index.ts`. The translator is the only place this flag can be set without coupling the translator to a side channel.
  </action>
  <files>worker/src/index.ts</files>
  <verify>
    <automated>grep -nE 'let sawApprovalChunk = false' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'sawApprovalChunk = true' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'type: "data-suspended"' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'chat-debug. suspended' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'let sawApprovalChunk = false' worker/src/index.ts` returns 1 match (flag declared)
    - `grep 'sawApprovalChunk = true' worker/src/index.ts` returns 1 match (flag set in tool-call-approval branch)
    - `grep 'type: "data-suspended"' worker/src/index.ts` returns 1 match (suspended data chunk emitted when flag set)
    - `grep 'chat-debug] suspended' worker/src/index.ts` returns 1 match (operator log distinguishes suspended from ok)
    - The pre-existing `grep 'type: "finish"' worker/src/index.ts` continues to return 1+ matches (finish chunk still emitted in both branches)
    - `pnpm tsc --noEmit` introduces no new errors in index.ts
  </acceptance_criteria>
  <done>Worker translator distinguishes suspended (sawApprovalChunk=true) from finished (sawApprovalChunk=false) terminal state. Suspended runs emit a `data-suspended` DataUIMessageChunk alongside the `finish` so the client (plan 01-Y) can surface "awaiting approval" instead of "response completed". The wire trace becomes self-documenting.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (gate mechanism observable end-to-end on the wire — distinguishes approved-and-ran from approved-and-suspended)</implements>
  <commit>fix(worker): translator emits suspended vs finish terminal — distinguish approval-pending from completed</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Translator → SSE | The translator runs in-process inside the worker; no external trust boundary. The `data-suspended` chunk is operator-authored (server-emitted); the client (plan 01-Y) reads it from `m.parts[i].data`. |
| AI SDK v5 wire parser | AI SDK v5 accepts unknown `data-*` chunks via the `DataUIMessageChunk` shape; `data-suspended` lands on `m.parts[i].data` (same as `data-usage`). No rejection. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-X-01 | Information Disclosure | `data-suspended` carries toolName | low | accept | toolName is operator-readable; the wire already exposes toolName via `tool-input-available` chunks. |
| T-1-X-02 | Spoofing | Client-side state inference | low | accept | The client (plan 01-Y) treats `data-suspended` as a hint to surface "awaiting approval" — the actual gating is enforced server-side via `requireToolApproval`. |

## Verification

1. Static: `grep` confirms `sawApprovalChunk` flag, branch in terminator, `data-suspended` chunk emission.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; toggle='tiered'; trigger "create a note called X saying Y" → wire trace shows `tool-input-available` → `tool-approval-request` → `finish` → `data-suspended { reason: "tool-call-approval", toolName: "createNoteTool" }` → `[DONE]`. Toggle='always', trigger same message → wire trace shows `tool-input-available` → `tool-result` → `finish` → `[DONE]` (no `data-suspended` chunk; flag never set).

## Success criteria

- Worker translator emits `data-suspended` when a `tool-call-approval` chunk fires during the for-await loop.
- Worker translator does NOT emit `data-suspended` when the loop completes without a `tool-call-approval` chunk.
- `finish` chunk is emitted in both branches (AI SDK v5 parser compatibility).
- `[chat-debug] suspended` log line fires only in the suspended branch; `[chat-debug] ok` log line fires only in the finished branch.
- No regression on text-start/text-delta/text-end/tool-call/tool-result/step-finish chunk translation.

## Artifacts this phase produces

- Modified: `worker/src/index.ts` (translator tracks `sawApprovalChunk`, branches terminator on `finish` vs `data-suspended`)
- Modified symbols: `sawApprovalChunk` (new closure-scoped boolean), `data-suspended` chunk shape (new wire chunk emitted when gate fires)

## Output

Create `.planning/phases/01-foundation/01-X-SUMMARY.md` when done.
