import { Agent } from "@mastra/core/agent";
import { echoTool } from "../tools/echo";
import { createNoteTool } from "../tools/create-note";
import { applyMigrationsTool } from "../tools/apply-migrations";
import { resolveApproval, loadActiveGrants, type ApprovalMode } from "../lib/approval";

// D-02: Nemotron 3 Ultra free via OpenRouter. 1M context, 65K output, tool calling supported.
// D-21 (research): `maxSteps: 4-6` keeps free-tier tool-call degradation from derailing long runs.
export const sdlcAgent = new Agent({
  id: "sdlcAgent",
  name: "SDLC Agent",
  instructions:
    "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
    "createNote (write_low), and applyMigrations (write_high). Use createNote when the user asks for a note; " +
    "use applyMigrations when the user asks to migrate. For everything else, answer from chat.",
  model: {
    id: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    gateway: "openrouter",
  },
  modelSettings: { maxTokens: 8192 },
  tools: { echoTool, createNoteTool, applyMigrationsTool },
});

// Per-call `requireToolApproval` resolver. Honors session-wide approvalMode
// (from AutoApproveToggle) and active approval_grants (5-min batch button).
export async function toolApprovalResolver(
  toolName: string,
  ctx?: { approvalMode?: ApprovalMode },
): Promise<boolean | "always"> {
  const grants = await loadActiveGrants();
  return resolveApproval(toolName, { approvalMode: ctx?.approvalMode, grants });
}
