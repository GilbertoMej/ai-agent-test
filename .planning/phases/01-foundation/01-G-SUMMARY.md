---
phase: 01-foundation
plan: G
subsystem: worker
tags: [mastra, hono, tsx, cjs, top-level-await, esbuild, iife, gap-closure]

# Dependency graph
requires:
  - phase: 01-F
    provides: "Wired Hono + MastraServer + serve() in worker/src/index.ts:155-161 (top-level await blocked CJS boot)"
provides:
  - "Worker module loads under CJS without esbuild 'Top-level await' transform error"
  - "Async IIFE wrapping for MastraServer.init() + serve() that survives esbuild's CJS output format"
  - "Hoisted `export { sdlcAgent, toolApprovalResolver }` before the IIFE so downstream imports don't ReferenceError"
affects: [01-foundation, any phase that runs the worker under tsx/CJS]

# Actuals (#2632)
actuals:
  tokens: 582           # chars/4 over the realized diff (2326 chars / 4)
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Async-IIFE wrap for async module-init code under CJS output: `void (async () => { ... })()`"
    - "Hoist named exports BEFORE any top-level async boundary to keep CJS export semantics stable"

key-files:
  modified:
    - worker/src/index.ts

key-decisions:
  - "Wrapped `await server.init()` and `serve(...)` in `void (async () => { ... })();` instead of changing package.json to ESM (would cascade to every other .ts file, break Drizzle .ts imports, etc.)"
  - "Moved `export { sdlcAgent, toolApprovalResolver }` to immediately after `registerApprovalRoutes(mastra)` and before the IIFE so CJS named-export hoisting under esbuild is not disrupted"

patterns-established:
  - "Async-IIFE wrap pattern: use `void` prefix on the IIFE to discard its Promise — defense-in-depth against silent bind failures"

requirements-completed: [UI-07, BCK-02]

coverage:
  - id: D1
    description: "Worker module loads under tsx/CJS without esbuild 'Top-level await' transform error"
    verification:
      - kind: automated
        ref: "grep -nE '^await server\\.init\\(\\)|^const server = new MastraServer' worker/src/index.ts (0 matches)"
        status: pass
      - kind: automated
        ref: "grep -nE 'void \\(async \\(\\) =>' worker/src/index.ts (1 match)"
        status: pass
      - kind: automated
        ref: "timeout 8 node --import tsx worker/src/index.ts 2>&1 | grep 'Top-level await' (0 matches)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Worker process boots and binds TCP :4111 (LISTENING)"
    requirement: UI-07
    verification:
      - kind: automated
        ref: "timeout 8 node --import tsx worker/src/index.ts (currently exits with Mastra route-validation error — see Deviations)"
        status: fail
    human_judgment: true
    rationale: "Live bind is blocked by a SECOND pre-existing latent bug exposed by this fix (see Deviations). Cannot auto-pass until that bug is resolved in a follow-up plan."
  - id: D3
    description: "`curl -fsS -H \"Authorization: Bearer $WORKER_SHARED_SECRET\" http://localhost:4111/api/health` returns worker_up:true"
    requirement: UI-07
    verification:
      - kind: automated
        ref: "Live curl (blocked — see D2)"
        status: fail
    human_judgment: true
    rationale: "Cannot exercise live until D2 passes."
  - id: D4
    description: "Browser banner flips green on `pnpm dev`"
    verification:
      - kind: automated
        ref: "Manual UAT (blocked — see D2)"
        status: fail
    human_judgment: true
    rationale: "Banner is downstream of /api/health, which is downstream of D2."
  - id: D5
    description: "Hydration gate from 01-F2 stays fixed (no regression)"
    verification:
      - kind: automated
        ref: "grep of worker/src/index.ts shows no React/Next.js surface touched; the only changes are lines 149-175 wiring"
        status: pass
    human_judgment: false
    rationale: "01-F2 fix is in app/ (not worker/), and the IIFE wrap does not change module top-level side effects (registerApprovalRoutes, maybeRefreshEmbeddings fire exactly as before — only the order of the named-export line moves earlier)."

# Metrics
duration: 5min
completed: 2026-08-20
status: halted
---

# Phase 01 Plan G: Worker Top-Level Await → Async IIFE Summary

**Async-IIFE wrap on Hono/MastraServer wiring — esbuild CJS top-level-await error eliminated, but live :4111 bind remains blocked by a separate latent Mastra 1.60 route-validation bug uncovered by this fix.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-08-20T00:00:00Z
- **Completed:** 2026-08-20T00:05:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Wrapped `new MastraServer` + `await server.init()` + `serve(...)` in `void (async () => { ... })();` so the `await` lives inside an async function body, not at CJS module top level.
- Hoisted `export { sdlcAgent, toolApprovalResolver };` to immediately after `registerApprovalRoutes(mastra)` so CJS named-export hoisting under esbuild is not disrupted by the async boundary.
- Confirmed via static checks + live boot: esbuild's "Top-level await is currently not supported with the 'cjs' output format" transform error is gone.
- Confirmed via `pnpm tsc --noEmit`: 14 pre-existing errors remain, 0 new errors introduced by this edit.

## Task Commits

