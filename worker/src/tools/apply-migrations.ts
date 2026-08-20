import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { withAudit } from "@/worker/src/lib/audit";

// 01-04b — write_high placeholder. The tool always records { attempted: true,
// rowsAffected: 0 } — approval is what gates execution, not the tool itself.
// Real applyMigrations lands in Phase 6 against the sandbox repo.
const inner = withAudit("applyMigrations", "write_high", async () => ({
  attempted: true,
  rowsAffected: 0,
}));

export const applyMigrationsTool = createTool({
  id: "applyMigrations",
  description:
    "Apply pending database migrations. Phase 1 stub: returns { attempted: true, rowsAffected: 0 }. " +
    "The harness pauses for human approval before execution — do not invent any additional gate.",
  inputSchema: z.object({}),
  execute: inner,
});
