---
status: investigating
trigger: "Gap G-1-1: /api/health returns worker_up:false; localhost:4111 unreachable; Next.js UI loads on :3000 but banner shows 'worker offline'"
created: 2026-08-19
updated: 2026-08-20
---

## Current Focus

hypothesis: Worker constructs `new Mastra({...})` but never starts an HTTP server. The `server: { port, host, apiRoutes }` block is stored as config, but in Mastra 1.60 the constructor does NOT auto-listen — you must explicitly call `MastraServer.init()` + `serve()` from `@mastra/hono`, which is not installed.
test: (1) Grep `worker/src/index.ts` for any listen/serve call. (2) Confirm `@mastra/hono` is not in package.json/node_modules. (3) Run `npx tsx worker/src/index.ts` directly and observe (a) does the process stay alive, (b) does anything bind to :4111. (4) `netstat -ano | grep 4111`.
expecting: No server bound to :4111; tsx stays alive in idle wait; no `worker: listening` log because the auto-listener never runs.
next_action: Update Resolution and return structured ROOT CAUSE FOUND.

## Symptoms

expected: `pnpm dev` boots Next.js + worker; `/api/health` returns `worker_up:true`; banner green within 1s; localhost:4111 reachable.
actual: Next.js loads :3000 fine; `/api/health` returns `{worker_up:false, error:"fetch failed"}`; `localhost:4111` is "site can't be reached"; banner shows red "worker offline".
errors: `fetch failed` on Next side (TCP connection refused); no worker stderr captured by user.
reproduction: `pnpm dev` — concurrently starts `next dev -p 3000` and `tsx watch worker/src/index.ts`. Worker process either dies or hangs idle; :4111 never bound.
started: 2026-08-19 first UAT of Phase 1.

## Eliminated

- hypothesis: Worker crashed because of missing env var
  evidence: `.env.local` contains all required vars (DATABASE_URL, WORKER_SHARED_SECRET, OPENROUTER_API_KEY, INSFORGE_BASE_URL, INSFORGE_SERVICE_KEY, WORKER_PORT) with non-empty values. Worker actually starts and prints `embed-bootstrap: refreshing (n=0, stale=true)` — meaning dotenv loaded, DB connection works, and execution reached line 27+ of `worker/src/index.ts`.
  timestamp: 2026-08-20
- hypothesis: `concurrently` failed to spawn the worker
  evidence: When invoked directly with `npx tsx worker/src/index.ts`, the process runs and prints `embed-bootstrap: refreshing` but does NOT bind :4111. The problem is intrinsic to the worker entry script, not to the dev launcher.
  timestamp: 2026-08-20
- hypothesis: Worker listens on a different port than 4111
  evidence: `WORKER_PORT=4111` in `.env.local` (length=4, not empty). Code at `worker/src/index.ts:22` reads `Number(process.env.WORKER_PORT ?? 4111)`. Netstat confirms nothing bound to 4111 (or any other port for that matter).
  timestamp: 2026-08-20
- hypothesis: `tsx watch` blocked by TS errors
  evidence: `tsc --noEmit` reports errors in `app/components/ChatPanel.tsx`, `lib/insforge.ts`, `worker/src/api-routes/pause.ts`, `worker/src/api-routes/resume.ts` — but `worker/src/index.ts` itself has NO TS errors. tsx transpiles, not type-checks, so these are non-blocking. Direct `npx tsx worker/src/index.ts` runs the module fully.
  timestamp: 2026-08-20
- hypothesis: `WORKER_URL` mismatch on Next side
  evidence: `app/api/health/route.ts:8` defaults to `http://localhost:4111`. `.env.local` has `WORKER_URL=http://localhost:4111` (length=21). The Next side dials the right port — the issue is no server exists at that port.
  timestamp: 2026-08-20

## Evidence

- timestamp: 2026-08-20
  checked: `worker/src/index.ts`
  found: Lines 28–144 construct `new Mastra({ agents, storage: new PostgresStore(...), server: { port, host: "0.0.0.0", apiRoutes: [...] } })`. The constructor only stores the server config in `this.#server` (verified in `@mastra/core` `mastra-S88Af5nD.js:1043–1046`). No code in the file calls `app.listen`, `serve(...)`, `MastraServer.init()`, or any equivalent.
  implication: The `server: { port: 4111, ... }` block is dead config until something wires up a Hono adapter. Nothing does.

