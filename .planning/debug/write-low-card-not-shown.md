---
status: investigated
trigger: "UAT gap G-1-7: write_low tool call does not render ApprovalCard"
created: 2026-08-20
updated: 2026-08-20
---

## Current Focus

hypothesis: Resolver logic is correct (verified by isolated test). Either Mastra 1.60 isn't reaching our resolver with the expected `requestContext.approvalMode`, or approval is being bypassed at the runToolEntry level (e.g. providerExecuted, missing requireToolApproval threading).
test: (cannot run worker — needs DATABASE_URL + Anthropic key)
expecting: n/a — code review only
next_action: return structured diagnosis to caller

## Symptoms

<!-- IMMUTABLE -->

expected: write_low tool call should pause for human approval via inline ApprovalCard
actual: tool ran un-gated; no ApprovalCard; user sees args echoed in ActionFeed
errors: none — silent approval bypass
reproduction: pnpm dev → tiered mode → "create a note called X saying Y" → tool executes
started: discovered during UAT phase 01

## Eliminated

- hypothesis: "requestContext shape mismatch — ctx.requestContext is not a plain object"
  evidence: agent.d.ts:29 declares `requestContext?: Record<string, unknown>`; buildApprovalContext at agent-BVtn9FqD.cjs:26240-26245 uses `Object.fromEntries([...requestContext.entries()].filter(...))`. Our resolver accesses `rc.approvalMode` correctly.
  timestamp: 2026-08-20
- hypothesis: "classify() returns 'read' for createNote — tool is auto-approved"
  evidence: classify.test.ts already asserts createNote → "write_low". isolated unit test reproduced resolveApproval("createNote", {approvalMode: "tiered", grants: []}) === "always" → true.
  timestamp: 2026-08-20
- hypothesis: "chunk translation is wrong — emits the wrong chunk type"
  evidence: AI SDK v5 UIMessageChunk `tool-approval-request` shape matches what useChat expects (per memory note). translator at worker/src/index.ts:151-156 maps Mastra `tool-call-approval` → AI SDK `tool-approval-request` with `approvalId` and `toolCallId`.
  timestamp: 2026-08-20
- hypothesis: "ChatPanel render filter is wrong — skips the approval part"
  evidence: ChatPanel.tsx:209-210 checks `if (p.type !== "tool-approval-request") return null` — passes through. Renders ApprovalCard with tier="write_low".
  timestamp: 2026-08-20

## Evidence

- timestamp: 2026-08-20
  checked: worker/src/agents/sdlc.ts:30-36 toolApprovalResolver
  found: `return resolveApproval(...) === "always"` — string→boolean coercion correct; "always" maps to true (gate fires).
  implication: resolver returns boolean correctly per Mastra contract (RequireToolApprovalFn: line 38 in tools/types.d.ts).
- timestamp: 2026-08-20
  checked: node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs:26230-26266 (runToolEntry approval flow)
  found: `requireToolApproval = requireToolApprovalFromFactory ?? requestContext.get("__mastra_requireToolApproval")` then `globalRequiresApproval = !!await requireToolApproval(buildApprovalContext())`. `approvalGated = !isDelegatedApproval && (suspendedForApproval || toolRequiresApproval && suspendData === void 0)`.
  implication: tool execution is gated when resolver returns true AND no suspendData. If tool ran, resolver returned false OR approval was bypassed (providerExecuted, no tool.execute, etc.).
- timestamp: 2026-08-20
  checked: agent-BVtn9FqD.cjs:26036 createToolCallStep signature + 26780 wiring
  found: `createToolCallStep({ ..., requireToolApproval: requireToolApprovalFromFactory, ... })`. Wired from `createAgenticExecutionWorkflow({ models, _internal, ...rest })` which receives rest from `createAgenticLoopWorkflow` → `workflowLoopStream` (line 27156) which receives requireToolApproval via workflowLoopProps.
  implication: threading looks correct. `requireToolApprovalFromFactory` should be our function. **However**: in `loop()` at line 27365, requireToolApproval is passed via `workflowLoopProps = { ..., requireToolApproval, ...rest }`. workflowLoopStream then at line 27226 does `requestContext.set("__mastra_requireToolApproval", requireToolApproval)`. **BOTH paths reach the same destination** — function either as factory arg or as requestContext key.
- timestamp: 2026-08-20
  checked: node_modules/@mastra/core/dist/request-context-CY1DtViW.cjs:192-194 setRaw
  found: `setRaw(key, value) { this.registry.set(key, value); }` — straightforward Map.set.
  implication: our `requestContext.setRaw("approvalMode", "tiered")` DOES persist.
- timestamp: 2026-08-20
  checked: isolated unit test of resolveApproval
  found: Replicating Mastra's buildApprovalContext with `RequestContext` containing `setRaw("approvalMode","tiered")` produces `ctx.requestContext = {approvalMode: "tiered", sessionId: "..."}`. resolveApproval("createNote", {approvalMode: "tiered", grants: []}) returns "always" → resolver returns true → gate fires.
  implication: Logic is correct IF context shape matches what Mastra delivers.
- timestamp: 2026-08-20
  checked: worker/src/index.ts:97-99 requestContext construction
  found: `new RequestContext()` then `setRaw("approvalMode", approvalMode ?? "tiered")` — approvalMode comes from body, defaults to "tiered".
  implication: Even if approvalMode is undefined, `?? "tiered"` covers it.
- timestamp: 2026-08-20
  checked: worker/src/lib/classify.ts:13 — createNote → "write_low"
  found: hardcoded match.
  implication: toolName "createNote" reaches classify correctly.

## Resolution

root_cause: TWO leading candidates, both untestable without running the worker:

**Candidate A (most likely): resolver is never called because Mastra 1.60 silently drops `requireToolApproval` from `agent.stream()` second-arg options**
- Symptom: tool runs because approvalGated evaluates to false (resolver returns undefined/undefined → false)
- Mechanism unclear — could be: (a) `agent.stream()` second-arg is wrapped in an options envelope that strips requireToolApproval; (b) workflowLoopStream is NOT the actual code path used (e.g. agent falls back to `loop()` non-workflow stream); (c) `_internal` destructure swallows it.
- Test: add `console.log("[resolver]", ctx.toolName, rc.approvalMode)` to toolApprovalResolver and observe whether it fires in production. If never fires → Candidate A confirmed.

**Candidate B: approval chunk IS emitted and tool IS suspended, but the chunk translation misses it because of a chunk-type aliasing or processor stripping**
- Symptom: tool never runs (would have to be re-resumed via approve/decline endpoint)
- But user says "tool ran" → Candidate A is more consistent.
- Test: log `chunk.type` from `for await (const chunk of stream.fullStream)` and check whether `tool-call-approval` ever appears.

files_changed: []
