---
phase: 1
plan: N
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-7]
depends_on: ["01-S"]
files_modified:
  - worker/src/agents/sdlc.ts
  - worker/src/index.ts
autonomous: true
must_haves:
  - "`toolApprovalResolver` logs `[approval-resolver]` per invocation: toolName, resolved approvalMode, and the boolean return"
  - "The chunk for-await loop in worker/src/index.ts logs `[chat-debug] chunk=...` per chunk type so the operator can see whether `tool-call-approval` ever fires"
  - "Both logs are kept in production builds (Ponytail: 1-line `console.log` per path — no logger abstraction, no toggle)"
  - "`pnpm tsc --noEmit` introduces no new errors"
  - "Live: trigger createNote with tiered mode → operator sees `[approval-resolver]` and `[chat-debug]` logs; whichever path was broken is now visible; if a `tool-call-approval` chunk fires, the existing translator emits `tool-approval-request` and the ChatPanel renders the card"
requirements:
  - HITL-01
---

# 01-N — Phase 1 Gap Closure (write-low card observability + structural fix)

Closes G-1-7 (major, INCONCLUSIVE). The diagnosis in `.planning/debug/write-low-card-not-shown.md` rules out the chunk translator and the ChatPanel render filter but cannot distinguish two runtime candidates without observability hooks:

- **Candidate A** (most likely): `agent.stream(...)` second-arg `requireToolApproval` is silently dropped by Mastra 1.60. The resolver never runs → gate returns undefined → tool runs un-gated.
- **Candidate B**: resolver IS invoked and gate fires, `tool-call-approval` IS emitted, but ChatPanel render path fails (e.g., tool-part lookup miss).

Both candidates share the same observable shape from the user: tool ran, no card. Adding per-chunk and per-resolver logs makes whichever path is broken visible in the terminal output.

This plan has TWO tasks: Task 1 adds the observability hooks (the cheap diagnostic — runs in any environment). Task 2 applies the most-likely structural fix based on the diagnosis's static analysis (defensive: covers both candidates). Ponytail: ship both together. The logs prove which path the runtime took; the structural fix covers whichever was broken.

## Tasks

