---
status: diagnosed
trigger: "UAT gap G-1-8 — applyMigrations model-hallucinated CONFIRM gate"
created: 2026-08-20T18:00:00Z
updated: 2026-08-20T18:00:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: TWO distinct root causes — (a) tool description in apply-migrations.ts bakes "Requires typed-CONFIRM approval" into the model prompt; (b) ChatPanel.tsx hardcodes tier="write_low" for all approval cards, so even if (a) fires, write_high styling never renders.
test: confirmed by direct file inspection
expecting: confirmed; no further investigation needed
next_action: return structured ROOT CAUSE FOUND diagnosis

## Symptoms

expected: applyMigrations tool call pauses for human approval via red-bordered destructive card with typed-CONFIRM input. Tool call fires FIRST, then the gate holds execution.
actual: model never calls the tool — replies with text describing a typed-CONFIRM gate that doesn't exist in instructions or approval code.
errors: (none on the wire; symptom is the missing tool-call chunk)
reproduction: 1) browser, approval mode = "tiered"; 2) send "apply the database migrations"; 3) observe explanatory text instead of a tool-call
started: Phase 01 verification (test 7)

## Eliminated

- hypothesis: agent instructions (sdlc.ts) require typed CONFIRM
  evidence: sdlc.ts:19-22 instructions only say "use applyMigrations when the user asks to migrate. For everything else, answer from chat." No CONFIRM word anywhere.
  timestamp: 2026-08-20T18:00:00Z
- hypothesis: approval.ts / classify.ts contain a typed-CONFIRM branch
  evidence: approval.ts:36-50 resolveApproval returns boolean | "always" only; classify.ts returns "read" | "write_low" | "write_high". No text-input gate anywhere.
  timestamp: 2026-08-20T18:00:00Z

## Evidence

- timestamp: 2026-08-20T18:00:00Z
  checked: worker/src/tools/apply-migrations.ts lines 13-19
  found: tool description is "Apply database migrations (Phase 1 stub: no-op returning { attempted: true, rowsAffected: 0 }). Requires typed-CONFIRM approval."
  implication: the literal string "typed-CONFIRM approval" is shipped to the model as part of the tool metadata. The model reads it and reproduces the rule verbatim in chat instead of letting the SDK gate pause execution. This is the seed of the hallucination — the model is doing what the description literally says.

- timestamp: 2026-08-20T18:00:00Z
  checked: worker/src/agents/sdlc.ts lines 16-25
  found: agent instructions string lists tools and their tiers but never references CONFIRM, typed approval, or chat-time gating.
  implication: the agent instructions are clean. The CONFIRM phrasing comes solely from the tool description.

- timestamp: 2026-08-20T18:00:00Z
  checked: worker/src/lib/classify.ts line 14
  found: applyMigrations is classified as "write_high".
  implication: backend tier resolution is correct — resolveApproval("applyMigrations", { approvalMode: "tiered" }) returns "always" (pauses for the card). The frontend just throws this information away.

- timestamp: 2026-08-20T18:00:00Z
  checked: app/components/ChatPanel.tsx line 219
  found: `tier: "write_low",` hardcoded into the ToolApprovalPart object assembled at line 214-220, regardless of the actual tool.
  implication: every ApprovalCard in the chat is rendered as a write_low card — blue border, Approve/Deny buttons, "Approve all matching (5 min)" option. The red border, DESTRUCTIVE badge, and typed-CONFIRM input are gated on `tier === "write_high"` in ApprovalCard.tsx:31,69,84,101-122 and never trigger because tier is always "write_low".

- timestamp: 2026-08-20T18:00:00Z
  checked: app/components/ApprovalCard.tsx lines 31-32, 101-122
  found: red border ("#ff5252"), red background, DESTRUCTIVE badge, "Type CONFIRM to enable" label, and typed-CONFIRM input all branch on `isHigh = tier === "write_high"`. The "Approve all matching (5 min)" button is suppressed when isHigh (line 152).
  implication: the write_high UX is fully built — it just never gets reached because ChatPanel overwrites tier with "write_low".

## Resolution

root_cause: TWO independent root causes, both required to surface the symptom:
  (1) worker/src/tools/apply-migrations.ts:15-16 — tool description ships "Requires typed-CONFIRM approval" to the model; the model obeys it literally and emits the gate as chat text instead of calling the tool. ApprovalCard never renders because the tool-call chunk never fires.
  (2) app/components/ChatPanel.tsx:219 — `tier: "write_low"` is hardcoded when building ToolApprovalPart; even if (1) is fixed and the model does call the tool, the resulting card is forced to write_low styling (no red border, no CONFIRM input).
fix: (not applied — goal: find_root_cause_only)
  (1) Remove "Requires typed-CONFIRM approval" from applyMigrationsTool description. Replace with neutral language ("Apply pending database migrations. The harness pauses for human approval before execution."). Optional: harden sdlc.ts instructions with an explicit "Never invent approval gates — call the tool and let the harness decide."
  (2) Derive tier from the tool part's metadata (worker-side classification) or from a tier field on the approval-request chunk. The classifier already exists (classify.ts) and could be shipped to the client via the tool part type or a side-channel. At minimum, read it from the tool part's known class (createNote → write_low, applyMigrations → write_high) instead of the literal "write_low".
verification: (not run — goal: find_root_cause_only)
files_changed: []
