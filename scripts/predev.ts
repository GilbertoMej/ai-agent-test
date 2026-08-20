import { config as loadEnv } from "dotenv";

loadEnv();                              // .env
loadEnv({ path: ".env.local" });        // .env.local wins

// scripts/predev.ts — runs once before `next dev` + worker boot.
// 01-06 / D-20: auto-refresh tool_docs embeddings on cold/stale dev boot.
import { maybeRefreshEmbeddings } from "@/worker/src/lib/embed-bootstrap";

// 01-I1 — kill stale node.exe processes that hold port 3000 from previous sessions.
// Windows-only (cmd.exe); on Linux/macOS the user's package manager handles this differently.
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
