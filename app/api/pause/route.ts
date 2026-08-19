import { NextRequest, NextResponse } from "next/server";

// 01-13 / D-07 — Next.js pause endpoint. Receives {sessionId} from the
// browser's beforeunload beacon and forwards it to the worker.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const workerUrl = process.env.WORKER_URL ?? "http://localhost:4111";
  const secret = process.env.WORKER_SHARED_SECRET;

  let sessionId = "";
  try {
    const body = await req.json();
    sessionId = String((body as { sessionId?: unknown }).sessionId ?? "");
  } catch {
    /* sendBeacon may send empty body if the page closes before blob flush */
  }

  try {
    const r = await fetch(`${workerUrl}/pause`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ sessionId }),
    });
    return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
