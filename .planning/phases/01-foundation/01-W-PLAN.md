---
phase: 1
plan: W
type: execute
wave: 3
gap_closure: true
gap_ids: [G-1-7b]
depends_on: ["01-T"]
files_modified:
  - app/components/ChatPanel.tsx
autonomous: true
must_haves:
  - "ChatPanel's approval-renderer filter swaps from `p.type === 'tool-approval-request'` to `p.type.startsWith('tool-') && (p as any).state === 'approval-requested' && !p.approval?.isAutomatic`"
  - "ApprovalCard receives `toolName`, `args`, `tier` read directly from the tool part (no separate tool-part lookup)"
  - "Dead code retired: `ApprovalRequestPart` type alias and `lookupToolPart` helper function"
  - "Auto-approved tool calls (`p.approval?.isAutomatic === true`) do NOT render an ApprovalCard"
  - "`pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx"
  - "Live: trigger createNote in tiered mode → ApprovalCard renders inline with the write_low UI (default border, Approve/Deny, "Approve all matching (5 min)"). Trigger applyMigrations in tiered mode → red-bordered card with DESTRUCTIVE badge + CONFIRM input."
requirements:
  - HITL-01
---

# 01-W — Phase 1 Gap Closure (ChatPanel renders ApprovalCard on AI SDK v7 tool part state)

Closes G-1-7b (major): AI SDK v7's chunk reducer at `node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/process-ui-message-stream.ts:746-758` handles a `tool-approval-request` wire chunk by MUTATING the existing `tool-<toolName>` part (looked up by `toolCallId`) — setting `state = 'approval-requested'` and adding `approval = { id: approvalId }`. It does NOT push a new top-level part with `type: 'tool-approval-request'`.

ChatPanel.tsx:233 currently filters on `if (p.type !== "tool-approval-request") return null;` — that part type never exists on `m.parts`, so the filter matches zero parts every turn and the `<ApprovalCard />` JSX at lines 247-256 never executes. The translator (worker/src/index.ts:165-170) correctly emits the wire chunk and the AI SDK parses it correctly; the failure is purely in the client-side renderer dimension.

ActionFeed.tsx:46-65 already inspects `tp.state === "approval-requested"` on the existing tool part — confirming the AI SDK puts the approval signal on the existing tool part, not on a new part type.

Fix is the renderer filter swap: change `p.type === "tool-approval-request"` to `p.type.startsWith("tool-") && (p as any).state === "approval-requested" && !p.approval?.isAutomatic`. Read `toolName`, `input`, `approval.id` directly from the tool part — no separate tool-part lookup needed. Retire the now-unused `ApprovalRequestPart` type alias and `lookupToolPart` helper function (they were scaffolding for a part type that never existed on the wire).

## Tasks

