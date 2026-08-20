---
phase: 1
plan: F
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-1, G-1-2]
depends_on: ["01-E"]
files_modified:
  - package.json
  - pnpm-lock.yaml
  - worker/src/index.ts
  - app/components/ChatPanel.tsx
autonomous: true
must_haves:
  - "Worker process binds TCP :4111 and curl http://localhost:4111/api/health returns {worker_up:true,...}"
  - "Browser console shows no React 19 hydration mismatch error on a fresh-tab load of /"
  - "Existing 13 pre-existing TS errors remain unchanged (no regression in scope)"
  - "scripts/smoke.sh assertions #5/#9 (worker_up) and #22 (localStorage session id marker) still pass grep checks"
  - "audit.test.ts + test-mcp-reconnect.ts still pass their structural assertions (no regression in worker tools)"
requirements:
  - UI-04
  - UI-07
  - BCK-02
---

# 01-F — Phase 1 Gap Closure (Worker listen + hydration mismatch)

Closes the two gaps UAT surfaced after plan E: (1) **G-1-1 blocker** — the Mastra worker configures `server:{port,host,apiRoutes}` on the constructor but Mastra 1.60 does not auto-listen; nothing binds :4111, so `/api/health` from the Next side gets ECONNREFUSED. Fix: install `@mastra/hono@1.7.0`, instantiate `MastraServer` over a `Hono()` app, `await server.init()`, and `serve({fetch, port, hostname:"0.0.0.0"}, info => log(...))` from the already-installed `@hono/node-server@2.1.1`. (2) **G-1-2 major** — `ChatPanel.tsx` `useState` initializer generates `Math.random().toString(36)` IDs in both the SSR branch and the client first-render branch, causing different `sess-X` IDs server-vs-client. Fix: initialize `sessionId` to a stable placeholder (`""`) and load-or-generate the real id inside `useEffect` post-mount.

Both fixes are surgical, independent, and atomic. One commit per gap.

## Tasks

