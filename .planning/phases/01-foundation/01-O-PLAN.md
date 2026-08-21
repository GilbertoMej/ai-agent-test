---
phase: 1
plan: O
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-9]
depends_on: ["01-N"]
files_modified:
  - worker/src/agents/sdlc.ts
autonomous: true
must_haves:
  - "`toolApprovalResolver` reads `approvalMode` from the RequestContext class instance via `.getRaw('approvalMode')` instead of property access"
  - "Resolver falls back to `.approvalMode` property access for any plain-object requestContext (forward-compatible with both shapes)"
  - "The fallback chain: `rc.getRaw?.(\"approvalMode\") ?? rc.approvalMode ?? undefined` — never throws"
  - "Static type-check: `pnpm tsc --noEmit` shows no new errors in sdlc.ts"
requirements:
  - HITL-02
---

# 01-O — Phase 1 Gap Closure (resolver reads requestContext.approvalMode correctly)

Closes G-1-9 (major): `worker/src/agents/sdlc.ts:33` reads `rc.approvalMode` via property access on the RequestContext class instance. The instance stores values in a private registry Map and exposes them only via `.get(key)` / `.getRaw(key)`. Property access therefore always returns `undefined`, so `resolveApproval(...)` is called with `approvalMode: undefined` regardless of toggle state. Both 'tiered' and 'always' paths fall through to the gate branch, making the Auto-Approve Toggle contrast invisible at the resolver layer.

Fix is one line: change the cast + read to use `.getRaw?.('approvalMode')` with a property-access fallback for the plain-object shape that the Mastra type docstring promises. Defensive — works on both shapes. One file.

**Alphabetical ordering note**: this plan (O) runs AFTER plan N. Plan N adds an observability `console.log` line in the resolver body without touching the read path; the log line is preserved on disk when this plan applies. The "Current" block below reflects the post-01-N state — including the `[approval-resolver]` log line that N inserted.

## Tasks