<task type="auto">
  <id>01-N1-add-observability-logs</id>
  <read_first>
    - worker/src/agents/sdlc.ts (lines 30-36 — toolApprovalResolver body — current property-access read; 01-O will add the getRaw fallback in its own alphabetical slot)
    - worker/src/index.ts (line 124 — `for await (const chunk of stream.fullStream)` — the loop body is the chunks-typed switch on lines 124-176)
    - .planning/debug/write-low-card-not-shown.md (Candidate A vs Candidate B)
  </read_first>
  <action>
    Two surgical edits in two files. One `console.log` per path. No logger abstraction (Ponytail: stdlib over a new dep).

    **IMPORTANT — ordering**: this plan (N) runs AFTER plan O in execution order (O has `depends_on: ["01-N"]`, so O is in wave 3 after N's wave 2). Plan O owns the `getRaw` read fix; if N also adds the getRaw read, O's diff cannot match the on-disk state and breaks. This task adds ONLY an observability log; it does NOT touch the approvalMode read path. Plan S runs before N (N depends on S) so the [approval-resolver] log lands in the post-S resolver body that includes ragQueryTool registration context.

    **Edit 1 — `worker/src/agents/sdlc.ts:30-36`**: insert a single `console.log` line at the end of the resolver body, BEFORE the existing `return` statement. Do not hoist the `return` expression into a local — that would break 01-O's diff which anchors on the existing one-line `return` form. Leave the property-access read intact — that's 01-O's job.

    Current lines 30-36 (PRE-01-O state):
    ```
    export async function toolApprovalResolver(
      ctx: ToolApprovalContext,
    ): Promise<boolean> {
      const rc = (ctx.requestContext ?? {}) as { approvalMode?: ApprovalMode };
      const grants = await loadActiveGrants();
      return resolveApproval(ctx.toolName, { approvalMode: rc.approvalMode, grants }) === "always";
    }
    ```

    Replacement:
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

    ONE-line addition: a `console.log` line inserted between `await loadActiveGrants()` and the `return`. Logs `tool` and `mode`. Operator reads the terminal and immediately sees (a) whether the resolver ran at all (no log = Candidate A confirmed; resolver was silently dropped), (b) the actual `mode` value the resolver saw (`rc.approvalMode` — expected `undefined` until 01-O's getRaw fix lands, which independently surfaces the read-path bug). The verdict is not logged (avoiding a second `resolveApproval` call or hoisting the expression — both would conflict with 01-O's diff).

    Do NOT add `getRaw` here — that change belongs to plan 01-O and will be applied in its own alphabetical slot. Do NOT change the `return` statement's structure (no verdict hoisting, no extra parens).

    **Edit 2 — `worker/src/index.ts`**: log per chunk inside the for-await loop.

    Insert a `console.log` at the TOP of the loop, BEFORE the `if/else if` statements. Operator sees which chunk types fire and in what order.

    Current loop opening:
    ```
    for await (const chunk of stream.fullStream) {
      if (chunk.type === "text-start") {
    ```

    Replacement:
    ```
    for await (const chunk of stream.fullStream) {
      console.log(`[chat-debug] chunk=${chunk.type}`);
      if (chunk.type === "text-start") {
    ```

    One-line addition: log `chunk.type`. Operator reads the terminal and sees the exact chunk sequence. If `tool-call-approval` appears but the ChatPanel still doesn't render the card, the bug is downstream (Candidate B). If `tool-call-approval` never appears and `tool-result` does, the resolver was bypassed (Candidate A).

    Both logs are unconditional — no toggle, no env-var guard. Production builds keep them. The volume is bounded (one log per chunk + one log per resolver invocation, max a few per turn).

    Do NOT change the chunk-type switch (the `if/else if` statements on lines 125-175) — keep all existing chunk translation intact. The fix in Task 2 (next) handles the structural change.
  </action>
  <files>worker/src/agents/sdlc.ts, worker/src/index.ts</files>
  <verify>
    <automated>grep -nE '\[approval-resolver\] tool=' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE '\[chat-debug\] chunk=' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'getRaw' worker/src/agents/sdlc.ts | grep -c . | awk '{exit !($1==0)}' && grep -nE 'return resolveApproval\(ctx\.toolName.*rc\.approvalMode' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep '[approval-resolver] tool=' worker/src/agents/sdlc.ts` returns 1 match (resolver logs toolName + mode)
    - `grep '[chat-debug] chunk=' worker/src/index.ts` returns 1 match (per-chunk log added)
    - `grep 'getRaw' worker/src/agents/sdlc.ts` returns 0 matches (01-O's getRaw fix is NOT applied here — alphabetical ordering; 01-O runs after 01-N and owns that change)
    - `grep 'return resolveApproval(ctx.toolName' worker/src/agents/sdlc.ts` returns 1 match (original return statement intact — verdict NOT hoisted, so 01-O's diff anchor still matches the on-disk state)
    - `pnpm tsc --noEmit` introduces no new errors in sdlc.ts or index.ts
  </acceptance_criteria>
  <done>Both observability hooks in place. Operator sees per-resolver-call and per-chunk logs in the worker terminal; whichever path the runtime takes is now visible.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (write_low tools require explicit approval before execution — observability step)</implements>
  <commit>chore(observability): log [approval-resolver] + per-chunk to surface G-1-7 root cause</commit>
</task>

<task type="auto">
  <id>01-N2-apply-most-likely-structural-fix</id>
  <read_first>
    - worker/src/agents/sdlc.ts (lines 16-25 — Agent constructor; lines 30-36 — toolApprovalResolver)
    - node_modules/@mastra/core/dist/agent-BVtn9FqD.cjs (lines 26230-26266 — runToolEntry approval flow; lines 27365 — workflowLoopStream)
    - node_modules/@mastra/core/dist/agent.d.ts (line 38 — RequireToolApprovalFn signature)
    - .planning/debug/write-low-card-not-shown.md (Candidate A — agent.stream second-arg requireToolApproval may be dropped; static analysis couldn't rule it out)
  </read_first>
  <action>
    One surgical edit in `worker/src/agents/sdlc.ts:16-25`. Move `requireToolApproval` from the per-call `agent.stream(...)` option (where Mastra 1.60 may strip it) to the agent's static `requireToolApproval` field on the constructor.

    **Candidate-A-specific structural fix, NOT defense-in-depth.** This change is meaningful ONLY when the runtime took Candidate A — i.e. the per-call `requireToolApproval` option was silently dropped and the resolver never ran. The diagnosis confirmed: `createAgenticExecutionWorkflow` accepts `requireToolApproval` as a constructor field; when set there, it flows through `requestContext.set("__mastra_requireToolApproval", requireToolApproval)` directly (per the agent-BVtn9FqD.cjs trace) without depending on the `agent.stream` second-arg path. If Candidate B is the runtime truth (resolver runs but card doesn't render), this constructor wiring is a no-op — the per-call option and the constructor field both resolve to the same function reference via deepMerge, so adding the constructor field changes nothing.

    **Run order:** observability from Task 1 (01-N1) lands FIRST; the operator reads the terminal to see whether Candidate A or B is the runtime truth; THEN this task's constructor wiring is applied. If the logs show `[approval-resolver]` firing (Candidate B is the truth), this constructor addition is dead weight — but the cost is one static field, so we ship it unconditionally to cover the worst case (Candidate A) without a second round-trip.

    Current lines 16-25 (post-01-S state — 01-S has already applied the ragQueryTool import, tools entry, and instructions extension; this task assumes that file state):
    ```
    export const sdlcAgent = new Agent({
      id: "sdlcAgent",
      name: "SDLC Agent",
      instructions:
        "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
        "rag_query (read), createNote (write_low), and applyMigrations (write_high). " +
        "Call rag_query BEFORE invoking any MCP tool whose usage you are unsure about — it returns the top-5 tool_docs rows relevant to the user's request. " +
        "Use createNote when the user asks for a note; use applyMigrations when the user asks to migrate. " +
        "For everything else, answer from chat.",
      model: "opencode-go/hy3",
      tools: { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool },
    });
    ```

    Replacement (only the constructor wiring is added — 01-S has already applied the ragQueryTool changes, and this task does NOT touch them):
    ```
    export const sdlcAgent = new Agent({
      id: "sdlcAgent",
      name: "SDLC Agent",
      instructions:
        "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
        "rag_query (read), createNote (write_low), and applyMigrations (write_high). " +
        "Call rag_query BEFORE invoking any MCP tool whose usage you are unsure about — it returns the top-5 tool_docs rows relevant to the user's request. " +
        "Use createNote when the user asks for a note; use applyMigrations when the user asks to migrate. " +
        "For everything else, answer from chat.",
      model: "opencode-go/hy3",
      tools: { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool },
      // G-1-7 structural fix: wire toolApprovalResolver at construction time
      // rather than via agent.stream second-arg. Mastra 1.60's tool runner
      // reads `requireToolApproval` from the agent config (set into requestContext
      // as `__mastra_requireToolApproval`) more reliably than from the per-call
      // options envelope. The per-call pass in worker/src/index.ts:108 remains as
      // a defensive belt-and-suspenders.
      requireToolApproval: toolApprovalResolver,
    });
    ```

    ONE change:
    1. Add `requireToolApproval: toolApprovalResolver` to the Agent constructor (the resolver function reference, not a call). The 4-tool registration and extended instructions are NOT touched here — 01-S owns those changes (and runs first via `depends_on: ["01-S"]`).

    The per-call `requireToolApproval: toolApprovalResolver` in `worker/src/index.ts:108` stays unchanged (the diagnosis note: "BOTH paths reach the same destination — function either as factory arg or as requestContext key"). Removing it would be safe per the trace, but keeping it costs nothing. Note: this is NOT defense-in-depth in any practical sense — both paths point at the same function reference; whichever one the runtime actually reads wins. The constructor field is the safety net for Candidate A; the per-call option remains as a no-op redundant write when Candidate A is false.

    Do NOT change the resolver function body (lines 30-36) — Task 1 already added the observability log; the structural change here is purely the constructor wiring.

    Do NOT change `worker/src/index.ts` — the per-call `requireToolApproval: toolApprovalResolver` stays (redundant but harmless; one source of truth for whether the resolver runs is the constructor field after this task lands).
  </action>
  <files>worker/src/agents/sdlc.ts</files>
  <verify>
    <automated>grep -nE 'requireToolApproval:\s*toolApprovalResolver' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'requireToolApproval:\s*toolApprovalResolver' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE '\[approval-resolver\]' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'requireToolApproval: toolApprovalResolver' worker/src/agents/sdlc.ts` returns 1 match (resolver wired on Agent constructor — Candidate-A-specific structural fix)
    - `grep 'requireToolApproval: toolApprovalResolver' worker/src/index.ts` returns 1 match (per-call path preserved — redundant but harmless; same function reference as constructor field)
    - `grep '[approval-resolver]' worker/src/agents/sdlc.ts` returns 1+ match (observability log from Task 1 still present)
    - `pnpm tsc --noEmit` introduces no new errors in sdlc.ts
  </acceptance_criteria>
  <done>toolApprovalResolver is wired at agent construction time (the path the Mastra 1.60 trace confirmed reaches runToolEntry via `__mastra_requireToolApproval`) AND at the per-call stream options (redundant — same reference). Combined with Task 1's observability hooks, whichever runtime path was broken is now both visible in logs AND structurally bypassed.</done>
  <reversibility>costly</reversibility>
  <implements>HITL-01 (write_low tools require explicit approval before execution)</implements>
  <commit>fix(agent): wire requireToolApproval at Agent constructor — defend against per-call strip</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Resolver → agent | `requireToolApproval` is operator-authored; reads `requestContext.approvalMode` (after G-1-9 fix). No user input. |
| Chunk log → terminal | Operator-only. No PII / secrets in chunk.type logs. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-N-01 | Information Disclosure | Per-chunk log volume | low | accept | Max ~10 logs per turn. Phase 1 single-user. |
| T-1-N-02 | Tampering | requireToolApproval at construction | low | accept | Static reference; cannot be overridden per-call without code change. |
| T-1-N-03 | Denial of Service | Resolver invoked twice | low | accept | Construction-time + per-call both reference the same function; deepMerge resolves to a single call site. Resolver is idempotent (same inputs → same verdict). No double-gating. |

## Verification

1. Static: grep confirms `[approval-resolver]` log, `[chat-debug] chunk=` log, and `requireToolApproval: toolApprovalResolver` on Agent constructor + index.ts stream route.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; trigger createNote with tiered mode. Worker terminal prints:
   - `[approval-resolver] tool=createNote mode=tiered verdict=true` (proves resolver ran AND got tiered AND returned gate)
   - `[chat-debug] chunk=text-start`
   - `[chat-debug] chunk=tool-input-available`
   - `[chat-debug] chunk=tool-call-approval` (proves chunk fired)
   - ...
   - ChatPanel renders the ApprovalCard.

   If the terminal shows `[chat-debug] chunk=tool-result` without a prior `chunk=tool-call-approval`, the resolver was bypassed AND the construction-time wiring didn't help — escalate to deeper investigation.

## Success criteria

- toolApprovalResolver logs are visible in worker terminal output.
- Per-chunk logs are visible in worker terminal output.
- Construction-time `requireToolApproval` is wired (defense-in-depth with per-call).
- createNote with tiered mode renders an ApprovalCard in the chat.
- No regression on echo (read-class, never gated), rag_query (read-class, never gated), or applyMigrations (write_high, gated + red border per G-1-8 fix).

## Output

Create `.planning/phases/01-foundation/01-N-SUMMARY.md` when done.
