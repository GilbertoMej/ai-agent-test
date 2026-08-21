---
phase: 01-foundation
plan: O
subsystem: agent-runtime
tags: [mastra-1.60, hitl, gap-closure, G-1-9, request-context]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "[approval-resolver] body in toolApprovalResolver (worker/src/agents/sdlc.ts:38) added by 01-N as observability anchor"
provides:
  - "toolApprovalResolver reads approvalMode via RequestContext.getRaw — toggle contrast becomes observable at the resolver layer"
  - "Fallback chain `rc.getRaw?.('approvalMode') ?? rc.approvalMode ?? undefined` works for both Mastra 1.60 class instance AND any future plain-object shape"
affects: [G-1-9 verification path, HITL-02 functional path]

# Actuals (#2632) — same estimateTokens scale (chars/4 over the realized diff)
actuals:
  tokens: 260
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns: ["property-access + optional-chain fallback (`getRaw?.(...) ?? obj.prop`) — defensive read across class-instance and plain-object shapes"]

key-files:
  created: []
  modified:
    - worker/src/agents/sdlc.ts

key-decisions:
  - "Read order: `rc.getRaw?.('approvalMode') ?? rc.approvalMode`. RequestContext API first (Mastra 1.60 reality); plain-object property second (Mastra type docstring promise; covers any future shape swap)."
  - "Cast widened to `{ getRaw?: (k: string) => unknown; approvalMode?: ApprovalMode }` — both shapes coexist in the type; the optional chain on `getRaw?.(...)` is the runtime safety net for the plain-object case."
  - "[approval-resolver] log line preserved (only the interpolated variable changed from `rc.approvalMode` to `approvalMode`) so the log now surfaces the getRaw-resolved value — observability path from 01-N stays wired, contrast becomes visible."

patterns-established:
  - "Pattern: when reading values from a third-party class instance whose type docstring lies about the shape, type the read path defensively as `{ instanceApi?: Fn; legacyProp?: T }` and chain with `??` — one edit covers both runtime shapes."

# Phase 1 Plan O: resolver reads requestContext.approvalMode correctly
Closes G-1-9: toolApprovalResolver now reads `approvalMode` from the RequestContext class instance via `getRaw`, with a plain-object fallback. One-line behavior change in a 13-line patch (the rest is a comment block explaining the read path).

## What was built

Surgical edit to `worker/src/agents/sdlc.ts` lines 33-40 (the `toolApprovalResolver` body). The resolver previously did:

```ts
const rc = (ctx.requestContext ?? {}) as { approvalMode?: ApprovalMode };
// ...
console.log(`[approval-resolver] tool=${ctx.toolName} mode=${rc.approvalMode ?? "undef"}`);
return resolveApproval(ctx.toolName, { approvalMode: rc.approvalMode, grants }) === "always";
```

That cast to a plain-object shape was a lie about the runtime — at call time, `ctx.requestContext` is the Mastra 1.60 `RequestContext` class instance (values in a private `registry` Map; reachable only via `.get(key)` / `.getRaw(key)`). Property access always returned `undefined`, so `resolveApproval` was called with `approvalMode: undefined` regardless of toggle state. Both 'tiered' and 'always' paths fell through to the gate branch — the Auto-Approve Toggle contrast was invisible at the resolver layer.

New read path:

```ts
const rc = (ctx.requestContext ?? {}) as {
  getRaw?: (k: string) => unknown;
  approvalMode?: ApprovalMode;
};
const raw = rc.getRaw?.("approvalMode");
const approvalMode = (raw ?? rc.approvalMode) as ApprovalMode | undefined;
// ...
console.log(`[approval-resolver] tool=${ctx.toolName} mode=${approvalMode ?? "undef"}`);
return resolveApproval(ctx.toolName, { approvalMode, grants }) === "always";
```

The `[approval-resolver]` log line added by 01-N is preserved — only its interpolated variable changed from `rc.approvalMode` to the new local `approvalMode`. The log now reflects the getRaw-resolved value, so the operator can confirm the contrast between `mode=tiered` and `mode=always` in terminal output.

## Tasks executed

| # | Task | Type | Commit |
|---|------|------|--------|
| 01-O1 | resolver-requestcontext-readraw | auto | fd1671d |

1/1 task complete.

## Verification

- Plan automated checks (all PASS):
  - `getRaw?.("approvalMode")` present in `worker/src/agents/sdlc.ts` (>= 1 match)
  - No naked `rc.approvalMode[^\?]` access — the only remaining `rc.approvalMode` reference lives inside the `??` fallback chain
  - `resolveApproval(ctx.toolName, { approvalMode, grants })` call preserved
- `[approval-resolver]` log line preserved at line 48 (from 01-N).
- `pnpm tsc --noEmit` — zero new errors in `sdlc.ts`. Pre-existing errors remain in `lib/insforge.ts` (carryover, not introduced by this plan).
- Live contrast verification requires G-1-7 (card rendering) and operator UAT — out of plan scope. The log line now surfaces the correct value, so the operator can confirm in terminal.

## Deviations from Plan

None — plan executed exactly as written. The 13-line diff matches the plan's "Replacement" block byte-for-byte; the only edits are the cast widening, the new `getRaw` read, the local `approvalMode` variable, and the log line variable swap.

## Files modified

- `worker/src/agents/sdlc.ts` — `toolApprovalResolver` read path. +13 / -3 lines.

## Decisions made

- Read order: `getRaw` first (Mastra 1.60 reality), `approvalMode` property second (covers any future plain-object shape).
- Single cast widened to `{ getRaw?: (k: string) => unknown; approvalMode?: ApprovalMode }` — both shapes coexist in the type; optional chain on `getRaw?.(...)` is the runtime safety net.
- `[approval-resolver]` log line kept verbatim from 01-N, only the interpolated variable changed. No new log statements, no new abstractions.

## Self-Check: PASSED

- File present: `worker/src/agents/sdlc.ts` (modified, commit fd1671d)
- Commit present: fd1671d in `git log --oneline -5`
- Plan automated grep checks: 3/3 PASS
- `pnpm tsc --noEmit`: no new errors in `sdlc.ts`
