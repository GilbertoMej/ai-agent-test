---
status: diagnosed
trigger: "UAT gap G-1-15 — 'tool ran anyway' inference after resolver fired + tool-call-approval chunk emitted"
created: 2026-08-20T19:00:00Z
updated: 2026-08-20T19:00:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: "Mastra 1.60 streaming DOES honor the toolApprovalResolver gate — the chunk is informational AND the workflow suspends; the user's 'tool ran anyway' inference is incorrect (translator's 'ok text=0 tool=applyMigrationsTool' log fires whenever stream ends, not just on tool execution; wire evidence shows no tool-output-available chunk which proves tool.execute() was never reached). Real bug: (1) translator emits finish/[DONE] after suspended stream, masking suspended state from UI; (2) ChatPanel doesn't render ApprovalCard (G-1-7b); (3) /api/approve doesn't call agent.approveToolCall() to resume suspended workflow."
test: "Traced gate logic in tool-call-step.ts → foreach suspends → dowhile suspends → run.start returns suspended → workflowLoopStream.safeClose controller → translator for-await ends → translator emits own finish/[DONE]. No path where tool.execute is called when resolver returns true on first call."
expecting: "No Mastra bypass exists; gate works. G-1-15 description mis-diagnosed; the actual defect stack is downstream (translator + ChatPanel + /api/approve)."
next_action: "Return ROOT CAUSE FOUND with corrected diagnosis."

## Symptoms

expected: Resolver returns true → stream pauses → client sends approval → tool runs and result forwarded
actual (verbatim user): "terminal log '[approval-resolver] tool=applyMigrationsTool mode=tiered' confirms resolver fires; then '[chat-debug] chunk=tool-call-approval' (translator emits tool-approval-request); then '[chat-debug] ok text=0 tool=applyMigrationsTool' — tool ran anyway. Chunk is a notification, not a pause."
errors: none surfaced (no chat-debug err log)
reproduction: "Test 7 — toggle 'tiered', send 'apply database migrations'"
started: 2026-08-20 during UAT retest

## Eliminated

- hypothesis: "Mastra 1.60 streaming bypasses the toolApprovalResolver return — chunk is informational only"
  evidence: |
    node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs lines 26246-26307 (tool-call-step.ts):
      let globalRequiresApproval;
      if (typeof requireToolApproval === "function") try {
        globalRequiresApproval = !!await requireToolApproval(buildApprovalContext());
      } catch (error) { ... globalRequiresApproval = true; }
      else globalRequiresApproval = !!requireToolApproval;
      let toolRequiresApproval = globalRequiresApproval || !!tool.requireApproval;
      ...
      const approvalGated = !isDelegatedApproval && (suspendedForApproval || toolRequiresApproval && suspendData === void 0);
      ...
      if (approvalGated) if (!approvalDecision) {
        ...emit approval chunk via outputWriter...
        return suspend({...}, { resumeLabel: inputData.toolCallId });
      } else { ...approvalDecision resume branch... }
      ...
      const result = require_utils_safe_stringify.ensureSerializable(await tool.execute(args, toolOptions));
    The `await tool.execute(...)` at line 26726 is unreachable when approvalGated && !approvalDecision. The `return suspend(...)` exits the step's execute function before falling through to line 26726.
    The workflow engine then marks the step as suspended (durableResult.suspended = { payload }), foreach iteration returns suspended status, executeForeach returns status "suspended" at line 1677-1691, executeLoop (dowhile) returns suspended at line 1278, DefaultExecutionEngine.execute returns suspended at line 3694-3701, run.start returns suspended, workflowLoopStream sees status !== "success" and calls require_trip_wire.safeClose(controller) at line 27282.
    Wire evidence: user reports SSE shows tool-input-available → tool-approval-request → finish → [DONE] with NO tool-output-available chunk. tool-output-available is emitted from the post-execution path (lines 25796-25838) only when tc.result !== void 0. No tool-result chunk proves tool.execute was never reached.
  timestamp: 2026-08-20T19:00:00Z

