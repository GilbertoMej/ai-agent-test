import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
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

// Optional fields a tool can attach to its audit_log row (01-05).
// rag_query populates tool_doc_rows_consumed; future tools can extend.
export type AuditExtras = { tool_doc_rows_consumed?: number };

// Wraps an async tool execute with audit_log writes. Per-tool call -> exactly one row.
// Tokens are patched post-hoc from step-finish.totalUsage (no double-write here).
export function withAudit<TArgs, TRet>(
  toolId: string,
  classification: ToolClass,
  fn: (args: TArgs) => Promise<TRet & Partial<AuditExtras>>,
) {
  return async (args: TArgs): Promise<TRet> => {
    const start = Date.now();
    let status: "ok" | "error" = "ok";
    let out: TRet & Partial<AuditExtras>;
    try {
      out = await fn(args);
      return out;
    } catch (e) {
      status = "error";
      throw e;
    } finally {
      // Redact both args_json AND any result content that flows out (defensive — secrets should never reach logs).
      // The audit_log schema has no result_content column (locked 01-01a); we log the redacted result to console only.
      const redactedResult = redact(out as unknown);
      if (process.env.AUDIT_LOG_RESULTS === "1") {
        console.log(`audit: ${toolId} -> ${redactedResult}`);
      }
      const extras: AuditExtras = (out as Partial<AuditExtras>) ?? {};
      await db.insert(auditLog).values({
        id: nanoid(),
        session_id: process.env.SESSION_ID ?? "anon",
        tool_name: toolId,
        args_json: redact(args),
        result_status: status,
        approval_decision: classification === "read" ? "auto" : null,
        duration_ms: Date.now() - start,
        tool_doc_rows_consumed: extras.tool_doc_rows_consumed ?? null,
      });
    }
  };
}

// Called from the stream step-finish handler to patch the most-recent audit row
// for this session+tool with token counts.
export async function patchTokens(
  sessionId: string,
  toolId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE audit_log
    SET tokens_in = ${tokensIn}, tokens_out = ${tokensOut}
    WHERE id = (
      SELECT id FROM audit_log
      WHERE session_id = ${sessionId} AND tool_name = ${toolId}
      ORDER BY ts DESC LIMIT 1
    )
  `);
}
