import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// D-12: "Approve all matching for 5 min" writes a transient grant row.
// requireToolApproval() checks this before the tier classifier.
export const approvalGrants = pgTable(
  "approval_grants",
  {
    id: text("id").primaryKey(),
    pattern: text("pattern").notNull(),                              // tool-name glob
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("approval_grants_expires").on(t.expires_at)],
);

export type ApprovalGrantRow = typeof approvalGrants.$inferSelect;
export type ApprovalGrantInsert = typeof approvalGrants.$inferInsert;
