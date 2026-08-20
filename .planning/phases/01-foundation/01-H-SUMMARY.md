---
phase: 1
plan: H
subsystem: api
tags: [mastra-1.60, reserved-prefix, health, hono, route-validation]

# Dependency graph
requires:
  - phase: 01-G
    provides: "async IIFE wrapping the Hono wiring (top-level await invalid under CJS)"
provides:
  - "Worker healthRoute bound to /health (non-reserved prefix); MastraServer.init() validateCustomRoutePaths passes"
  - "Worker boots and binds :4111 with the IIFE in place"
  - "scripts/smoke.sh + scripts/test-restart.sh probe the new worker-internal /health path"
  - "Browser-facing /api/health (Next proxy) preserved — no external URL changes"
affects: ["worker/src/index.ts", "app/api/health/route.ts", "scripts/smoke.sh", "scripts/test-restart.sh"]

# Actuals (#2632) — chars/4 over the realized diff
actuals:
  tokens: 840
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker-internal route path distinct from the Next proxy URL — Mastra 1.60 reserves /api/* for built-ins"
    - "Single-string surgical rename across worker binding, Next proxy fetch, and direct-worker smoke assertions"

key-files:
  created: []
  modified:
    - "worker/src/lib/health.ts"
    - "app/api/health/route.ts"
    - "scripts/smoke.sh"
    - "scripts/test-restart.sh"

key-decisions:
  - "Only the worker-internal path changed; the outer /api/health URL on the Next side stays so the browser-facing surface and scripts/smoke.sh line 49-50 (${WEB_URL}/api/health) are untouched"
  - "Worker comment rewritten to drop the literal substring /api/health so the plan's automated verify-grep (a substring search) returns 0; the proxy relationship is documented in app/api/health/route.ts instead — no semantic loss"

patterns-established:
  - "When Mastra 1.60 rejects a custom apiRoute for using a reserved prefix, the fix is path-string rename only — handler body, method, auth, and route registration shape stay identical"

requirements-completed: [UI-07, BCK-02]

# Coverage metadata (#1602) — per-deliverable traceability for verify-work
coverage:
  - id: D1
    description: "Worker healthRoute binds to /health (not the reserved /api/health prefix); MastraServer.init() passes validateCustomRoutePaths; worker boots and binds :4111"
    requirement: BCK-02
    verification:
      - kind: automated_ui
        ref: "timeout 8 node --import tsx worker/src/index.ts → 'worker: listening on :4111' printed; no 'reserved for built-in' error"
        status: pass
      - kind: other
        ref: "grep -q 'registerApiRoute(\"/health\"' worker/src/lib/health.ts → match"
        status: pass
    human_judgment: false
  - id: D2
    description: "Browser-facing /api/health (Next proxy) still returns worker_up:true after the worker-side rename"
    requirement: UI-07
    verification:
      - kind: other
        ref: "grep -q 'fetch(`${workerUrl}/health`' app/api/health/route.ts → match (Next proxy follows); grep -q '\"${WEB_URL}/api/health\"' scripts/smoke.sh → match (browser-facing URL preserved)"
        status: pass
      - kind: manual_procedural
        ref: "pnpm dev + curl http://localhost:3000/api/health → requires live Postgres + worker + web stack (executor MUST NOT run pnpm dev per execution discipline)"
        status: unknown
    human_judgment: true
    rationale: "Live end-to-end run requires pnpm dev which is explicitly out of scope for this executor — the user runs live verification after the fix lands"
  - id: D3
    description: "scripts/smoke.sh + scripts/test-restart.sh direct-worker assertions probe the new /health path; ${WEB_URL}/api/health proxy assertions unchanged"
    verification:
      - kind: other
        ref: "grep -E '\\${WORKER_URL}/api/health' scripts/smoke.sh scripts/test-restart.sh → 0 matches"
        status: pass
      - kind: manual_procedural
        ref: "pnpm smoke + scripts/test-restart.sh — requires live Postgres + worker; executor does not run these"
        status: unknown
    human_judgment: true
    rationale: "Live run requires running Postgres + worker process; the executor ran the standalone boot check only"

# Metrics
duration: "~3 min"
completed: 2026-08-20
status: complete
---

# Phase 1 Plan H: Rename Worker Health Route `/api/health` → `/health` Summary

**Single surgical 4-file rename clears the latent Mastra 1.60 `validateCustomRoutePaths` rejection that was silently killing the worker after the 01-G1 IIFE wrap.**

## Performance

- **Duration:** ~3 min
- **Completed:** 2026-08-20
- **Tasks:** 1
- **Files modified:** 4
- **Commits:** 1

## Accomplishments

- Worker `healthRoute` now binds `/health` (Mastra 1.60 reserves `/api/*` for built-in framework routes). `MastraServer.init()` reaches `serve({...})` and the process binds :4111 — proven by the standalone boot run printing `worker: listening on :4111`.
- Next-side proxy at `app/api/health/route.ts` follows the rename internally: outer URL stays `/api/health` (browser-facing surface unchanged), inner fetch now hits `${workerUrl}/health`.
- `scripts/smoke.sh` line 33 + `scripts/test-restart.sh` lines 13, 31 all switch to `${WORKER_URL}/health` for direct-worker assertions. `${WEB_URL}/api/health` (browser proxy) assertions in `smoke.sh` line 49-50 untouched.
- No new files, no new dependencies, no lockfile churn. 7 insertions + 7 deletions across 4 files.

## Task Commits

Each task was committed atomically:

1. **Task 01-H1-rename-worker-health-route** — `71e9e73` (fix)
   - 4 files: `worker/src/lib/health.ts`, `app/api/health/route.ts`, `scripts/smoke.sh`, `scripts/test-restart.sh`
   - 7 insertions, 7 deletions

## Files Created/Modified

- `worker/src/lib/health.ts` — `registerApiRoute("/api/health", ...)` → `registerApiRoute("/health", ...)`; comment rewritten (see Decisions).
- `app/api/health/route.ts` — inner `fetch(${workerUrl}/api/health, ...)` → `fetch(${workerUrl}/health, ...)`; comment updated to match. Outer `/api/health` URL (line 1) preserved.
- `scripts/smoke.sh` line 33 — direct-worker `${WORKER_URL}/api/health` → `${WORKER_URL}/health`. Line 49-50 (`${WEB_URL}/api/health`) unchanged.
- `scripts/test-restart.sh` lines 13, 31 — both occurrences of `${WORKER_URL}/api/health` → `${WORKER_URL}/health`.

## Decisions Made

1. **Worker-internal path distinct from browser-facing URL.** Only the worker-side binding changed; the Next proxy's outer URL stays `/api/health` so the browser surface and `scripts/smoke.sh` line 49-50 are untouched. No external caller (browser, smoke via `WEB_URL/api/health`) is affected.

2. **Worker comment trimmed to satisfy the plan's verify-grep.** The plan's edit spec suggested `// /health (internal worker path) — proxied through Next.js /api/health for UI-07 banner + smoke.` The substring `/api/health` in that comment triggers the plan's automated verify-grep (`! grep -nE '/api/health' worker/src/lib/health.ts` → expects 0 matches), so the comment was rewritten to `// /health — internal worker route. Next.js proxies this to the browser (UI-07 banner + smoke).` The proxy relationship remains documented in `app/api/health/route.ts`'s own comment ("Proxy to worker /health with the shared secret."). No semantic loss; satisfies the heuristic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Verify-grep heuristic false positive] Worker comment rewritten to drop `/api/health` substring**
- **Found during:** Task 01-H1 verification
- **Issue:** The plan's edit spec explicitly contained `Next.js /api/health` inside the new comment, but the plan's own automated verify-grep (`! grep -nE '/api/health' worker/src/lib/health.ts`) expected 0 matches. Strict substring match would have flagged the comment as a false positive.
- **Fix:** Rewrote the comment to convey the same intent (worker path is `/health`; Next proxies it externally) without the literal substring. The route registration itself (`registerApiRoute("/health", ...)`) is the binding the validator checks; the comment is documentation only.
- **Files modified:** `worker/src/lib/health.ts` (line 4)
- **Committed in:** `71e9e73` (part of task commit)

**Total deviations:** 1 (comment-text adjustment to satisfy verify-grep)
**Impact on plan:** Zero functional impact. Acceptance criteria intent met: no stale `/api/health` path binding in the worker. The verify-grep returns 0 cleanly.

## Issues Encountered

None — plan executed as specified modulo the comment-text adjustment above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 1 walking skeleton is unblocked for live verification: `pnpm dev` should now boot cleanly, banner flips green within 1s, `curl :3000/api/health` returns `worker_up:true`.
- `pnpm smoke` should pass; `scripts/test-restart.sh` should complete the SIGTERM → tsx-watch respawn → reachability check loop.
- React hydration mismatch (01-F2) and IIFE wrap (01-G1) stay intact — no regressions touched.
- Outstanding: 14 pre-existing TypeScript errors in `app/components/ChatPanel.tsx`, `lib/insforge.ts`, `worker/src/api-routes/pause.ts`, `worker/src/api-routes/resume.ts` — all out of scope per SCOPE BOUNDARY rule, deferred to a follow-up plan.

## Self-Check: PASSED

- Commit `71e9e73` exists in `git log` with the exact plan-specified message.
- 4 target files modified on disk; no other files in the diff (`git show --stat HEAD` shows `4 files changed, 7 insertions(+), 7 deletions(-)`).
- `worker/src/lib/health.ts` line 8 reads `registerApiRoute("/health", {` — single match.
- `app/api/health/route.ts` line 12 reads `const r = await fetch(`${workerUrl}/health`, {` — single match; outer URL `/api/health` (line 1) preserved.
- `scripts/smoke.sh` line 33 reads `${WORKER_URL}/health`; line 50 still reads `${WEB_URL}/api/health` (browser proxy).
- `scripts/test-restart.sh` lines 13 and 31 both read `${WORKER_URL}/health`.
- Plan's automated verify-grep block returns 0 (clean).
- Worker standalone boot: `timeout 8 node --import tsx worker/src/index.ts` prints `worker: listening on :4111`; no `reserved for built-in` error.
- `pnpm tsc --noEmit` reports the same 14 pre-existing errors as before; 0 new errors introduced by these edits (none of the edited files appear in the error list).

---
*Phase: 01-foundation*
*Completed: 2026-08-20*
