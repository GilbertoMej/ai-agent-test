import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { withAudit } from "../lib/audit";

// Phase 1 tracer tool. `echo` is read-class — auto-approved, never prompts the user.
// Real tool inventory ships in Phase 2+ (Notion, Linear, Playwright, Sentry).
// 01-E3: wrap execute with withAudit so audit_log gets one row per call without
// the caller hand-inserting. classify('read') drives approval_decision='auto'.
// `execute` signature stays (input, options) — withAudit passes ctx through to fn.
const echoExecute = withAudit(
  "echo",
  "read",
  async ({ message }: { message: string }) => ({ text: `echo:${message}` }),
);

export const echoTool = createTool({
  id: "echo",
  description: "Echo the input back with a `echo:` prefix. Used by the Phase 1 tracer to prove the round-trip works end-to-end.",
  inputSchema: z.object({
    message: z.string().min(1).max(2000),
  }),
  // D-13: hardcoded read class — no requireApproval flag needed here; classification lives in classify().
  execute: echoExecute,
});