1. **Task 1: 01-G1 — wrap wiring in async IIFE** - `062ed28` (fix)
   - Atomic commit: 1 file changed, 21 insertions(+), 9 deletions(-)

## Files Created/Modified

- `worker/src/index.ts` — moved named exports before the IIFE; wrapped the three wiring lines (`new Hono()`, `new MastraServer(...)`, `await server.init()`, `serve(...)`) inside `void (async () => { ... })();`. `void maybeRefreshEmbeddings();` and `registerApprovalRoutes(mastra)` keep their original positions.

## Decisions Made

- **IIFE wrap, not `"type": "module"`.** Adding ESM to package.json would cascade into every other `.ts` file in the project and break Drizzle's `.ts` config imports. The async IIFE is the minimal, scoped fix.
- **`void` prefix on the IIFE.** Discards the returned Promise as a defense-in-depth signal that bind failures should be loud (unhandled rejection → Node stderr + exit 1), not silent.
- **Named exports hoisted BEFORE the IIFE.** CJS named-export hoisting under esbuild can yield `ReferenceError: ... is not defined` when exports sit after a top-level async boundary. Placing them earlier preserves downstream imports in test scripts and the agents sub-module.

## Deviations from Plan

### Auto-fixed Issues

None.

### Latent Bug Exposed by This Fix (not auto-fixed — out of scope)

**1. [Rule 4 - Out of Scope] Mastra 1.60 rejects custom routes starting with `/api`**
- **Found during:** Task 1 verification (`timeout 8 node --import tsx worker/src/index.ts`)
- **Issue:** Pre-edit, the worker crashed with the esbuild top-level-await error before any of `MastraServer.init()` could run, so the route-validation bug was hidden. Post-edit, the esbuild transform succeeds, `DATABASE_URL` is satisfied, and execution reaches `MastraServer.init()`. There, `@mastra/server@1.60.0`'s `validateCustomRoutePaths` throws:
  ```
  Error: Custom API route "/api/health" must not start with "/api" — that path is reserved
  for built-in Mastra routes. Choose a different path (e.g. "/custom/health").
  ```
  The worker process exits with code 1, never reaching `serve(...)`, and nothing binds :4111.
- **Why not auto-fixed:** The plan's explicit "Do NOT touch" list includes the `server: { port, host, apiRoutes }` block on `new Mastra(...)`, and the offending path lives in `worker/src/lib/health.ts:8` (`registerApiRoute("/api/health", ...)`). Changing that path also forces updates to `app/api/health/route.ts:12` (`${workerUrl}/api/health`), `app/components/HealthBanner.tsx:43` (Next-side proxy `/api/health`), `scripts/smoke.sh:33`, `scripts/smoke-stopped-worker.sh:9`, and `scripts/test-restart.sh:13,31`. That's a cross-cutting routing refactor — too broad for a "single surgical fix" gap-closure plan.
- **Recommended follow-up (separate plan):** Add a Phase 01 plan that:
  1. Moves the worker route to `/custom/health` (or whatever prefix Mastra 1.60 permits).
  2. Updates `app/api/health/route.ts` and `app/components/HealthBanner.tsx` to call the new path through the same Next-side proxy (which can keep its `/api/health` surface for the browser).
  3. Re-runs this plan's automated verify (must print `worker: listening on :4111`).

**Total deviations:** 0 auto-fixed; 1 latent bug surfaced and deferred to a follow-up plan (per the plan's "do NOT touch" rule).

**Impact on plan:** The IIFE wrap itself is correct and verified at the static/transform layer. The must_have "Worker process boots and binds :4111" remains unmet only because of a second, pre-existing, out-of-scope bug. Plan status is `halted` (not `complete`) because the surgical fix alone cannot deliver the full gap-closure goal — the user's UAT will still see the worker offline until the route-validation bug is resolved.

## Issues Encountered

- Pre-edit boot reproduced the exact `Top-level await is currently not supported with the "cjs" output format` error from the diagnosis (confirmed via `git stash` round-trip). Post-edit boot reproduces the `Top-level await` error as gone, with a new `validateCustomRoutePaths` error taking its place — i.e. the IIFE fix demonstrably moves the failure one stage later.
- `pnpm tsc --noEmit` was run; the 14 pre-existing errors (all in `ChatPanel.tsx`, `insforge.ts`, `pause.ts`, `resume.ts`) are unchanged. Zero new errors in `worker/src/index.ts`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **The IIFE fix is shipped and the esbuild transform error is gone.** Anyone reading `worker/src/index.ts` and running `node --import tsx` will now progress past the module-load stage into `MastraServer.init()` — a strictly better failure mode than crashing at transform time.
- **Live `:4111` bind and `/api/health` 200 are still blocked** by the latent Mastra 1.60 route-validation bug documented above. Recommended action: create a follow-up Phase 01 plan (call it `01-G2` or `01-H`) that renames the worker route and updates the Next-side proxy + smoke scripts.
- **Static must_haves for D1, D5 PASS** (transform fix verified; no React-surface touched). **Live must_haves for D2, D3, D4 are blocked** pending the route-validation follow-up.
- After the route-validation fix lands, the existing automated verify block from this plan will pass without further edits.

---
*Phase: 01-foundation*
*Completed: 2026-08-20*
