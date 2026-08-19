import { NextRequest, NextResponse } from "next/server";

// 01-04 — decline endpoint. Records approval_decision='user_deny' in
// audit_log via the worker. The agent re-evaluates on the next user
// message and skips the tool call.

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

  return NextResponse.json({ ok: upstream.ok, status: upstream.status });
}
