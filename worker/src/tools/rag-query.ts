import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { withAudit } from "@/worker/src/lib/audit";
import { retrieve, formatContext } from "@/worker/src/lib/rag";

// 01-06 — rag_query tool. Read-class (already wired in audit.classify()).
// Populates audit_log.tool_doc_rows_consumed via AuditExtras.
const inner = withAudit(
  "rag_query",
  "read",
  async ({ query }: { query: string }) => {
    const hits = await retrieve(query);
    return { context: formatContext(hits), tool_doc_rows_consumed: hits.length };
  },
);

export const ragQueryTool = createTool({
  id: "rag_query",
  description:
    "Retrieve tool documentation relevant to the user's request. Returns a context string built from the top-5 tool_docs rows (cosine distance). Use BEFORE calling any MCP tool whose usage you are unsure about.",
  inputSchema: z.object({
    query: z.string().min(1).max(2000),
  }),
  execute: inner,
});
