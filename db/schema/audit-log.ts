import { pgTable, text, timestamp, index, bigint } from "drizzle-orm/pg-core";

// Canonical audit_log — 11 columns, locked here. Every other plan reads this list.
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    tool_name: text("tool_name").notNull(),
    args_json: text("args_json"),                                    // redacted before write (M7)
    result_status: text("result_status").notNull(),                  // 'ok' | 'error' | 'denied'
    approval_decision: text("approval_decision"),                    // 'auto' | 'user_allow' | 'user_deny' | null
    tokens_in: bigint("tokens_in", { mode: "number" }),
    tokens_out: bigint("tokens_out", { mode: "number" }),
    duration_ms: bigint("duration_ms", { mode: "number" }).notNull(),
    tool_doc_rows_consumed: bigint("tool_doc_rows_consumed", { mode: "number" }),
  },
  (t) => [index("audit_log_session_ts").on(t.session_id, t.ts)],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type AuditLogInsert = typeof auditLog.$inferInsert;
