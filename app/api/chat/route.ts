import { NextRequest } from "next/server";

// SSE relay: Next.js → worker. D-22 Bearer auth on every call.
// Pattern verified at nextjs.org/docs/app/api-reference/file-conventions/route (Streaming).
// 01-11 — threads approvalMode + sessionId through to the worker's requireToolApproval.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, threadId, approvalMode, sessionId } = body;
  const workerUrl = process.env.WORKER_URL ?? "http://localhost:4111";
  const secret = process.env.WORKER_SHARED_SECRET;

  const upstream = await fetch(`${workerUrl}/agents/sdlcAgent/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      messages,
      threadId,
      resourceId: "operator",
      approvalMode,
      sessionId,
    }),
  });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
