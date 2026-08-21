---
status: diagnosed
trigger: "UAT gap G-1-9 — Auto-Approve Toggle set to Always makes all cards disappear"
created: 2026-08-20T18:00:00Z
updated: 2026-08-20T18:00:00Z
---

## Current Focus

hypothesis: "toolApprovalResolver cannot read requestContext.approvalMode — uses property access on a RequestContext class instance, which always returns undefined regardless of approvalMode value sent from ChatPanel"
test: "Static analysis of resolver + RequestContext API surface"
expecting: "Independent root cause from G-1-7 — toggle will remain non-functional even after G-1-7 (card-rendering) is fixed"
next_action: "Return ROOT CAUSE FOUND to orchestrator"

## Symptoms

expected: "Switching AutoApproveToggle to 'Always' bypasses ApprovalCard; cards disappear; audit shows approval_decision='auto'"
actual: "Cannot observe contrast because ApprovalCard never renders in tiered either (G-1-7). Switched to Always and triggered createNote — tool still ran un-gated. No observable delta between tiered and always."
errors: "none observed directly — symptom is invisible because both paths skip the gate"
reproduction: "Set toggle to Always, send 'create a note' via ChatPanel → tool runs without ApprovalCard; same as tiered"

## Eliminated

- hypothesis: "requestContext is a plain object per Mastra types (Record<string, unknown>)"
  evidence: "Mastra's `ToolApprovalContext` type declares `requestContext?: Record<string, unknown>`, BUT at runtime the agent runtime passes the actual `RequestContext` class instance (from `@mastra/core/request-context`), not a plain-object snapshot. The instance stores values in a `private registry` Map; values are accessed via `.get(key)` / `.getRaw(key)`, NOT via property access. A TypeScript cast to `{ approvalMode?: ApprovalMode }` lies about the shape — the cast suppresses the error but does not turn the instance into a plain object."
  timestamp: "2026-08-20T18:00:00Z"

## Evidence

- timestamp: "2026-08-20T18:00:00Z"
  checked: "worker/src/agents/sdlc.ts:30-36"
  found: "Resolver does `const rc = (ctx.requestContext ?? {}) as { approvalMode?: ApprovalMode };` then `rc.approvalMode`. If `ctx.requestContext` is the RequestContext class instance, `rc.approvalMode` is always undefined — there is no `approvalMode` property on the instance."
  implication: "Resolver receives `approvalMode: undefined` in BOTH tiered and always modes → falls through to default branch in `resolveApproval` → returns 'always' (gate) in BOTH modes. Toggle has no effect."

- timestamp: "2026-08-20T18:00:00Z"
  checked: "worker/src/index.ts:97-99"
  found: "`new RequestContext()` then `setRaw(\"approvalMode\", approvalMode ?? \"tiered\")` and `setRaw(\"sessionId\", ...)`. setRaw is the runtime-only open-map path. Comment on line 96 confirms intent."
  implication: "Value IS being stored on the RequestContext; downstream read is the broken side."

- timestamp: "2026-08-20T18:00:00Z"
  checked: "node_modules/@mastra/core/dist/_types/@internal_core/dist/request-context/index.d.ts"
  found: "RequestContext class has `setRaw(key, value)`, `getRaw(key)`, `hasRaw(key)`. No public `approvalMode` property. Values live in a `private registry` Map."
  implication: "Property access is not the supported API; `.getRaw(\"approvalMode\")` is."

- timestamp: "2026-08-20T18:00:00Z"
  checked: "worker/src/lib/approval.ts:36-50"
  found: "resolveApproval returns `false` when `ctx.approvalMode === \"always\"`. So a working resolver would return false (no gate) in Always mode and `\"always\"` (gate) in tiered mode."
  implication: "Fixing the resolver read would surface the intended contrast: cards in tiered, no cards in Always."

- timestamp: "2026-08-20T18:00:00Z"
  checked: "app/components/ChatPanel.tsx:74, 90, 171"
  found: "approvalMode state threads through DefaultChatTransport body to /api/chat; worker reads it from body at index.ts:80. AutoApproveToggle onChange → setApprovalMode → re-renders transport body. Path is wired correctly."
  implication: "Hypotheses A and B ruled out by static reading — toggle does propagate, and the value reaches `setRaw`. Bug is exclusively at the resolver read site (sdlc.ts:33)."

## Resolution

root_cause: "toolApprovalResolver (worker/src/agents/sdlc.ts:33) reads approvalMode via TypeScript cast + property access: `(ctx.requestContext ?? {}) as { approvalMode?: ApprovalMode }` then `rc.approvalMode`. The runtime value of `ctx.requestContext` is the RequestContext CLASS INSTANCE (not a plain object — the type docstring says 'plain object view' but the actual instance is passed). The instance stores values in a private Map and exposes them only via `.get(key)` / `.getRaw(key)`. Property access therefore always returns undefined. Result: `resolveApproval` is called with `approvalMode: undefined` regardless of the toggle's actual state, so 'tiered' and 'always' both fall through to the gate path. The toggle contrast is invisible at the resolver layer."

fix: "Change sdlc.ts:33 from `const rc = (ctx.requestContext ?? {}) as { approvalMode?: ApprovalMode };` to `const rc = (ctx.requestContext as { getRaw?: (k: string) => unknown } | undefined) ?? {}; const approvalMode = (rc.getRaw?.(\"approvalMode\") ?? rc.approvalMode) as ApprovalMode | undefined;`. Or normalize upstream: cast at the call site in worker/src/index.ts to pass a plain Record<string, unknown> snapshot of the request context (call `Object.fromEntries(requestContext.entries())`) into the agent.stream call's requestContext option. Ponytail minimum: one-line change at the read site, no extra abstraction."

verification: |
  - Type-check passes (cast adjusted).
  - Manual: trigger createNote with toggle='tiered' → ApprovalCard renders (assumes G-1-7 fix is in).
  - Manual: switch toggle to 'always', trigger createNote → no ApprovalCard; tool executes silently.
  - Console log on resolver: should show `mode=tiered` vs `mode=always` per toggle state.

files_changed:
  - "worker/src/agents/sdlc.ts"

## Independence from G-1-7

G-1-7 (cards don't render in tiered) and G-1-9 (toggle contrast invisible) are independent failures:

1. G-1-7 root cause (per UAT note): "createNoteTool executed and echoed args back. No ApprovalCard rendered." Plus the G-1-8 note: "ChatPanel hardcodes tier='write_low' for all approvals — would not show red/CONFIRM even if it fired." Likely the stream translator at worker/src/index.ts:151-156 emits `tool-approval-request` chunks, but ChatPanel's `parts.map` filter at line 209 only renders when `p.type === \"tool-approval-request\"`. The chunk arrives, but something in the render path is failing — possibly the chunk payload shape mismatch (the translator emits `approvalId` + `toolCallId` but ChatPanel looks for `toolCallId` on the tool part via `lookupToolPart`). Separate diagnosis required.

2. G-1-9 root cause (this diagnosis): resolver read bug in sdlc.ts:33. Will surface AFTER G-1-7 is fixed, because only then will cards render and a contrast be observable.

Fixing G-1-7 will NOT fix G-1-9. The two gaps need separate plans.
