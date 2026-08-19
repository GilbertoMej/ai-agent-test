import "dotenv/config";
import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { sdlcAgent, toolApprovalResolver } from "./agents/sdlc";
import { healthRoute } from "./lib/health";

// D-05: local-only worker. Boots in <2s with no MCPs loaded (D-06).
// D-22: Next.js sends `Authorization: Bearer ${WORKER_SHARED_SECRET}` on every call.
// Phase 1 ships the bare Mastra + Hono server + the echo agent. Real MCPs land in Wave 2.
const port = Number(process.env.WORKER_PORT ?? 4111);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for PostgresStore");
}

export const mastra = new Mastra({
  agents: { sdlcAgent },
  storage: new PostgresStore({
    id: "mastra",
    connectionString: process.env.DATABASE_URL!,
  }),
  server: {
    port,
    host: "0.0.0.0",
  },
  apiRoutes: [healthRoute],
});

// Convenience exports for callers that want to invoke the agent directly
// (e.g. the smoke endpoint, future server actions).
export { sdlcAgent, toolApprovalResolver };

if (import.meta.url === `file://${process.argv[1]}`) {
  // Boot side-effect: tsx / node entry point. The Hono server starts when `server.port` is set.
  console.log(`worker: listening on :${port}`);
}
