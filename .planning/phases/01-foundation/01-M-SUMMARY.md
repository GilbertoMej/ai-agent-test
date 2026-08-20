---
phase: 01-foundation
plan: M
subsystem: hitl
tags: [approval-tier, tool-classifier, prompt-bias, model-bias, frontend-import]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "3-tier tool classifier (classify.ts), ApprovalCard with write_high branch, applyMigrations stub tool"
provides:
  - "Tool description that does not bias the model to hallucinate a typed-CONFIRM gate"
  - "ApprovalCard tier derived from classify(toolName) instead of a hardcoded write_low"
  - "Direct client-bundle import path for classify() that avoids the audit re-export's transitive db/client load"
affects: [01-foundation, hitl-verify, future approval UX work]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
actuals:
  tokens: 180
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure modules safe for client bundle must be imported directly, not via re-exports that transitively pull in server-only side effects"
    - "Tool descriptions must document harness behavior without injecting literal approval-gate instructions that bias the model"

key-files:
  created: []
  modified:
    - "worker/src/tools/apply-migrations.ts — neutral description; no literal typed-CONFIRM phrase"
    - "app/components/ChatPanel.tsx — approval tier derived from classify(toolName)"

key-decisions:
  - "Import classify directly from @/worker/src/lib/classify, NOT from @/worker/src/lib/audit (audit pulls db/client → postgres() at module load → throws without DATABASE_URL)"
  - "Default unknown / read toolClass to write_low tier (safety net for unknown tools; resolver already auto-approves 'read' upstream)"

patterns-established:
  - "Pure classifier module is the canonical import path for both server (audit) and client (ChatPanel) — single source of truth, two import surfaces"
  - "Tool description authorship pattern: describe what the harness does (resolver + ApprovalCard), tell the model not to invent its own gate"

requirements-completed: [HITL-01]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "applyMigrationsTool description no longer contains the literal 'Requires typed-CONFIRM approval' bias phrase; replaced with neutral harness-behavior guidance"
    requirement: HITL-01
    verification:
      - kind: automated_ui
        ref: "grep -nE 'Requires typed-CONFIRM approval' worker/src/tools/apply-migrations.ts → 0 matches"
        status: pass
      - kind: automated_ui
        ref: "grep -nE 'do not invent any additional gate' worker/src/tools/apply-migrations.ts → 1 match"
        status: pass
      - kind: automated_ui
        ref: "grep -nE 'id:\\s*\"applyMigrations\"' worker/src/tools/apply-migrations.ts → 1 match (unchanged)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ChatPanel.tsx derives approval tier from classify(toolName) instead of hardcoded 'write_low'"
    requirement: HITL-01
    verification:
      - kind: automated_ui
        ref: "grep -nE 'import.*classify.*@/worker/src/lib/classify' app/components/ChatPanel.tsx → 1 match"
        status: pass
      - kind: automated_ui
        ref: "grep -nE 'const toolClass:\\s*ToolClass\\s*=' app/components/ChatPanel.tsx → 1 match"
        status: pass
      - kind: automated_ui
        ref: "grep -nE 'tier:\\s*\"write_low\",\\s*$' app/components/ChatPanel.tsx → 0 matches"
        status: pass
      - kind: automated_ui
        ref: "grep -nE 'approvalTier' app/components/ChatPanel.tsx → 2 matches"
        status: pass
      - kind: automated_ui
        ref: "pnpm tsc --noEmit → 0 errors in apply-migrations.ts or ChatPanel.tsx (2 pre-existing errors in lib/insforge.ts unchanged)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live: applyMigrations tool call surfaces red-bordered card with DESTRUCTIVE badge and typed-CONFIRM input; Approve button disabled until user types 'CONFIRM'"
    requirement: HITL-01
    verification:
      - kind: manual_procedural
        ref: "pnpm dev → trigger applyMigrations → expect write_high card UX (red border, DESTRUCTIVE, CONFIRM input)"
        status: unknown
    human_judgment: true
    rationale: "Visual UX verification requires a running dev server + browser interaction; static checks confirm the code path that drives the UX."

