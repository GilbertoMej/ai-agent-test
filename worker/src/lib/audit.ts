import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { redact } from "@/lib/redact";
import { classify, type ToolClass } from "./classify";

export { classify, type ToolClass };

// Module-scope sessionId carrier. Mastra 1.60's tool runner invokes
// createTool({execute}).execute(args) with a single arg — no ctx carrying
// requestContext. The stream route calls setAuditSessionId(sessionId) before
// agent.stream() so withAudit can read the value via resolveSessionId().
// This is a per-request set — the stream route MUST call it before every
// agent.stream() to avoid cross-session bleed.
let currentSessionId: string | undefined;
export function setAuditSessionId(sessionId: string | undefined): void {
  currentSessionId = sessionId;
}

// Optional fields a tool can attach to its audit_log row (01-05).
// rag_query populates tool_doc_rows_consumed; future tools can extend.
export type AuditExtras = { tool_doc_rows_consumed?: number };

// Wraps an async tool execute with audit_log writes. Per-tool call -> exactly one row.
// Tokens default to 0 here; patchTokens() updates them post-hoc from step-finish.totalUsage.
export function withAudit<TArgs, TRet>(
  toolId: string,
  classification: ToolClass,
  fn: (args: TArgs, ctx?: AuditToolContext) => Promise<TRet & Partial<AuditExtras>>,
) {
  return async (args: TArgs, ctx?: AuditToolContext): Promise<TRet> => {
    const sessionId = resolveSessionId(ctx);
    const start = Date.now();
    let status: "ok" | "error" = "ok";
    let out: TRet & Partial<AuditExtras> | undefined;
    try {
      out = await fn(args, ctx);
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
      try {
        await db.insert(auditLog).values({
          id: nanoid(),
          session_id: sessionId,
          tool_name: toolId,
          args_json: redact(args),
          result_status: status,
          approval_decision: classification === "read" ? "auto" : null,
          duration_ms: Date.now() - start,
          tool_doc_rows_consumed: extras.tool_doc_rows_consumed ?? null,
          // Default tokens to 0 so the column is IS NOT NULL even before patchTokens() runs.
          // patchTokens() updates the most-recent row for (session_id, tool_name) on step-finish.
          tokens_in: 0,
          tokens_out: 0,
        });
      } catch (e) {
        // ponytail: surface the failure loudly; do NOT re-throw — the tool has
        // already returned to the caller, and the chat stream must not break.
        // Without this, audit INSERT failures are silent (the stream outer
        // try/catch only console.logs and the row is missing from audit_log).
        console.error(`audit: insert failed tool=${toolId} session=${sessionId}`, e);
      }
    }
  };
}

// Tool-execution context — createTool.execute passes a 2nd arg; we accept the
// fields we care about and ignore the rest. sessionId wins over requestContext.
export type AuditToolContext = {
  sessionId?: string;
  requestContext?: { get?: (key: string) => unknown } | unknown;
};

function resolveSessionId(ctx: AuditToolContext | undefined): string {
  // Module-scope (set per-request by the stream route) wins over ctx.
  // Mastra 1.60's tool runner never delivers a 2nd-arg ctx to execute(),
  // so this is the path that actually fires in production.
  if (currentSessionId) return currentSessionId;
  if (ctx?.sessionId) return ctx.sessionId;
  const rc = ctx?.requestContext as { get?: (key: string) => unknown } | undefined;
  const fromRc = rc?.get?.("sessionId");
  if (typeof fromRc === "string" && fromRc.length > 0) return fromRc;
  return process.env.SESSION_ID ?? "anon";
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
