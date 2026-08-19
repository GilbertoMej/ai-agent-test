import "dotenv/config";
import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { sdlcAgent, toolApprovalResolver } from "./agents/sdlc";
import { healthRoute } from "./lib/health";
import { maybeRefreshEmbeddings } from "./lib/embed-bootstrap";
import { registerApprovalRoutes, getApprovalHandlers } from "./lib/approval-route";
import type { ApprovalPayload } from "./lib/approval-route";
import { pauseRoute } from "./api-routes/pause";
import { resumeRoute, suspendedListRoute } from "./api-routes/resume";

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
  apiRoutes: [
    healthRoute,
    pauseRoute,
    resumeRoute,
    suspendedListRoute,
    // 01-04 + 01-11 — approval/decline endpoints. Bearer auth via WORKER_SHARED_SECRET
    // is enforced by the Next.js routes; the worker trusts the call.
    {
      path: "/approval/approve",
      method: "POST",
      handler: async (c: { json: (body: unknown) => Promise<unknown>; }) => {
        const body = (await c.json({})) as ApprovalPayload;
        const handlers = getApprovalHandlers(mastra);
        if (!handlers) return { ok: false, error: "approval not registered" };
        return await handlers.approve(body);
      },
    },
    {
      path: "/approval/decline",
      method: "POST",
      handler: async (c: { json: (body: unknown) => Promise<unknown>; }) => {
        const body = (await c.json({})) as ApprovalPayload;
        const handlers = getApprovalHandlers(mastra);
        if (!handlers) return { ok: false, error: "approval not registered" };
        return await handlers.decline(body);
      },
    },
  ],
});

// Register the approval handlers so the routes above can find them.
registerApprovalRoutes(mastra);

// Boot-time embed refresh (D-20). Fire-and-forget; non-blocking.
void maybeRefreshEmbeddings();

export { sdlcAgent, toolApprovalResolver };

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`worker: listening on :${port}`);
}