<task type="auto">
  <id>01-W1-renderer-filter-swap-and-dead-code-retirement</id>
  <read_first>
    - app/components/ChatPanel.tsx (lines 22-39 — ToolApprovalPart + ApprovalRequestPart + ToolPart types + lookupToolPart helper; lines 232-257 — the broken approval-renderer JSX) — verify line ranges before editing; 01-U and 01-V land first
    - node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/process-ui-message-stream.ts (lines 746-758 — `case 'tool-approval-request'` reducer that MUTATES the existing tool part)
    - node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/ui-messages.ts (lines 313-326, 431-444 — UIMessage schema for `state: 'approval-requested'` with `approval: { id, ... }`)
    - app/components/ActionFeed.tsx (lines 46-65 — how the tool part IS rendered today via `state === 'approval-requested'`; the pattern ChatPanel should adopt)
    - app/components/ApprovalCard.tsx (full file — accepts `tier`, `toolName`, `args`, `onApprove`, `onDecline`, `onApproveAll`)
    - .planning/debug/g-1-7b-write-low-card-renderer.md (full root-cause trace + suggested fix pattern)
  </read_first>
  <action>
    Two coordinated edits in `app/components/ChatPanel.tsx`. One file.

    **Edit 1 — Retire dead types + helper** (remove lines 22, 30-39).

    Current:

    ```
    interface ToolApprovalPart {
      type: string;
      toolCallId?: string;
      toolName?: string;
      args?: Record<string, unknown>;
      tier?: ApprovalTier;
    }

    // AI SDK v5 — approval-request chunk has { approvalId, toolCallId }.
    // Args + toolName live on the linked tool part (`tool-<name>` with same toolCallId).
    type ApprovalRequestPart = { type: "tool-approval-request"; approvalId: string; toolCallId: string };
    type ToolPart = { type: string; toolCallId?: string; toolName?: string; input?: Record<string, unknown> };

    function lookupToolPart(parts: unknown[], toolCallId: string): ToolPart | undefined {
      return (parts as ToolPart[]).find(
        (p) => typeof p?.type === "string" && p.type.startsWith("tool-") && p.toolCallId === toolCallId,
      );
    }
    ```

    Replacement:

    ```
    // ToolApprovalPart — the shape ChatPanel builds locally before handing to
    // <ApprovalCard />. NOT a wire part type; the wire carries `tool-<name>` parts
    // with `state: 'approval-requested'` + `approval: { id, ... }` (see
    // ai/src/ui/process-ui-message-stream.ts:746-758 — the approval-request chunk
    // MUTATES the existing tool part rather than pushing a new top-level part).
    interface ToolApprovalPart {
      type: string;
      toolCallId?: string;
      toolName?: string;
      args?: Record<string, unknown>;
      tier?: ApprovalTier;
    }
    ```

    Three changes:
    1. Drop `ApprovalRequestPart` type alias (lines 30-32) — it was scaffolding for a part type that never exists on `m.parts`.
    2. Drop `ToolPart` type alias (line 33) — only used by the dead helper below.
    3. Drop `lookupToolPart` helper function (lines 35-39) — no longer needed because the approval signal is on the same part that already carries `toolName` + `input` (the tool part itself).
    4. Keep `ToolApprovalPart` (the local shape passed to ApprovalCard) — it stays the bridge between the wire part and the card's prop surface.

    **Edit 2 — Swap the renderer filter** (replace lines 232-257).

    Current:

    ```
    {parts.map((p, i) => {
      if (p.type !== "tool-approval-request") return null;
      const ap = p as unknown as ApprovalRequestPart;
      const toolPart = lookupToolPart(parts, ap.toolCallId);
      const toolName = (toolPart?.toolName) ?? (toolPart?.type?.startsWith("tool-") ? toolPart.type.slice("tool-".length) : "unknown");
      const toolClass: ToolClass = toolName ? classify(toolName) : "write_low";
      const approvalTier: ToolApprovalPart["tier"] = toolClass === "write_high" ? "write_high" : "write_low";
      const approvalPart: ToolApprovalPart = {
        type: "tool-approval-request",
        toolCallId: ap.toolCallId,
        toolName,
        args: toolPart?.input ?? {},
        tier: approvalTier,
      };
      return (
        <ApprovalCard
          key={`card-${i}`}
          tier={approvalPart.tier ?? "write_low"}
          toolName={approvalPart.toolName ?? "unknown"}
          args={approvalPart.args ?? {}}
          onApprove={() => decide("approve", approvalPart)}
          onDecline={() => decide("decline", approvalPart)}
          onApproveAll={(pat) => decide("approve", approvalPart, pat)}
        />
      );
    })}
    ```

    Replacement:

    ```
    {parts.map((p, i) => {
      // AI SDK v7: the tool-approval-request chunk MUTATES the existing tool part
      // (looked up by toolCallId) to { state: 'approval-requested', approval: { id } }.
      // Filter on the tool part's state, not on a non-existent top-level part type.
      // ActionFeed.tsx:46-65 uses the same dimension — confirmed correct.
      const tp = p as unknown as {
        type: string;
        toolCallId?: string;
        toolName?: string;
        input?: Record<string, unknown>;
        state?: string;
        approval?: { id?: string; isAutomatic?: boolean };
      };
      if (!tp.type.startsWith("tool-") || tp.state !== "approval-requested") return null;
      // ponytail: skip auto-approved tool calls — they have no card to show.
      if (tp.approval?.isAutomatic) return null;
      // Read toolName/input/approval.id directly from the tool part (no separate lookup).
      const toolName = tp.toolName ?? tp.type.slice("tool-".length);
      const toolClass: ToolClass = toolName ? classify(toolName) : "write_low";
      const approvalTier: ToolApprovalPart["tier"] = toolClass === "write_high" ? "write_high" : "write_low";
      const approvalPart: ToolApprovalPart = {
        type: tp.type,
        toolCallId: tp.toolCallId,
        toolName,
        args: tp.input ?? {},
        tier: approvalTier,
      };
      return (
        <ApprovalCard
          key={`card-${tp.toolCallId ?? i}`}
          tier={approvalPart.tier ?? "write_low"}
          toolName={approvalPart.toolName ?? "unknown"}
          args={approvalPart.args ?? {}}
          onApprove={() => decide("approve", approvalPart)}
          onDecline={() => decide("decline", approvalPart)}
          onApproveAll={(pat) => decide("approve", approvalPart, pat)}
        />
      );
    })}
    ```

    Five changes:
    1. Filter swap: `p.type !== "tool-approval-request"` → `!tp.type.startsWith("tool-") || tp.state !== "approval-requested"`. The new filter matches the AI SDK v7 wire reality (approval signal on the tool part).
    2. Auto-approval guard: skip cards where `tp.approval?.isAutomatic === true` (these are tool calls where Mastra auto-approved without user input — no card needed). This handles the "always" approval mode path cleanly: when approvalMode is 'always', the resolver returns false (no gate, no card), but if a future Mastra version auto-approves with `isAutomatic: true`, this filter suppresses the card.
    3. Read directly from `tp` (no `lookupToolPart` helper) — `toolName`, `toolCallId`, `input` all live on the same part that carries the approval state.
    4. `approvalPart.toolCallId` now comes from `tp.toolCallId` (the real toolCallId the wire assigned), not from a separate approval-part lookup that could miss.
    5. Key uses `tp.toolCallId` for stable React reconciliation across re-renders — if the same tool call re-fires (e.g. after resume), the key stays stable.

    Do NOT change the `<ActionFeed parts={parts} />` rendering on line 231 (ActionFeed still uses its own dimension — confirmed correct, no changes needed).
    Do NOT change `decide()` (lines 156-186) — the approve/decline flow accepts `ToolApprovalPart` as it does today; the new `approvalPart` literal matches the same shape.
    Do NOT change `app/components/ApprovalCard.tsx` — its prop surface is correct.
    Do NOT change `app/components/ActionFeed.tsx` — its filter pattern is correct.
    Do NOT change `worker/src/index.ts` — the translator correctly emits the AI SDK v7 wire shape.
    Do NOT add `addToolApprovalResponse` wiring in this plan. That belongs to plan 01-Y (the server-side resume path) — this plan only fixes the renderer; the decide flow still POSTs to `/api/approve` and follows up with `sendMessage({text: "Continue with X (approved)"})`. Plan 01-Y upgrades the resume path to call `agent.approveToolCall({runId, toolCallId})`.
  </action>
  <files>app/components/ChatPanel.tsx</files>
  <verify>
    <automated>grep -nE 'type startsWith.*tool-.*state.*approval-requested' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'type !== "tool-approval-request"' app/components/ChatPanel.tsx | grep -c . | awk '{exit !($1==0)}' && grep -nE 'approval\?\.isAutomatic' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'lookupToolPart' app/components/ChatPanel.tsx | grep -c . | awk '{exit !($1==0)}' && ! grep -nE 'ApprovalRequestPart' app/components/ChatPanel.tsx | grep -c . | awk '{exit !($1==0)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E 'type\.startsWith\("tool-"\).*state.*approval-requested' app/components/ChatPanel.tsx` returns 1 match (new filter dimension present)
    - `grep 'type !== "tool-approval-request"' app/components/ChatPanel.tsx` returns 0 matches (old filter removed)
    - `grep 'approval?.isAutomatic' app/components/ChatPanel.tsx` returns 1+ match (auto-approval guard added)
    - `grep 'lookupToolPart' app/components/ChatPanel.tsx` returns 0 matches (dead helper removed)
    - `grep 'ApprovalRequestPart' app/components/ChatPanel.tsx` returns 0 matches (dead type alias removed)
    - `pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx (pre-existing 7 errors remain out-of-scope per the 01-E carryover list)
    - No edits in ActionFeed.tsx, ApprovalCard.tsx, worker/src/index.ts, or any worker file
  </acceptance_criteria>
  <done>ChatPanel renders ApprovalCard inline on tool parts whose state is 'approval-requested'. createNote in tiered mode produces a write_low card; applyMigrations in tiered mode produces a red-bordered write_high card with DESTRUCTIVE badge + CONFIRM input. Auto-approved tool calls (isAutomatic: true) produce no card. Dead code (ApprovalRequestPart type, lookupToolPart helper) is retired.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (write_low + write_high tools render approval cards inline)</implements>
  <commit>fix(chat): render ApprovalCard on tool part state — match AI SDK v7 wire shape</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| AI SDK v7 chunk reducer → m.parts | Reducer MUTATES the existing tool part on approval-request chunks (verified at process-ui-message-stream.ts:746-758). No new part type is pushed. ChatPanel's filter must match this reality. |
| Tool part state → ApprovalCard | ApprovalCard reads `toolName`, `args`, `tier` from its props. No network calls; no side effects. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-W-01 | Spoofing | Auto-approval bypass | low | mitigate | `tp.approval?.isAutomatic === true` filters out auto-approved tool calls; the resolver still gates write_low/write_high in tiered mode. The auto-approve toggle (approvalMode='always') is handled at the resolver layer (01-O), not at the renderer. |
| T-1-W-02 | Tampering | Tool part type matching | low | accept | `p.type.startsWith("tool-")` is the documented prefix for tool parts (AI SDK v7 source). Matches all four Phase 1 tools (echo/rag_query/createNote/applyMigrations). |

## Verification

1. Static: `grep` confirms filter dimension swap, auto-approval guard, dead-code retirement.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; toggle='tiered'; trigger "create a note called X saying Y" → ApprovalCard renders within ~1s of tool-input-available with toolName=createNoteTool (or createNote, depending on what classify() sees), tier=write_low (default border), Approve/Deny, "Approve all matching (5 min)" buttons. Trigger "apply database migrations" → red-bordered card with DESTRUCTIVE badge + CONFIRM input; Approve disabled until CONFIRM typed.

## Success criteria

- ApprovalCard renders inline on tool parts with state='approval-requested'.
- createNote in tiered produces write_low card; applyMigrations in tiered produces write_high card.
- Auto-approved tool calls produce no card.
- Dead type/helper code is retired.
- No regression on ActionFeed (still renders tool lifecycle independently).
- The approve flow continues to POST to `/api/approve`; this plan does NOT change the resume round-trip (that belongs to plan 01-Y).

## Artifacts this phase produces

- Modified: `app/components/ChatPanel.tsx` (renderer filter swap, auto-approval guard, dead-code retirement)
- Modified symbols: parts.map renderer (filter + ApprovalCard construction), `ToolApprovalPart` (kept), `ApprovalRequestPart` (removed), `ToolPart` (removed), `lookupToolPart` (removed)

## Output

Create `.planning/phases/01-foundation/01-W-SUMMARY.md` when done.
