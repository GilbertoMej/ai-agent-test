import { NextResponse } from "next/server";

// Proxy to worker /api/health with the shared secret. Returns the JSON body verbatim.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const workerUrl = process.env.WORKER_URL ?? "http://localhost:4111";
  const secret = process.env.WORKER_SHARED_SECRET;

  try {
    const r = await fetch(`${workerUrl}/api/health`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const body = await r.json();
    return NextResponse.json(body, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { worker_up: false, error: (e as Error).message },
      { status: 503 },
    );
  }
}
