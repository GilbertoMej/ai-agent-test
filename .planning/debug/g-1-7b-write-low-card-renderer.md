---
status: diagnosed
trigger: "UAT gap G-1-7b — ApprovalCard never renders despite tool-approval-request chunk arriving on SSE wire with correct approvalId+toolCallId. Translator works. Tool still executes un-gated. ChatPanel ignores tool-approval-request chunks."
created: 2026-08-20
updated: 2026-08-20
---

## Current Focus

hypothesis: ChatPanel uses the wrong part filter (`p.type === "tool-approval-request"`) — the AI SDK v7 chunk reducer at `node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/process-ui-message-stream.ts:746-758` does NOT create a separate `tool-approval-request` part; it mutates the existing `tool-<toolName>` part to `{ state: 'approval-requested', approval: { id: approvalId } }`. So the filter in ChatPanel.tsx:232-257 finds zero matching parts and never renders ApprovalCard.
test: grep + source read confirmed; AI SDK v7 official docs (`docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx:131-134, 225-228, 286-289, 462-468`) explicitly tell clients to render via `part.state === 'approval-requested'` on the existing tool part.
expecting: filter swap will make ApprovalCard render — but tool execution is still un-gated (G-1-15 cross-link, separate root cause at the Mastra 1.60 streaming flow level).
next_action: return ROOT CAUSE FOUND to caller (find_root_cause_only mode — no fix applied).

## Symptoms

<!-- IMMUTABLE -->

expected: Tool calls createNote → ApprovalCard appears inline with Approve/Deny buttons + 5-min grant option
actual: ApprovalCard never renders. User sees only the tool call bubble + tool result bubble. Wire evidence shows tool-approval-request chunk emitted with correct approvalId+toolCallId, translator path works.
errors: none on wire; silent drop in client render
reproduction: Test 6 in UAT — toggle 'tiered', send 'create a note with text X'
started: Discovered 2026-08-20 during UAT retest after gap-closure plans K-S

## Eliminated

- hypothesis: "Worker translator emits the wrong chunk shape"
  evidence: `worker/src/index.ts:165-170` emits `data: {"type":"tool-approval-request","approvalId":"...","toolCallId":"..."}` — exact shape required by AI SDK v7 schema at `ui-message-chunks.ts:85-90`. AI SDK's official `to-ui-message-chunk.ts:252-259` uses the same shape.
  timestamp: 2026-08-20
- hypothesis: "useChat's DefaultChatTransport does not parse the tool-approval-request chunk"
  evidence: `process-ui-message-stream.ts:746-758` (`case 'tool-approval-request'`) is the AI SDK's stock reducer path — DefaultChatTransport routes all parsed chunks through `process-ui-message-stream`. Chunk is recognized.
  timestamp: 2026-08-20
- hypothesis: "ActionFeed blocks the approval rendering somehow"
  evidence: ActionFeed.tsx:46 explicitly returns null for `tp.type === "tool-approval-request"` (deliberate handoff to ChatPanel). ActionFeed handles tool parts via state, not via separate approval parts — does not interfere.
  timestamp: 2026-08-20
- hypothesis: "ApprovalCard component is not imported / not reachable"
  evidence: ChatPanel.tsx:6 imports `ApprovalCard, type ApprovalTier` from "./ApprovalCard". ApprovalCard is invoked inside a conditional render — that conditional never fires (root cause below).
  timestamp: 2026-08-20
- hypothesis: "sessionId:'' empty in payload is the root cause"
  evidence: That breaks G-1-12 audit row association — orthogonal to rendering. Tool part still arrives with correct `state: 'approval-requested'` regardless of sessionId in body. Cross-link only.
  timestamp: 2026-08-20

## Evidence

