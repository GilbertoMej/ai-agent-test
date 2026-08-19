import { NextResponse } from "next/server";
import { echoTool } from "@/worker/src/tools/echo";

// Deterministic smoke endpoint — runs the `echo` tool synchronously.
// 01-E3: withAudit() inside echoTool writes the audit_log row automatically,
// so this route no longer hand-inserts. sessionId flows via ctx so the audit
// row is queryable under the smoke session.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const sessionId = `smoke-${Date.now().toString(36)}`;
  const result = (await echoTool.execute!(
    { message: "hello" },
    { sessionId } as never,
  )) as { text: string };
  return NextResponse.json({ text: result.text, sessionId });
}
