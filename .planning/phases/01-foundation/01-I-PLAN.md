---
phase: 1
plan: I
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-1]
depends_on: ["01-H"]
files_modified:
  - package.json
  - scripts/predev.ts
autonomous: true
must_haves:
  - "`pnpm dev` boots and worker binds :4111 within 5s (even when port 3000 is held by a stale process)"
  - "Ctrl-C still terminates both next dev and worker cleanly (TTY process group)"
  - "Hydration gate (01-F2), IIFE wrap (01-G1), health route rename (01-H1) all stay intact"
  - "`pnpm tsc --noEmit` no new errors"
requirements:
  - UI-07
  - BCK-02
---

# 01-I — Phase 1 Gap Closure (dev script: stop -k from killing worker)

Closes the third blocker of G-1-1: `package.json` `dev` script uses `concurrently -k` which kills the worker whenever `next dev` exits for any reason — including EADDRINUSE on port 3000 from a stale `node.exe`. Worker dies before the async IIFE reaches `serve()`, so :4111 never binds.

Two surgical edits:

1. Drop `-k` from `concurrently` flags. Each child lives independently. Ctrl-C still kills both because they share the parent TTY's process group.
2. Add a stale-port-cleanup step in `predev` so a leftover port-3000 holder gets killed before `next dev` even tries to bind.

## Tasks

<task type="auto">
  <id>01-I1-fix-dev-script</id>
  <read_first>
    - package.json scripts block (`dev`, `worker`, `predev` — currently `"dev": "tsx scripts/predev.ts && concurrently -k -n web,worker -c blue,magenta \"next dev -p 3000\" \"tsx watch worker/src/index.ts\""`)
    - scripts/predev.ts (current content: dotenv load + maybeRefreshEmbeddings kick)
  </read_first>
  <action>
    Two edits.

    **Edit 1 — `package.json`:** change the `dev` script value from:
    ```
    "tsx scripts/predev.ts && concurrently -k -n web,worker -c blue,magenta \"next dev -p 3000\" \"tsx watch worker/src/index.ts\""
    ```
    to:
    ```
    "tsx scripts/predev.ts && concurrently -n web,worker -c blue,magenta \"next dev -p 3000\" \"tsx watch worker/src/index.ts\""
    ```
    Only change: remove the `-k` flag.

    **Edit 2 — `scripts/predev.ts`:** add a Windows-port-cleanup at the top. After the dotenv loads, before `maybeRefreshEmbeddings()`, add:
    ```ts
    // 01-I1 — kill stale node.exe processes that hold port 3000 from previous sessions.
    // Windows-only (cmd.exe); on Linux/macOS the user's package manager handles this differently.
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
      } catch {}
    }
    ```

    Wrap the import + cleanup in a top-level `await`. Since `predev.ts` is invoked by `pnpm dev` via `tsx scripts/predev.ts` and runs to completion before `concurrently` starts, top-level await is fine here (it's a separate process from the worker; if it fails, pnpm's `&&` short-circuits and dev doesn't start — loud failure mode).

    Actually — top-level await may still trip the same CJS constraint as the worker. Safer: wrap in an async IIFE matching the 01-G pattern:
    ```ts
    void (async () => {
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
        } catch {}
      }
    })();

    maybeRefreshEmbeddings().catch((e) => console.error("predev: embed-bootstrap failed", e));
    ```

    Do NOT touch any other script. Do NOT change `worker/src/index.ts`. Do NOT add `-k` back. Do NOT add `"type": "module"`.
  </action>
  <files>package.json, scripts/predev.ts</files>
  <verify>
    <automated>grep -q '"dev": "tsx scripts/predev.ts && concurrently -n web,worker' package.json && ! grep -q 'concurrently -k' package.json && grep -q 'predev: killed stale port-3000 holder' scripts/predev.ts && grep -q 'process.platform === "win32"' scripts/predev.ts && timeout 6 pnpm dev > /tmp/d.log 2>&1; sleep 5; curl -fsS -H "Authorization: Bearer $WORKER_SHARED_SECRET" --max-time 3 http://localhost:4111/health 2>&1 | head -1; netstat -ano | grep ":4111 " | head -1</automated>
  </verify>
  <acceptance_criteria>
    - `grep '"dev": "tsx scripts/predev.ts && concurrently -n web,worker' package.json` returns 1 match (`-k` removed)
    - `grep 'concurrently -k' package.json` returns 0 matches (no `-k` anywhere)
    - `grep 'process.platform === "win32"' scripts/predev.ts` returns 1+ match (cleanup guarded)
    - `grep 'taskkill /F /PID' scripts/predev.ts` returns 1+ match (kill command present)
    - `grep 'predev: killed stale port-3000 holder' scripts/predev.ts` returns 1+ match (log message)
    - `pnpm tsc --noEmit` shows no new errors (14 pre-existing remain; 0 new)
  </acceptance_criteria>
  <done>`pnpm dev` boots and worker binds :4111 even when port 3000 was stale. Ctrl-C still kills both children (TTY process group).</done>
  <reversibility>reversible</reversibility>
  <implements>UI-07 (worker health surface reachable from `pnpm dev`), BCK-02 (bearer-authed health route reachable)</implements>
  <commit>fix(dev): stop concurrently -k from killing worker when next dev exits (port 3000 stale)</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| predev cleanup | `taskkill /F /PID <pid>` is destructive but scoped to PIDs found via `netstat -ano \| findstr ":3000"`. The PIDs ARE port-3000 LISTENING holders — exactly the stale processes we want killed. On non-Windows, the platform guard skips the block entirely. |

## Caveats for executor

- The predev cleanup is wrapped in `try/catch` and `void (async () => {...})()` — failures are silent. That's intentional: a stale-holder kill failure shouldn't block dev boot.
- Do NOT add port-4111 cleanup. The worker binds :4111 itself; killing its prior holder would race with the worker's own bind and cause EADDRINUSE.
- Do NOT add a Linux/macOS branch. The project is Windows-only per `.claude/CLAUDE.md` (win32, Windows 11).
- Run the verify block as written: `pnpm dev` in background, sleep 5, curl + netstat. The `&&` chain at the end is bash; on git-bash this works.
- Live `pnpm dev` test will leave processes running. Kill them after the verify with `pkill -f "next dev"; pkill -f "tsx watch worker"; pkill -f "concurrently"`.

## Success criteria

- `pnpm dev` boots; worker prints `worker: listening on :4111` within 5s.
- `curl :4111/health` (with bearer) returns `worker_up:true`.
- Browser `/api/health` (Next proxy) returns `worker_up:true`.
- Banner flips green; no hydration error.
- If a stale node.exe holds port 3000, predev kills it; `pnpm dev` still boots cleanly.
- Ctrl-C terminates both next dev and worker.

## Output

Create `.planning/phases/01-foundation/01-I-SUMMARY.md` when done.