<task type="auto">
  <id>01-O1-resolver-requestcontext-readraw</id>
  <read_first>
    - worker/src/agents/sdlc.ts (lines 30-37 — toolApprovalResolver body, INCLUDING the `[approval-resolver]` log line that plan 01-N inserted; line 6 — ApprovalMode type import from ../lib/approval)
    - worker/src/lib/approval.ts (lines 36-50 — resolveApproval branches on approvalMode)
    - node_modules/@mastra/core/dist/_types/@internal_core/dist/request-context/index.d.ts (RequestContext.getRaw / setRaw surface)
    - .planning/debug/g-1-9-toggle-resolver.md (full root-cause trace)
  </read_first>
  <action>
    Single edit to `worker/src/agents/sdlc.ts:30-37`. Replace the resolver's read path to use `.getRaw?.("approvalMode")` with a property-access fallback. The `[approval-resolver]` log line that plan 01-N inserted is preserved — only the read path and the resolveApproval call change.

    Current lines 30-37 (post-01-N state):

    ```
    export async function toolApprovalResolver(
      ctx: ToolApprovalContext,
    ): Promise<boolean> {
      const rc = (ctx.requestContext ?? {}) as { approvalMode?: ApprovalMode };
      const grants = await loadActiveGrants();
      console.log(`[approval-resolver] tool=${ctx.toolName} mode=${rc.approvalMode ?? "undef"}`);
      return resolveApproval(ctx.toolName, { approvalMode: rc.approvalMode, grants }) === "always";
    }
    ```

    Replacement:

    ```
    export async function toolApprovalResolver(
      ctx: ToolApprovalContext,
    ): Promise<boolean> {
      // Mastra 1.60 passes the RequestContext class instance at runtime — values
      // live in a private Map and are reachable only via .getRaw(key). Property
      // access always returns undefined. The .approvalMode fallback covers the
      // plain-object shape that the SDK type docstring promises, in case a future
      // version switches to it.
      const rc = (ctx.requestContext ?? {}) as {
        getRaw?: (k: string) => unknown;
        approvalMode?: ApprovalMode;
      };
      const raw = rc.getRaw?.("approvalMode");
      const approvalMode = (raw ?? rc.approvalMode) as ApprovalMode | undefined;
      const grants = await loadActiveGrants();
      console.log(`[approval-resolver] tool=${ctx.toolName} mode=${approvalMode ?? "undef"}`);
      return resolveApproval(ctx.toolName, { approvalMode, grants }) === "always";
    }
    ```

    Four changes:
    1. Cast widens to include `getRaw?: (k: string) => unknown` for the RequestContext class surface, alongside the `approvalMode?: ApprovalMode` plain-object surface.
    2. Read order: `rc.getRaw?.("approvalMode") ?? rc.approvalMode` — RequestContext API first, plain-object property as fallback.
    3. Pass `approvalMode` directly into `resolveApproval` instead of reading `rc.approvalMode` again inline.
    4. Update the existing `[approval-resolver]` log line (which 01-N inserted reading `rc.approvalMode ?? "undef"`) to read `approvalMode ?? "undef"` instead — now the logged value reflects the getRaw-resolved value, so the observability hook surfaces the correct mode once this fix lands.

    The `await loadActiveGrants()` call is unchanged. The `resolveApproval(...) === "always"` return is unchanged (string-to-boolean coercion correct per the 01-J diagnosis). The `[approval-resolver]` log line is preserved (only its interpolated variable changes).

    Do NOT change the `ApprovalMode` type import (line 6) — it's still in scope from `../lib/approval`. Do NOT change any other file.
  </action>
  <files>worker/src/agents/sdlc.ts</files>
  <verify>
    <automated>grep -nE 'getRaw\?\.\("approvalMode"\)' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'rc\.approvalMode[^?]' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1==0)}' && grep -nE 'resolveApproval\(ctx\.toolName.*approvalMode' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'getRaw?.("approvalMode")' worker/src/agents/sdlc.ts` returns 1+ match (RequestContext API used)
    - `grep -E 'rc\.approvalMode[^\?]' worker/src/agents/sdlc.ts` returns 0 matches (no property-access-only read; the new code only uses `rc.approvalMode` inside the `??` fallback chain)
    - `grep 'resolveApproval(ctx.toolName' worker/src/agents/sdlc.ts` returns 1+ match (call preserved)
    - `pnpm tsc --noEmit` introduces no new errors in sdlc.ts (sdlc.ts had no pre-existing TS errors)
  </acceptance_criteria>
  <done>toolApprovalResolver reads approvalMode via the RequestContext API; 'always' mode short-circuits to `false` (no gate); 'tiered' mode passes through to the gate path. Auto-Approve Toggle contrast becomes observable once G-1-7 cards start rendering.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-02 (auto-approve toggle bypasses cards for the session)</implements>
  <commit>fix(agent): read approvalMode via RequestContext.getRaw — drop property-access undefined trap</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| toolApprovalResolver → RequestContext | `ctx.requestContext` is the Mastra 1.60 RequestContext class instance (verified at `node_modules/@mastra/core/dist/_types/.../request-context/index.d.ts`). Optional chaining (`getRaw?.(...)`) prevents a throw if a future build swaps back to a plain object. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-O-01 | Spoofing | approvalMode undefined | low | mitigate | `rc.getRaw?.("approvalMode") ?? rc.approvalMode` covers both Mastra 1.60's class instance AND any future plain-object shape. The `as ApprovalMode \| undefined` cast keeps `resolveApproval` strict. |
| T-1-O-02 | Tampering | approval_grants DB | low | accept | `loadActiveGrants()` runs unchanged — filters by `expires_at > now()` server-side. Resolver still consults grants after approvalMode. |

## Verification

1. Static: `grep` confirms `getRaw?.("approvalMode")` present, no naked `rc.approvalMode` (the property access only appears inside the `??` fallback).
2. `pnpm tsc --noEmit` — no new errors.
3. Live (after G-1-7 plan 01-N lands and cards start rendering): trigger createNote with toggle='always' → no ApprovalCard; tool executes silently. Switch to 'tiered' → ApprovalCard renders. audit_log.approval_decision = 'auto' in always mode.

## Success criteria

- Resolver reads approvalMode from the RequestContext class instance correctly.
- ApprovalMode flow: 'always' → resolveApproval returns false → resolver returns false → tool runs un-gated.
- 'tiered' → resolveApproval returns 'always' for write_low → resolver returns true → tool is gated → ApprovalCard renders (assuming G-1-7 is also fixed).
- No regression on `loadActiveGrants()`.

## Output

Create `.planning/phases/01-foundation/01-O-SUMMARY.md` when done.
