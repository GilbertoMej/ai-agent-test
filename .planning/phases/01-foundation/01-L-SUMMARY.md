---
phase: 01-foundation
plan: L
subsystem: ui
tags: [react, hover-tooltip, stage-picker, gap-closure]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: StagePicker.tsx component (01-D 01-09, UI-02) with native title= hover hint
provides:
  - Immediate React-state hover tooltip on StagePicker rows (sub-100 ms latency)
  - role="tooltip" span rendered in-flow below the hovered row using existing toast styling
  - onMouseLeave guard keyed on hovered.id (defensive against rapid sibling-row mouse moves)
affects: [01-foundation, phase-2-onwards]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 605
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - React state-driven tooltip replacing browser-native title= for sub-100 ms hover latency
    - useState<{ id, text } | null> shape preserves hovered-row identity for defensive clear

key-files:
  created: []
  modified:
    - app/components/StagePicker.tsx

key-decisions:
  - "Replace native HTML title= with React state (onMouseEnter/onMouseLeave) to bypass 500-1000 ms browser tooltip delay and extension suppression"
  - "Reuse exact inline-style tokens (color: '#ffcc00', fontFamily: 'monospace') of the existing click toast for visual parity"
  - "No new deps — shadcn/Radix Tooltip is aspirational per CLAUDE.md; node_modules/@radix-ui is absent, so pure React + existing inline-style pattern"
  - "onMouseLeave keyed on hovered.id so rapid sibling-row hovers do not clear a still-hovered tooltip"

patterns-established:
  - "Pattern: when a hover hint needs sub-100 ms latency, replace native title= with React state — never add a UI lib for a one-off tooltip"
  - "Pattern: defensive leave-clear (h?.id === s.id ? null : h) when multiple rows share the same tooltip slot"

requirements-completed: [UI-02]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "StagePicker disabled rows show an immediate React-rendered tooltip on hover (no browser-native title= delay); hovering out clears it; click path unaffected"
    requirement: UI-02
    verification:
      - kind: other
        ref: "grep -nE 'title=\\{' app/components/StagePicker.tsx returns 0 matches"
        status: pass
      - kind: other
        ref: "grep -nE 'onMouseEnter' app/components/StagePicker.tsx returns 1+ match"
        status: pass
      - kind: other
        ref: "grep -nE 'onMouseLeave' app/components/StagePicker.tsx returns 1+ match"
        status: pass
      - kind: other
        ref: "grep -nE 'role=\"tooltip\"' app/components/StagePicker.tsx returns 1 match"
        status: pass
    human_judgment: true
    rationale: "Static grep proves the wiring; a human must visually confirm the tooltip appears within ~100 ms of hover and disappears on mouseleave in a running browser (browser-native delay is a perception call, not a programmatic one)"

# Metrics
duration: 5min
completed: 2026-08-20
status: complete
---

# Phase 1 Plan L: StagePicker Tooltip Gap Closure (G-1-4)

**StagePicker hover tooltip: native HTML title= replaced with React state for sub-100 ms latency; click path preserved.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-08-20T23:30:00Z
- **Completed:** 2026-08-20T23:35:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Dropped the browser-native `title=` hover hint on `StagePicker.tsx` (500–1000 ms delay, sometimes suppressed by browser/extension settings — the G-1-4 perception failure).
- Wired `onMouseEnter` / `onMouseLeave` to a `useState<{ id, text } | null>` slot; the rendered `<span role="tooltip">` appears immediately on hover and clears on leave.
- Tooltip reuses the click toast's exact inline styling (`#ffcc00`, monospace, 11 px) — visual parity for free, no new tokens.
- Enabled stages also surface their label on hover (the prior `title=` did the same, so visual richness matches the prior native behaviour).
- Click path (`pick()` → `setToast(...)` → `<span role="status">`) untouched; both states render independently inside the same `<nav>`.

## Task Commits

Each task was committed atomically:

1. **Task 1: 01-L1-stagepicker-immediate-tooltip** - `11a656a` (fix)

**Plan metadata:** (final docs commit below)

## Files Created/Modified

- `app/components/StagePicker.tsx` — Added `hovered` state, swapped `title=` for `onMouseEnter`/`onMouseLeave`, rendered `<span role="tooltip">` slot in-flow below the row stack.

## Decisions Made

None — followed plan exactly. The plan already encoded the ponytail ladder rung 6 (one-line React state swap) and the no-new-deps constraint.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes, no architectural changes, no surprises.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. The fix is purely client-side React state.

## Next Phase Readiness

- G-1-4 closed. The remaining Phase 1 gap-closure plans (01-M..01-S visible in `.planning/phases/01-foundation/`) can proceed independently.
- UI-02 acceptance verified at the wiring level (grep); remaining human judgment is the actual hover-latency perception, which is the whole point of the gap report.

## Self-Check: PASSED

- `app/components/StagePicker.tsx` modified and present at the committed path.
- Commit `11a656a` exists in `git log --oneline`.
- All 4 grep acceptance criteria pass (title= count 0; onMouseEnter/onMouseLeave/role="tooltip" each ≥ 1).
- `useState` count 4 (1 import + 3 declarations: `active`, `toast`, `hovered`) exceeds the `≥ 2` threshold.

---
*Phase: 01-foundation*
*Completed: 2026-08-20*
