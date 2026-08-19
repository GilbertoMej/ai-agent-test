import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Phase 1 tracer tool. `echo` is read-class — auto-approved, never prompts the user.
// Real tool inventory ships in Phase 2+ (Notion, Linear, Playwright, Sentry).
export const echoTool = createTool({
  id: "echo",
  description: "Echo the input back with a `echo:` prefix. Used by the Phase 1 tracer to prove the round-trip works end-to-end.",
  inputSchema: z.object({
    message: z.string().min(1).max(2000),
  }),
  // D-13: hardcoded read class — no requireApproval flag needed here; classification lives in classify().
  execute: async ({ message }) => ({ text: `echo:${message}` }),
});
