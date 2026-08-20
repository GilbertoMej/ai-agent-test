---
phase: 1
plan: H
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-1]
depends_on: ["01-G"]
files_modified:
  - worker/src/lib/health.ts
  - app/api/health/route.ts
  - scripts/smoke.sh
  - scripts/test-restart.sh
autonomous: true
must_haves:
  - "`node --import tsx worker/src/index.ts` runs past `MastraServer.init()` and prints `worker: listening on :4111`"
  - "`netstat -ano | grep 4111` shows LISTENING"
  - "`curl -fsS -H \"Authorization: Bearer $WORKER_SHARED_SECRET\" http://localhost:4111/health` returns `{\"worker_up\":true,...}`"
  - "Browser `/api/health` (Next proxy) still returns `worker_up:true` — external URL unchanged"
  - "Hydration gate (01-F2) and IIFE wrap (01-G1) stay intact — no regression"
requirements:
  - UI-07
  - BCK-02
---

# 01-H — Phase 1 Gap Closure (rename worker health route from `/api/health` to `/health`)

Closes Blocker B of G-1-1 surfaced after 01-G1. With the top-level-await IIFE wrap in place, `MastraServer.init()` now reaches `validateCustomRoutePaths`, which rejects the worker `healthRoute` because its path `/api/health` starts with `/api/` — a prefix Mastra 1.60 reserves for built-in framework routes. The error throws from inside the IIFE, becomes an unhandled rejection (we used `void`), and the process exits silently — nothing binds :4111.

External `/api/health` URL stays as the Next.js proxy surface. Only the worker-internal route path changes. External callers (browser, smoke.sh via `WEB_URL/api/health`) are unaffected.

## Tasks

