---
phase: 01-foundation
plan: X
subsystem: worker-stream
tags: [chat, translator, suspended, finish, terminal-state, mastra-1.60, hitl, wire-contract]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "worker/src/index.ts translator for-await loop (01-C); tool-call-approval chunk branch (01-N); [chat-debug] per-chunk log (01-N); 01-T normalizeToolName (resolver no longer gates read tools)"
provides:
  - "Translator distinguishes approval-pending (suspended) from assistant-completed (finished) via sawApprovalChunk flag"
  - "Wire carries data-suspended DataUIMessageChunk after finish when an approval gate fired upstream"
  - "[chat-debug] suspended log line when sawApprovalChunk was true"
affects: [01-Y, 01-Z, verify-work-1]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
actuals:
  tokens: 690   # ~2760 bytes of diff / 4
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AI SDK v5 has no `suspended` UIMessageChunk type. Wire a custom data-suspended DataUIMessageChunk (data: { reason, toolName }) AFTER the standard `finish` chunk so the client's parser accepts the terminator and the 01-Y resume path can read the data part to know it must wait for /api/approve."
    - "Mastra 1.60's workflowLoopStream.safeClose(controller) exits the for-await loop without error for BOTH a successful run AND a suspended run — the only signal that distinguishes the two is whether a `tool-call-approval` chunk fired mid-loop. Track with a closure-scoped boolean; check after the loop."
    - "Pattern: terminal-state distinction via a flag set during iteration, evaluated once after the loop. The translator branches on the flag to emit either `finish` (with [chat-debug] ok) or `finish`+`data-suspended` (with [chat-debug] suspended)."

key-files:
  modified:
    - worker/src/index.ts

key-decisions:
  - "Add sawApprovalChunk boolean inside start(controller) closure, next to lastToolName/textCount. Set true inside the existing tool-call-approval branch (line 178). Check after the for-await loop exits."
  - "Emit `data-suspended` DataUIMessageChunk (data: { reason: 'tool-call-approval', toolName: lastToolName }) AFTER the standard `finish` chunk when sawApprovalChunk is true. AI SDK v5 has no `suspended` chunk type — the data- prefix uses the DataUIMessageChunk part shape so the AI SDK stores it on m.parts[i].data without rejecting the stream."
  - "Keep `finish` emission on the suspended path. The client's parser must see a standard terminator; the data-suspended chunk is a SIDE-CAR signal, not a replacement. Plan 01-Y's approval-route handler reads m.parts[i].data.suspended to know the response is awaiting approval."
  - "Log line branched: `[chat-debug] ok text=N tool=T` (finished) vs `[chat-debug] suspended text=N tool=T` (approval-pending). Operator can grep the worker log to confirm which path fired."
  - "Do NOT change the upstream tool-call-approval chunk translator (still emits { type: 'tool-approval-request', approvalId, toolCallId }). Do NOT change other chunk branches. Do NOT throw on suspend — Mastra 1.60 closes the controller cleanly and the for-await loop exits without error."
  - "Do NOT touch 01-Y's wiring (runId storage, /api/approve handler, agent.approveToolCall resume). This plan only fixes the terminal-state distinction; the resume path is 01-Y's job."

patterns-established:
  - "Pattern: when an upstream runloop exits without error but the work was actually suspended, the translator must surface that signal via a side-car data chunk. The wire contract stays AI-SDK-valid; the suspended state rides on a custom data part the client reads explicitly."
  - "Pattern: prefer the DataUIMessageChunk part shape (data- prefix) for out-of-band signals that the AI SDK doesn't natively support. The parser accepts the chunk; the part is stored on m.parts[i].data; the client filters on type and reads .data as needed."

# TDD Gate Compliance
gate_status: not-applicable  # task is a wire-contract fix, not behavior-adding TDD per the centralized predicate

requirements-completed: [HITL-01]

coverage:
  - id: D1
    description: "sawApprovalChunk boolean declared in start(controller) closure; set true in tool-call-approval branch; checked after for-await loop to branch terminator."
    requirement: "HITL-01"
    verification:
      - kind: other
        ref: "grep -nE 'let sawApprovalChunk = false' worker/src/index.ts → 1 match (line 139)"
        status: pass
      - kind: other
        ref: "grep -nE 'sawApprovalChunk = true' worker/src/index.ts → 1 match (line 178, inside tool-call-approval branch)"
        status: pass
      - kind: other
        ref: "grep -nE 'if \\(sawApprovalChunk\\)' worker/src/index.ts → 1 match (line 205, terminator branch)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Suspended terminator emits `finish` + `data-suspended` DataUIMessageChunk + [chat-debug] suspended log; finished terminator emits `finish` + [chat-debug] ok log (no data-suspended)."
    requirement: "HITL-01"
    verification:
      - kind: other
        ref: "grep -nE 'data-suspended.*reason.*tool-call-approval' worker/src/index.ts → 1 match (line 213)"
        status: pass
      - kind: other
        ref: "grep -nE 'chat-debug. suspended' worker/src/index.ts → 1 match (line 215)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TypeScript introduces no new errors in index.ts (pre-existing 2 errors in lib/insforge.ts remain out-of-scope per the 01-E carryover list)."
    requirement: "HITL-01"
    verification:
      - kind: other
        ref: "npx tsc --noEmit 2>&1 | grep -i 'index.ts' → empty (no new errors in worker/src/index.ts); only 2 pre-existing errors in lib/insforge.ts remain"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live: trigger createNote in tiered mode → wire shows tool-input-available → tool-approval-request → finish → data-suspended → [DONE]; no data-suspended chunk in the finished path."
    requirement: "HITL-01"
    verification:
      - kind: manual
        ref: "pnpm dev; toggle='tiered'; trigger 'create a note called X saying Y' → SSE stream shows tool-input-available → tool-approval-request → finish → data-suspended { reason: 'tool-call-approval', toolName: 'createNote' } → [DONE]. Trigger 'what is 2+2' (no tool gating) → tool-input-available → tool-output-available → finish (NO data-suspended) → [DONE]."
        status: pending  # manual end-to-end is the verify-work-1 gate's job
    human_judgment: true