- timestamp: 2026-08-20
  checked: Mastra 1.60 documentation bundled at `node_modules/.pnpm/@mastra+core@1.60.0_.../node_modules/@mastra/core/dist/docs/references/integrations-frameworks-hono.md` and `reference-server-mastra-server.md`
  found: Server requires `@mastra/hono` (`MastraServer` adapter) + `@hono/node-server` (`serve({ fetch, port })`). Example: `const server = new MastraServer({ app, mastra }); await server.init(); serve({ fetch: app.fetch, port: 4111 }, ...)`. Without `await server.init()`, none of the apiRoutes are bound. Without `serve(...)`, nothing listens.
  implication: The current worker does none of these steps.

- timestamp: 2026-08-20
  checked: `node_modules/.pnpm` for `@mastra/hono`, `@mastra/server`, `@mastra/server-adapter`
  found: Neither `@mastra/hono` nor any other Mastra server-adapter package is present. Only bare `@hono/node-server` and `hono` exist (transitive deps, not in package.json). `package.json` has no `mastra/hono` dependency.
  implication: The required adapter is not even installed; even if the worker code imported it, `pnpm install` would not resolve.

- timestamp: 2026-08-20
  checked: Live run — `npx tsx worker/src/index.ts` for ~10 s in background
  found: tsx parent (PID via `npx`) + child (PID via `tsx/dist/cli.mjs`) are alive. Worker log shows only the pg SSL warning and `embed-bootstrap: refreshing (n=0, stale=true)`. After the fire-and-forget embed-bootstrap spawn, the Node event loop goes empty and the process idles. `netstat -ano | grep 4111` returns empty. The expected `worker: listening on :4111` console.log at `worker/src/index.ts:155` is also never printed (the `import.meta.url === file://${process.argv[1]}` guard is broken under tsx — `process.argv[1]` is a relative path, `import.meta.url` is absolute).
  implication: Worker stays alive but performs no listening. fetch() from Next.js to `localhost:4111/api/health` returns ECONNREFUSED, surfacing as `error: "fetch failed"` in `app/api/health/route.ts:20`.

- timestamp: 2026-08-20
  checked: `app/api/health/route.ts`
  found: Line 8 reads `process.env.WORKER_URL ?? "http://localhost:4111"`. Line 12 does `fetch(\`${workerUrl}/api/health\`)`. On connect refusal, line 20 returns `{ worker_up: false, error: (e as Error).message }` with status 503 — exactly what the UAT observed.
  implication: Next side is correctly translating ECONNREFUSED into the banner-friendly payload; the failure origin is upstream (no worker server).

## Resolution

root_cause: `worker/src/index.ts` configures `server: { port, host, apiRoutes }` on the `Mastra` constructor but never starts an HTTP server. In Mastra 1.60, that config is metadata only; you must explicitly instantiate a `MastraServer` (from `@mastra/hono`), call `await server.init()` to register routes, and call `serve({ fetch, port }, ...)` from `@hono/node-server`. The required adapter package (`@mastra/hono`) is not in `package.json` and not installed, and no server-start code exists in the worker. The worker process loads modules, fires `embed-bootstrap`, then idles forever — `localhost:4111` is never bound, so `fetch()` from `app/api/health/route.ts` gets ECONNREFUSED and returns `{worker_up:false, error:"fetch failed"}`.
fix: (NOT TO BE APPLIED — return_diagnosis only) Install `@mastra/hono` (which pulls `@hono/node-server`), then in `worker/src/index.ts` after constructing `mastra`, import `Hono` from `hono` + `MastraServer` from `@mastra/hono` + `serve` from `@hono/node-server`, do `const app = new Hono(); const server = new MastraServer({ app, mastra }); await server.init(); serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, ...)`. Also fix the `import.meta.url` guard at line 154 (broken under tsx) so the listen log actually prints.
verification: After fix, `netstat -ano | grep 4111` should show LISTENING; `curl http://localhost:4111/api/health` should return `{"worker_up":true,...}`; `/api/health` proxy returns `worker_up:true` and the banner flips green.
files_changed: []