<task type="auto">
  <id>01-H1-rename-worker-health-route</id>
  <read_first>
    - worker/src/lib/health.ts (full file — needs path rename on line 8 + comment on line 4)
    - app/api/health/route.ts (full file — needs the worker URL fetch path on line 12)
    - scripts/smoke.sh (lines 33, 49-50 — direct-worker assertion + WEB_URL proxy assertion)
    - scripts/test-restart.sh (lines 13, 31 — same direct-worker assertions)
  </read_first>
  <action>
    Four coordinated surgical edits. Each is a single string change. No new files, no new dependencies.

    **Edit 1 — `worker/src/lib/health.ts`:**
    - Line 4 comment: change `// /api/health — UI-07 banner + smoke assertion.` to `// /health (internal worker path) — proxied through Next.js /api/health for UI-07 banner + smoke.`
    - Line 8: change `registerApiRoute("/api/health", {` to `registerApiRoute("/health", {`
    - Leave the route handler body, path, method, auth untouched. The route handler logic does not change; only the URL path it binds to.

    **Edit 2 — `app/api/health/route.ts`:**
    - Line 3 comment: change `// Proxy to worker /api/health with the shared secret. Returns the JSON body verbatim.` to `// Proxy to worker /health with the shared secret. Returns the JSON body verbatim.`
    - Line 12: change `const r = await fetch(\`${workerUrl}/api/health\`, {` to `const r = await fetch(\`${workerUrl}/health\`, {`
    - This is the Next-side proxy: the browser still hits `/api/health` on the Next server (line 1: `app/api/health/route.ts`), but the Next server now fetches the worker's `/health` route internally.

    **Edit 3 — `scripts/smoke.sh`:**
    - Line 33: change `WORKER_HEALTH="$(curl -fsS -H "Authorization: Bearer ${WORKER_SHARED_SECRET}" "${WORKER_URL}/api/health")"` to `WORKER_HEALTH="$(curl -fsS -H "Authorization: Bearer ${WORKER_SHARED_SECRET}" "${WORKER_URL}/health")"`
    - Lines 49-50 (`test "$(curl -fsS "${WEB_URL}/api/health" | jq -r .worker_up)" = "true"`) — UNCHANGED. The browser-facing URL stays `/api/health` (Next proxies it).

    **Edit 4 — `scripts/test-restart.sh`:**
    - Line 13: change `"${WORKER_URL}/api/health"` to `"${WORKER_URL}/health"`
    - Line 31: change `"${WORKER_URL}/api/health"` to `"${WORKER_URL}/health"`
    - Both are direct-worker assertions inside the restart-recovery test.

    Do NOT touch any other file. Do NOT change the worker's Hono wiring (01-G1 IIFE), do NOT change `app/api/health/route.ts`'s outer URL (`/api/health` is preserved as the Next proxy surface), do NOT touch any other worker route (`/pause`, `/resume`, `/suspended`, `/approval/*`, `/agents/sdlcAgent/stream` already use non-reserved paths).
  </action>
  <files>worker/src/lib/health.ts, app/api/health/route.ts, scripts/smoke.sh, scripts/test-restart.sh</files>
  <verify>
    <automated>grep -q 'registerApiRoute("/health"' worker/src/lib/health.ts && grep -q 'fetch(`${workerUrl}/health`' app/api/health/route.ts && ! grep -nE '/api/health' worker/src/lib/health.ts && ! grep -nE '\$\{workerUrl\}/api/health' app/api/health/route.ts && ! grep -nE '\$\{WORKER_URL\}/api/health' scripts/smoke.sh scripts/test-restart.sh && timeout 8 node --import tsx worker/src/index.ts 2>&1 | grep -qE 'worker: listening on :4111|reserved for built-in' | awk '{exit !($1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'registerApiRoute("/health"' worker/src/lib/health.ts` returns 1 match (path renamed)
    - `grep -E '/api/health' worker/src/lib/health.ts` returns 0 matches (no stale `/api/health` on worker side)
    - `grep 'fetch(`${workerUrl}/health`' app/api/health/route.ts` returns 1 match (Next proxy follows)
    - `grep -E '\$\{workerUrl\}/api/health' app/api/health/route.ts` returns 0 matches (Next proxy no longer hits reserved path)
    - `grep -E '\$\{WORKER_URL\}/api/health' scripts/smoke.sh scripts/test-restart.sh` returns 0 matches (smoke scripts no longer probe reserved path)
    - `grep -E '"\$\{WEB_URL\}/api/health"' scripts/smoke.sh` returns 1+ match (browser-facing URL preserved in smoke)
    - `timeout 8 node --import tsx worker/src/index.ts` exits with `worker: listening on :4111` printed (this requires `.env.local` to be populated; if DATABASE_URL is missing the worker exits with that error BEFORE the route-validation check — that is also acceptable, it proves the transform succeeded; only `reserved for built-in` is a fail)
    - `pnpm tsc --noEmit` does not introduce new errors (the 14 pre-existing remain; 0 new)
  </acceptance_criteria>
  <done>Worker route renamed to `/health`; Next proxy + smoke scripts + test-restart scripts follow; `MastraServer.init()` passes route validation; `serve({...})` binds :4111; `curl /health` returns worker_up:true; browser `/api/health` (Next proxy) still works.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-07 (worker health surface reachable), BCK-02 (bearer-authed health route reachable through Hono)</implements>
  <commit>fix(worker): rename healthRoute path /api/health → /health (Mastra 1.60 reserved prefix)</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Worker :4111 → External | unchanged from 01-F — Hono binds 0.0.0.0:4111, bearer auth via WORKER_SHARED_SECRET |
| Browser → Next → Worker | external URL `/api/health` preserved; Next proxies to worker `/health` internally. No external caller changes. |

## Verification

End-to-end after the fix:

1. **Worker standalone boot**: `timeout 8 node --import tsx worker/src/index.ts` prints `worker: listening on :4111` and stays alive (or exits with DATABASE_URL missing — both prove the route-validation error is gone).
2. **Direct worker curl**: `curl -fsS -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:4111/health` returns `{"worker_up":true,...}`.
3. **Browser proxy curl**: `curl http://localhost:3000/api/health` returns `{"worker_up":true,...}` (Next proxies the new worker path internally).
4. **Smoke**: `pnpm smoke` exits 0; assertions #5 (worker_up direct), #9 (worker_up via proxy), #22 (`sdlc.playground.session.v1` marker) all pass.

## Caveats for executor

- The `worker/src/lib/health.ts` route handler body, method, auth — all unchanged. Only the URL path string changes.
- The Next proxy at `app/api/health/route.ts` keeps its OUTER URL `/api/health` (browser-facing). The INNER fetch URL changes to `/health`.
- The smoke.sh and test-restart.sh `WEB_URL/api/health` assertions (browser-side proxy) stay; only the direct-worker `WORKER_URL/api/health` assertions change to `/health`.
- If the worker boots in this environment and `DATABASE_URL` is missing, you'll see `DATABASE_URL is required for PostgresStore` BEFORE the route validation check — that's fine, it proves the transform + module-load succeeded.
- No new dependencies, no lockfile change.

## Success criteria

- Worker process boots and binds :4111; `curl :4111/health` returns `worker_up:true`.
- `pnpm dev` boots cleanly; banner flips green within 1s; `curl :3000/api/health` returns `worker_up:true`.
- React hydration mismatch stays fixed (01-F2 untouched).
- IIFE wrap stays in place (01-G1 untouched).
- `pnpm tsc --noEmit` does not introduce new errors.
- `grep` confirms all four rename markers and the absence of `/api/health` on the worker side.

## Output

Create `.planning/phases/01-foundation/01-H-SUMMARY.md` when done.
