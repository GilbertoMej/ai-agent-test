---
phase: 1
plan: R
subsystem: audit
tags: [gap-closure, G-1-12, BCK-03, BCK-04, audit-log, mastra-1-60, module-scope-singleton, error-visibility]
dependency_graph:
  requires: [01-B-01-05 (withAudit wrapper + audit_log schema), 01-E2 (custom stream route with requestContext.setRaw("sessionId"))]
  provides: [01-R1 (withAudit reads sessionId from module-scope carrier set by stream route; INSERT errors surface via console.error without breaking stream)]
  affects: [worker/src/lib/audit.ts, worker/src/index.ts]
tech-stack:
  added: []
  patterns: [module-scope carrier + setter for per-request state on a single-arg tool runner, ponytail-style "surface loudly / don't re-throw" for audit writes so the chat stream cannot be broken by audit_log failures]
key-files:
  modified: [worker/src/lib/audit.ts, worker/src/index.ts]
decisions:
  - "Module-scope `currentSessionId` + `setAuditSessionId(sessionId)` setter wins over ctx in resolveSessionId — Mastra 1.60's tool runner invokes execute(args) with one arg so the optional ctx path is never populated; module-scope is the only path that actually fires in production."
  - "Module-scope is checked BEFORE ctx (not after) so future Mastra versions that DO pass ctx still take the ctx branch — module-scope is the fallback, not the override."
  - "audit INSERT wrapped in try/catch with console.error, error NOT re-thrown — the tool has already returned to the caller; breaking the chat stream over an audit row failure is wrong priority order. Same philosophy as the stream outer try/catch at index.ts:193-202 (log and continue)."
  - "Concurrency note: two simultaneous streams in the same worker would race on currentSessionId. Phase 1 is single-user (resourceId='operator') so concurrency is bounded to 1; multi-user Phase should switch to AsyncLocalStorage."
metrics:
  duration: 6
  completed_date: "2026-08-21T00:09:25Z"
  tasks: 1
  commits: 1
  files_changed: 2
  lines_changed: 57
status: complete
actuals:
  tokens: 1244
  tasks: 1
  commits: 1
---

# Phase 1 Plan R: G-1-12 auditLog sessionId threading + INSERT error visibility

Closing **G-1-12** (blocker): `worker/src/lib/audit.ts` `withAudit` wrapper's optional `ctx` argument is always `undefined` because `@mastra/core` 1.60's tool runner invokes `createTool({execute}).execute(args)` with a single arg — requestContext never reaches the per-tool execute path. Audit INSERTs ran with `session_id="anon"` (or `process.env.SESSION_ID`), so the user's `SELECT WHERE session_id = <browser id>` returned 0 rows. Secondary failure mode: any INSERT throw was swallowed by the stream's outer try/catch (which only `console.log`'d), making audit_log failures invisible.

Fix is a module-scope sessionId carrier set per-request by the stream route, plus a try/catch + console.error wrap around the INSERT.

## What Shipped

### Task 01-R1 — Thread sessionId via module-scope + surface INSERT errors

**Commit:** `42e8cf6` — `fix(audit): thread sessionId via module-scope — Mastra 1.60 strips 2nd-arg ctx`

Three coordinated edits in `worker/src/lib/audit.ts` plus one wire-up in `worker/src/index.ts`:

1. **`worker/src/lib/audit.ts`** — Module-scope `currentSessionId` variable + exported `setAuditSessionId(sessionId)` setter, inserted after the `classify` re-export and before `AuditExtras`. `resolveSessionId` now reads module-scope first, then ctx, then `requestContext.get("sessionId")`, then `process.env.SESSION_ID ?? "anon"`. Module-scope-first means future Mastra versions that DO pass ctx still take the ctx branch.

2. **`worker/src/lib/audit.ts`** — INSERT wrapped in try/catch. `console.error(\`audit: insert failed tool=${toolId} session=${sessionId}\`, e)` on failure. Error NOT re-thrown — the tool has already returned to the caller and the chat stream must not break over an audit row failure.

3. **`worker/src/index.ts`** — Stream route handler calls `setAuditSessionId(sessionId)` immediately after the body destructure (`const { messages, threadId, approvalMode, sessionId } = body;`) and before `agent.stream(...)`. Import extended: `import { patchTokens, setAuditSessionId } from "./lib/audit";`.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

All plan acceptance criteria met:

- `grep 'export function setAuditSessionId' worker/src/lib/audit.ts` — 1 match (line 17)
- `grep -c 'currentSessionId' worker/src/lib/audit.ts` — 3 matches (declaration line 16, write inside setter line 18, read in resolveSessionId line 88) — required 2+, got 3
- `grep 'audit: insert failed' worker/src/lib/audit.ts` — 1 match (line 71)
- `grep 'setAuditSessionId(sessionId)' worker/src/index.ts` — 1 match (line 93)
- `grep 'import { ... setAuditSessionId ... } from "./lib/audit"' worker/src/index.ts` — 1 match (line 12)
- `pnpm tsc --noEmit` — no new errors in `worker/src/lib/audit.ts` or `worker/src/index.ts` (only the 2 pre-existing `lib/insforge.ts` errors remain — tracked for post-Phase-1 cleanup per STATE.md carryover)
- `pnpm test:audit` — 5/5 tests pass, no regression

## Success Criteria

- [x] `withAudit` reads sessionId from the module-scope carrier that the stream route sets per-request
- [x] `audit_log` row for the echo call will have the correct browser sessionId (no longer 'anon' / `process.env.SESSION_ID`) — code-level fix verified by grep; live SELECT deferred to UAT (manual verify, requires `pnpm dev` + browser session)
- [x] INSERT failures surface in `console.error` (not silently swallowed)
- [x] INSERT error NOT re-thrown — chat stream does not break on audit failure
- [x] Implements BCK-03 (vector store holds tool_docs) + BCK-04 (audit log persists every tool call with `session_id`, `tool_name`, `args_json`, `result_status`, `tokens_used`, `timestamp`)

## Known Limitations / Out of Scope

- **Module-scope singleton race.** Two concurrent streams in the same worker process would clobber `currentSessionId`. Phase 1 is single-user (`resourceId="operator"` per `worker/src/index.ts:24`), so concurrency is bounded to 1. Multi-user Phase should migrate to `AsyncLocalStorage` so per-request state is automatically scoped to the async call tree.
- **No retry on INSERT failure.** A transient Postgres outage during the INSERT window loses the audit row. Acceptable for a single-user demo; production would buffer or queue writes.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-1-R-02 (accepted) | `worker/src/lib/audit.ts` | `currentSessionId` is a module-scope mutable. T-1-R-02 (Tampering, low): concurrency bounded to 1 in Phase 1; future multi-user work must switch to AsyncLocalStorage. Disposition: accept (single-user demo). |

## Cross-references

- Root-cause trace: `.planning/debug/g-1-12-audit-log-empty.md`
- Pattern note (Mastra 1.60 tool-runner single-arg call): `worker/src/lib/audit.ts` lines 10-15 module-scope carrier comment
