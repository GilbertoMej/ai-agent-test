---
status: diagnosed
trigger: "model calls ragQueryTool correctly but '[approval-resolver] tool=ragQueryTool mode=tiered' fires (read tool should not gate); tool runs but SSE ends after tool-approval-request with no tool-output chunk"
created: 2026-08-20
updated: 2026-08-20
---

## Current Focus

hypothesis: The "two stacked defects" in the gap collapse into ONE: classify() compares against the wrong name space. Mastra 1.60 passes the tool's property KEY (e.g., "ragQueryTool") to ToolApprovalContext, but classify() matches against the tool ID (e.g., "rag_query"). Result: read tools fall through to write_high, get gated, and SUSPEND in Mastra's workflow — so the tool never runs and no tool-result chunk is ever emitted. The translator is correct; the user's perception of "tool runs" likely comes from seeing the tool-input-available bubble + the assistant's prefatory text "I'll look up..." (neither means the tool executed).

test: confirmed via direct code-path tracing + Mastra 1.60 source read
expecting: confirmed both halves; this is a single root cause
next_action: return ROOT CAUSE FOUND

## Symptoms

<!-- Written during gathering, then IMMUTABLE -->

expected: Ask "How does Notion MCP work?" → model calls rag_query → resolver returns false (no gate, read tier) → tool runs → tool-output-available chunk carries context string → user sees the Notion doc content
actual: model calls ragQueryTool correctly but '[approval-resolver] tool=ragQueryTool mode=tiered' fires (read tool should not gate); tool runs but SSE ends after tool-approval-request with no tool-output chunk; user sees: 'I'll look up...' text + tool call bubble, but NO context string and NO tool result rendered.
errors: (none — silent failure)
reproduction: Test 15 — toggle 'tiered', send 'How does notion MCP work?'
started: Discovered 2026-08-20 during UAT retest

## Eliminated

- hypothesis: "translator drops tool-result chunk"
  evidence: worker/src/index.ts:171-177 correctly handles `chunk.type === "tool-result"` and emits tool-output-available. Mastra 1.60 source (agent-BVtn9FqD.cjs:26271-26307) confirms that when `approvalGated && !approvalDecision`, the workflow SUSPENDS via `suspend({...}, { resumeLabel: inputData.toolCallId })` BEFORE tool execution. No tool-result chunk is ever emitted because the tool never runs. The translator cannot drop what is never produced.
  timestamp: 2026-08-20

- hypothesis: "Mastra 1.60 stream emits a tool-result with a different chunk.type than 'tool-result'"
  evidence: worker/src/index.ts:138 logs `[chat-debug] chunk=...` for every chunk. If tool-result were emitted under a different type, the log would show that type. The user-reported wire trace shows only text-start/delta/end, tool-input-available (from tool-call), tool-approval-request, finish, [DONE]. No tool-result chunk of any kind appeared, confirming Mastra never reached tool execution.
  timestamp: 2026-08-20

- hypothesis: "approvalMode 'tiered' is being misread as something else"
  evidence: worker/src/agents/sdlc.ts:48 logs `mode=${approvalMode ?? "undef"}` and the user sees `mode=tiered` printed — correct. The resolver consults classify() at sdlc.ts:49, classify() returns write_high, resolveApproval() returns "always", and the gate fires. approvalMode is not the issue.
  timestamp: 2026-08-20

## Evidence

- timestamp: 2026-08-20
  checked: worker/src/agents/sdlc.ts (toolApprovalResolver)
  found: resolver passes ctx.toolName straight to resolveApproval(). The resolver log emits the literal string "ragQueryTool" (camelCase property key), not "rag_query" (snake_case ID).
  implication: Mastra 1.60 passes the property key from `tools: { ... }` to ToolApprovalContext, NOT the tool's `id`.

- timestamp: 2026-08-20
  checked: worker/src/lib/classify.ts
  found: line 12 matches `toolName === "echo" || toolName === "rag_query"` (tool IDs). None of the four tools (echoTool, ragQueryTool, createNoteTool, applyMigrationsTool) match their declared tier because the keys differ by the "Tool" suffix or by case.
  implication: Every tool routed through the resolver falls through to the write_high default at line 36. ALL tools are gated, not just rag_query.

- timestamp: 2026-08-20
  checked: worker/src/lib/approval.ts:resolveApproval()
  found: `if (cls === "read") return false;` — short-circuit works as designed. But cls is write_high because classify() got the wrong name, so the short-circuit is unreachable.
  implication: resolveApproval is correct; classify() is the broken link.