- timestamp: 2026-08-20
  checked: `node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/process-ui-message-stream.ts:746-758`
  found: |
    case 'tool-approval-request': {
      const toolInvocation = getToolInvocation(chunk.toolCallId);
      toolInvocation.state = 'approval-requested';
      toolInvocation.approval = {
        id: chunk.approvalId,
        ...(chunk.isAutomatic === true ? { isAutomatic: true } : {}),
        ...(chunk.signature != null ? { signature: chunk.signature } : {}),
      };
      write();
      break;
    }
  implication: Reducer MUTATES the existing tool part (looked up by toolCallId). It does NOT push a new part with `type: 'tool-approval-request'` onto `m.parts`. So ChatPanel.tsx:233's filter `if (p.type !== "tool-approval-request") return null` finds no match — the loop body never executes, and `<ApprovalCard />` is never rendered.

- timestamp: 2026-08-20
  checked: `node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/ui-messages.ts:313-326, 431-444`
  found: |
    | {
        state: 'approval-requested';
        input: asUITool<TOOL>['input'];
        output?: never;
        errorText?: never;
        callProviderMetadata?: ProviderMetadata;
        approval: { id: string; approved?: never; ... };
      }
  implication: UIMessage schema treats approval as a STATE on the existing tool part (`type: 'tool-<toolName>'`), with `approval: { id, ... }` as a side field — not a new top-level part type. Confirms no `tool-approval-request` part ever exists on `m.parts`.

- timestamp: 2026-08-20
  checked: `node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx:131-134, 225-228, 286-289, 439-468`
  found: |
    "Typed tool parts also include the `approval-requested`, `approval-responded`, and `output-denied` states. Include these states when handling `part.state` exhaustively..."
    "case 'approval-requested': return <div>Approval requested.</div>;"
    "When a tool requires manual approval, the tool part state is `approval-requested`. Automatic approvals and denials also flow through the same approval states..."
  implication: Official AI SDK v7 docs render approval UI via `part.state === 'approval-requested'` on the existing tool part. ChatPanel's `p.type === "tool-approval-request"` filter is misaligned with the documented pattern.

- timestamp: 2026-08-20
  checked: `app/components/ChatPanel.tsx:227-257`
  found: |
    // line 232-234:
    {parts.map((p, i) => {
      if (p.type !== "tool-approval-request") return null;
      const ap = p as unknown as ApprovalRequestPart;
      // ... constructs approvalPart + <ApprovalCard />
    })}
    // line 22-28 — ToolApprovalPart type declared with `type: string` (not constrained).
    // line 32 — ApprovalRequestPart declared but never appears in m.parts at runtime.
  implication: The entire approval-rendering JSX is gated behind a filter that can never be true. Result: zero renders regardless of how many approval chunks arrive on the wire.

- timestamp: 2026-08-20
  checked: `app/components/ActionFeed.tsx:46-65` — how the tool part IS rendered today
  found: |
    if (tp.type === "tool-approval-request") return null; // ChatPanel renders ApprovalCard
    if (tp.type.startsWith("tool-")) {
      const toolName = tp.toolName ?? tp.type.slice("tool-".length);
      if (tp.state === "output-available") return <ActionFeedEntry ... status="success" />;
      if (tp.state === "output-error") ...;
      return <ActionFeedEntry status={tp.state === "approval-requested" ? "approval" : "running"} ... />;
    }
  implication: ActionFeed correctly inspects `tp.state === "approval-requested"` — confirming the AI SDK puts the approval signal on the existing tool part. ChatPanel uses the wrong filter dimension (part.type instead of part.state). Note: ActionFeed already shows the "approval" status pill inline even though ChatPanel fails to render the actual ApprovalCard.

- timestamp: 2026-08-20
  checked: `worker/src/index.ts:155-170` — chunk translator
  found: |
    } else if (chunk.type === "tool-call") {
      // emits { type: "tool-input-available", toolCallId, toolName: lastToolName, input: args }
    } else if (chunk.type === "tool-call-approval") {
      // emits { type: "tool-approval-request", approvalId: toolCallId, toolCallId }
    }
  implication: Translator correctly creates the `tool-<toolName>` part via `tool-input-available` (which sets state to `input-available`), then later mutates it to `approval-requested` via the `tool-approval-request` chunk. Wire + reducer chain verified end-to-end.