- hypothesis: "Parallel path runs tool.execute while approval chunk is being emitted"
  evidence: |
    node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs line 26288: `await outputWriter(approvalChunk)` — fully awaited before `return suspend(...)`. No concurrency.
    outputWriter (line 27054-27135) only enqueues chunks via safeEnqueue; never invokes tool.execute.
    No other call site for tool.execute exists in the streaming path for the first iteration: line 35866 (hook wrapper) only fires from wrapToolWithHooks which is called when hooks are configured; not our path.
  timestamp: 2026-08-20T19:00:00Z

- hypothesis: "Suspend doesn't propagate through foreach → workflow → stream"
  evidence: |
    Foreach suspend at agent-D5C9QXkF.js lines 1654-1691 returns { status: "suspended", ... }.
    Loop (dowhile) suspend at line 1272-1278 returns the suspended result early.
    DefaultExecutionEngine.execute returns suspended at line 3642-3701.
    workflowLoopStream closes controller without emitting finish/error at line 27269-27283 (status !== "success" path).
    Controller close terminates the underlying ReadableStream, causing for-await (translator line 137) to exit normally (no error throw), then translator emits its own finish (line 194) and [DONE] (line 195).
  timestamp: 2026-08-20T19:00:00Z

- hypothesis: "Suspend throws because validateStepSuspendData fails on payload shape"
  evidence: |
    tool-call-step has no suspendSchema defined (createStep$1 at line 4192 only sets params.suspendSchema if defined).
    validateStepSuspendData (workflow-event-processor-mGtERBFZ.js line 189) skips validation when !step.suspendSchema.
    Payload {requireToolApproval:{...}, __streamState, __agentId} matches the documented Mastra HITL suspend shape.
  timestamp: 2026-08-20T19:00:00Z

## Evidence

- timestamp: 2026-08-20T19:00:00Z
  checked: "node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs lines 26036-26307 (createToolCallStep + execute)"
  found: "Gate logic is synchronous: resolver called via `await requireToolApproval(buildApprovalContext())` at line 26248, approvalGated computed at line 26266, suspend() called at line 26299. tool.execute() at line 26726 is unreachable on the gated-no-approval path."
  implication: "Gate is consumed synchronously, not informational."

- timestamp: 2026-08-20T19:00:00Z
  checked: "node_modules/@mastra/core/dist/agent-D5C9QXkF.js lines 1654-1691 (executeForeach return on suspend)"
  found: "Returns { status: 'suspended', suspendPayload: { __workflow_meta: {...} } } when any iteration suspends."
  implication: "Foreach propagates suspended status."

- timestamp: 2026-08-20T19:00:00Z
  checked: "node_modules/@mastra/core/dist/agent-D5C9QXkF.js lines 1208-1378 (executeLoop / dowhile)"
  found: "Loop returns early with suspended status at line 1272-1278; doesn't re-evaluate condition."
  implication: "Agentic loop workflow suspends when agenticExecutionWorkflow suspends."

- timestamp: 2026-08-20T19:00:00Z
  checked: "node_modules/@mastra/core/dist/agent-D5C9QXkF.js lines 3642-3701 (DefaultExecutionEngine.execute)"
  found: "Returns the result early with suspended status. Doesn't proceed to next entry."
  implication: "Workflow execution terminates at the suspended step."

- timestamp: 2026-08-20T19:00:00Z
  checked: "node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs lines 27249-27283 (workflowLoopStream)"
  found: |
    if (executionResult.status !== "success") {
        if (executionResult.status === "failed") { ...error chunk enqueued... }
        if (executionResult.status !== "suspended") await deleteRunSnapshots();
        else keepRegisteredForResume = true;
        require_trip_wire.safeClose(controller);
        return;
    }
  implication: "Stream controller closes WITHOUT emitting finish chunk when suspended. The translator's 'finish' + '[DONE]' comes from worker/src/index.ts:194-195 (translator's post-loop emissions), NOT from Mastra. The translator masks the suspended state by emitting its own terminator."

