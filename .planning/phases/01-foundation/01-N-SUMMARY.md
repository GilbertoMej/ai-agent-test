---
phase: 01-foundation
plan: N
subsystem: agent-runtime
tags: [mastra-1.60, observability, hitl, gap-closure, G-1-7]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "[approval-resolver] body in toolApprovalResolver + chat for-await chunk loop in worker/src/index.ts"
provides:
  - "Per-resolver-call [approval-resolver] log (toolName + approvalMode) so operator can confirm the resolver actually fires"
  - "Per-chunk [chat-debug] log so operator can see whether `tool-call-approval` ever appears in the stream"
affects: [01-O, G-1-7 verification path]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 41
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns: ["one-line console.log per diagnostic path (Ponytail: stdlib over a new dep, no logger abstraction, no toggle)"]

key-files:
  created: []
  modified:
    - worker/src/agents/sdlc.ts
    - worker/src/index.ts

key-decisions:
  - "Task 1 landed as planned: one [approval-resolver] log + one [chat-debug] log, both unconditional."
  - "Task 2 ROLLED BACK: Mastra 1.60's AgentConfigBase does NOT expose `requireToolApproval` as a top-level field. Adding it at the constructor top level triggers TS2353 (Object literal may only specify known properties) and is silently ignored at runtime by the Agent constructor. The plan's premise — that the per-call `agent.stream(...)` second-arg is dropped and a constructor-field fallback exists — is incorrect in Mastra 1.60. See Deviations from Plan, Rule 4."

patterns-established:
  - "Pattern: observability hooks are first-class gap-closure artifacts — log before any structural fix lands so the actual runtime path is provable from terminal output."

requirements-completed: [HITL-01]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "toolApprovalResolver logs [approval-resolver] tool=... mode=... per invocation in worker/src/agents/sdlc.ts (line 38)"
    requirement: HITL-01
    verification:
      - kind: other
        ref: "grep -nE '\\[approval-resolver\\] tool=' worker/src/agents/sdlc.ts (1 match)"
        status: pass
      - kind: other
        ref: "git show 5468848 -- worker/src/agents/sdlc.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Chunk for-await loop in worker/src/index.ts logs [chat-debug] chunk=... per chunk (line 138)"
    verification:
      - kind: other
        ref: "grep -nE '\\[chat-debug\\] chunk=' worker/src/index.ts (1 match)"
        status: pass
      - kind: other
        ref: "git show 5468848 -- worker/src/index.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Determination of G-1-7 runtime path (Candidate A vs Candidate B from .planning/debug/write-low-card-not-shown.md) — REQUIRES live worker run with createNote + tiered mode; observability logs make whichever path was broken visible in the terminal"
    verification:
      - kind: manual_procedural
        ref: "pnpm dev -> tiered mode -> 'create a note called X saying Y' -> read worker terminal for [approval-resolver] and [chat-debug] chunk sequence"
        status: unknown
    human_judgment: true
    rationale: "Cannot run worker (needs DATABASE_URL + Anthropic key) — operator must run the live trigger to interpret the runtime path from logs."
  - id: D4
    description: "Task 2 structural fix (Candidate-A-specific) — DEFERRED. Plan as written cannot be applied: Mastra 1.60's AgentConfigBase does not include `requireToolApproval` as a top-level field; runtime ignores unknown config fields."
    verification: []
    human_judgment: true
    rationale: "Architectural decision required: the only valid Mastra 1.60 mechanism for wiring a default `requireToolApproval` is `defaultOptions: { requireToolApproval: toolApprovalResolver }`, which is deepMerged into per-call options in stream() (agent-BVtn9FqD.cjs:37176). That is a different design than the plan's 'move from per-call to constructor' and warrants explicit user review before a follow-up plan."

# Metrics
duration: 5min
completed: 2026-08-21
status: complete
---

# Phase 01 Plan N: Write-Low Card Observability Summary

**Tool-approval gap G-1-7 made observable: [approval-resolver] per-call log + [chat-debug] per-chunk log so the operator can prove which runtime path (Candidate A vs B) is broken — Task 2's structural fix deferred because Mastra 1.60's AgentConfigBase does not accept a top-level `requireToolApproval` field.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-21T00:30:47Z
- **Completed:** 2026-08-21T00:35:00Z
- **Tasks:** 1 (Task 1 complete; Task 2 deferred per Rule 4)
- **Files modified:** 2