<task type="auto">
  <id>01-F1-wire-worker-listen</id>
  <read_first>
    - worker/src/index.ts (full file — needs MastraServer wiring after `new Mastra(...)`)
    - package.json (dependencies block — needs `@mastra/hono` pin)
    - .planning/debug/worker-unreachable.md (root-cause evidence + the exact listen wiring pattern)
    - node_modules/.pnpm/@hono+node-server@2.1.1_hono@4.13.3/node_modules/@hono/node-server/dist/index.d.mts (confirms `serve(options, listener)` signature; `Options` has `fetch`, `port`, `hostname`)
  </read_first>
  <action>
    Two coordinated edits.

    **Edit 1 — `package.json`**: Add `"@mastra/hono": "1.7.0"` to the `dependencies` block (exact pin, no `^`/`~`, alongside `@mastra/core`). Version is the latest stable; peerDeps are `hono@^4.12.8` (already at 4.13.3) and `@mastra/core@>=1.50.0 <2.0.0` (we have 1.60.0). Then run `pnpm install` to regenerate the lockfile. Do NOT modify any other dep.

    **Edit 2 — `worker/src/index.ts`**: Three surgical changes inside the existing module.

    (a) Add three new imports at the top alongside the existing `@mastra/core` import:
    - `import { Hono } from "hono";`
    - `import { serve } from "@hono/node-server";`
    - `import { MastraServer } from "@mastra/hono";`

    (b) AFTER `const mastra = new Mastra({...})` at lines 28-144 and AFTER the existing `registerApprovalRoutes(mastra)` call at line 147 (i.e., between line 147 and the existing `void maybeRefreshEmbeddings()` at line 150), add the Hono + MastraServer wiring:
    - `const app = new Hono();`
    - `const server = new MastraServer({ app, mastra });`
    - `await server.init();`  // registers context middleware, auth middleware, and the apiRoutes
    - `serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => console.log(\`worker: listening on :\${info.port}\`));`

    Note: `MastraServer.init()` is async — it must be `await`-ed before `serve()` binds, otherwise the apiRoutes are not registered and `/api/health` returns 404. Do NOT use `void` here. The Hono app must be created AFTER `new Mastra(...)` because MastraServer reads the mastra instance to wire up the routes.

    (c) Replace the broken listen-log guard at line 154 (`if (import.meta.url === \`file://${process.argv[1]}\`) { console.log(...) }`). The guard never fires under tsx because `process.argv[1]` is a relative path (`worker/src/index.ts`) while `import.meta.url` is an absolute `file://` URL. Delete the guard entirely; the `serve(..., info => log(...))` callback above already prints the listen log unconditionally. Keep the existing `export { sdlcAgent, toolApprovalResolver }` at line 152 — move it to AFTER the wiring if needed (it currently sits at line 152, between `registerApprovalRoutes` and the listen guard; that ordering is fine).

    The wiring MUST stay at module top-level (not inside `if (import.meta.url === ...)`) because `import.meta.url` under tsx is unreliable and tsx-watch needs the `serve()` to be invoked at module load to keep the process alive. `serve()` is non-blocking (it returns a `ServerType`), so the rest of the module continues to execute.

    Do NOT touch `server: { port, host, apiRoutes }` on the `new Mastra(...)` constructor — it remains as MastraServer's metadata (the `apiRoutes` array gets registered by `MastraServer.init()`).
  </action>
  <files>package.json, pnpm-lock.yaml, worker/src/index.ts</files>
  <verify>
    <automated>grep -q '"@mastra/hono": "1.7.0"' package.json && grep -nE 'await server.init\(\)' worker/src/index.ts | grep -v '^#' | grep -c 'await server.init()' | awk '{exit !($1>=1)}' && grep -n 'import.*MastraServer.*@mastra/hono\|from "@mastra/hono"' worker/src/index.ts | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'serve\(\{\s*fetch:\s*app\.fetch' worker/src/index.ts | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'import\.meta\.url === `file:' worker/src/index.ts | grep -c . | awk '{exit !($1==0)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep '"@mastra/hono": "1.7.0"' package.json` returns 1 match
    - `pnpm install` exits 0 and prints "Done in" (lockfile regenerated)
    - `grep 'await server.init()' worker/src/index.ts` returns 1+ match (MastraServer.init called and awaited)
    - `grep 'from "@mastra/hono"' worker/src/index.ts` returns 1+ match (import wired)
    - `grep 'serve({ fetch: app.fetch' worker/src/index.ts` returns 1+ match (HTTP listener bound)
    - `grep 'import.meta.url === `file:' worker/src/index.ts` returns 0 matches (broken guard removed)
    - `node_modules/@mastra/hono` directory exists (verify with `ls node_modules/.pnpm | grep -c '@mastra+hono'` → >=1)
  </acceptance_criteria>
  <done>Worker process binds :4111; Hono + MastraServer.init() + serve() wired; broken import.meta.url guard removed; install succeeds with the new pin.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-07 (worker health surface reachable), BCK-02 (bearer-authed health route reachable through Hono)</implements>
  <commit>fix(worker): bind :4111 via @mastra/hono — MastraServer.init() + serve() after new Mastra()</commit>
</task>