- timestamp: 2026-08-20
  checked: worker/src/index.ts:171-177 (translator)
  found: Handles `chunk.type === "tool-result"` correctly: extracts toolCallId + result, emits `tool-output-available` SSE chunk.
  implication: Translator is correct. If a tool-result were emitted, it would be forwarded.

- timestamp: 2026-08-20
  checked: node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs:26266 + 26271-26307 (Mastra source)
  found: When `approvalGated && !approvalDecision`, Mastra emits `tool-call-approval` chunk and calls `return suspend({...}, { resumeLabel: inputData.toolCallId })`. The tool does NOT execute. No `tool-result` chunk is emitted for a suspended tool.
  implication: The "tool runs but result not forwarded" claim in the UAT is misdiagnosed — the tool never runs because of the gate. The chat-debug terminal trace (no chunk=tool-result) confirms this.

- timestamp: 2026-08-20
  checked: worker/src/tools/rag-query.ts + worker/src/tools/echo.ts + worker/src/tools/create-note.ts + worker/src/tools/apply-migrations.ts
  found: All four tools declare `id` (rag_query, echo, createNote, applyMigrations) AND are imported as camelCase `Tool`-suffixed variables (ragQueryTool, echoTool, createNoteTool, applyMigrationsTool). sdlc.ts:27 wires them by the variable name as object keys.
  implication: The naming convention mismatch is the structural defect. classify() was written assuming tool IDs, but the resolver receives property keys.

## Resolution

root_cause: classify() in worker/src/lib/classify.ts:12-14 compares against tool IDs ("echo", "rag_query", "createNote", "applyMigrations"), but toolApprovalResolver in worker/src/agents/sdlc.ts:49 passes the property KEY from the `tools: { ... }` object map (e.g., "ragQueryTool") to classify(). None of the four tools match their intended tier — every tool falls through to the write_high default at classify.ts:36. This makes resolveApproval() return "always" and the resolver gate the call. When gated, Mastra 1.60 suspends the workflow (agent-BVtn9FqD.cjs:26271-26307) BEFORE tool execution, so no tool-result chunk is ever produced. The translator at worker/src/index.ts:171-177 is correct (it does handle tool-result); the wire-level gap is that Mastra never reaches the tool-result emission because the gate suspends execution.

The UAT's "two stacked defects" framing (resolver-always-gates + translator-drops-result) is a single root cause with two visible symptoms. Fixing the resolver (so read tools return false and don't gate) unblocks both halves — the tool will execute, Mastra will emit tool-result, and the translator will forward tool-output-available.

fix: NOT APPLIED (find_root_cause_only mode). Suggested direction: pick one —

(a) **Normalize in the resolver.** Strip the trailing "Tool" suffix from camelCase keys before classifying, e.g. add a small helper in sdlc.ts:
```typescript
function normalizeToolName(n: string): string {
  return n.endsWith("Tool") ? n.slice(0, -4) : n;
}
return resolveApproval(normalizeToolName(ctx.toolName), { approvalMode, grants }) === "always";
```
Pros: 2 lines, no API changes, fixes all four tools. Cons: fragile if a tool name happens to end in "Tool" (e.g., a hypothetical "tool_tool").

(b) **Look up by tool ID.** The resolver can call `ctx.toolName` and look up the actual tool by iterating over a tools-by-key map (passed in or fetched from a singleton). classify() continues to match by ID. Pros: robust to naming convention. Cons: requires passing tools into the resolver context or a lookup helper.

(c) **Update classify() to accept both forms.** Add the camelCase keys alongside the IDs (e.g., `echoTool || echo || ragQueryTool || rag_query`). Pros: 1 file changed. Cons: hardcodes the property-key convention in classify() — leaks the variable-naming convention into the classifier, which is a layering inversion.

Recommended: **(a)** — one helper, scoped to the resolver. The classifier stays clean (reads tool IDs only). Document the normalization inline.

verification: NOT PERFORMED (find_root_cause_only mode). The expected post-fix verification: re-run Test 15 — model calls rag_query → resolver logs `[approval-resolver] tool=ragQueryTool mode=tiered` and `classify` returns "read" → no tool-call-approval chunk in SSE → tool runs → tool-result chunk emitted → translator forwards tool-output-available with the context string referencing notion-guides-mcp-overview.md. Also: re-run Test 14 (echo) to confirm read tier doesn't regress; re-run Test 1 (createNote in tiered) to confirm write_low still gates correctly.

files_changed: []
---

## Appendix: full source citations

### A. resolver-always-gates (root cause)