---

# Phase 01 Plan X: Translator suspended vs finished terminal state — Summary

**One-liner:** Worker translator now distinguishes approval-pending (suspended) from assistant-completed (finished) via a `sawApprovalChunk` flag; the suspended path emits a `data-suspended` DataUIMessageChunk side-car so the 01-Y resume handler can tell which terminator fired.

## What was built

Single-file edit to `worker/src/index.ts`. Three coordinated changes inside the `start(controller)` closure of the SSE `ReadableStream`:

### 1. Flag declaration (line 139)

Added `let sawApprovalChunk = false;` next to `lastToolName`/`textCount`. Comment explains the root cause: Mastra 1.60's `workflowLoopStream.safeClose(controller)` exits the for-await loop without error for BOTH successful AND suspended runs, so the loop alone cannot tell them apart.

### 2. Flag set in the tool-call-approval branch (line 178)

The existing `else if (chunk.type === "tool-call-approval")` branch now sets `sawApprovalChunk = true` before emitting the wire chunk. No other chunk branch touches the flag.

### 3. Terminator branch (lines 205-219)

After the for-await loop exits, the code branches on `sawApprovalChunk`:

```ts
if (sawApprovalChunk) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ type: "data-suspended", data: { reason: "tool-call-approval", toolName: lastToolName } })}\n\n`),
  );
  console.log(`[chat-debug] suspended text=${textCount} tool=${lastToolName}`);
} else {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
  console.log(`[chat-debug] ok text=${textCount} tool=${lastToolName}`);
}
```

The `finish` chunk still emits on the suspended path — the AI SDK parser needs a standard terminator. The `data-suspended` side-car uses the `data-` prefix so the AI SDK stores it on `m.parts[i].data` (the DataUIMessageChunk part shape). The 01-Y plan's approval-route handler reads `m.parts[i].data.suspended` to know the response is awaiting approval.

## Deviations from Plan

### Ponytail simplification

**1. [Wire chunk type] Plan said emit `suspended` UIMessageChunk; code emits `finish` + `data-suspended` side-car**
- **Found during:** Task 1 implementation
- **Issue:** AI SDK v5 has no `suspended` UIMessageChunk type. The plan's "emit a `suspended` UIMessageChunk" is the correct INTENT but the wire chunk type doesn't exist — the AI SDK parser would reject the stream. The ponytail fix: emit the standard `finish` terminator (the parser needs it) PLUS a `data-suspended` DataUIMessageChunk side-car. The side-car uses the `data-` prefix so the AI SDK stores it on `m.parts[i].data` without rejecting the stream.
- **Why this is better:** the wire contract stays AI-SDK-valid; the suspended signal rides on a custom data part the client reads explicitly via `m.parts[i].data.suspended`. Plan 01-Y's resume handler reads that part to know the response is awaiting approval.
- **Files modified:** worker/src/index.ts (lines 205-215).
- **Commit:** 182b962.
- **Acceptance impact:** D1 (sawApprovalChunk flag) passes. D2 (data-suspended side-car replaces plan's nominal `suspended` chunk) passes by the same intent — the wire carries the suspended signal as a data part, the 01-Y handler reads it. D3 (tsc) passes — no new errors.

### Auto-fixed Issues

None.

## Auth Gates

None.

## Known Stubs

None.

## Threat Flags

None new. The `data-suspended` chunk only carries the toolName and a fixed `reason` string — no secrets, no user data. The terminator branch does not throw on suspend, so the SSE stream completes cleanly and the AI SDK client parser doesn't see a malformed event.

## Self-Check

PASSED:
- [x] `worker/src/index.ts` exists and modified
- [x] Commit 182b962 exists (`fix(worker): translator emits suspended vs finish terminal — distinguish approval-pending from completed`)
- [x] All 4 acceptance-criteria checks pass (flag declared, flag set, terminator branches, data-suspended side-car present)
- [x] `npx tsc --noEmit` introduces zero new errors in worker/src/index.ts
- [x] `[approval-resolver]` log + 01-T normalizeToolName pattern preserved untouched
- [x] `data-suspended` uses the `data-` DataUIMessageChunk prefix so AI SDK parser accepts the stream
- [x] `data: [DONE]` still emitted after the terminator (line 220, unchanged)
