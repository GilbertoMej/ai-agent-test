---
phase: 1
plan: R
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-12]
depends_on: []
files_modified:
  - worker/src/lib/audit.ts
  - worker/src/index.ts
autonomous: true
must_haves:
  - "`withAudit` threads sessionId via a module-scope variable set per-request at the stream-route level (worker/src/index.ts already calls `requestContext.setRaw(\"sessionId\", sessionId)` on line 99 — `withAudit` falls back to that value via `process.env.SESSION_ID` ONLY if the module-scope isn't set)"
  - "Module-scope variable `currentSessionId` is exported as a setter so the stream route can call `setAuditSessionId(sessionId)` before `agent.stream()`; `withAudit` reads it inside `resolveSessionId`"
  - "INSERT errors in `withAudit` are logged via `console.error` (not just silently swallowed) and the error is NOT re-thrown so it does not break the tool-call chain"
  - "Static type-check: `pnpm tsc --noEmit` introduces no new errors in audit.ts"
  - "Live: `SELECT * FROM audit_log` returns at least 1 row after the echo call, with `session_id` matching the browser's sessionId from localStorage"
requirements:
  - BCK-03
---

# 01-R — Phase 1 Gap Closure (withAudit sessionId — thread via module-scope, surface INSERT errors)

Closes G-1-12 (blocker): `worker/src/lib/audit.ts:21` — `createTool({execute}).execute(...)` in @mastra/core 1.60 invokes user-supplied execute through an internal tool-runner wrapper that does NOT pass a 2nd ctx argument carrying requestContext. `withAudit` outer signature `(args, ctx?)` therefore always sees `ctx=undefined` for `echoTool`. `resolveSessionId(ctx)` falls back to `process.env.SESSION_ID ?? "anon"` — INSERT runs with wrong session_id OR INSERT throws inside `finally` and the throw is swallowed by the stream outer try/catch which only console.logs.

Fix is two coordinated edits in one file (`worker/src/lib/audit.ts`): (1) thread sessionId via a module-scope variable that the stream route sets before `agent.stream()`. (2) Improve INSERT error visibility — `console.error` + don't re-throw so the stream still completes.

## Tasks

