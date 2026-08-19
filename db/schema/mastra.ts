import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Mastra PostgresStore tables. Names verified against @mastra/pg v1.21.0
// (see RESEARCH.md §1.2). Created here so PostgresStore boots without the
// "table not found" error on a fresh database.
//
// Schema mirrors the documented Mastra memory layout:
//   - mastra_threads   — one row per agent conversation thread
//   - mastra_messages  — one row per message in a thread
//   - mastra_snapshots — workflow / run snapshots for suspend/resume (D-07/D-08)
//   - mastra_workflows — workflow metadata
//   - mastra_evals     — eval result rows
//   - mastra_traces    — observability trace rows
//
// ponytail: column shapes match Mastra's minimal schema; if a future Mastra
// release adds columns, the migration must catch up.

export const mastraThreads = pgTable(
  "mastra_threads",
  {
    id: text("id").primaryKey(),
    resource_id: text("resource_id").notNull(),
    title: text("title"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mastra_threads_resource_idx").on(t.resource_id, t.updated_at)],
);

export const mastraMessages = pgTable(
  "mastra_messages",
  {
    id: text("id").primaryKey(),
    thread_id: text("thread_id").notNull(),
    role: text("role").notNull(),
    content: jsonb("content").notNull(),
    type: text("type"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mastra_messages_thread_idx").on(t.thread_id, t.created_at)],
);

export const mastraSnapshots = pgTable(
  "mastra_snapshots",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id").notNull(),
    workflow_name: text("workflow_name").notNull(),
    step_id: text("step_id"),
    snapshot: jsonb("snapshot").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mastra_snapshots_run_idx").on(t.run_id, t.created_at)],
);

export const mastraWorkflows = pgTable(
  "mastra_workflows",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const mastraEvals = pgTable(
  "mastra_evals",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    result: jsonb("result").notNull(),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const mastraTraces = pgTable(
  "mastra_traces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    run_id: text("run_id"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);
