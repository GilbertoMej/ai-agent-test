---
phase: 1
plan: M
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-8]
depends_on: []
files_modified:
  - worker/src/tools/apply-migrations.ts
  - app/components/ChatPanel.tsx
autonomous: true
must_haves:
  - "`applyMigrationsTool` description does NOT contain the literal string 'Requires typed-CONFIRM approval' (the model-bias phrase)"
  - "`ChatPanel.tsx` derives the approval `tier` from the tool part's `toolName` via `classify()` instead of hardcoding `'write_low'`"
  - "Backend `classify('applyMigrations')` returns `'write_high'`; frontend tier derivation reads the same function via direct import from `worker/src/lib/classify` (pure module — safe for client bundle; NOT via the audit re-export which transitively pulls in `db/client` and runs `postgres(url)` at module load)"
  - "`pnpm tsc --noEmit` introduces no new errors in apply-migrations.ts or ChatPanel.tsx"
  - "Live: triggering applyMigrations surfaces a red-bordered card with DESTRUCTIVE badge and the typed-CONFIRM input; the Approve button is disabled until the user types 'CONFIRM'"
requirements:
  - HITL-01
---

# 01-M — Phase 1 Gap Closure (applyMigrations tool description + ChatPanel tier hardcode)

Closes G-1-8 (minor): TWO coupled defects stack — (1) `worker/src/tools/apply-migrations.ts:15-16` ships "Requires typed-CONFIRM approval" in the tool description; the model obeys the literal text and emits a typed-CONFIRM gate as chat text instead of calling the tool. (2) `app/components/ChatPanel.tsx:219` hardcodes `tier: "write_low"` when building the ApprovalCard, so even if (1) is fixed and the tool does fire, the resulting card is forced to write_low styling (no red border, no DESTRUCTIVE, no CONFIRM input).

Fix is two coordinated edits in two files: neutralize the tool description, and derive tier from the toolName via the existing `classify()` function (which already correctly returns `'write_high'` for `applyMigrations` — `worker/src/lib/classify.ts:14`).

## Tasks

