import "dotenv/config";
import { Mastra } from "@mastra/core";
import { RequestContext } from "@mastra/core/request-context";
import { PostgresStore } from "@mastra/pg";
import { registerApiRoute } from "@mastra/core/server";
import { sdlcAgent, toolApprovalResolver } from "./agents/sdlc";
import { healthRoute } from "./lib/health";
import { patchTokens } from "./lib/audit";
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
    // Mastra 1.60 — apiRoutes moved inside `server` (was top-level on the Config type).
    apiRoutes: [
      healthRoute,
      pauseRoute,
      resumeRoute,
      suspendedListRoute,
      // 01-04 + 01-11 — approval/decline endpoints. Bearer auth via WORKER_SHARED_SECRET
      // is enforced by the Next.js routes; the worker trusts the call.
      registerApiRoute("/approval/approve", {
        method: "POST",
        handler: async (c) => {
          const body = (await c.req.json().catch(() => ({}))) as ApprovalPayload;
          const handlers = getApprovalHandlers(mastra);
          if (!handlers) return c.json({ ok: false, error: "approval not registered" });
          return c.json(await handlers.approve(body));
        },
      }),
      registerApiRoute("/approval/decline", {
        method: "POST",
        handler: async (c) => {
          const body = (await c.req.json().catch(() => ({}))) as ApprovalPayload;
          const handlers = getApprovalHandlers(mastra);
          if (!handlers) return c.json({ ok: false, error: "approval not registered" });
          return c.json(await handlers.decline(body));
        },
      }),
      // 01-E2 — custom POST /agents/sdlcAgent/stream route. Wires toolApprovalResolver
      // into agent.stream() (HITL-01/02), threads sessionId through requestContext
      // (UI-04 anchor), and patches tokens_in/out on step-finish (UI-06).
      // Custom route takes precedence over the Mastra built-in stream route for the same path.
      registerApiRoute("/agents/sdlcAgent/stream", {
        method: "POST",
        handler: async (c) => {
          const body = (await c.req.json().catch(() => ({}))) as {
            messages?: unknown;
            threadId?: string;
            approvalMode?: string;
            sessionId?: string;
          };
          const { messages, threadId, approvalMode, sessionId } = body;
          const agent = c.get("mastra").getAgent("sdlcAgent");
          // RequestContext values are runtime-only; setRaw bypasses the declared-keys schema.
          const requestContext = new RequestContext();
          requestContext.setRaw("approvalMode", approvalMode ?? "tiered");
          requestContext.setRaw("sessionId", sessionId ?? "anon");
          // Mastra 1.60: agent.stream signature is `(messages, { requireToolApproval,
          // requestContext, memory?: { thread, resource }, abortSignal })`. threadId/resourceId
          // moved into the `memory` option; PostgresStore is wired at the Mastra level.
          const stream = await agent.stream(messages as never, {
            requireToolApproval: toolApprovalResolver,
            requestContext,
            memory: threadId ? { thread: threadId, resource: "operator" } : undefined,
            abortSignal: c.req.raw.signal,
          });
          // Iterate fullStream as SSE. On step-finish, fire-and-forget patchTokens()
          // so audit_log.tokens_in/out reflect real LLM usage (not the default 0).
          const sseBody = new ReadableStream<Uint8Array>({
            async start(controller) {
              const encoder = new TextEncoder();
              let lastToolName = "sdlcAgent";
              try {
                for await (const chunk of stream.fullStream) {
                  if (chunk.type === "tool-call") {
                    lastToolName = chunk.payload?.toolName ?? lastToolName;
                  }
                  if (
                    chunk.type === "step-finish" &&
                    chunk.payload &&
                    typeof chunk.payload === "object" &&
                    "totalUsage" in chunk.payload &&
                    chunk.payload.totalUsage
                  ) {
                    const usage = chunk.payload.totalUsage as {
                      inputTokens?: number;
                      outputTokens?: number;
                    };
                    void patchTokens(
                      sessionId ?? "anon",
                      lastToolName,
                      usage.inputTokens ?? 0,
                      usage.outputTokens ?? 0,
                    ).catch(() => {});
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              } catch (e) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "error", error: String(e) })}\n\n`),
                );
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              }
            },
          });
          return new Response(sseBody, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          });
        },
      }),
    ],
  },
});

// Register the approval handlers so the routes above can find them.
registerApprovalRoutes(mastra);

// Boot-time embed refresh (D-20). Fire-and-forget; non-blocking.
void maybeRefreshEmbeddings();

export { sdlcAgent, toolApprovalResolver };

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`worker: listening on :${port}`);
}