- timestamp: 2026-08-20T19:00:00Z
  checked: "node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs lines 25794-25838 (post-tool-execution tool-result emission)"
  found: "`hasPendingHITL = inputData.some((tc) => tc.result === void 0 && !tc.error && !tc.aborted && !tc.providerExecuted && !isDeniedApproval(tc));` — tool-result chunks only emitted for `successfulResults` where `tc.result !== void 0`."
  implication: "No tool-result chunk in user's wire = tool.execute was never reached."

- timestamp: 2026-08-20T19:00:00Z
  checked: "worker/src/index.ts lines 134-208 (SSE translator)"
  found: |
    After for-await loop completes normally (no error throw), translator unconditionally emits:
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
  implication: "This produces the user's observed wire: tool-input-available → tool-approval-request → finish → [DONE]. The 'finish' chunk misleads the client into thinking the assistant response completed when actually it's waiting for approval."

- timestamp: 2026-08-20T19:00:00Z
  checked: "worker/src/lib/approval-route.ts (existing /api/approve handler)"
  found: "approve handler records audit_log row and writes approval_grants; does NOT call agent.approveToolCall() to resume the suspended workflow. The suspended runId/toolCallId is never wired back to Mastra."
  implication: "Even if ChatPanel rendered the card and POSTed to /api/approve, the workflow would NOT resume — no agent.approveToolCall() invocation."

- timestamp: 2026-08-20T19:00:00Z
  checked: "node_modules/@mastra/core/dist/docs/references/docs-agents-human-in-the-loop.md"
  found: "Documents approveToolCall({runId, toolCallId?}) as the resume API for streaming. Returns a new stream that continues from the suspended step. Without this call, the suspended workflow persists in storage and is resumable only via listSuspendedRuns + the same approveToolCall."
  implication: "The /api/approve handler needs to find the runId (via /agents/:agentId/suspended-runs lookup filtered by sessionId/threadId) and call agent.approveToolCall({runId, toolCallId}) to resume."

- timestamp: 2026-08-20T19:00:00Z
  checked: "G-1-7b gap status (ChatPanel renderer)"
  found: "G-1-7b already documented as the downstream blocker for rendering ApprovalCard. ChatPanel doesn't subscribe to tool-approval-request chunks. Even if /api/approve were wired to resume, no client can POST to it."
  implication: "Three defects stack: translator masks suspended (cosmetic, but enables misinterpretation); ChatPanel doesn't render (G-1-7b); /api/approve doesn't resume (new)."

## Resolution

root_cause: |
  G-1-15 as stated in UAT.md is mis-diagnosed. The actual evidence is:

  1. The gate IS honored by Mastra 1.60 streaming. Traced: tool-call-step.ts:26246-26307 calls `await requireToolApproval(buildApprovalContext())`, computes `approvalGated`, and on `!approvalDecision` returns `suspend({...})` — exiting the step execute before line 26726 (`await tool.execute(...)`). The workflow suspends (foreach returns status:"suspended" at agent-D5C9QXkF.js:1677; dowhile returns suspended at line 1278; engine.execute returns suspended at line 3694; run.start returns suspended; workflowLoopStream safeCloses controller at agent-BVtn9FqD.cjs:27282 without emitting finish/error).

  2. The user's "tool ran anyway" observation is incorrect inference. The translator's `[chat-debug] ok text=0 tool=applyMigrationsTool` log line (worker/src/index.ts:197) fires whenever the for-await loop completes normally — it does NOT indicate tool execution. Wire evidence confirms: no tool-output-available chunk was emitted (the tool-result emission path at agent-BVtn9FqD.cjs:25794-25838 only fires for tc.result !== void 0).

  3. The wire shape the user observed — tool-input-available → tool-approval-request → finish → [DONE] — is exactly what a properly-suspended gate produces plus the translator's unconditional finish emission after the for-await loop exits (controller.close terminates the loop without error). The 'finish' chunk from the translator (worker/src/index.ts:194) MISLEADS the client into thinking the assistant response completed.

  4. The actual blocker for the user-visible flow is a stack of three downstream defects:
     (a) worker/src/index.ts:194-195 — translator emits finish/[DONE] even when stream ended due to upstream suspension. Client thinks response completed; can't distinguish "assistant answered" from "waiting for approval".
     (b) G-1-7b (existing) — ChatPanel doesn't render ApprovalCard on tool-approval-request chunks. UI can't surface approval request to user.
     (c) worker/src/lib/approval-route.ts:49-58 — /api/approve records audit only; does not call agent.approveToolCall({runId, toolCallId}) to resume the suspended workflow. Even if (b) were fixed and user clicked Approve, the workflow would stay suspended.

