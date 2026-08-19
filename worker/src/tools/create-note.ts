import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { withAudit } from "@/worker/src/lib/audit";

// 01-04a — write_low placeholder. Real write goes through the Notion MCP in
// Phase 2; for Phase 1 this returns the captured text so the HITL gate has
// a working target. The audit row carries tool_name='createNote' so the
// verify commands and per-tool dashboards can find it.
const inner = withAudit("createNote", "write_low", async ({ text }: { text: string }) => ({
  note: text,
  created: true,
}));

export const createNoteTool = createTool({
  id: "createNote",
  description:
    "Create a short note (Phase 1 stub: returns the text as `note` and `created: true`). Real Notion write lands in Phase 2.",
  inputSchema: z.object({ text: z.string().min(1).max(500) }),
  execute: inner,
});
