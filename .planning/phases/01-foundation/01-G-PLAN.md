---
phase: 1
plan: G
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-1]
depends_on: ["01-F"]
files_modified:
  - worker/src/index.ts
autonomous: true
must_haves:
  - "Worker process boots under tsx and binds :4111 (netstat shows LISTENING)"
  - "`node --import tsx worker/src/index.ts` runs past line 160 without esbuild 'Top-level await' error"
  - "`curl -fsS -H \"Authorization: Bearer $WORKER_SHARED_SECRET\" http://localhost:4111/api/health` returns `{\"worker_up\":true,...}`"
  - "Browser banner flips green on `pnpm dev`"
  - "Hydration gate from 01-F2 stays fixed (no regression)"
requirements:
  - UI-07
  - BCK-02
---

# 01-G — Phase 1 Gap Closure (worker top-level await → async IIFE)

Closes the remaining blocker G-1-1 after 01-F1 landed: `worker/src/index.ts:160` uses top-level `await server.init()`, but tsx loads the file as CommonJS (package.json has no `"type": "module"`) and CJS does not support top-level await. esbuild throws `Transform failed: Top-level await is currently not supported with the "cjs" output format` at module-load time, the worker process crashes before `serve(...)` runs, and nothing binds :4111.

Surgical fix: wrap the wiring in an async IIFE so the `await` lives inside an async function. No other changes.

## Tasks

<task type="auto">
  <id>01-G1-wrap-wiring-in-iife</id>
  <read_first>
    - worker/src/index.ts (lines 152-163 — the broken module-top-level wiring)
    - package.json (confirm no `"type": "module"` — that is the load-format constraint)
    - tsconfig.json (`module: esnext` is misleading here; tsx follows package.json resolution at runtime)
  </read_first>
  <action>
    One surgical edit to `worker/src/index.ts` lines 152-163.

    Wrap the existing three lines (155-161) in an immediately-invoked async function expression so the `await` lives inside an async function body, not at module top level. Exact replacement:

    **Before** (lines 155-161):
    ```ts
    // 01-F1 — Hono + MastraServer wires the apiRoutes registered above onto a real HTTP
    // listener. Mastra 1.60 stores server config on `this.#server` but does NOT auto-listen,
    // so without this block the worker process exits silently and :4111 is unbound.
    const app = new Hono();
    const server = new MastraServer({ app, mastra });
    await server.init();
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => console.log(`worker: listening on :${info.port}`));
    ```

    **After**:
    ```ts
    // 01-G1 — top-level await is invalid under CJS (tsc/tsx emit CJS because package.json
    // has no "type": "module"). Wrap the wiring in an async IIFE so the await lives inside
    // an async function. The IIFE returns void; we deliberately do not `await` it from the
    // module top-level (same constraint). The IIFE runs synchronously up to the first `await`,
    // then yields to the microtask queue and resolves. The rest of the module finishes loading
    // before `serve(...)` binds, which is the intended behavior.
    void (async () => {
      const app = new Hono();
      const server = new MastraServer({ app, mastra });
      await server.init();
      serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => console.log(`worker: listening on :${info.port}`));
    })();
    ```

    Notes:
    - The `void` prefix discards the IIFE's returned Promise; we don't want an unhandled rejection
      if `serve()` ever throws (it doesn't currently, but the `void` is a defense-in-depth signal).
    - Move the existing `export { sdlcAgent, toolApprovalResolver };` (line 163) to BEFORE the IIFE
      so the named exports are still hoisted at module top-level (esbuild + CJS sometimes trip on
      named exports placed after top-level statements that yield to the event loop). Place the
      `export` block immediately after `registerApprovalRoutes(mastra)` and before the IIFE block.

    Final shape of lines 149-163:
    ```ts
    // Register the approval handlers so the routes above can find them.
    registerApprovalRoutes(mastra);

    // Re-export for downstream tools (test scripts, etc.).
    export { sdlcAgent, toolApprovalResolver };

    // Boot-time embed refresh (D-20). Fire-and-forget; non-blocking.
    void maybeRefreshEmbeddings();

    // 01-G1 — see comment block in the IIFE below.
    void (async () => {
      // ...wiring...
    })();
    ```

    Do NOT touch:
    - `server: { port, host, apiRoutes }` block on `new Mastra(...)` (line 37-146) — MastraServer reads apiRoutes from there
    - Imports at lines 18-20 — already correct
    - The `port` constant at line 25 — unchanged
    - Any other file
  </action>
  <files>worker/src/index.ts</files>
  <verify>
    <automated>grep -nE 'void \(async \(\) =>|new MastraServer\(\{ app, mastra \}\)|await server\.init\(\)|serve\(\{ fetch: app\.fetch' worker/src/index.ts && ! grep -nE '^await server\.init\(\)|^const server = new MastraServer' worker/src/index.ts && timeout 8 node --import tsx worker/src/index.ts 2>&1 | grep -qE 'worker: listening on :4111|Top-level await' | awk '{exit !($1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'void (async () =>' worker/src/index.ts` returns 1+ match (IIFE wrapper present)
    - `grep 'await server.init()' worker/src/index.ts` returns 1+ match (await still present, now inside async fn)
    - `grep '^await server.init()' worker/src/index.ts` returns 0 matches (no top-level await)
    - `grep '^const server = new MastraServer' worker/src/index.ts` returns 0 matches (constructor call moved inside IIFE)
    - `grep 'serve({ fetch: app.fetch' worker/src/index.ts` returns 1+ match
    - `timeout 8 node --import tsx worker/src/index.ts` exits with `worker: listening on :4111` printed, no `Top-level await` error (this requires DATABASE_URL set in .env — use `.env.local` if not in .env)
    - `grep 'export { sdlcAgent, toolApprovalResolver' worker/src/index.ts` returns 1+ match (named exports still hoisted)
  </acceptance_criteria>
  <done>Worker process boots under tsx, bypasses the CJS top-level-await error, calls `MastraServer.init()` then `serve({...})` from inside an async IIFE, and binds TCP :4111. /api/health returns worker_up:true.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-07 (worker health surface reachable), BCK-02 (bearer-authed health route reachable through Hono)</implements>
  <commit>fix(worker): wrap Hono wiring in async IIFE — top-level await invalid under CJS</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Worker :4111 → External | unchanged from 01-F — Hono binds 0.0.0.0:4111, bearer auth via WORKER_SHARED_SECRET |
