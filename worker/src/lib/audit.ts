import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { redact } from "@/lib/redact";

// D-13: hardcoded per tool name. Refined in Phase 2-7 once real MCP tool names exist.
export type ToolClass = "read" | "write_low" | "write_high";

export function classify(toolName: string): ToolClass {
  if (toolName === "echo") return "read";
  // Phase 1 working set per research §2.1. Extend as MCPs ship.
  if (
    toolName.startsWith("get_") ||
    toolName.startsWith("list_") ||
    toolName.startsWith("search_") ||
    toolName.startsWith("preview_") ||
    toolName === "rag_query"
  )
    return "read";
  if (
    toolName === "write_file" ||
    toolName === "git_commit" ||
    toolName === "run_tests" ||
    toolName === "sandbox_e2e"
  )
    return "write_low";
  return "write_high";
}

// Wraps an async tool execute with audit_log writes. Per-tool call → exactly one row.
// Tokens are patched post-hoc from step-finish.totalUsage (no double-write here).
export function withAudit<TArgs, TRet>(
  toolId: string,
  classification: ToolClass,
  fn: (args: TArgs) => Promise<TRet>,
) {
  return async (args: TArgs): Promise<TRet> => {
    const start = Date.now();
    let status: "ok" | "error" = "ok";
    let out: TRet;
    try {
      out = await fn(args);
      return out;
    } catch (e) {
      status = "error";
      throw e;
    } finally {
      await db.insert(auditLog).values({
        id: nanoid(),
        session_id: process.env.SESSION_ID ?? "anon",
        tool_name: toolId,
        args_json: redact(args),
        result_status: status,
        approval_decision: classification === "read" ? "auto" : null,
        duration_ms: Date.now() - start,
      });
    }
  };
}

// Called from the stream step-finish handler to patch the most-recent audit row
// for this session+tool with token counts. Returns the row id.
export async function patchTokens(
  sessionId: string,
  toolId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  // Postgres bigint mode: number is fine in JS until ~2^53.
  await db.execute(
    // Drizzle's sql-tag is fine here; raw call keeps the patch simple.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import("drizzle-orm")).sql`
      UPDATE audit_log
      SET tokens_in = ${tokensIn}, tokens_out = ${tokensOut}
      WHERE id = (
        SELECT id FROM audit_log
        WHERE session_id = ${sessionId} AND tool_name = ${toolId}
        ORDER BY ts DESC LIMIT 1
      )
    ` as any,
  );
}
