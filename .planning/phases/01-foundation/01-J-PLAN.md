---
phase: 1
plan: J
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-1]
depends_on: ["01-I"]
files_modified:
  - scripts/predev.ts
autonomous: true
must_haves:
  - "`pnpm dev` proceeds past predev into concurrently within 3s"
  - "`worker: listening on :4111` appears in `pnpm dev` output"
  - "`curl :4111/health` returns worker_up:true from a `pnpm dev` boot"
  - "Stale port-3000 holders still get killed (predev cleanup still runs)"
  - "Hydration gate (01-F2), IIFE wrap (01-G1), route rename (01-H1), -k drop (01-I1) all stay intact"
requirements:
  - UI-07
  - BCK-02
---

# 01-J — Phase 1 Gap Closure (predev must exit after kicking off work)

Closes the fourth blocker of G-1-1: `scripts/predev.ts` was rewritten in 01-I to launch a port-cleanup IIFE plus fire `maybeRefreshEmbeddings()` with `.catch()`. Both calls are fire-and-forget — they leave pending promises on the event loop. tsx/Node waits for the event loop to drain before exiting, so predev never returns. pnpm's `tsx scripts/predev.ts && concurrently ...` never reaches concurrently; no Next dev, no worker boots. Only the early `embed-bootstrap: refreshing` log appears (the function logs before it returns its promise).

`pnpm worker` works because it skips predev entirely.

Fix: wrap the entire predev body in a single async IIFE that AWAITS both the cleanup and the embed-refresh, then `process.exit(0)` explicitly. Failures in either step are caught and logged but do not block exit. predev becomes deterministic — runs its work, exits, `&&` fires concurrently.

## Tasks