<task type="auto">
  <id>01-M1-neutralize-apply-migrations-description</id>
  <read_first>
    - worker/src/tools/apply-migrations.ts (lines 13-19 — full createTool call; line 15-16 the description)
    - .planning/debug/g-1-8-apply-migrations-confirm-gate.md (root cause A — tool description literally bakes typed-CONFIRM bias into the model prompt)
  </read_first>
  <action>
    Single edit to `worker/src/tools/apply-migrations.ts:15-16`.

    Current lines 15-16:

    ```
      description:
        "Apply database migrations (Phase 1 stub: no-op returning { attempted: true, rowsAffected: 0 }). Requires typed-CONFIRM approval.",
    ```

    Replacement:

    ```
      description:
        "Apply pending database migrations. Phase 1 stub: returns { attempted: true, rowsAffected: 0 }. " +
        "The harness pauses for human approval before execution — do not invent any additional gate.",
    ```

    Three changes:
    1. Drop the literal phrase "Requires typed-CONFIRM approval" — that is the model-bias seed.
    2. Replace with a neutral sentence: "The harness pauses for human approval before execution — do not invent any additional gate." This documents the actual behavior (resolver + ApprovalCard) AND instructs the model not to fabricate a typed-CONFIRM gate of its own.
    3. Use two string fragments joined with `+` (matches the existing string-concatenation style in `worker/src/agents/sdlc.ts:19-22`).

    Do NOT change `id: "applyMigrations"` (line 14 — the model needs the exact id to call), `inputSchema: z.object({})` (line 17 — stub takes no input), or `execute: inner` (line 18 — the audit-wrapped execute stays).
  </action>
  <files>worker/src/tools/apply-migrations.ts</files>
  <verify>
    <automated>! grep -nE 'Requires typed-CONFIRM approval' worker/src/tools/apply-migrations.ts | grep -c . | awk '{exit !($1==0)}' && grep -nE 'do not invent any additional gate' worker/src/tools/apply-migrations.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'id:\s*"applyMigrations"' worker/src/tools/apply-migrations.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'Requires typed-CONFIRM approval' worker/src/tools/apply-migrations.ts` returns 0 matches (bias phrase removed)
    - `grep 'do not invent any additional gate' worker/src/tools/apply-migrations.ts` returns 1+ match (neutral guidance added)
    - `grep 'id: "applyMigrations"' worker/src/tools/apply-migrations.ts` returns 1 match (id unchanged)
    - `pnpm tsc --noEmit` introduces no new errors in apply-migrations.ts
  </acceptance_criteria>
  <done>Tool description no longer biases the model to emit a typed-CONFIRM gate as chat text; the model now calls the tool directly and the harness's resolver+ApprovalCard takes over.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (write_high tools require explicit approval before execution)</implements>
  <commit>fix(tools): neutralize applyMigrations description — stop model CONFIRM-hallucination</commit>
</task>

<task type="auto">
  <id>01-M2-derive-tier-from-classify</id>
  <read_first>
    - app/components/ChatPanel.tsx (lines 209-220 — approval-request part rendering, the `tier: "write_low"` hardcode at line 219)
    - worker/src/lib/audit.ts (DO NOT import from here on the client — see action note)
    - worker/src/lib/classify.ts (line 14 — `applyMigrations` → `'write_high'`; line 13 — `createNote` → `'write_low'`; line 12 — `echo`/`rag_query` → `'read'`; pure module with no side effects — safe for client bundle)
    - .planning/debug/g-1-8-apply-migrations-confirm-gate.md (root cause B — ChatPanel hardcodes tier, discarding backend classifier)
  </read_first>
  <action>
    Single edit to `app/components/ChatPanel.tsx:209-220`.

    **Add the import** at the top of the file (next to the existing imports on lines 1-12). After the `import type { ApprovalMode } from "@/worker/src/lib/approval";` line (line 11), add:

    ```
    import { classify, type ToolClass } from "@/worker/src/lib/classify";
    ```

    Note: import DIRECTLY from `@/worker/src/lib/classify`, NOT from `@/worker/src/lib/audit`. The audit module re-exports `classify` (line 8: `export { classify, type ToolClass };`) but transitively imports `@/db/client` (line 3: `import { db } from "@/db/client";`) which calls `postgres(url)` at module load. In the browser bundle that throws on missing `DATABASE_URL` and tree-shaking can't strip the side effect (top-level `postgres(url)` is a real side effect, not dead code). `classify.ts` is a pure module — no DB import, no `postgres()` call — so it's safe to ship to the client. Source of truth is the same in both paths; only the import surface differs.

    **Derive the tier** in the approval-part render. Current lines 214-220:

    ```
    const approvalPart: ToolApprovalPart = {
      type: "tool-approval-request",
      toolCallId: ap.toolCallId,
      toolName,
      args: toolPart?.input ?? {},
      tier: "write_low",
    };
    ```

    Replacement:

    ```
    const toolClass: ToolClass = toolName ? classify(toolName) : "write_low";
    const approvalTier: ToolApprovalPart["tier"] = toolClass === "write_high" ? "write_high" : "write_low";
    const approvalPart: ToolApprovalPart = {
      type: "tool-approval-request",
      toolCallId: ap.toolCallId,
      toolName,
      args: toolPart?.input ?? {},
      tier: approvalTier,
    };
    ```

    Four changes:
    1. Import `classify` and `ToolClass` directly from `@/worker/src/lib/classify` (pure module — see import note above). The server-side `audit.ts` still re-exports `classify` and that's fine for any server-side callers; only the client bundle needs the direct path.
    2. Call `classify(toolName)` to derive the backend-equivalent tier (`'read' | 'write_low' | 'write_high'`).
    3. Map `ToolClass` → `ApprovalTier` (`write_high` → `write_high`; everything else including `'read'` → `'write_low'` — `'read'` tools should never reach the approval part because the resolver auto-approves them; the `'write_low'` default is a safety net for unknown tools).
    4. Drop the literal `tier: "write_low"`.

    The `ApprovalCard` component (`app/components/ApprovalCard.tsx:31,69,84,101-122`) already branches on `tier === "write_high"` for red border + DESTRUCTIVE badge + typed-CONFIRM input — no frontend ApprovalCard changes needed.

    Do NOT change any other line in ChatPanel.tsx. Do NOT change `classify.ts`. Do NOT remove `audit.ts`'s server-side re-export of `classify` — server-side callers (worker/src/lib/audit.ts itself) still import it that way.
  </action>
  <files>app/components/ChatPanel.tsx</files>
  <verify>
    <automated>grep -nE 'import.*classify.*@/worker/src/lib/classify' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'const toolClass:\s*ToolClass\s*=' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'tier:\s*"write_low",\s*$' app/components/ChatPanel.tsx | grep -c . | awk '{exit !($1==0)}' && grep -nE 'approvalTier' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'import { classify' app/components/ChatPanel.tsx` returns 1 match (classify imported from @/worker/src/lib/classify — pure module, safe for client bundle; NOT from the audit re-export which transitively pulls in db/client)
    - `grep 'const toolClass: ToolClass' app/components/ChatPanel.tsx` returns 1 match (tier derived)
    - `grep -E 'tier:\s*"write_low",\s*$' app/components/ChatPanel.tsx` returns 0 matches (no more hardcode — the new code uses `tier: approvalTier`)
    - `grep 'approvalTier' app/components/ChatPanel.tsx` returns 1+ match (variable used)
    - `pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx (pre-existing 7 errors remain unchanged)
  </acceptance_criteria>
  <done>ApprovalCard tier now derives from the backend classifier via `classify(toolName)`. applyMigrations tool calls produce red-bordered cards with DESTRUCTIVE badge + CONFIRM input; createNote tool calls produce default-bordered cards with Approve/Deny + "Approve all matching (5 min)".</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (write_high tools render the high-tier card)</implements>
  <commit>fix(chat): derive approval tier from classify(toolName) — drop write_low hardcode</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Tool description → model prompt | `createTool({description})` is shipped to the model as part of the tool metadata. Operator-authored. |
| classify() in client → toolName | The frontend import of `classify` from `@/worker/src/lib/audit` is a transitive import — Next.js bundles `worker/src/lib/classify.ts` into the client chunk. The function is pure (no side effects, no DB access). |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-M-01 | Prompt Injection | Tool description | low | accept | Description is operator-authored. Removed the literal "Requires typed-CONFIRM approval" bias. |
| T-1-M-02 | Tampering | classify() in client bundle | low | accept | `classify()` is a pure function over a hardcoded table. Direct import from `@/worker/src/lib/classify` keeps the client bundle to just the function + types — no `db/client`, no `audit.ts`. |
| T-1-M-03 | Information Disclosure | Worker code in client bundle | low | accept | Next.js tree-shaking keeps only the `classify` function and its types in the client chunk; the audit-INSERT code path is server-only. |

## Verification

1. Static: grep confirms description neutralized, classify imported + used in ChatPanel.tsx, no more `tier: "write_low"` literal.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; trigger createNote → default-bordered card (write_low). Trigger applyMigrations → red-bordered card with DESTRUCTIVE badge + CONFIRM input. Approve button is disabled until user types "CONFIRM".

## Success criteria

- applyMigrations tool description no longer biases the model.
- ChatPanel derives the approval tier from `classify(toolName)`.
- applyMigrations calls surface the write_high card UX (red border, DESTRUCTIVE badge, typed-CONFIRM input).
- createNote calls continue to surface the write_low card UX (default border, Approve/Deny, "Approve all matching (5 min)").
- No regression on the resolver, requestContext reads, or other ApprovalCard behavior.

## Output

Create `.planning/phases/01-foundation/01-M-SUMMARY.md` when done.