## Accomplishments
- `[approval-resolver]` log in `toolApprovalResolver` body prints `tool=...` and `mode=...` per invocation — if the resolver is silently bypassed (Candidate A), the operator sees NO log and the diagnosis is confirmed.
- `[chat-debug]` log at the top of the chunk for-await loop prints `chunk.type` per chunk — if `tool-call-approval` is emitted but the card doesn't render, the operator sees the chunk and confirms Candidate B.
- Both logs are unconditional `console.log` (Ponytail: stdlib, no logger abstraction, no env-var toggle, kept in production builds).
- `pnpm tsc --noEmit` introduces no new errors in the touched files (the pre-existing `lib/insforge.ts` errors are unrelated, tracked as Phase-1 carryover in STATE.md).

## Task Commits

1. **Task 1: Add observability logs** - `5468848` (chore)
   - `worker/src/agents/sdlc.ts`: one `console.log` between `loadActiveGrants()` and the existing `return` statement.
   - `worker/src/index.ts`: one `console.log` at the top of the chunk for-await loop.

## Files Created/Modified
- `worker/src/agents/sdlc.ts` - Added `[approval-resolver]` log inside the resolver body (between `loadActiveGrants()` and the `return`).
- `worker/src/index.ts` - Added `[chat-debug] chunk=...` log at the top of the chunk for-await loop, before the `if/else if` switch.

## Decisions Made
- **Ship Task 1 only, defer Task 2.** The plan's Task 2 was based on a false premise (Mastra 1.60's Agent constructor does not have a `requireToolApproval` field). Rolling it back keeps `pnpm tsc --noEmit` clean and avoids shipping dead code; the observability logs from Task 1 are sufficient to determine the runtime truth when the worker is run.
- **Log format chosen for grep-ability and brevity:** `tool=...` and `mode=...` (instead of structured JSON) — Ponytail: stdlib string formatting, no new dep, terminal-grep-friendly.
- **Verdict NOT logged** in the resolver (no extra `resolveApproval` call, no hoisting of the return expression) — the plan's Task 1 explicitly anchors the return expression for plan 01-O's `getRaw` read fix.

## Deviations from Plan

### Plan-implementation bug — Rule 4 (architectural decision required)

**1. Task 2 ROLLED BACK — `requireToolApproval` is NOT a top-level field on Mastra 1.60's AgentConfigBase**
- **Found during:** Task 2 implementation (after Task 1 observability hooks landed).
- **Issue:** The plan asserted "Move `requireToolApproval` from the per-call `agent.stream(...)` option ... to the agent's static `requireToolApproval` field on the constructor" and provided an exact diff that places `requireToolApproval: toolApprovalResolver` at the top level of the `new Agent({...})` config object. This field does not exist in Mastra 1.60:
  - TypeScript: `AgentConfigBase` (node_modules/.pnpm/@mastra+core@1.60.0_ai@7.0._6f6d82524998c05318c2ce4d97d92913/node_modules/@mastra/core/dist/agent/types.d.ts:464+) lists `id, name, description, metadata, instructions, model, maxRetries, tools, hooks, workflows, durable, defaultGenerateOptionsLegacy, defaultStreamOptionsLegacy, defaultOptions, defaultNetworkOptions, mastra, pubsub, agents, scorers, memory, skills, skillsFormat, browser, voice, channels, workspace, inputProcessors, outputProcessors, maxProcessorRetries, errorProcessors, options, rawConfig, requestContextSchema, backgroundTasks, notifications, signals, goal, transform` — no `requireToolApproval`. Adding it triggers `TS2353: Object literal may only specify known properties`.
  - Runtime: the Agent constructor (agent-BVtn9FqD.cjs:32200-32360) does NOT read `config.requireToolApproval` anywhere. The field would be silently ignored.
  - Source of confusion in the plan: the diagnosis (`write-low-card-not-shown.md`) noted that `createAgenticExecutionWorkflow` and `workflowLoopStream` both receive `requireToolApproval` and set it into `requestContext.__mastra_requireToolApproval` (agent-BVtn9FqD.cjs:26769, 27226). The plan writer apparently conflated the workflow construction path (which DOES read `requireToolApproval` from `rest`) with the Agent constructor (which does NOT).
