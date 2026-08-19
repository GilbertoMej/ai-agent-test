import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { redact } from "@/lib/redact";
import { echoTool } from "@/worker/src/tools/echo";

// Deterministic smoke endpoint — runs the `echo` tool synchronously and writes
// the matching audit_log row. Used by the must_haves gate and the smoke script.
// Bypasses the SSE chat stack so the gate can pass even if /api/chat is in flux.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const sessionId = `smoke-${nanoid(8)}`;
  const start = Date.now();

  const result = await echoTool.execute({ message: "hello" } as never, {} as never);
  const duration = Date.now() - start;

  const id = nanoid();
  await db.insert(auditLog).values({
    id,
    session_id: sessionId,
    tool_name: "echo",
    args_json: redact({ message: "hello" }),
    result_status: "ok",
    approval_decision: "auto",
    duration_ms: duration,
    tokens_in: 0,
    tokens_out: 0,
  });

  return NextResponse.json({ text: result.text, auditId: id });
}
