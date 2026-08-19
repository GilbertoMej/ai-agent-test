---
phase: 1
plan: E
subsystem: audit
tags: [deps, mastra-1.60, hitl, audit-log, e2e]
dependency-graph:
  requires: ["01-A", "01-B", "01-C", "01-D"]
  provides: ["audit_log write path", "HITL resolver invocation", "sessionId anchor", "token counter patch"]
  affects: ["worker/src/index.ts", "worker/src/lib/audit.ts", "worker/src/tools/echo.ts", "app/api/smoke/echo/route.ts"]
tech-stack:
  added: []
  patterns: ["registerApiRoute", "RequestContext.setRaw", "agent.stream({memory:{thread,resource}})", "withAudit(ctx)"]
key-files:
  created: []
  modified: ["package.json", "pnpm-lock.yaml", "worker/src/index.ts", "worker/src/lib/audit.ts", "worker/src/tools/echo.ts", "app/api/smoke/echo/route.ts"]
decisions:
  - "Used RequestContext.setRaw() (not typed set()) because Mastra 1.60 RequestContext requires untyped-keyed writes for runtime-only values like approvalMode/sessionId."
  - "Moved threadId/resourceId into agent.stream({memory:{thread,resource}}) per Mastra 1.60 signature; standalone threadId/resourceId options no longer exist."
  - "Dropped auditId from smoke endpoint response — smoke.sh line 54 only reads .text; auditId field was dead. sessionId returned instead so caller can query audit_log directly."
  - "Removed modelSettings:{maxTokens} from sdlcAgent config — AgentConfig does not accept it in 1.60; per-call maxTokens on agent.stream() covers the use case."
  - "Updated toolApprovalResolver signature to (ctx: ToolApprovalContext) => Promise<boolean> — Mastra 1.60 resolver type returns boolean, not 'always'; resolveApproval()'s 'always' string is mapped to true."
metrics:
  duration: "single session (continuation)"
  tasks: 3
  commits: 3
  files: 6
status: complete
actuals:
  tokens: 96000
  tasks: 3
  commits: 3
---

# Phase 1 Plan E: Phase 1 Gap Closure Summary

Closes the five gaps VERIFICATION.md surfaced for the Phase 1 walking skeleton: install blocker, HITL gate wiring, token patching, session_id anchor, and echo tool audit. All three tasks committed atomically with the plan-specified messages.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 01-E1 | Install pin (bump @mastra/mcp to 1.17.0) | b505ab8 | package.json, pnpm-lock.yaml |
| 01-E2 | Wire custom stream route (HITL + tokens + sessionId) | 06eeea6 | worker/src/index.ts, worker/src/lib/audit.ts, worker/src/agents/sdlc.ts |
| 01-E3 | Wrap echoTool with withAudit | 91bf4e4 | worker/src/tools/echo.ts, app/api/smoke/echo/route.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `modelSettings:{maxTokens}` from sdlcAgent config**
- **Found during:** E2 verification (`npx tsc --noEmit`)
- **Issue:** `modelSettings` does not exist on `AgentConfig` in Mastra 1.60; it only lives inside model-fallbacks entries. Pre-existing TS error hidden by the install blocker.
- **Fix:** Removed the line; per-call `agent.stream(messages, {maxTokens})` covers it when needed.
- **Files modified:** worker/src/agents/sdlc.ts
- **Commit:** 06eeea6

**2. [Rule 1 - Bug] Updated toolApprovalResolver signature**
- **Found during:** E2 verification
- **Issue:** Pre-existing resolver returned `boolean | "always"`; Mastra 1.60 `RequireToolApprovalFn` returns `boolean`.
- **Fix:** Resolver now `(ctx: ToolApprovalContext) => Promise<boolean>`; maps resolveApproval()'s `'always'` string to `true`.
- **Files modified:** worker/src/agents/sdlc.ts
- **Commit:** 06eeea6

**3. [Rule 3 - Blocking] Moved apiRoutes inside `server:` config**
- **Found during:** E2 verification
- **Issue:** `'apiRoutes' does not exist in type Config<...>` — Mastra 1.60 relocated `apiRoutes` under the `server` object.
- **Fix:** Moved the entire `apiRoutes: [...]` array inside `server: { port, host, apiRoutes: [...] }`.
- **Files modified:** worker/src/index.ts
- **Commit:** 06eeea6

