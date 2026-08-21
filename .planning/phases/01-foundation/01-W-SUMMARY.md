---
phase: 01-foundation
plan: W
subsystem: ui
tags: [chat, ai-sdk, tool-part, approval-card, hitl, dead-code, render]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "ChatPanel.tsx with useChat + DefaultChatTransport (01-V); toolApprovalResolver at worker/src/lib/approval (01-C); classify() at worker/src/lib/classify (01-C)"
provides:
  - "ChatPanel renders <ApprovalCard /> inline on tool parts whose state === 'approval-requested' (matches AI SDK v7 wire shape)"
  - "Auto-approved tool calls (approval.isAutomatic === true) produce NO card"
  - "Dead code retired: ApprovalRequestPart type alias + ToolPart type alias + lookupToolPart helper"
affects: [01-X, 01-Y, 01-Z, verify-work-1]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 1110   # 4437 bytes of diff / 4
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AI SDK v7 tool-approval-request chunk reducer (node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/process-ui-message-stream.ts:746-758) MUTATES the existing tool part to { state: 'approval-requested', approval: { id, ... } } rather than pushing a new top-level part with type='tool-approval-request'"
    - "Pattern: client-side approval renderer must filter on the tool part's state dimension, not on a non-existent top-level part type. ActionFeed.tsx:46-65 already uses this dimension — same pattern applies to ApprovalCard."
    - "Pattern: when a part type never exists on the wire, retire the type alias + helper that scaffolded it. The tool part itself carries toolName/input/approval; no separate lookup is needed."

key-files:
  modified:
    - app/components/ChatPanel.tsx

key-decisions:
  - "Filter swap: p.type !== 'tool-approval-request' → !tp.type.startsWith('tool-') || tp.state !== 'approval-requested'. The new dimension matches what the AI SDK v7 chunk reducer actually emits on the wire."
  - "Add auto-approval guard: tp.approval?.isAutomatic === true → no card. The resolver still gates write_low/write_high in tiered mode; this only suppresses the card when the chunk explicitly marks the call auto-approved."
  - "Retire ApprovalRequestPart type alias + ToolPart type alias + lookupToolPart helper. These were scaffolding for a part type that never exists on m.parts — the tool part itself carries toolName/input/approval.id."
  - "Use tp.toolCallId as the React key (was array index). Stable across re-renders — if the same tool call re-fires (e.g. after resume), the key stays stable."
  - "Read toolName/input/approval.id directly from the tool part. No separate tool-part lookup needed — the approval signal lives on the same part that carries toolName + input."
  - "Do NOT change decide() (lines 156-186 unchanged) — the approve/decline flow already accepts ToolApprovalPart as it does today; the new approvalPart literal matches the same shape."
  - "Do NOT change ActionFeed.tsx, ApprovalCard.tsx, or worker/src/index.ts — all three already use the correct dimension."
  - "Do NOT add addToolApprovalResponse wiring in this plan — that belongs to 01-Y (server-side resume path). This plan only fixes the renderer; the decide flow still POSTs to /api/approve and follows up with sendMessage({text: 'Continue with X (approved)'}).

patterns-established:
  - "Pattern: when a chunk reducer MUTATES an existing part instead of pushing a new one, the client-side filter must read the same part's state field, not look for a non-existent top-level part type. Verify against the AI SDK source (process-ui-message-stream.ts:746-758) before trusting the part shape."
  - "Pattern: if a typed bridge (type alias + helper) was scaffolding for a wire part type that never exists, the right move is retirement, not a conditional fix. The smallest correct change is one that matches the wire reality."

# TDD Gate Compliance
gate_status: not-applicable  # task is a renderer fix, not behavior-adding TDD per the centralized predicate

requirements-completed: [HITL-01]

coverage:
  - id: D1
    description: "Renderer filter swapped from non-existent top-level part type to AI SDK v7 wire reality: p.type.startsWith('tool-') && p.state === 'approval-requested' && !p.approval?.isAutomatic."
    requirement: "HITL-01"
    verification:
      - kind: other
        ref: "grep -nE 'type\\.startsWith.*tool-.*state.*approval-requested' app/components/ChatPanel.tsx → 1 match (line 251)"
        status: pass
      - kind: other
        ref: "grep -nE 'type !== \"tool-approval-request\"' app/components/ChatPanel.tsx → 0 matches (old filter removed)"
        status: pass
      - kind: other
        ref: "grep -nE 'approval\\?\\.isAutomatic' app/components/ChatPanel.tsx → 1 match (line 253)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dead code retired: ApprovalRequestPart type alias + ToolPart type alias + lookupToolPart helper function."
    requirement: "HITL-01"
    verification:
      - kind: other
        ref: "grep -nE 'lookupToolPart' app/components/ChatPanel.tsx → 0 matches"
        status: pass
      - kind: other
        ref: "grep -nE 'ApprovalRequestPart' app/components/ChatPanel.tsx → 0 matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "TypeScript introduces no new errors in ChatPanel.tsx (pre-existing 2 errors in lib/insforge.ts remain out-of-scope per the 01-E carryover list)."
    requirement: "HITL-01"
    verification:
      - kind: other
        ref: "npx tsc --noEmit 2>&1 | grep -i 'ChatPanel' → empty (no ChatPanel errors); only 2 pre-existing errors remain in lib/insforge.ts (TS2724 + TS2353) — unrelated to this fix"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live: trigger createNote in tiered mode → ApprovalCard renders inline with the write_low UI (default border, Approve/Deny, 'Approve all matching (5 min)'). Trigger applyMigrations in tiered mode → red-bordered card with DESTRUCTIVE badge + CONFIRM input."
    requirement: "HITL-01"
    verification:
      - kind: manual
        ref: "pnpm dev; toggle='tiered'; trigger 'create a note called X saying Y' → ApprovalCard renders within ~1s of tool-input-available with toolName=createNoteTool (or createNote), tier=write_low (default border), Approve/Deny, 'Approve all matching (5 min)' buttons. Trigger 'apply database migrations' → red-bordered card with DESTRUCTIVE badge + CONFIRM input; Approve disabled until CONFIRM typed."
        status: pending  # manual end-to-end is the verify-work-1 gate's job
    human_judgment: true

