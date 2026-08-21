---
phase: 1
plan: S
subsystem: agent-runtime
tags: [gap-closure, G-1-14, RAG-01, RAG-02, rag, agent-tools, mastra, instructions]
dependency_graph:
  requires:
    - phase: 01-B-01-06
      provides: rag_query tool (worker/src/tools/rag-query.ts, id='rag_query', classified 'read' in classify.ts:12, wrapped with withAudit)
    - phase: 01-A-01-01b
      provides: sdlcAgent runtime (worker/src/agents/sdlc.ts Mastra 1.60 Agent config + toolApprovalResolver)
  provides:
    - "01-S1 — ragQueryTool wired on sdlcAgent: imported (line 6), registered on tools object (line 27), instructions tell the model when to call it (line 22-23)"
  affects: [worker/src/agents/sdlc.ts]
tech-stack:
  added: []
  patterns: ["agent instructions mirror tool description (worker/src/tools/rag-query.ts:19-20) so model behaviour tracks tool semantics", "3-edit surgical fix to wire an already-built tool onto the agent — no new code, no new deps"]
key-files:
  modified: [worker/src/agents/sdlc.ts]
key-decisions:
  - "Tool description wording ('Call rag_query BEFORE invoking any MCP tool whose usage you are unsure about') lifted verbatim from worker/src/tools/rag-query.ts:19-20 so agent instructions and tool description stay in lockstep — same wording, same trigger condition."
  - "Instructions explicitly enumerate every tool's class (echo=read, rag_query=read, createNote=write_low, applyMigrations=write_high) so the model can see the full Phase 1 inventory at a glance — small string, low cost, helps tool selection."
  - "Plan <verify> pattern 'ragQueryTool,' (trailing comma) does not match because ragQueryTool is the last entry in the tools object — the line ends in 'ragQueryTool },' not 'ragQueryTool,'. Substantive intent (ragQueryTool is registered) is met; documented as plan typo, not a deviation. Acceptance check via `grep -n 'ragQueryTool' worker/src/agents/sdlc.ts` returns 2 matches (line 6 import + line 27 tools object)."
metrics:
  duration: 5
  completed_date: "2026-08-21T00:21:00Z"
  tasks: 1
  commits: 1
  files_changed: 1
  lines_changed: 9
status: complete
actuals:
  tokens: 800
  tasks: 1
  commits: 1
---

# Phase 1 Plan S: G-1-14 register rag_query on sdlcAgent + extend instructions

Closing **G-1-14** (blocker): `worker/src/agents/sdlc.ts` was missing the `ragQueryTool` wiring on three fronts — no import on line 6, no entry on the `tools` object line 27, and no mention of `rag_query` in the agent's instructions string (lines 19-22). The tool itself was fully implemented (`worker/src/tools/rag-query.ts:17` — `id='rag_query'`, classified `'read'` in `classify.ts:12`, wrapped with `withAudit` so the audit_log row already records `tool_doc_rows_consumed`). The model simply had no way to call it.

Fix is three coordinated edits in one file: add the import, register the tool, extend the instructions.

## What Shipped

### Task 01-S1 — Register `ragQueryTool` on `sdlcAgent`

**Commit:** `9fe5170` — `feat(agent): register rag_query on sdlcAgent — agent can now retrieve tool docs`

Three surgical edits in `worker/src/agents/sdlc.ts`:

1. **Import** (line 6) — added the missing import after line 5:
   ```ts
   import { ragQueryTool } from "../tools/rag-query";
   ```

2. **Tools registration** (line 27) — extended the tools object:
   ```ts
   tools: { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool },
   ```

3. **Instructions string** (lines 20-25) — extended so the model knows when to call rag_query:
   - Added `rag_query (read)` to the Phase 1 inventory line
   - Added the explicit "Call rag_query BEFORE invoking any MCP tool whose usage you are unsure about — it returns the top-5 tool_docs rows relevant to the user's request" prompt — wording copied verbatim from `worker/src/tools/rag-query.ts:19-20`
   - Kept the existing createNote / applyMigrations / "everything else" guidance unchanged

Nothing below line 25 touched: `toolApprovalResolver` is intact (G-1-9 plan 01-O owns that block), `model: "opencode-go/hy3"` stays, no changes to `worker/src/tools/` or `worker/src/lib/`.

## Deviations from Plan

### Plan typo (non-actionable)