### Plan-Adapted to Mastra 1.60 API Surface

**4. [Caveman] `RequestContext.setRaw()` instead of typed `set()`**
- **Why:** Mastra 1.60 RequestContext requires declaring typed keys for `.set()`; runtime-only keys like `approvalMode` and `sessionId` need `setRaw()` to bypass the schema. Same value lands in the resolver's `ctx.requestContext`.
- **Files modified:** worker/src/index.ts
- **Commit:** 06eeea6

**5. [Caveman] `memory: {thread, resource}` instead of top-level threadId/resourceId**
- **Why:** Mastra 1.60 moved threadId/resourceId into the `memory` option; standalone keys no longer exist on `agent.stream()`.
- **Files modified:** worker/src/index.ts
- **Commit:** 06eeea6

**6. [Caveman] Dropped `auditId` from /api/smoke/echo response**
- **Why:** scripts/smoke.sh line 54 reads only `.text` from the response. `auditId` was dead; replaced with `sessionId` so caller can query audit_log directly.
- **Files modified:** app/api/smoke/echo/route.ts
- **Commit:** 91bf4e4

**7. [Caveman] Used non-null assertion on `echoTool.execute!`**
- **Why:** Mastra 1.60's `createTool` return type marks `execute` as optional; the smoke endpoint is the only external caller and `execute` is statically present.
- **Files modified:** app/api/smoke/echo/route.ts
- **Commit:** 91bf4e4

### Out-of-Scope (Pre-existing TS errors, not fixed here)

`pnpm tsc --noEmit` reports 13 remaining errors in files NOT touched by 01-E:
- `app/components/ChatPanel.tsx` (7 errors) — `useChat` API surface mismatch (`input`, `handleInputChange`, `handleSubmit`, `isLoading`, `append`, `api`, `content`)
- `lib/insforge.ts` (2 errors) — `InsforgeClient` → `InsForgeClient` typo; `serviceKey` not on `InsForgeConfig`
- `worker/src/api-routes/pause.ts` (3 errors) — type instantiation depth, argument count, `.catch` on JSONRespondReturn
- `worker/src/api-routes/resume.ts` (2 errors) — same shape as pause.ts

These pre-existed before E1 cleared the install blocker and are out of scope per the SCOPE BOUNDARY rule (only auto-fix issues DIRECTLY caused by the current task's changes). They will be addressed in a follow-up plan (deferred-items.md in phase dir if/when created).

## Verification

**E1 verify (install pin):**
- `grep '"@mastra/mcp": "1.17.0"' package.json` exits 0
- `pnpm install` exits 0; lockfile regenerated
- Pre-existing tsc errors masked by install blocker now visible (documented above)

**E2 verify (custom stream route):**
- `grep -n 'registerApiRoute("/agents/sdlcAgent/stream"' worker/src/index.ts` → line 63
- `grep -n 'requireToolApproval: toolApprovalResolver' worker/src/index.ts` → line 82
- `grep -n 'patchTokens(' worker/src/index.ts` → lines 87 (comment), 109 (call)
- `grep -n 'sessionId?: string' worker/src/lib/audit.ts` → line 61
- `npx tsc --noEmit` clean on E2-touched files (sdlc.ts, index.ts, audit.ts); 13 pre-existing errors elsewhere

**E3 verify (echo tool audit):**
- `grep -n 'withAudit("echo"' worker/src/tools/echo.ts` → match
- `grep -c 'db.insert(auditLog)' app/api/smoke/echo/route.ts` → 0 (manual insert removed)
- Smoke endpoint returns `{ text, sessionId }` (auditId dropped per deviation 6)

**End-to-end smoke (not run in this session — requires live Postgres + worker + web stack):**
- `pnpm smoke` expected to pass; smoke.sh covers all five gap-closure must-haves at lines 54, 57, 62, 63, 68, 79.

## Self-Check: PASSED

- All 3 commits exist in git log (b505ab8, 06eeea6, 91bf4e4)
- All 6 files modified by 01-E exist on disk
- E2 structural grep markers all present
- E3 `withAudit("echo"` match present
- `audit_log` write path is single-source via `withAudit()` (no manual insert outside `withAudit`)