fix: |
  (not applied — goal: find_root_cause_only)

  Three concrete changes, ordered by symptom impact:

  (1) worker/src/index.ts:194-195 (translator) — stop emitting finish/[DONE] when stream ended due to upstream suspension. The stream's `fullStream` exposes a `status` or the controller-closed-without-finish-chunk signal can be tracked. Recommended minimal: when the for-await loop exits without seeing a `finish` chunk from upstream (i.e., controller was closed via Mastra's safeClose path), emit a `suspended` terminal chunk instead of `finish`, OR skip the finish emission entirely and rely on upstream behavior. Alternatively, track whether the last chunk was tool-call-approval and surface that as a `suspended` indicator.

  (2) app/components/ChatPanel.tsx (G-1-7b) — subscribe to tool-approval-request chunks, instantiate ApprovalCard with classify(toolName) tier, render inline in chat. On Approve: POST to /api/approve with {approvalId, toolCallId, toolName, args, tier, sessionId}. On Deny: POST to /api/decline.

  (3) worker/src/lib/approval-route.ts:44-58 (and the corresponding apiRoute in worker/src/index.ts:58-75) — after recording audit decision, look up the suspended run via agent.listSuspendedRuns({resourceId: sessionId, threadId}) filtered by toolCallId, call agent.approveToolCall({runId, toolCallId}) (returns a MastraModelOutput stream), pipe the new stream's chunks into the EXISTING SSE response (or open a fresh SSE stream). The decline path should call agent.declineToolCall({runId, toolCallId}).

  Order of operations: (2) and (3) are independent of (1). (1) is cosmetic but important — without it the client cannot distinguish suspended from completed, and the user's G-1-15 observation keeps recurring.
verification: |
  (not run — goal: find_root_cause_only)

  Test matrix:
  - Toggle tiered, send "apply database migrations" → tool-approval-request chunk emitted, NO tool-output-available, translator emits suspended (not finish), ChatPanel renders red-bordered ApprovalCard with CONFIRM input.
  - Type CONFIRM and click Approve → POST /api/approve → agent.approveToolCall resumes workflow → tool runs → tool-output-available chunk reaches ChatPanel → Action Feed shows tool lifecycle.
  - Click Deny → POST /api/decline → agent.declineToolCall → tool-output-denied chunk reaches ChatPanel → assistant reply shows decline reason.
  - Toggle always, send same message → no tool-approval-request chunk; tool runs immediately; tool-output-available emitted; translator emits finish normally.
  - Audit_log: row with approval_decision='user_allow' or 'user_deny' or 'auto' depending on path.

files_changed: []

## Independence from G-1-7b and G-1-9

- G-1-7b: ChatPanel doesn't render ApprovalCard on tool-approval-request chunks. Independent of G-1-15. The translator correctly emits the chunk; ChatPanel ignores it.
- G-1-9: toolApprovalResolver property-access bug (sdlc.ts). Fixed by 01-O. Independent.
- New bug (this diagnosis): /api/approve doesn't call agent.approveToolCall(). Stacks on top of G-1-7b — fixing G-1-7b alone won't complete the loop because the Approve button has no working server endpoint that resumes the workflow.

## Specialist Hint

typescript (Next.js client + Hono worker; AI SDK v5 UIMessageChunk wire; Mastra 1.60 workflow internals)
