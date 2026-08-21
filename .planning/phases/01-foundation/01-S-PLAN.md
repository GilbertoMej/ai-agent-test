---
phase: 1
plan: S
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-14]
depends_on: []
files_modified:
  - worker/src/agents/sdlc.ts
autonomous: true
must_haves:
  - "`ragQueryTool` is imported in sdlc.ts:3-5 alongside the existing three tool imports"
  - "`ragQueryTool` is registered on the `tools:` object of the sdlcAgent config (currently line 24)"
  - "The agent instructions string mentions `rag_query` so the model knows when to call it"
  - "`pnpm tsc --noEmit` introduces no new errors in sdlc.ts"
  - "Calling rag_query via the agent returns a non-empty `context` string and audit_log row has tool_doc_rows_consumed >= 1"
requirements:
  - RAG-01
  - RAG-02
---

# 01-S — Phase 1 Gap Closure (register rag_query on sdlcAgent + instructions)

Closes G-1-14 (blocker): `worker/src/agents/sdlc.ts` lines 3-5 import only `echoTool` / `createNoteTool` / `applyMigrationsTool`; line 24 wires those three only; lines 19-22 instructions string never names `rag_query`. The tool itself is implemented and audited (`worker/src/tools/rag-query.ts:17` — `id='rag_query'`, classified `'read'` in `classify.ts:12`, wrapped with withAudit). The model has no way to call it.

Fix is three coordinated edits in one file: add the import, register the tool, and extend the instructions. One file.

## Tasks

<task type="auto">
  <id>01-S1-register-rag-query-on-sdlc-agent</id>
  <read_first>
    - worker/src/agents/sdlc.ts (lines 1-25 — full top-half; line 3-5 imports; line 19-22 instructions; line 24 tools object)
    - worker/src/tools/rag-query.ts (full file — id='rag_query', description, inputSchema, execute)
    - worker/src/lib/classify.ts (line 12 — rag_query already classified as 'read')
    - worker/src/lib/rag.ts (retrieve + formatContext — what the tool returns)
  </read_first>
  <action>
    Three surgical edits in `worker/src/agents/sdlc.ts`, all in the existing top-half of the file. One file.

    **Edit 1 — Import** (after line 5): add the missing tool import.

    Current lines 3-5:
    ```
    import { echoTool } from "../tools/echo";
    import { createNoteTool } from "../tools/create-note";
    import { applyMigrationsTool } from "../tools/apply-migrations";
    ```

    Add a 4th import after line 5:
    ```
    import { ragQueryTool } from "../tools/rag-query";
    ```

    **Edit 2 — Tools registration** (line 24): add `ragQueryTool` to the tools object.

    Current line 24:
    ```
    tools: { echoTool, createNoteTool, applyMigrationsTool },
    ```

    Replacement:
    ```
    tools: { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool },
    ```

    **Edit 3 — Instructions string** (lines 19-22): extend so the model knows when to call rag_query.

    Current lines 19-22:
    ```
    instructions:
      "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
      "createNote (write_low), and applyMigrations (write_high). Use createNote when the user asks for a note; " +
      "use applyMigrations when the user asks to migrate. For everything else, answer from chat.",
    ```

    Replacement:
    ```
    instructions:
      "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
      "rag_query (read), createNote (write_low), and applyMigrations (write_high). " +
      "Call rag_query BEFORE invoking any MCP tool whose usage you are unsure about — it returns the top-5 tool_docs rows relevant to the user's request. " +
      "Use createNote when the user asks for a note; use applyMigrations when the user asks to migrate. " +
      "For everything else, answer from chat.",
    ```

    Three changes:
    1. Mention `rag_query (read)` in the tool inventory list.
    2. Add the explicit "call BEFORE invoking any MCP tool whose usage you are unsure about" prompt — copied from `worker/src/tools/rag-query.ts:19-20` so the model's instruction matches the tool's documented purpose.
    3. Keep the existing createNote / applyMigrations / "everything else" guidance unchanged.

    Do NOT change anything below line 25 (the `toolApprovalResolver` is untouched — G-1-9 plan 01-O owns that block). Do NOT touch the `model` field on line 23 (stays `opencode-go/hy3`). Do NOT change any file under `worker/src/tools/` or `worker/src/lib/`.
  </action>
  <files>worker/src/agents/sdlc.ts</files>
  <verify>
    <automated>grep -nE 'import.*ragQueryTool.*rag-query' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'ragQueryTool,' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'rag_query.*\(read\)' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'Call rag_query BEFORE' worker/src/agents/sdlc.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'import { ragQueryTool }' worker/src/agents/sdlc.ts` returns 1 match (import wired)
    - `grep 'ragQueryTool,' worker/src/agents/sdlc.ts` returns 1 match (registered on tools object)
    - `grep 'rag_query (read)' worker/src/agents/sdlc.ts` returns 1 match (inventory line updated)
    - `grep 'Call rag_query BEFORE' worker/src/agents/sdlc.ts` returns 1 match (usage instruction added)
    - `pnpm tsc --noEmit` introduces no new errors in sdlc.ts
    - No edits in worker/src/tools/rag-query.ts, worker/src/lib/classify.ts, or worker/src/lib/rag.ts
  </acceptance_criteria>
  <done>ragQueryTool is wired on the agent; the model is told to call it before unfamiliar MCP tools; chat can now trigger rag retrieval; audit_log rows for rag_query will record tool_doc_rows_consumed.</done>
  <reversibility>reversible</reversibility>
  <implements>RAG-01 (agent calls rag_query for tool doc retrieval), RAG-02 (audit row records tool_doc_rows_consumed)</implements>
  <commit>feat(agent): register rag_query on sdlcAgent — agent can now retrieve tool docs</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| agent → rag_query | Read-classified tool; resolveApproval returns false (auto-approve). withAudit wraps execute; INSERT runs unconditionally. |
| rag_query → PostgresStore (via worker/src/lib/rag.ts retrieve) | RAG retrieval runs against tool_docs table; same DB the worker uses for audit_log + PostgresStore. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-S-01 | Prompt Injection | rag_query description | low | accept | Tool description is operator-authored (`worker/src/tools/rag-query.ts:19-20`) — not user input. The agent instructions extension is also operator-authored. No untrusted data flows into the model instructions. |
| T-1-S-02 | Information Disclosure | tool_docs table | low | accept | tool_docs is the operator's own DB table (single-user demo). rag_query returns snippets of the operator's own docs, not external secrets. |

## Verification

1. Static: `grep` confirms import, tools registration, inventory line, and instructions all updated.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; send a chat message like "what is the Snyk CLI command?". The agent should call rag_query, return a context string quoting tool_docs rows, and `SELECT * FROM audit_log WHERE tool_name='rag_query'` should return a row with `tool_doc_rows_consumed >= 1`.

## Success criteria

- ragQueryTool is registered on the agent's tools object.
- The agent's instructions mention `rag_query (read)` and tell the model when to call it.
- A chat message that benefits from tool-doc retrieval triggers a rag_query tool call.
- audit_log row for the rag_query call has `tool_doc_rows_consumed >= 1`.
- No regression on echo/createNote/applyMigrations tool calls (those still work as before).

## Output

Create `.planning/phases/01-foundation/01-S-SUMMARY.md` when done.