<task type="auto">
  <id>01-F2-fix-hydration-session-id</id>
  <read_first>
    - app/components/ChatPanel.tsx (lines 64-71 — broken useState initializer; line 9 — existing loadSessionId/saveSessionId imports; line 82 — usePauseOnUnload(sessionId); line 136 — Session: {sessionId})
    - app/lib/pause-signal.ts (loadSessionId returns null on server + fresh client; saveSessionId writes to localStorage)
    - .planning/debug/hydration-session-id.md (root-cause trace)
  </read_first>
  <action>
    One surgical edit to `app/components/ChatPanel.tsx` at lines 64-71.

    **Replace the broken useState initializer** (currently branches on `typeof window` and calls `Math.random()` in both branches) with TWO pieces: a stable placeholder initializer that returns `""` (empty string), and a `useEffect` that runs once on mount to load-or-generate the real session id and call `setSessionId` to trigger a single post-mount re-render.

    Exact replacement at lines 64-71:
    - Replace `const [sessionId] = useState<string>(...)` with `const [sessionId, setSessionId] = useState<string>("")`
    - ADD a new `useEffect` near the other effects (after the existing `useEffect(() => { ... onError ... }, [])` block at lines 84-92). The new effect:
      - Runs once on mount (`useEffect(() => {...}, [])`)
      - Reads `const existing = loadSessionId();` from the existing `@/app/lib/pause-signal` import (already in scope)
      - If `existing` is non-null, `setSessionId(existing)`
      - Else: `const fresh = \`sess-${Math.random().toString(36).slice(2, 10)}\`; saveSessionId(fresh); setSessionId(fresh);`
      - Wrapped in a `typeof window !== "undefined"` guard so it does nothing during SSR (defense in depth — useEffect does not fire on the server, but the guard documents intent).

    Both server-render and client first-render now produce identical HTML for `<span>Session: {sessionId}</span>` (line 136) because `sessionId` is `""` in both. The post-mount effect triggers one re-render with the real id. No `Math.random()` runs during initial paint.

    Do NOT change:
    - The `loadSessionId` / `saveSessionId` helpers in `app/lib/pause-signal.ts` (they already handle SSR correctly)
    - `usePauseOnUnload(sessionId)` at line 82 — it now receives `""` during first paint but the `useEffect` inside that hook uses `sessionId` from its own closure; the `beforeunload` handler that calls `beaconPause(sessionId)` will fire `""` once during the brief window between mount and the post-mount effect. That's acceptable (the worker treats empty sessionId the same as `'anon'` via `sessionId ?? "anon"` in `worker/src/index.ts:81`). If this is unacceptable, the alternative is to add the listen-log guard inside usePauseOnUnload — but that's out of scope for this surgical fix.
    - The `<span>Session: {sessionId}</span>` rendering at line 136 — empty string is fine; the span renders empty until the effect fires.
  </action>
  <files>app/components/ChatPanel.tsx</files>
  <verify>
    <automated>! grep -nE 'Math\.random.*toString\(36\)' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1==0)}' && grep -nE 'useEffect.*loadSessionId|sessionId.*loadSessionId|sessionId.*saveSessionId|loadSessionId.*setSessionId' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'useState<string>\(""\)' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -q 'sdlc.playground.session.v1' app/components/ChatPanel.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E 'Math\.random.*toString\(36\)' app/components/ChatPanel.tsx` returns 0 matches (no random ID generation during initial paint)
    - `grep -E 'loadSessionId\(\)|setSessionId\(' app/components/ChatPanel.tsx` returns 2+ matches (load + set inside the new useEffect)
    - `grep -E 'useState<string>\(""\)' app/components/ChatPanel.tsx` returns 1 match (stable placeholder)
    - `grep 'sdlc.playground.session.v1' app/components/ChatPanel.tsx` returns 1+ match (smoke.sh #22 marker preserved)
    - `pnpm tsc --noEmit` does not introduce new errors in ChatPanel.tsx (the pre-existing 7 ChatPanel errors from useChat API mismatch remain unchanged — not introduced by this fix)
  </acceptance_criteria>
  <done>React hydration mismatch error gone; sessionId loads from localStorage on first paint after mount; new tabs get a fresh random id (post-mount, after the initial paint matches between server and client).</done>
  <reversibility>reversible</reversibility>
  <implements>UI-04 (session persists across refresh via localStorage — preserved)</implements>
  <commit>fix(chat): hydrate sessionId post-mount — eliminates SSR/client Math.random() mismatch</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Worker :4111 → External | Hono binds 0.0.0.0:4111; bearer auth on /api/health and other apiRoutes is enforced by the Hono context middleware registered by `MastraServer.init()` per Mastra docs. Bearer token in `.env.local` WORKER_SHARED_SECRET. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-F-01 | Information Disclosure | Worker :4111 0.0.0.0 bind | medium | mitigate | Hono binds 0.0.0.0 per existing `host: "0.0.0.0"` config (matches the intent of `concurrently` + dev tunnel use); production deploys MUST scope to 127.0.0.1 or a private interface — out of scope for this fix; bearer auth via WORKER_SHARED_SECRET still gates /api/health. |
| T-1-F-02 | Tampering | npm install (adds @mastra/hono@1.7.0) | medium | mitigate | Package legitimacy gate: `@mastra/hono@1.7.0` is published by `@mastra` org on npmjs.com (same publisher as `@mastra/core@1.60.0`); peer deps `hono@^4.12.8` and `@mastra/core@>=1.50.0 <2.0.0` align with installed versions. Verified via `WebFetch` against `https://registry.npmjs.org/@mastra/hono/1.7.0`; no `[SLOP]` indicators. |
| T-1-F-03 | Spoofing | sessionId empty-string window between mount and post-mount effect | low | accept | During the ~1-frame window between React hydration and the post-mount useEffect firing, `usePauseOnUnload(sessionId)` captures `""`. If the user closes the tab in that exact window, the worker receives `{sessionId: ""}` and falls back to `'anon'` via the existing `sessionId ?? "anon"` guard at `worker/src/index.ts:81`. The audit row is logged under `'anon'` for that single edge case. Acceptable for a Phase 1 demo; full mitigation requires a `useRef` synchronously set in the effect — out of scope. |

## Verification

End-to-end after both tasks complete:

1. **Install + types**: `pnpm install && pnpm tsc --noEmit` — both exit 0. The 13 pre-existing TS errors in ChatPanel.tsx / lib/insforge.ts / pause.ts / resume.ts remain (out of scope per E-SUMMARY §Out-of-Scope).
2. **Worker listen gate** (G-1-1): `pnpm dev` boots Next.js + worker. After ~3s, `curl -fsS -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:4111/api/health` returns `{"worker_up":true,...}` (the existing healthRoute is bound by `MastraServer.init()` and served by Hono on :4111). `netstat -ano | grep 4111` shows LISTENING. `/api/health` proxy from Next side returns `worker_up:true`. Banner flips green.
3. **Hydration gate** (G-1-2): Load `http://localhost:3000/` in a fresh browser. Browser console is free of the React 19 hydration mismatch error. The `<span>Session: ...</span>` renders empty during first paint, then the stored or freshly-generated id appears after mount. localStorage key `sdlc.playground.session.v1` is set on the new tab.
4. **Smoke regression**: `grep -q 'sdlc.playground.session.v1' app/components/ChatPanel.tsx` still passes (smoke.sh assertion #22). `grep -q '1_000, 2_000, 4_000' app/components/ChatPanel.tsx` still passes (smoke.sh #21). `grep -q 'setInterval(tick, 30_000)' app/components/HealthBanner.tsx` unaffected. `pnpm test:audit` runs `worker/src/lib/audit.test.ts` cleanly (no edit to audit.ts). `node --import tsx worker/scripts/test-mcp-reconnect.ts` still passes (no edit to MCP lifecycle).
5. **No regression on `pnpm smoke`**: smoke.sh assertions #5 (worker_up from /api/health) now passes live (was failing pre-fix); assertions #9 (Next proxy worker_up) now passes; all other assertions are unchanged.

## Cross-references

- Hono + MastraServer pattern (Mastra 1.60): https://mastra.ai/docs/server/server-adapters — confirms `init()` then `serve()` from `@hono/node-server`. (HIGH)
- `@mastra/hono@1.7.0` peer deps: `https://registry.npmjs.org/@mastra/hono/1.7.0` — `hono@^4.12.8` + `@mastra/core@>=1.50.0 <2.0.0` + `@hono/node-ws@^1.3.0` + `ws@^8.21.0` + `fetch-to-node@^2.1.0` (auto-installed transitively). (HIGH)
- Root cause trace for G-1-1: `.planning/debug/worker-unreachable.md` lines 44-62 (Mastra 1.60 stores server config on `this.#server`; no auto-listen; `import.meta.url` guard broken under tsx).
- Root cause trace for G-1-2: `.planning/debug/hydration-session-id.md` lines 33-44 (useState lazy init with Math.random() in both SSR + client branches).
- E-SUMMARY §Out-of-Scope — pre-existing TS errors in ChatPanel.tsx (7) are unchanged by F2 (F2's edit is a 1-line `useState` initializer swap + 1 new `useEffect`; it does not touch the `useChat` API surface that causes the 7 errors).

## Caveats for executor

- **`MastraServer.init()` is async and must be awaited** before `serve()`. If you skip the `await`, the apiRoutes are not registered and `/api/health` returns 404 (a worse failure mode than the current ECONNREFUSED). Run `node --import tsx worker/src/index.ts` once after the edit and check the listen log appears.
- **`serve()` is non-blocking** — it returns a `ServerType` (Node `http.Server`) and the module continues executing. `void maybeRefreshEmbeddings()` and `export { sdlcAgent, ... }` still run. The Node event loop stays alive because Hono's `serve()` registers a `connection` listener on the server.
- **Do NOT remove the `server: { port, host, apiRoutes }` block from `new Mastra(...)`** — `MastraServer.init()` reads the apiRoutes from there. Removing it breaks the wiring.
- **pnpm install may bump transitive deps** (`ws`, `@hono/node-ws`, `fetch-to-node`, `@mastra/server` auto-installed). The lockfile regenerates; commit it alongside `package.json`.
- **`@hono/node-server` 2.x is already installed transitively** (verified at `node_modules/.pnpm/@hono+node-server@2.1.1_hono@4.13.3/`). You do NOT need to add it to `package.json` — `@mastra/hono` does not require it as a peer; you import it directly because it ships with the existing `hono` dep closure.
- **`useState<string>("")` is intentional** — do not change to `null` unless you also update line 136 (`<span>Session: {sessionId}</span>` would render `"null"` and React 19 would still hydrate cleanly but the displayed text would say `Session: null` during first paint).
- **The post-mount effect runs ONCE** — `useEffect(() => {...}, [])` with empty deps. Do not add `sessionId` to the deps; otherwise it would loop (setSessionId → re-render → effect runs again).
- **No checkpoint needed** — both fixes are structural and verified by static grep + curl. No human-verify step.

## Success criteria

- `pnpm install` exits 0 against the new `@mastra/hono@1.7.0` pin; lockfile regenerated.
- `pnpm tsc --noEmit` exits 0 with the same 13 pre-existing errors and no new ones.
- `grep` confirms all four F1 markers (`@mastra/hono` import, `await server.init()`, `serve({ fetch: app.fetch`, broken `import.meta.url` guard removed) and all three F2 markers (no `Math.random().toString(36)` in ChatPanel, `loadSessionId`/`setSessionId` paired in a new effect, stable `useState<string>("")`).
- Live: worker binds :4111; `curl /api/health` (with bearer) returns `worker_up:true`; Next proxy `/api/health` returns `worker_up:true`; banner flips green.
- Live: fresh-tab load shows no React hydration error in browser console; `Session:` label appears with the stored id after mount.
- `pnpm smoke` exits 0 (G-1-1 fix unblocks assertions #5, #9, #10; G-1-2 fix does not regress any assertions).
- `pnpm test:audit` and `node --import tsx worker/scripts/test-mcp-reconnect.ts` still pass.

## Output

Create `.planning/phases/01-foundation/01-F-SUMMARY.md` when done.