- **Fix:** Rolled back the constructor-field edit. Task 1 observability logs are the only shipped change from this plan.
- **Files modified:** `worker/src/agents/sdlc.ts` (Task 2 edit reverted; Task 1 log retained at line 38).
- **Verification:** `pnpm tsc --noEmit` returns to the pre-plan error count (only the unrelated `lib/insforge.ts` errors remain). `git status --short worker/` is clean.
- **Committed in:** No commit — the rollback reverts the edit; working tree is unchanged from post-Task-1 state.

**2. Alternative fix design noted for follow-up plan (NOT applied)**
- **Mechanism that DOES exist in Mastra 1.60:** `defaultOptions: { requireToolApproval: toolApprovalResolver }` on the Agent constructor. This is a `DynamicArgument<AgentExecutionOptions<TOutput>, TRequestContext>` field that `stream()` deepMerges with per-call options (agent-BVtn9FqD.cjs:37176: `const mergedOptions = require_utils$1.deepMerge(await this.getDefaultOptions({ requestContext: streamOptions?.requestContext }), streamOptions ?? {})`). Per-call values override defaults, but since both reference the same function, deepMerge is a no-op when the per-call option matches.
- **Why this is a Rule 4 (architectural) decision, not a Rule 1/3 auto-fix:** the plan's intent was to MOVE the resolver from per-call to constructor as a Candidate-A defense. The `defaultOptions` alternative provides the same defense but with a different merge semantics — it's not equivalent to a "move"; it's an "add a fallback that the merge collapses". The user may want to drop the per-call option entirely (single source of truth = constructor) OR keep both (defense-in-depth). This deserves an explicit decision before a follow-up plan is written.

---

**Total deviations:** 1 (Rule 4, deferred — not auto-fixed)

## Issues Encountered
- None during Task 1.
- Task 2 surfaced the plan-vs-runtime gap described above. Resolved by rollback + deferral.

## Verification Run

```bash
# Task 1 grep gates (all PASS):
grep -nE '\[approval-resolver\] tool=' worker/src/agents/sdlc.ts      # 1
grep -nE '\[chat-debug\] chunk=' worker/src/index.ts                   # 1
grep -nE 'getRaw' worker/src/agents/sdlc.ts                            # 0 (correct — owned by 01-O)
grep -nE 'return resolveApproval\(ctx\.toolName.*rc\.approvalMode' worker/src/agents/sdlc.ts  # 1 (return expression intact)

# tsc gate:
cd worker && pnpm tsc --noEmit  # errors only in lib/insforge.ts (pre-existing; STATE.md carryover)
```

## Self-Check: PASSED

- `[approval-resolver]` log: FOUND at `worker/src/agents/sdlc.ts:38`
- `[chat-debug]` log: FOUND at `worker/src/index.ts:138`
- Task 1 commit `5468848`: FOUND in `git log --oneline`
- Working tree clean post-Task-2 rollback: `git status --short worker/` returns nothing
- No new tsc errors in `sdlc.ts` or `index.ts`

## Next Phase Readiness
- **For G-1-7 verification:** operator runs `pnpm dev` with `tiered` mode and asks the agent to create a note. Worker terminal prints `[approval-resolver]` (resolver fired) and `[chat-debug]` chunks. If `[chat-debug] chunk=tool-call-approval` appears but the card doesn't render → Candidate B (ChatPanel render or chunk translation bug). If `[approval-resolver]` never prints → Candidate A (resolver bypassed — needs deeper investigation, possibly Mastra 1.60 deepMerge semantics with the per-call options envelope).
- **For follow-up plan:** a small follow-up plan can apply the `defaultOptions: { requireToolApproval: toolApprovalResolver }` fix IF the operator confirms Candidate A. If Candidate B is the truth, that follow-up is unnecessary and the chunk-translator / ChatPanel render path is the bug to chase.
- **01-O is unblocked:** Task 1's `[approval-resolver]` log intentionally does NOT log the verdict, so the return expression `return resolveApproval(ctx.toolName, ...) === "always"` is unchanged and 01-O's `getRaw` diff anchor still matches the on-disk state.

---
*Phase: 01-foundation*
*Completed: 2026-08-21*
