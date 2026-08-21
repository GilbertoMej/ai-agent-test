import { NextRequest } from "next/server";

// 01-04 + 01-11 — approve endpoint.
// Records the decision via the worker (so audit_log.approval_decision lands
// against the right session/tool). When `pattern` is supplied, also writes
// an approval_grants row for the 5-min batch button (D-12).
// 01-Y — worker /approval/approve now returns SSE (the resumed
// MastraModelOutput.fullStream). Forward the upstream body verbatim so the
// client gets the tool-result + assistant follow-up text. ChatPanel does not
// pipe the body (window.location.reload after the POST resolves) — the SSE
// is consumed only by the browser-level response; the React fetch await
// resolves once headers arrive.

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

  // ponytail: forward the upstream body unchanged. Headers propagate the SSE
  // content-type + no-cache + connection: keep-alive so the browser parses
  // each `data: { ... }` event as it arrives.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
