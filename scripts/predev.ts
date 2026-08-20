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