<task type="auto">
  <id>01-J1-predev-explicit-exit</id>
  <read_first>
    - scripts/predev.ts (current state — IIFE + maybeRefreshEmbeddings fire-and-forget)
  </read_first>
  <action>
    Single edit to `scripts/predev.ts`.

    **Final shape of the file** (line-for-line):

    ```ts
    import { config as loadEnv } from "dotenv";

    loadEnv();                              // .env
    loadEnv({ path: ".env.local" });        // .env.local wins

    // scripts/predev.ts — runs once before `next dev` + worker boot.
    // 01-06 / D-20: auto-refresh tool_docs embeddings on cold/stale dev boot.
    // 01-J1: wrap the whole body in an async IIFE that exits explicitly, otherwise
    // tsx/Node waits for pending promises (the dynamic import, the embed-refresh
    // HTTP call) to drain — predev never returns and pnpm's `&&` never fires
    // concurrently. Symptom: only "embed-bootstrap: refreshing" log appears, no
    // Next dev, no worker.
    void (async () => {
      // 01-I1 — kill stale node.exe processes that hold port 3000 from previous
      // sessions. Windows-only; on Linux/macOS the user's package manager handles
      // this differently.
      if (process.platform === "win32") {
        try {
          const { execSync } = await import("node:child_process");
          const out = execSync('netstat -ano | findstr ":3000"', { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .split("\n")
            .filter((l) => l.includes("LISTENING"))
            .map((l) => l.trim().split(/\s+/).pop())
            .filter(Boolean);
          for (const pid of new Set(out)) {
            try {
              execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
              console.log(`predev: killed stale port-3000 holder PID ${pid}`);
            } catch {}
          }
        } catch (e) {
          console.error("predev: port-cleanup failed", e);
        }
      }

      // 01-06 / D-20 — fire-and-forget the embed-refresh; await it so we know
      // whether it failed before exiting. If InsForge is unreachable, the await
      // resolves (the function catches internally) within a bounded time.
      try {
        const { maybeRefreshEmbeddings } = await import("@/worker/src/lib/embed-bootstrap");
        await maybeRefreshEmbeddings();
      } catch (e) {
        console.error("predev: embed-bootstrap failed", e);
      }

      // 01-J1 — exit explicitly so the `&&` chain in package.json's dev script
      // reaches concurrently. Do NOT await any further promises after this.
      process.exit(0);
    })();
    ```

    Key changes from the current 01-I version:
    - The `maybeRefreshEmbeddings` import moved INTO the IIFE (it was a top-level static import before; that import side-effect was actually OK but moving it inside makes the IIFE the single owner of async work).
    - The IIFE now `await`s both the cleanup and the embed-refresh.
    - The IIFE ends with `process.exit(0)` — explicit, deterministic.
    - Outer `try/catch` around each step so a single failure does not prevent exit; each logs to stderr.
    - The `void` prefix on the IIFE discards the returned Promise (best practice for top-level async wrappers).

    Do NOT touch any other file. Do NOT remove the port-cleanup. Do NOT add `"type": "module"`.
  </action>
  <files>scripts/predev.ts</files>
  <verify>
    <automated>grep -q 'process.exit(0)' scripts/predev.ts && grep -q 'await maybeRefreshEmbeddings()' scripts/predev.ts && grep -q 'predev: killed stale port-3000 holder' scripts/predev.ts && grep -q 'void (async () =>' scripts/predev.ts && ! grep -q '^maybeRefreshEmbeddings()' scripts/predev.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'process.exit(0)' scripts/predev.ts` returns 1 match (explicit exit)
    - `grep 'await maybeRefreshEmbeddings()' scripts/predev.ts` returns 1 match (embed-refresh awaited)
    - `grep '^maybeRefreshEmbeddings()' scripts/predev.ts` returns 0 matches (no top-level fire-and-forget)
    - `grep 'predev: killed stale port-3000 holder' scripts/predev.ts` returns 1 match (cleanup log preserved)
    - `grep 'void (async () =>' scripts/predev.ts` returns 1 match (IIFE wrapper)
    - `grep 'process.platform === "win32"' scripts/predev.ts` returns 1 match (platform guard preserved)
    - `pnpm tsc --noEmit` no new errors (14 pre-existing; 0 new from edits)
  </acceptance_criteria>
  <done>predev runs cleanup + embed-refresh, awaits both, exits deterministically; pnpm dev proceeds to concurrently; both Next dev and worker boot; worker binds :4111.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-07 (worker health surface reachable from `pnpm dev`), BCK-02</implements>
  <commit>fix(predev): explicit process.exit(0) — stop tsx hanging on pending promises</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| predev exit | `process.exit(0)` is unconditional at the end of the IIFE. If both cleanup and embed-refresh throw, the catches log to stderr but exit still fires. predev is intentionally a one-shot script — it is NOT a long-running daemon. |

## Caveats for executor

- The `await import("@/worker/src/lib/embed-bootstrap")` inside the IIFE works because `@/` alias is resolved by tsx at runtime via tsconfig paths. If tsconfig paths aren't honored by tsx (older tsx), fall back to relative path `../worker/src/lib/embed-bootstrap` — but try the alias first, it should work.
- Do NOT remove the `void` prefix from the IIFE call. It's the standard pattern for top-level async wrappers and silences "unhandled promise" linters.
- Do NOT add `process.exit(1)` on failure paths. Even when the embed-refresh fails, predev should still exit 0 — the failure is logged and dev should proceed (the worker will re-attempt embed-refresh at runtime via its own `void maybeRefreshEmbeddings()`).
- Run the static verify only; do NOT run `pnpm dev` end-to-end — that needs a live DB the executor does not have. User will verify after the fix lands.

## Success criteria

- `pnpm dev` proceeds to concurrently within 3s (you'll see the Next.js "ready" log and the worker's "worker: listening on :4111" log appear).
- `curl :4111/health` returns worker_up:true.
- Browser `/api/health` returns worker_up:true; banner green.
- Stale port-3000 holders still get killed.
- No regression on hydration, route rename, -k removal.

## Output

Create `.planning/phases/01-foundation/01-J-SUMMARY.md` when done.