`worker/src/agents/sdlc.ts:27`
```typescript
tools: { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool },
```

`worker/src/agents/sdlc.ts:33-50`
```typescript
export async function toolApprovalResolver(
  ctx: ToolApprovalContext,
): Promise<boolean> {
  // ...
  const rc = (ctx.requestContext ?? {}) as {
    getRaw?: (k: string) => unknown;
    approvalMode?: ApprovalMode;
  };
  const raw = rc.getRaw?.("approvalMode");
  const approvalMode = (raw ?? rc.approvalMode) as ApprovalMode | undefined;
  const grants = await loadActiveGrants();
  console.log(`[approval-resolver] tool=${ctx.toolName} mode=${approvalMode ?? "undef"}`);
  return resolveApproval(ctx.toolName, { approvalMode, grants }) === "always";
}
```

`worker/src/lib/approval.ts:36-50` (resolveApproval, correct but unreachable for the wrong reason)
```typescript
export function resolveApproval(toolName: string, ctx: ApprovalContext = {}): boolean | "always" {
  const cls = classify(toolName);
  // Read tools never gate.
  if (cls === "read") return false;
  // Session-wide auto-approve.
  if (ctx.approvalMode === "always") return false;
  // Per-tool batch grant (5-min "approve all matching").
  if (isToolGranted(toolName, ctx.grants)) return false;
  // Anything else pauses for the card.
  return "always";
}
```

`worker/src/lib/classify.ts:10-37` (broken — compares wrong name space)
```typescript
export function classify(toolName: string): ToolClass {
  // Phase 1 working set
  if (toolName === "echo" || toolName === "rag_query") return "read";
  if (toolName === "createNote") return "write_low";
  if (toolName === "applyMigrations") return "write_high";

  // Read-class patterns (Phase 2-7 tools — extend as MCPs ship)
  if (
    toolName.startsWith("get_") ||
    toolName.startsWith("list_") ||
    toolName.startsWith("search_") ||
    toolName.startsWith("preview_")
  )
    return "read";

  // Write-low (Phase 2-7)
  if (
    toolName === "write_file" ||
    toolName === "git_commit" ||
    toolName === "run_tests" ||
    toolName === "sandbox_e2e"
  )
    return "write_low";

  // Write-high (Phase 2-7) — anything not explicitly read/write_low lands here.
  return "write_high";
}
```

User log confirms the wrong key: `[approval-resolver] tool=ragQueryTool mode=tiered` — Mastra 1.60 passes the property KEY (`ragQueryTool`), not the ID (`rag_query`).

### B. translator-drops-result (false alarm — actually "Mastra never emits tool-result")

`worker/src/index.ts:171-177`
```typescript
} else if (chunk.type === "tool-result") {
  const p = chunk.payload as { toolCallId?: string; result?: unknown } | undefined;
  if (p?.toolCallId) {
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ type: "tool-output-available", toolCallId: p.toolCallId, output: p.result })}\n\n`),
    );
  }
}
```

`node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs:26266-26308` (Mastra 1.60 source — gating suspends BEFORE tool execution)
```js
const approvalGated = !isDelegatedApproval && (suspendedForApproval || toolRequiresApproval && suspendData === void 0);
// ...
if (approvalGated) if (!approvalDecision) {
  // ...
  const approvalChunk = await transformChunk({
    type: "tool-call-approval",
    // ...
  }, "approval");
  if (outputWriter) await outputWriter(approvalChunk);
  else require_trip_wire.safeEnqueue(controller, approvalChunk);
  // ...
  await flushMessagesBeforeSuspension();
  return suspend({
    requireToolApproval: {
      toolCallId: inputData.toolCallId,
      toolName: inputData.toolName,
      args: inputData.args
    },
    __streamState: streamState.serialize(),
    __agentId: agentId
  }, { resumeLabel: inputData.toolCallId });
}
```

When `approvalGated && !approvalDecision`, the workflow SUSPENDS — `return suspend(...)` exits the tool-execution path. The tool never runs. No `tool-result` chunk is produced. The user's wire trace (no chunk=tool-result in the chat-debug log) matches this.

### C. The collapse

The UAT frame "resolver-always-gates AND translator-drops-result" is two visible symptoms of one defect:
- Symptom A: resolver gates read tools → tool never executes.
- Symptom B: no tool-output-available in SSE → tool-result was never emitted (because the tool never ran).

Fix the resolver (single change in sdlc.ts:33-50) → read tools return false → no gate → tool executes → tool-result emitted → translator forwards tool-output-available. Both symptoms disappear together.
