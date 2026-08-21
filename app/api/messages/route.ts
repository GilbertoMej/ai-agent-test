import { NextResponse } from "next/server";

// 01-Q — Next.js proxy to the worker's GET /sessions/:id/messages.
// Browser fetches this route; the proxy forwards to the worker with bearer auth.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") ?? "anon";
  const workerUrl = process.env.WORKER_URL ?? "http://localhost:4111";
  const secret = process.env.WORKER_SHARED_SECRET;
  try {
    const r = await fetch(`${workerUrl}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await r.json();
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ messages: [] }, { status: 200 });
  }
}
