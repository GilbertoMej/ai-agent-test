import { config as loadEnv } from "dotenv";

loadEnv();                              // .env
loadEnv({ path: ".env.local" });        // .env.local wins

import { Mastra } from "@mastra/core";
import { RequestContext } from "@mastra/core/request-context";
import { PostgresStore } from "@mastra/pg";
import { registerApiRoute } from "@mastra/core/server";
import { sdlcAgent, toolApprovalResolver } from "./agents/sdlc";
import { healthRoute } from "./lib/health";
import { patchTokens, setAuditSessionId } from "./lib/audit";
import { maybeRefreshEmbeddings } from "./lib/embed-bootstrap";
import { registerApprovalRoutes, getApprovalHandlers } from "./lib/approval-route";
import type { ApprovalPayload } from "./lib/approval-route";
import { pauseRoute, getSuspendedMessages, suspendedRuns } from "./api-routes/pause";
import { resumeRoute, suspendedListRoute } from "./api-routes/resume";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { MastraServer } from "@mastra/hono";
import { convertToModelMessages, type UIMessage, type ModelMessage } from "ai";

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
      // 01-Q — GET /sessions/:id/messages — read suspended messages for resume.
      registerApiRoute("/sessions/:id/messages", {
        method: "GET",
        handler: async (c) => {
          const sessionId = c.req.param("id") ?? "anon";
          const messages = getSuspendedMessages(sessionId) ?? [];
          return c.json({ sessionId, messages });
        },
      }),
      // 01-04 + 01-11 — approval/decline endpoints. Bearer auth via WORKER_SHARED_SECRET
      // is enforced by the Next.js routes; the worker trusts the call.
      // 01-Y — approve/decline now pipe the resumed MastraModelOutput.fullStream back
      // as SSE (a Response, not a JSON-serializable object). When the handler returns
      // a Response, pass it through directly; otherwise fall back to c.json (used by
      // the 404/503 error paths).
      registerApiRoute("/approval/approve", {
        method: "POST",
        handler: async (c) => {
          const body = (await c.req.json().catch(() => ({}))) as ApprovalPayload;
          const handlers = getApprovalHandlers(mastra);
          if (!handlers) return c.json({ ok: false, error: "approval not registered" });
          const result = await handlers.approve(body);
          if (result instanceof Response) return result;
          return c.json(result);
        },
      }),
      registerApiRoute("/approval/decline", {
        method: "POST",
        handler: async (c) => {
          const body = (await c.req.json().catch(() => ({}))) as ApprovalPayload;
          const handlers = getApprovalHandlers(mastra);
          if (!handlers) return c.json({ ok: false, error: "approval not registered" });
          const result = await handlers.decline(body);
          if (result instanceof Response) return result;
          return c.json(result);
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
          // 01-R — withAudit reads sessionId from this module-scope carrier. Mastra
          // 1.60's tool runner invokes createTool({execute}).execute(args) with a
          // single arg, so withAudit's optional ctx arg is always undefined here.
          setAuditSessionId(sessionId);
          const agent = c.get("mastra").getAgent("sdlcAgent");
          // 01-chat-debug: browser sends AI SDK v5 UIMessage[] (parts-format). Mastra 1.60
          // agent.stream expects MessageListInput — pass ModelMessage[] via convertToModelMessages.
          // Without this conversion the call silently produces no model output.
          const modelMessages: ModelMessage[] = Array.isArray(messages)
            ? await convertToModelMessages(messages as UIMessage[])
            : [];
          // ponytail: take only the latest user message. Phase 1 sdlcAgent has no memory
          // configured yet, so passing the full client history causes the model to re-run
          // every prior command each turn. Memory wiring is the proper fix — add when
          // multi-turn context is a Phase 1 requirement (track in [mastra-1-60-stream-signature]).
          const lastUser = [...modelMessages].reverse().find((m) => m.role === "user");
          const promptMessages = lastUser ? [lastUser] : modelMessages;
          console.log(`[chat-debug] in=${Array.isArray(messages) ? messages.length : 0} prompt=${promptMessages.length} thread=${threadId ?? "-"} mode=${approvalMode ?? "tiered"}`);
          // ponytail: per-chunk logging stripped (was used to identify translation bug). Re-add only if regression.
          // RequestContext values are runtime-only; setRaw bypasses the declared-keys schema.
          const requestContext = new RequestContext();
          requestContext.setRaw("approvalMode", approvalMode ?? "tiered");
          requestContext.setRaw("sessionId", sessionId ?? "anon");
          // Mastra 1.60: agent.stream signature is `(messages, { requireToolApproval,
          // requestContext, memory?: { thread, resource }, abortSignal })`. threadId/resourceId
          // moved into the `memory` option; PostgresStore is wired at the Mastra level.
          // ponytail: do NOT pass c.req.raw.signal — the upstream LLM provider (opencode-go)
          // reported "Client connection prematurely closed" when our request signal fired
          // mid-stream. Let the agent finish naturally; if the browser closes, the worker
          // discards remaining chunks (controller.enqueue throws after close).
          const stream = await agent.stream(promptMessages, {
            requireToolApproval: toolApprovalResolver,
            requestContext,
            memory: threadId ? { thread: threadId, resource: "operator" } : undefined,
          });
          // Translate Mastra fullStream → AI SDK v5 UIMessageChunk SSE so useChat's
          // DefaultChatTransport can parse it. Token counting still rides on step-finish.
          const sseBody = new ReadableStream<Uint8Array>({
            async start(controller) {
              const encoder = new TextEncoder();
              const msgId = crypto.randomUUID();
              let lastToolName = "sdlcAgent";
              let textCount = 0;
              // 01-X — true if the for-await loop saw a tool-call-approval chunk. Mastra
              // 1.60's workflowLoopStream closes its controller without error on suspend
              // (agent-BVtn9FqD.cjs:27282 — safeClose), so the for-await loop exits normally
              // for BOTH successful AND suspended runs. Without this flag, the translator
              // emits `finish` either way — misleading the client into thinking the
              // assistant response completed when it's actually waiting for user approval.
              let sawApprovalChunk = false;
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "start", messageId: msgId, messageMetadata: { modelId: "opencode-go/hy3" } })}\n\n`),
                );
                for await (const chunk of stream.fullStream) {
                  console.log(`[chat-debug] chunk=${chunk.type}`);
                  if (chunk.type === "text-start") {
                    const id = (chunk.payload as { id?: string } | undefined)?.id ?? crypto.randomUUID();
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "text-start", id })}\n\n`),
                    );
                  } else if (chunk.type === "text-delta") {
                    const p = chunk.payload as { id?: string; text?: string } | undefined;
                    textCount++;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "text-delta", id: p?.id ?? msgId, delta: p?.text ?? "" })}\n\n`),
                    );
                  } else if (chunk.type === "text-end") {
                    const id = (chunk.payload as { id?: string } | undefined)?.id;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "text-end", id })}\n\n`),
                    );
                  } else if (chunk.type === "tool-call") {
                    const p = chunk.payload as { toolCallId?: string; toolName?: string; args?: unknown } | undefined;
                    const toolCallId = p?.toolCallId ?? crypto.randomUUID();
                    lastToolName = p?.toolName ?? lastToolName;
                    // Strip __mastraMetadata from args (not a tool input — Mastra internal).
                    const args = (p?.args ?? {}) as Record<string, unknown>;
                    delete (args as Record<string, unknown>)["__mastraMetadata"];
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "tool-input-available", toolCallId, toolName: lastToolName, input: args })}\n\n`),
                    );
                  } else if (chunk.type === "tool-call-approval") {
                    const p = chunk.payload as { toolCallId?: string } | undefined;
                    const toolCallId = p?.toolCallId ?? crypto.randomUUID();
                    // 01-X — mark that the upstream gate fired; the for-await loop will exit
                    // without error (controller.close, not throw) and the terminator below
                    // branches on this flag to emit `suspended` instead of `finish`.
                    sawApprovalChunk = true;
                    // 01-Y — stash (sessionId, toolCallId) → runId so /approval/approve can
                    // call agent.approveToolCall({runId, toolCallId}) to resume the suspended
                    // run. MastraModelOutput.runId (output.d.ts:88) is stable across the
                    // suspended-then-resumed lifetime. Composite key avoids collision with
                    // pause.ts's sessionId-keyed entries (separate concern, same Map).
                    if (stream.runId) {
                      suspendedRuns.set(`${sessionId}::${toolCallId}`, {
                        pausedAt: Date.now(),
                        messages: [],
                        runId: stream.runId,
                      });
                    }
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "tool-approval-request", approvalId: toolCallId, toolCallId })}\n\n`),
                    );
                  } else if (chunk.type === "tool-result") {
                    const p = chunk.payload as { toolCallId?: string; result?: unknown } | undefined;
                    if (p?.toolCallId) {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: "tool-output-available", toolCallId: p.toolCallId, output: p.result })}\n\n`),
                      );
                    }
                  } else if (chunk.type === "step-finish") {
                    const payload = chunk.payload as { totalUsage?: { inputTokens?: number; outputTokens?: number } } | undefined;
                    const usage = payload?.totalUsage;
                    if (usage) {
                      const inTok = usage.inputTokens ?? 0;
                      const outTok = usage.outputTokens ?? 0;
                      // Server-side audit (BCK-03) — patch the most recent row.
                      void patchTokens(sessionId ?? "anon", lastToolName, inTok, outTok).catch(() => {});
                      // Client-side wire (UI-06) — data-usage DataUIMessageChunk lands on m.parts[i].data,
                      // NOT m.usage (which doesn't exist on UIMessage). The Counter reads from parts.
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: "data-usage", data: { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok } })}\n\n`),
                      );
                    }
                  }
                }
                if (sawApprovalChunk) {
                  // ponytail: AI SDK v5 has no `suspended` chunk type — emit `finish` so the
                  // client's parser accepts the terminator, plus a custom data chunk the
                  // client (plan 01-Y) reads to know the response is awaiting approval.
                  // The data chunk uses the existing `data-...` part shape so the AI SDK
                  // stores it on m.parts[i].data without rejecting the stream.
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "data-suspended", data: { reason: "tool-call-approval", toolName: lastToolName } })}\n\n`),
                  );
                  console.log(`[chat-debug] suspended text=${textCount} tool=${lastToolName}`);
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
                  console.log(`[chat-debug] ok text=${textCount} tool=${lastToolName}`);
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              } catch (e) {
                console.log(`[chat-debug] err text=${textCount} msg=${e instanceof Error ? e.message : String(e)}`);
                try {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "error", error: e instanceof Error ? e.message : String(e) })}\n\n`),
                  );
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                } catch { /* controller closed mid-error — nothing to do */ }
              }
            },
          });
          return new Response(sseBody, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            },
          });
        },
      }),
    ],
  },
});