---

# Phase 01 Plan W: ChatPanel renders ApprovalCard on AI SDK v7 tool part state — Summary

**One-liner:** ApprovalCard renderer swapped from a non-existent top-level part type (`tool-approval-request`) to the AI SDK v7 wire reality (`tool-<name>` part with `state === 'approval-requested'` + `approval.isAutomatic` guard); dead type alias + helper retired; type-checker reports zero new errors.

## What was built

Single-file edit to `app/components/ChatPanel.tsx`. Two coordinated changes:

### 1. Renderer filter swap (lines 238-275)

Before, ChatPanel filtered on `p.type !== "tool-approval-request"` and looked up the linked tool part via `lookupToolPart(parts, ap.toolCallId)`. The AI SDK v7 chunk reducer at `node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/src/ui/process-ui-message-stream.ts:746-758` does NOT push a new top-level part with `type: 'tool-approval-request'` — it MUTATES the existing `tool-<toolName>` part (looked up by `toolCallId`) to `{ state: 'approval-requested', approval: { id: approvalId } }`. The old filter matched zero parts every turn and the `<ApprovalCard />` JSX never rendered.

After, the filter reads the same dimension `ActionFeed.tsx:46-65` already uses:

```ts
const tp = p as unknown as {
  type: string; toolCallId?: string; toolName?: string;
  input?: Record<string, unknown>; state?: string;
  approval?: { id?: string; isAutomatic?: boolean };
};
if (!tp.type.startsWith("tool-") || tp.state !== "approval-requested") return null;
if (tp.approval?.isAutomatic) return null;
```

`toolName` / `input` / `approval.id` are read directly from the tool part — no separate lookup needed. React key is `tp.toolCallId ?? i` (stable across re-renders).

### 2. Dead code retirement (lines 22-39)

Three scaffolding artifacts removed:

- `ApprovalRequestPart` type alias — scaffolding for a part type that never exists on the wire.
- `ToolPart` type alias — only used by the dead helper.
- `lookupToolPart` helper function — no longer needed because the approval signal lives on the same part that already carries `toolName` + `input`.

`ToolApprovalPart` (the local shape passed to `<ApprovalCard />`) is kept — it remains the bridge between the wire part and the card's prop surface.

## Deviations from Plan

### Auto-fixed Issues

None.

### Plan-regex typo (no code change required)

**1. [Verification regex typo] Plan's verify regex used `type startsWith` (space) instead of `type.startsWith` (dot)**
- **Found during:** Task 1 verification
- **Issue:** The plan's literal `<automated>` grep used `type startsWith.*tool-.*state.*approval-requested`. The actual code uses `tp.type.startsWith("tool-") || tp.state !== "approval-requested"` — a dot, not a space. The plan's regex matched zero lines; the corrected regex (`type\.startsWith.*tool-.*state.*approval-requested`) matches line 251 (1 match).
- **Fix:** None required to the code — the code is correct. Verified by running the corrected regex plus all other 4 acceptance checks individually:
  - new filter: 1 match
  - old filter removed: 0 matches
  - auto-approval guard: 1 match
  - `lookupToolPart` removed: 0 matches
  - `ApprovalRequestPart` removed: 0 matches
- **Files modified:** None.
- **Commit:** 58b60cb.

## Auth Gates

None.

## Known Stubs

None.

## Threat Flags

None new. Threat model T-1-W-01 (auto-approval bypass) mitigated inline by `tp.approval?.isAutomatic` guard (line 253). T-1-W-02 (tool part type matching) accepted — `startsWith("tool-")` matches all four Phase 1 tools.

## Self-Check

PASSED:
- [x] `app/components/ChatPanel.tsx` exists and modified
- [x] Commit 58b60cb exists (`fix(chat): render ApprovalCard on tool part state — match AI SDK v7 wire shape`)
- [x] All 5 acceptance-criteria grep checks pass with corrected regex
- [x] `npx tsc --noEmit` introduces zero new errors in ChatPanel.tsx
