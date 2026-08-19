import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// UI-04 + D-07/D-08 anchor: localStorage sessionId maps to a Mastra threadId
// stored here. Worker looks up by `id` on resume.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  thread_id: text("thread_id"),                                     // nullable until first stream attaches
  resource_id: text("resource_id").notNull().default("operator"),   // single-user demo (D-22)
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