| IIFE error handling | If `MastraServer.init()` rejects, the IIFE returns a rejected Promise. The `void` prefix means it becomes an unhandled rejection → Node prints to stderr and exits with code 1. Acceptable: a failed bind should be loud. If silent-recovery is wanted later, add `.catch((e) => console.error('worker: bind failed', e))` — out of scope. |

## Verification

End-to-end after the fix:

1. **No top-level await**: `grep -nE '^await server\.init\(\)|^const server = new MastraServer' worker/src/index.ts` returns 0 matches.
2. **IIFE present**: `grep 'void (async () =>' worker/src/index.ts` returns 1+ match.
3. **Standalone boot**: with `.env.local` populated, `timeout 8 node --import tsx worker/src/index.ts` prints `worker: listening on :4111` and exits 0 (or hangs in the timeout — both prove bind).
4. **Live**: `pnpm dev` boots Next + worker; after ~3s, `curl -fsS -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:4111/api/health` returns `{"worker_up":true,...}`; `netstat -ano | grep 4111` shows LISTENING; Next proxy `/api/health` returns `worker_up:true`; banner flips green.
5. **No regression on hydration**: fresh-tab `/` still shows no React hydration mismatch (01-F2 still in place).

## Caveats for executor

- The `export { sdlcAgent, toolApprovalResolver }` line must move BEFORE the IIFE block. CJS named-export hoisting under esbuild is finicky around top-level async boundaries; placing exports inside or after an async IIFE can yield `ReferenceError: ... is not defined` when downstream tools (test scripts, agents) import the worker module.
- The IIFE is intentionally not awaited at module top level (same constraint we just fixed). The `void` operator marks the resulting Promise as intentionally-unawaited; Node will still warn on unhandled rejection if init() throws. Acceptable: a bind failure should be loud.
- If `serve()` is called but the port is already in use, `@hono/node-server` throws `EADDRINUSE`. Worker exits with that error in stderr — verify the port is free before running the standalone test.
- Do NOT add `"type": "module"` to package.json as part of this fix. That's a broader change (forces every other .ts file to ESM, breaks Drizzle's .ts config imports, etc.) and out of scope for the surgical gap closure. The async IIFE is the correct fix under the existing module format.

## Success criteria

- `node --import tsx worker/src/index.ts` prints `worker: listening on :4111` and stays alive.
- `pnpm dev` boots cleanly, banner flips green within 1s, `curl :4111/api/health` (with bearer) returns `worker_up:true`.
- React hydration mismatch stays fixed (01-F2 untouched).
- `pnpm tsc --noEmit` does not introduce new errors.
- `grep` confirms the IIFE pattern and the absence of top-level `await server.init()`.

## Output

Create `.planning/phases/01-foundation/01-G-SUMMARY.md` when done.
