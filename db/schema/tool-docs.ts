import { pgTable, text, timestamp, vector, index, uniqueIndex } from "drizzle-orm/pg-core";

// RAG source — 4 MCP servers in Phase 1 (D-18): notion, linear, playwright, sentry.
// Embedding dims come from EMBED_DIMS env (1536 default — OpenAI text-embedding-3-small).
export const toolDocs = pgTable(
  "tool_docs",
  {
    id: text("id").primaryKey(),
    tool: text("tool").notNull(),
    version: text("version").notNull(),                              // semver of the MCP package
    section: text("section").notNull(),                              // e.g. 'install', 'tools.search'
    content: text("content").notNull(),
    source_url: text("source_url"),
    fetched_at: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [
    // HNSW index for cosine distance — Phase 1 scale is small; defaults are fine.
    index("tool_docs_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    uniqueIndex("tool_docs_section_uniq").on(t.tool, t.version, t.section),
  ],
);

export type ToolDocRow = typeof toolDocs.$inferSelect;
export type ToolDocInsert = typeof toolDocs.$inferInsert;
