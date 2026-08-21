import { NextRequest } from "next/server";

// 01-04 — decline endpoint. Records approval_decision='user_deny' in
// audit_log via the worker. The agent re-evaluates on the next user
// message and skips the tool call.
// 01-Y — worker /approval/decline now returns SSE (the resumed stream
// emits tool-error + assistant follow-up text). Forward upstream body
// verbatim. ChatPanel reloads the page after the POST resolves so the
// user sees the assistant's "I cannot proceed with that action" reply.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const workerUrl = process.env.WORKER_URL ?? "http://localhost:4111";
  const secret = process.env.WORKER_SHARED_SECRET;

  const upstream = await fetch(`${workerUrl}/approval/decline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      toolCallId: body.toolCallId,
      toolName: body.toolName,
      args: body.args,
      reason: body.reason ?? "user denied",
      sessionId: body.sessionId,
    }),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