- timestamp: 2026-08-20
  checked: Cross-link to G-1-15
  found: UAT 7 shows `tool=applyMigrationsTool` runs after `[chat-debug] chunk=tool-call-approval` — Mastra 1.60's streaming flow does NOT actually pause tool execution on `requireToolApproval: true`. The chunk is informational only; the tool runs anyway.
  implication: Even with the renderer fix, write_low/write_high tools still execute un-gated at the worker level. G-1-7b (renderer) and G-1-15 (gate mechanism) are independent: renderer fix is necessary for the visual card, but it does not produce actual gating without a separate worker-side gate.

## Resolution

root_cause: **ChatPanel filters on a part type that never exists in `m.parts`.** The AI SDK v7 chunk reducer at `process-ui-message-stream.ts:746-758` handles a `tool-approval-request` wire chunk by MUTATING the existing `tool-<toolName>` part (looked up by `toolCallId`) — setting `state = 'approval-requested'` and adding `approval = { id: approvalId }` — and does NOT push a new top-level part with `type: 'tool-approval-request'`. ChatPanel.tsx:233's filter `if (p.type !== "tool-approval-request") return null` therefore matches zero parts every turn, and the `<ApprovalCard />` JSX at lines 247-256 never executes. The translator (`worker/src/index.ts:165-170`) is correct and the AI SDK parses the chunk correctly; the failure is purely in the client-side renderer dimension.

fix: |
  (Suggested — not applied, find_root_cause_only mode.)
  In ChatPanel.tsx, replace the `parts.map((p, i) => { if (p.type !== "tool-approval-request") return null; ... })` block (lines 232-257) with a filter on the existing tool part:

    {parts.map((p, i) => {
      if (!(p.type.startsWith("tool-") && (p as any).state === "approval-requested")) return null;
      const tp = p as unknown as { type: string; toolCallId?: string; toolName?: string; input?: Record<string, unknown>; approval?: { id: string; isAutomatic?: boolean } };
      if (tp.approval?.isAutomatic) return null; // auto-decided — no card needed
      const toolName = tp.toolName ?? tp.type.slice("tool-".length);
      const toolClass: ToolClass = classify(toolName);
      const tier: ToolApprovalPart["tier"] = toolClass === "write_high" ? "write_high" : "write_low";
      return (
        <ApprovalCard
          key={`card-${tp.toolCallId ?? i}`}
          tier={tier}
          toolName={toolName}
          args={tp.input ?? {}}
          onApprove={() => decide("approve", { type: "tool-approval-request", toolCallId: tp.toolCallId, toolName, args: tp.input ?? {}, tier })}
          onDecline={() => decide("decline", { type: "tool-approval-request", toolCallId: tp.toolCallId, toolName, args: tp.input ?? {}, tier })}
          onApproveAll={(pat) => decide("approve", { type: "tool-approval-request", toolCallId: tp.toolCallId, toolName, args: tp.input ?? {}, tier }, pat)}
        />
      );
    })}

  Also retire the now-unused `ApprovalRequestPart` type and `lookupToolPart` helper (lines 32, 35-39) — they were scaffolding for a part type that never exists. Decide handler already posts to /api/approve with the approvalId-less payload it had; that path needs review against AI SDK v7's `addToolApprovalResponse` flow (see `chat.ts:507-516`) to round-trip the response chunk — without it, the tool will still never actually resume.

  IMPORTANT cross-link: this fix alone does NOT gate tool execution. G-1-15 (Mastra 1.60's `requireToolApproval: true` resolver returning `true` does NOT pause the tool in streaming mode — the chunk is a notification, not a pause) is a separate, independent root cause at the worker stream translator. Renderer fix makes the card visible; gate fix makes the tool actually wait.

verification: |
  Manual: pnpm dev → tiered mode → "create a note called X saying Y" → ApprovalCard appears inline within ~1s of tool-input-available. Card shows toolName=createNoteTool, tier=write_low, args={...}, Approve/Deny buttons, "Approve all matching (5 min)" button. Note: tool still runs un-gated until G-1-15 (worker-side gate) is also fixed.

files_changed:
  - app/components/ChatPanel.tsx (renderer filter swap + dead-code cleanup)