# Metrics
duration: 3min
completed: 2026-08-20
status: complete
---

# Phase 1 Plan M: G-1-8 Gap Closure Summary

**Closes G-1-8: applyMigrations tool no longer biases the model; approval tier derives from classify() so write_high tools surface the red-bordered CONFIRM card.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-08-20T23:39:24Z
- **Completed:** 2026-08-20T23:42:48Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- Neutralized `applyMigrationsTool` description — removed the literal "Requires typed-CONFIRM approval" phrase that was biasing the model to emit a typed-CONFIRM gate as chat text. Replaced with neutral harness-behavior guidance ("The harness pauses for human approval before execution — do not invent any additional gate").
- Derived the approval `tier` in `ChatPanel.tsx` from `classify(toolName)` instead of the hardcoded `"write_low"`. `applyMigrations` (write_high) now flows through to the red-bordered, DESTRUCTIVE, CONFIRM-input card; `createNote` (write_low) keeps the default Approve/Deny UX with "Approve all matching (5 min)".
- Established the canonical client-bundle import path for `classify()` — `@/worker/src/lib/classify` directly (pure module, no DB side effects), NOT `@/worker/src/lib/audit` (which transitively imports `db/client` → `postgres(url)` at module load, throws without DATABASE_URL, can't be tree-shaken because top-level `postgres(url)` is a real side effect).

## Task Commits

Each task was committed atomically:

1. **Task 1: 01-M1-neutralize-apply-migrations-description** - `904bfa6` (fix)
2. **Task 2: 01-M2-derive-tier-from-classify** - `89181d3` (fix)

**Plan metadata:** pending final docs commit

_Note: No TDD — this is a 2-line text + 4-line code patch, not a feature with new behavior to test against a unit surface._

## Files Created/Modified

- `worker/src/tools/apply-migrations.ts` — Replaced literal "Requires typed-CONFIRM approval" with two-sentence neutral description using the existing string-concatenation style (matches `worker/src/agents/sdlc.ts:19-22`).
- `app/components/ChatPanel.tsx` — Added `import { classify, type ToolClass } from "@/worker/src/lib/classify";`. Replaced the literal `tier: "write_low"` with `tier: approvalTier` derived from `classify(toolName)` (write_high → write_high; everything else → write_low as safety net).

## Decisions Made

- **Direct import from `@/worker/src/lib/classify` over the `@/worker/src/lib/audit` re-export.** `classify.ts` is pure (no DB import, no `postgres()` call). `audit.ts` re-exports `classify` for server-side callers but transitively imports `db/client` — Next.js tree-shaking can't strip the top-level `postgres(url)` side effect, so shipping audit through the client bundle throws on missing DATABASE_URL. The same source of truth (`classify.ts`) is reachable via two different import surfaces; the client takes the direct path.
- **Default unknown / read `ToolClass` to `write_low` tier.** `'read'` tools should never reach the approval part because the resolver auto-approves them upstream; the `'write_low'` default is a safety net for unknown tool names. The classifier's "everything not explicitly read/write_low lands here" rule already routes unknowns to `write_high` server-side, but the client-side mapping is intentionally permissive (write_low) so a missing classifier entry doesn't accidentally trip the DESTRUCTIVE UI on a benign tool.

## Deviations from Plan

None - plan executed exactly as written. Both atomic edits, both static checks green, both `pnpm tsc --noEmit` clean for the touched files (pre-existing 2 errors in `lib/insforge.ts` unchanged, not in scope).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

G-1-8 closed. The HITL gate UX is now correctly tiered end-to-end: server-side `classify()` decides the tier; the resolver pauses or auto-approves; the client-side `classify()` import + `tier` derivation in `ChatPanel.tsx` produces the correct card visual. Phase 2 (Notion MCP Integration) can proceed.

The remaining gap-closure plans (`01-N` through `01-S`) are unrelated to HITL-01 and can be sequenced independently.

---
*Phase: 01-foundation*
*Completed: 2026-08-20*