// Register the approval handlers so the routes above can find them.
registerApprovalRoutes(mastra);

// Re-export for downstream tools (test scripts, etc.). Hoisted before the async IIFE
// because CJS named-export hoisting under esbuild is finicky around top-level async
// boundaries; placing exports after the IIFE can yield `ReferenceError: ... is not defined`
// when downstream tools import the worker module.
export { sdlcAgent, toolApprovalResolver };

// Boot-time embed refresh (D-20). Fire-and-forget; non-blocking.
void maybeRefreshEmbeddings();

// 01-G1 — top-level await is invalid under CJS (tsc/tsx emit CJS because package.json
// has no "type": "module"). Wrap the wiring in an async IIFE so the await lives inside
// an async function. The IIFE returns void; we deliberately do not `await` it from the
// module top-level (same constraint). The IIFE runs synchronously up to the first `await`,
// then yields to the microtask queue and resolves. The rest of the module finishes loading
// before `serve(...)` binds, which is the intended behavior.
void (async () => {
  // 01-F1 — Hono + MastraServer wires the apiRoutes registered above onto a real HTTP
  // listener. Mastra 1.60 stores server config on `this.#server` but does NOT auto-listen,
  // so without this block the worker process exits silently and :4111 is unbound.
  const app = new Hono();
  const server = new MastraServer({ app, mastra });
  await server.init();
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => console.log(`worker: listening on :${info.port}`));
})();
