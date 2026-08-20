import { config as loadEnv } from "dotenv";

loadEnv();                              // .env
loadEnv({ path: ".env.local" });        // .env.local wins

import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// 01-06 — D-20 boot-time refresh.
// Trigger scrape+embed when tool_docs is empty OR stale (older than 7 days).
// Runs as a fire-and-forget child process so the worker boots in <2s (D-06).

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export async function maybeRefreshEmbeddings(): Promise<void> {
  // Skip on Supabase path — embeddings are gated by InsForge/OpenRouter.
  if (process.env.BACKEND_PROVIDER === "supabase") return;

  const rows = (await db.execute(sql`
    SELECT count(*)::int AS n, max(fetched_at) AS latest FROM tool_docs
  `)) as unknown as Array<{ n: number; latest: string | null }>;
  const { n, latest } = rows[0] ?? { n: 0, latest: null };
  const stale = !latest || Date.now() - new Date(latest).getTime() > STALE_MS;
  if (n > 0 && !stale) return;

  console.log(`embed-bootstrap: refreshing (n=${n}, stale=${stale})`);
  const child = spawn("pnpm", ["embed:tools"], { detached: true, stdio: "inherit", shell: true });
  child.unref();
}
