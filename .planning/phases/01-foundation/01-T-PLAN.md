---
phase: 1
plan: T
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-14b]
depends_on: []
files_modified:
  - worker/src/agents/sdlc.ts
autonomous: true
must_haves:
  - "`toolApprovalResolver` normalizes the incoming `ctx.toolName` by stripping a trailing `Tool` suffix before passing it to `resolveApproval`/`classify`"
  - "Resolver log line `[approval-resolver] tool=<normalized> mode=<mode>` shows the normalized name (e.g. `tool=ragQuery` not `tool=ragQueryTool`)"
  - "Classify returns `read` for `ragQuery`/`echo`, `write_low` for `createNote`, `write_high` for `applyMigrations` after normalization"
  - "`pnpm tsc --noEmit` introduces no new errors in sdlc.ts"
  - "Live: trigger rag_query → resolver does NOT gate (no `tool-call-approval` chunk); tool runs; `tool-output-available` chunk arrives with the context string"
requirements:
  - HITL-01
  - RAG-02
---

# 01-T — Phase 1 Gap Closure (resolver normalizes property keys before classify)

Closes G-1-14b (blocker): `worker/src/lib/classify.ts:12-14` matches tool IDs (`"echo"`, `"rag_query"`, `"createNote"`, `"applyMigrations"`) but `toolApprovalResolver` (worker/src/agents/sdlc.ts:49) receives the property KEY from the `tools: { ... }` object map (e.g. `ragQueryTool`, `echoTool`, `createNoteTool`, `applyMigrationsTool`). Every tool falls through to the `write_high` default at classify.ts:36, so `resolveApproval()` returns `"always"` and the resolver gates every tool — including read-tier ones — which makes Mastra 1.60 suspend the workflow (agent-BVtn9FqD.cjs:26271-26307) before tool execution. The chat-debug wire trace shows no `tool-result` chunk because the tool never runs. The UAT's framing of "two stacked defects" collapses to one root cause with two visible symptoms: fix the resolver → read tools return `false` → tool runs → tool-result emitted → translator forwards `tool-output-available`.

Fix is a 2-line helper in `worker/src/agents/sdlc.ts`: strip the trailing `Tool` suffix from camelCase keys before classifying. `classify()` stays clean (still matches tool IDs only). One file, two lines.

## Tasks