The plan's `<verify>` and `<acceptance_criteria>` use `grep 'ragQueryTool,'` (trailing comma). Since `ragQueryTool` is the last entry in the tools object, the actual line ends in `ragQueryTool },` — `grep -nE 'ragQueryTool,'` returns 0 matches.

The substantive intent (ragQueryTool is registered on the agent's tools object) is verified by:
- `grep -n 'ragQueryTool' worker/src/agents/sdlc.ts` returns 2 matches:
  - line 6: `import { ragQueryTool } from "../tools/rag-query";`
  - line 27: `tools: { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool },`

This is a benign plan typo, not a deviation in the code change. No edits were re-applied to chase the typo.

## Verification

All plan acceptance criteria met (with the one plan-typo caveat above):

- `grep 'import { ragQueryTool }' worker/src/agents/sdlc.ts` — 1 match (line 6, import wired)
- `grep -nE 'ragQueryTool' worker/src/agents/sdlc.ts` — 2 matches (line 6 import + line 27 tools object)
- `grep -nE "rag_query \(read\)" worker/src/agents/sdlc.ts` — 1 match (line 22, inventory line updated)
- `grep -nE "Call rag_query BEFORE" worker/src/agents/sdlc.ts` — 1 match (line 23, usage instruction added)
- `pnpm tsc --noEmit` — no new errors in `worker/src/agents/sdlc.ts` (only the 2 pre-existing `lib/insforge.ts` errors remain — tracked for post-Phase-1 cleanup per STATE.md carryover)
- No edits in `worker/src/tools/rag-query.ts`, `worker/src/lib/classify.ts`, or `worker/src/lib/rag.ts` (confirmed via `git status --short`)

## Success Criteria

- [x] `ragQueryTool` registered on the agent's tools object (line 27)
- [x] Agent instructions mention `rag_query (read)` and tell the model when to call it (lines 22-23)
- [ ] Live: chat message that benefits from tool-doc retrieval triggers a rag_query tool call — deferred to UAT (manual verify, requires `pnpm dev` + browser session)
- [ ] Live: audit_log row for the rag_query call has `tool_doc_rows_consumed >= 1` — deferred to UAT
- [ ] Live: no regression on echo/createNote/applyMigrations tool calls — deferred to UAT

Live verification deferred to `/gsd-verify-work 1` phase verification (UAT step requires a running worker + browser session, out of scope for the gap-closure plan).

## Known Limitations / Out of Scope

- **Model may not always call rag_query even when told.** Instructions are guidance, not enforcement — Phase 1's free-tier model may skip the rag_query call for short/easy questions and answer from chat. Acceptable: the wiring exists, the audit row will surface the call (or its absence), and the live behaviour can be tuned later by adjusting the instructions prompt.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-1-S-01 (accepted) | `worker/src/agents/sdlc.ts` | Agent instructions now mention rag_query by name. T-1-S-01 (Prompt Injection, low): the instructions string is operator-authored (not user input) — untrusted chat content cannot inject into the agent's system prompt. Disposition: accept. |
| T-1-S-02 (accepted) | `worker/src/tools/rag-query.ts` | rag_query returns tool_docs snippets. T-1-S-02 (Information Disclosure, low): tool_docs is the operator's own DB table (single-user demo) — no external secrets flow through. Disposition: accept. |

## Cross-references

- Tool implementation: `worker/src/tools/rag-query.ts` (id=`rag_query`, read-classified, withAudit-wrapped)
- Classification: `worker/src/lib/classify.ts:12` (`toolName === "rag_query"` → `'read'`)
- RAG retrieval: `worker/src/lib/rag.ts` (`retrieve` + `formatContext`)
- Pattern: instructions wording mirrors tool description so model behaviour tracks tool semantics

## Self-Check: PASSED

Verified:

- `.planning/phases/01-foundation/01-S-SUMMARY.md` exists on disk
- Task commit `9fe5170` present in `git log` on `dev`
- 3/4 grep verifications per PLAN.md `<verify>` block pass; the 4th (`ragQueryTool,` trailing-comma pattern) is a plan typo — substantive check via `grep ragQueryTool` returns 2 matches (import + tools object)
- `pnpm tsc --noEmit` — 0 new errors in `worker/src/agents/sdlc.ts` (only the 2 pre-existing `lib/insforge.ts` errors remain)
- No edits in `worker/src/tools/rag-query.ts`, `worker/src/lib/classify.ts`, or `worker/src/lib/rag.ts`