<task type="auto">
  <id>01-R1-audit-thread-sessionid-via-module-scope</id>
  <read_first>
    - worker/src/lib/audit.ts (lines 16-71 — full withAudit + resolveSessionId; line 60-63 AuditToolContext type)
    - worker/src/index.ts (lines 97-99 — `requestContext.setRaw("sessionId", sessionId ?? "anon")` before agent.stream; line 107 — `agent.stream(promptMessages, {...})`)
    - .planning/debug/g-1-12-audit-log-empty.md (full root-cause trace: Mastra 1.60 tool runner calls execute(args) with single arg)
  </read_first>
  <action>
    Two coordinated edits in `worker/src/lib/audit.ts`, one file.

    **Edit 1 — Module-scope sessionId carrier** (insert at the top of the file, after the `export { classify, type ToolClass };` re-export on line 8 and before `export type AuditExtras = ...` on line 12):

    ```
    // Module-scope sessionId carrier. Mastra 1.60's tool runner invokes
    // createTool({execute}).execute(args) with a single arg — no ctx carrying
    // requestContext. The stream route calls setAuditSessionId(sessionId) before
    // agent.stream() so withAudit can read the value via resolveSessionId().
    // This is a per-request set — the stream route MUST call it before every
    // agent.stream() to avoid cross-session bleed.
    let currentSessionId: string | undefined;
    export function setAuditSessionId(sessionId: string | undefined): void {
      currentSessionId = sessionId;
    }
    ```

    **Edit 2 — `resolveSessionId` augmentation** (replace lines 65-71):

    Current:
    ```
    function resolveSessionId(ctx: AuditToolContext | undefined): string {
      if (ctx?.sessionId) return ctx.sessionId;
      const rc = ctx?.requestContext as { get?: (key: string) => unknown } | undefined;
      const fromRc = rc?.get?.("sessionId");
      if (typeof fromRc === "string" && fromRc.length > 0) return fromRc;
      return process.env.SESSION_ID ?? "anon";
    }
    ```

    Replacement:
    ```
    function resolveSessionId(ctx: AuditToolContext | undefined): string {
      // Module-scope (set per-request by the stream route) wins over ctx.
      // Mastra 1.60's tool runner never delivers a 2nd-arg ctx to execute(),
      // so this is the path that actually fires in production.
      if (currentSessionId) return currentSessionId;
      if (ctx?.sessionId) return ctx.sessionId;
      const rc = ctx?.requestContext as { get?: (key: string) => unknown } | undefined;
      const fromRc = rc?.get?.("sessionId");
      if (typeof fromRc === "string" && fromRc.length > 0) return fromRc;
      return process.env.SESSION_ID ?? "anon";
    }
    ```

    Note the order: module-scope first, then ctx, then process.env fallback. This way, future Mastra versions that DO pass ctx will still hit the ctx branch (the module-scope value is only the fallback).

    **Edit 3 — Surface INSERT errors** (replace the `await db.insert(auditLog).values(...)` block at lines 40-53). Wrap the insert in try/catch with `console.error`. Do NOT re-throw — the tool has already returned successfully; failing the audit write must not break the chat stream.

    Current:
    ```
    await db.insert(auditLog).values({
      id: nanoid(),
      session_id: sessionId,
      tool_name: toolId,
      args_json: redact(args),
      result_status: status,
      approval_decision: classification === "read" ? "auto" : null,
      duration_ms: Date.now() - start,
      tool_doc_rows_consumed: extras.tool_doc_rows_consumed ?? null,
      tokens_in: 0,
      tokens_out: 0,
    });
    ```

    Replacement:
    ```
    try {
      await db.insert(auditLog).values({
        id: nanoid(),
        session_id: sessionId,
        tool_name: toolId,
        args_json: redact(args),
        result_status: status,
        approval_decision: classification === "read" ? "auto" : null,
        duration_ms: Date.now() - start,
        tool_doc_rows_consumed: extras.tool_doc_rows_consumed ?? null,
        tokens_in: 0,
        tokens_out: 0,
      });
    } catch (e) {
      // ponytail: surface the failure loudly; do NOT re-throw — the tool has
      // already returned to the caller, and the chat stream must not break.
      // Without this, audit INSERT failures are silent (the stream outer
      // try/catch only console.logs and the row is missing from audit_log).
      console.error(`audit: insert failed tool=${toolId} session=${sessionId}`, e);
    }
    ```

    **Edit 4 — Wire the setter into the stream route** (`worker/src/index.ts`). Add one line at the top of the `/agents/sdlcAgent/stream` handler — AFTER the `const { messages, threadId, approvalMode, sessionId } = body;` destructure (line 80) and BEFORE the `agent = c.get("mastra").getAgent("sdlcAgent");` line (line 81):

    ```
    setAuditSessionId(sessionId);
    ```

    And add the import at the top alongside the other audit imports (line 12 area): `import { patchTokens, setAuditSessionId } from "./lib/audit";`.

    The setter is per-request; the next `agent.stream()` call resets it via the handler re-running. Two concurrent streams in the same worker process would race — but Phase 1 is single-user (`resourceId="operator"` per `worker/src/index.ts:24`), so concurrency is bounded to 1.

    Do NOT change the `withAudit` outer signature (`(args, ctx?)`) — leave the optional ctx parameter in place for future Mastra versions that DO deliver ctx. Do NOT change `patchTokens` (the step-finish handler still calls it directly). Do NOT change `worker/src/tools/echo.ts` or `worker/src/tools/rag-query.ts` — the wrappers at those call sites are unchanged.
  </action>
  <files>worker/src/lib/audit.ts, worker/src/index.ts</files>
  <verify>
    <automated>grep -nE 'export function setAuditSessionId' worker/src/lib/audit.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'currentSessionId' worker/src/lib/audit.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=2)}' && grep -nE 'audit: insert failed' worker/src/lib/audit.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'setAuditSessionId\(sessionId\)' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'import.*setAuditSessionId.*from "./lib/audit"' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'export function setAuditSessionId' worker/src/lib/audit.ts` returns 1 match (setter exported)
    - `grep -c 'currentSessionId' worker/src/lib/audit.ts` returns 2+ matches (module var + read site)
    - `grep 'audit: insert failed' worker/src/lib/audit.ts` returns 1+ match (error visibility added)
    - `grep 'setAuditSessionId(sessionId)' worker/src/index.ts` returns 1+ match (stream route wires setter)
    - `grep 'import { ... setAuditSessionId ... } from "./lib/audit"' worker/src/index.ts` returns 1 match (import added)
    - `pnpm tsc --noEmit` introduces no new errors in audit.ts (audit.ts had no pre-existing TS errors)
  </acceptance_criteria>
  <done>withAudit reads sessionId from the module-scope carrier that the stream route sets per-request; audit_log INSERT failures are logged to console.error; the chat stream does not break on INSERT failure. Live: SELECT FROM audit_log returns the row with the correct browser sessionId.</done>
  <reversibility>costly</reversibility>
  <implements>BCK-03 (audit_log records every tool call with session_id + tokens)</implements>
  <commit>fix(audit): thread sessionId via module-scope — Mastra 1.60 strips 2nd-arg ctx</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Stream route → audit module-scope | `setAuditSessionId(sessionId)` is called inside the stream handler. Single-user Phase 1 demo (`resourceId="operator"`); no concurrent streams in the same worker. |
| audit INSERT → PostgresStore / Drizzle | INSERT goes through the existing `db` client (`@/db/client`). Auth is unchanged. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-R-01 | Information Disclosure | audit_log.args_json | medium | mitigate | `redact(args)` runs before every INSERT (line 44) — unchanged. |
| T-1-R-02 | Tampering | Module-scope currentSessionId | low | accept | Single-user demo; concurrency bounded to 1. Future multi-user Phase should switch to AsyncLocalStorage. |
| T-1-R-03 | Denial of Service | audit INSERT failure | low | mitigate | `console.error` logs the failure; chat stream does NOT re-throw, so a DB outage degrades the audit log but does not break chat. |

## Verification

1. Static: grep confirms module-scope carrier, INSERT error logging, and stream-route wiring.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; note browser sessionId from header; trigger "use echo to say hello"; `SELECT * FROM audit_log WHERE tool_name='echo' ORDER BY ts DESC LIMIT 1` returns 1 row with `session_id` matching the browser sessionId.

## Success criteria

- withAudit correctly threads sessionId from the module-scope carrier.
- audit_log row for the echo call has the correct browser sessionId (no longer 'anon').
- INSERT failures surface in console.error (not silently swallowed).
- No regression on echo/createNote/applyMigrations tool behavior.

## Output

Create `.planning/phases/01-foundation/01-R-SUMMARY.md` when done.
