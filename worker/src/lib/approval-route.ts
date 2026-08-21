import { nanoid } from "nanoid";
import type { Mastra } from "@mastra/core";
import type { MastraModelOutput } from "@mastra/core/stream";
import { db } from "@/db/client";
import { auditLog, approvalGrants } from "@/db/schema";
import { suspendedRuns } from "../api-routes/pause";

// 01-04 + 01-11 — /approval/approve and /approval/decline handlers.
// Wired into the worker via apiRoutes in worker/src/index.ts.
// Records audit_log.approval_decision and (for approve with pattern) an
// approval_grants row so resolveApproval() short-circuits for 5 min.
// 01-Y — resume round-trip: handlers now look up the stashed runId in
// suspendedRuns (composite key `${sessionId}::${toolCallId}`), call
// agent.approveToolCall / agent.declineToolCall, and pipe the resumed
// MastraModelOutput.fullStream back as SSE so the browser sees the
// tool-result + assistant follow-up text. Client refreshes via
// `window.location.reload()` after the POST resolves.

export interface ApprovalPayload {
  toolCallId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  tier?: "read" | "write_low" | "write_high";
  pattern?: string; // when set, writes an approval_grants row
  sessionId?: string;
  reason?: string; // 01-Y — decline payload
}

async function recordDecision(
  p: ApprovalPayload,
  decision: "user_allow" | "user_deny" | "auto",
): Promise<void> {
  await db.insert(auditLog).values({
    id: nanoid(),
    session_id: p.sessionId ?? process.env.SESSION_ID ?? "anon",
    tool_name: p.toolName,
    args_json: JSON.stringify(p.args ?? {}),
    result_status: decision === "user_deny" ? "denied" : "ok",
    approval_decision: decision,
    duration_ms: 0,
  });
}

async function writeGrant(pattern: string): Promise<void> {
  await db.insert(approvalGrants).values({
    id: nanoid(),
    pattern,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });
}

// ponytail: inlined translator body from worker/src/index.ts:127-208 — drops the
// tool-call-approval chunk branch and the sawApprovalChunk flag because the
// resumed run has already cleared the gate. Only one call site needs the
// translator; extracting a shared helper would add a new exported function the
// operator has to chase to debug.
async function streamResumedAsSse(resumed: MastraModelOutput, sessionId: string): Promise<Response> {
  const encoder = new TextEncoder();
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const msgId = crypto.randomUUID();
      let textCount = 0;
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "start", messageId: msgId, messageMetadata: { modelId: "opencode-go/hy3" } })}\n\n`),
        );
        for await (const chunk of resumed.fullStream) {
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
            const args = (p?.args ?? {}) as Record<string, unknown>;
            delete (args as Record<string, unknown>)["__mastraMetadata"];
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "tool-input-available", toolCallId, toolName: p?.toolName ?? "sdlcAgent", input: args })}\n\n`),
            );
          } else if (chunk.type === "tool-result") {
            const p = chunk.payload as { toolCallId?: string; result?: unknown } | undefined;
            if (p?.toolCallId) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "tool-output-available", toolCallId: p.toolCallId, output: p.result })}\n\n`),
              );
            }
          } else if (chunk.type === "tool-error") {
            // 01-Y — declined tool calls surface as tool-error chunks (Mastra 1.60
            // default). Emit a tool-output-available with the error so the
            // ActionFeed still renders the failure path; AI SDK v5 doesn't have
            // a dedicated tool-error part type.
            const p = chunk.payload as { toolCallId?: string; error?: unknown } | undefined;
            if (p?.toolCallId) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "tool-output-available", toolCallId: p.toolCallId, output: { error: p.error } })}\n\n`),
              );
            }
          } else if (chunk.type === "step-finish") {
            const payload = chunk.payload as { totalUsage?: { inputTokens?: number; outputTokens?: number } } | undefined;
            const usage = payload?.totalUsage;
            if (usage) {
              const inTok = usage.inputTokens ?? 0;
              const outTok = usage.outputTokens ?? 0;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "data-usage", data: { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok } })}\n\n`),
              );
            }
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        console.log(`[chat-debug] resumed ok session=${sessionId} text=${textCount}`);
      } catch (e) {
        console.log(`[chat-debug] resumed err session=${sessionId} msg=${e instanceof Error ? e.message : String(e)}`);
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
  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function registerApprovalRoutes(mastra: Mastra): void {
  // The Mastra Hono server exposes registered apiRoutes; these handlers
  // piggyback on the same shape (path + handler) the SDK expects.
  // ponytail: hand-rolled handlers — no extra deps, no extra middleware.
  // 01-Y — capture `mastra` in the closure and resolve the agent at handler-call
  // time via `mastra.getAgent("sdlcAgent")`. Avoids a CJS circular import
  // (index.ts → approval-route.ts → index.ts) where the approvalAgent binding
  // would be captured at require time before index.ts finishes its module init.
  const handlers = {
    approve: async (body: ApprovalPayload): Promise<Response> => {
      await recordDecision(body, "user_allow");
      if (body.pattern) await writeGrant(body.pattern);
      const sessionId = body.sessionId ?? "anon";
      const toolCallId = body.toolCallId ?? "";
      const key = `${sessionId}::${toolCallId}`;
      const runId = suspendedRuns.get(key)?.runId;
      if (!runId) {
        return jsonError(404, { ok: false, error: "no-suspended-run", sessionId, toolCallId });
      }
      const agent = mastra.getAgent("sdlcAgent") as unknown as {
        approveToolCall: (opts: { runId: string; toolCallId: string }) => Promise<MastraModelOutput>;
      } | undefined;
      if (!agent) {
        return jsonError(503, { ok: false, error: "agent-not-ready" });
      }
      // ponytail: clear the Map entry — second approve with the same toolCallId
      // returns 404 (T-1-Y-03). The run is no longer suspended once resumed.
      suspendedRuns.delete(key);
      const resumed: MastraModelOutput = await agent.approveToolCall({ runId, toolCallId });
      return streamResumedAsSse(resumed, sessionId);
    },
    decline: async (body: ApprovalPayload): Promise<Response> => {
      await recordDecision(body, "user_deny");
      const sessionId = body.sessionId ?? "anon";
      const toolCallId = body.toolCallId ?? "";
      const key = `${sessionId}::${toolCallId}`;
      const runId = suspendedRuns.get(key)?.runId;
      if (!runId) {
        return jsonError(404, { ok: false, error: "no-suspended-run", sessionId, toolCallId });
      }
      const agent = mastra.getAgent("sdlcAgent") as unknown as {
        declineToolCall: (opts: { runId: string; toolCallId: string; reason: string }) => Promise<MastraModelOutput>;
      } | undefined;
      if (!agent) {
        return jsonError(503, { ok: false, error: "agent-not-ready" });
      }
      suspendedRuns.delete(key);
      const resumed: MastraModelOutput = await agent.declineToolCall({
        runId,
        toolCallId,
        reason: body.reason ?? "user-declined",
      });
      return streamResumedAsSse(resumed, sessionId);
    },
  };
  // Stash on the mastra instance so the route file in worker/src/index.ts
  // can register them via apiRoutes. Keeps this file a pure-logic module.
  (mastra as unknown as { __approval: typeof handlers }).__approval = handlers;
}

export function getApprovalHandlers(mastra: Mastra) {
  return (mastra as unknown as { __approval?: {
    approve: (b: ApprovalPayload) => Promise<Response>;
    decline: (b: ApprovalPayload) => Promise<Response>;
  } }).__approval;
}