<task type="auto">
  <id>01-T1-resolver-normalizes-camelcase-keys</id>
  <read_first>
    - worker/src/agents/sdlc.ts (lines 33-50 — full toolApprovalResolver body; line 49 — the `resolveApproval(ctx.toolName, ...)` call)
    - worker/src/lib/classify.ts (lines 11-14 — Phase 1 working set matched against tool IDs)
    - worker/src/lib/approval.ts (lines 36-50 — resolveApproval branches on `classify(toolName)`)
    - .planning/debug/g-1-14b-rag-query-result-forwarding.md (full root-cause trace — recommend normalization at resolver)
  </read_first>
  <action>
    Single-file edit to `worker/src/agents/sdlc.ts`. Add a small `normalizeToolName` helper inside the file and apply it to `ctx.toolName` before the `resolveApproval(...)` call and before the `[approval-resolver]` log line.

    Current lines 33-50 (post-01-O state — the `[approval-resolver]` log reads `approvalMode ?? "undef"`):

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

    Replacement:

    ```
    // Mastra 1.60 passes the PROPERTY KEY from the `tools: { ... }` object map
    // (e.g. "ragQueryTool", "echoTool") to ToolApprovalContext, not the tool's
    // `id`. classify() matches tool IDs ("rag_query", "echo"). Without
    // normalization, every tool falls through to the write_high default and the
    // resolver gates read tools — which Mastra 1.60 enforces by suspending the
    // workflow before tool execution. Strip the "Tool" suffix that the sdlc.ts
    // tools: object keys all share.
    function normalizeToolName(n: string): string {
      return n.endsWith("Tool") ? n.slice(0, -4) : n;
    }

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
      const toolName = normalizeToolName(ctx.toolName);
      console.log(`[approval-resolver] tool=${toolName} mode=${approvalMode ?? "undef"}`);
      return resolveApproval(toolName, { approvalMode, grants }) === "always";
    }
    ```

    Three changes:
    1. Add a 2-line `normalizeToolName(n)` helper above the resolver that strips a trailing `Tool` suffix (idempotent — does nothing if no suffix). This is the only normalization; `classify()` itself stays clean and still matches tool IDs.
    2. Compute `const toolName = normalizeToolName(ctx.toolName);` after the `approvalMode` read so the normalized name is used for both the log line and the `resolveApproval` call.
    3. The `[approval-resolver]` log now shows the normalized name (`tool=ragQuery` not `tool=ragQueryTool`) so the operator can see the actual classified tier at a glance.

    The `await loadActiveGrants()` call is unchanged. The `resolveApproval(...) === "always"` return is unchanged. The 4 lines that read `approvalMode` via `getRaw` + property-access fallback (the 01-O fix) are unchanged — that fix and this one compose: 01-O fixes the read path, this plan fixes the classify-name mismatch.

    Do NOT change `worker/src/lib/classify.ts` — it correctly matches tool IDs. Do NOT change `worker/src/lib/approval.ts` — `resolveApproval` is correct given a correctly-named argument. Do NOT change the `toolName` field on `sdlc.ts:27`'s `tools:` object — the camelCase keys are a Mastra 1.60 convention we have to live with.
  </action>
  <files>worker/src/agents/sdlc.ts</files>
  <verify>
    <automated>grep -nE 'function normalizeToolName' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'const toolName = normalizeToolName' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'resolveApproval\(toolName' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'resolveApproval\(ctx\.toolName' worker/src/agents/sdlc.ts | grep -c . | awk '{exit !($1==0)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'function normalizeToolName' worker/src/agents/sdlc.ts` returns 1 match (helper defined)
    - `grep 'const toolName = normalizeToolName' worker/src/agents/sdlc.ts` returns 1 match (normalization applied)
    - `grep 'resolveApproval(toolName' worker/src/agents/sdlc.ts` returns 1 match (normalized name passed in)
    - `grep -E 'resolveApproval\(ctx\.toolName' worker/src/agents/sdlc.ts` returns 0 matches (raw key NOT passed to resolveApproval anymore)
    - `grep '[approval-resolver]' worker/src/agents/sdlc.ts` returns 1+ match (observability log from 01-N preserved — now reads normalized name)
    - `grep 'rc.getRaw?.("approvalMode")' worker/src/agents/sdlc.ts` returns 1 match (01-O's read fix preserved)
    - `pnpm tsc --noEmit` introduces no new errors in sdlc.ts
  </acceptance_criteria>
  <done>toolApprovalResolver normalizes the property-key (ragQueryTool → ragQuery, echoTool → echo, etc.) before passing to resolveApproval/classify. Read tools return false from resolveApproval → resolver returns false → tool runs un-gated. rag_query tool result reaches the client. write_low/write_high still gate correctly because their normalized keys (createNote, applyMigrations) match classify.ts entries.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (classifier returns the right tier for every tool), RAG-02 (rag_query tool result reaches the client)</implements>
  <commit>fix(agent): strip trailing Tool suffix in resolver — match classify() tool-ID namespace</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| resolver → classify | `normalizeToolName` is a pure string transform (slice trailing "Tool"). Idempotent on inputs without the suffix. No DB or network access. |
| resolver log → terminal | Operator-only observability log; no secrets in `toolName` (all 4 names are operator-authored). |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-T-01 | Spoofing | Edge case: hypothetical `tool_tool` ends in "Tool" | low | accept | Phase 1 working set has 4 tools, none ending in "Tool" except via the camelCase suffix. If a future tool is named `tool_tool` (not `toolTool`), normalization would produce `tool_tool` which still matches `classify.ts` correctly (none of the startsWith patterns match `tool_tool`). Document in code comment that the suffix rule applies only to the `<name>Tool` naming convention used in sdlc.ts. |
| T-1-T-02 | Tampering | Classify lookup | low | accept | `classify()` is a pure function over a hardcoded table; normalization is reversible in the source. |

## Verification

1. Static: `grep` confirms `normalizeToolName` helper defined, applied once, `resolveApproval(toolName, ...)` uses normalized name, no remaining `resolveApproval(ctx.toolName, ...)`.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; trigger "what is the Snyk CLI command?" → resolver log shows `[approval-resolver] tool=ragQuery mode=tiered` (normalized, not `tool=ragQueryTool`) → classify returns `read` → resolver returns `false` → tool runs un-gated → `tool-output-available` chunk carries the context string in the chat. Confirm echo still runs silently (Test 5), createNote still gates in tiered (Test 6), applyMigrations still gates in tiered (Test 7).

## Success criteria

- Resolver normalizes toolName via the 2-line helper before classification.
- `[approval-resolver]` log shows normalized name (`ragQuery`, `echo`, `createNote`, `applyMigrations`).
- Read tools (echo, rag_query) do NOT gate — they run immediately.
- write_low (createNote) and write_high (applyMigrations) still gate in tiered mode.
- rag_query now returns a context string in the chat (Test 15 passes).
- No regression on echo (Test 5 still passes).

## Artifacts this phase produces

- Modified: `worker/src/agents/sdlc.ts` (adds `normalizeToolName` helper, applies to `ctx.toolName`)
- Modified symbols: `normalizeToolName` (new private helper), `toolApprovalResolver` (calls helper before log + resolveApproval)

## Output

Create `.planning/phases/01-foundation/01-T-SUMMARY.md` when done.
