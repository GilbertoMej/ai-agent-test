import { NextRequest, NextResponse } from "next/server";

// 01-04 + 01-11 — approve endpoint.
// Records the decision via the worker (so audit_log.approval_decision lands
// against the right session/tool). When `pattern` is supplied, also writes
// an approval_grants row for the 5-min batch button (D-12).

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const workerUrl = process.env.WORKER_URL ?? "http://localhost:4111";
  const secret = process.env.WORKER_SHARED_SECRET;

  const upstream = await fetch(`${workerUrl}/approval/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      toolCallId: body.toolCallId,
      toolName: body.toolName,
      args: body.args,
      tier: body.tier,
      pattern: body.pattern,
      sessionId: body.sessionId,
    }),
  });

  return NextResponse.json({ ok: upstream.ok, status: upstream.status });
}
