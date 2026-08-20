import { Agent } from "@mastra/core/agent";
import type { ToolApprovalContext } from "@mastra/core/tools";
import { echoTool } from "../tools/echo";
import { createNoteTool } from "../tools/create-note";
import { applyMigrationsTool } from "../tools/apply-migrations";
import { resolveApproval, loadActiveGrants, type ApprovalMode } from "../lib/approval";

// D-02: OpenCode Zen Go provider. Iterated from Nemotron 3 Ultra (premature stream close)
// → GLM 5.2 (rate-limited) → Poolside Laguna S 2.1 (also prematurely closed). OpenCode Go
// is the current stable choice; see https://mastra.ai/models/providers/opencode-go.
// D-21 (research): `maxSteps: 4-6` keeps free-tier tool-call degradation from derailing long runs.
// Mastra 1.60: the `gateway` field was removed from the model config object; pass a
// `provider/model` string and Mastra auto-routes via the provider registry.
// `modelSettings: { maxTokens }` moved off the agent config — Mastra 1.60 only accepts
// it inside a model-fallbacks array. Per-call `agent.stream(messages, { maxTokens })` covers it.
export const sdlcAgent = new Agent({
  id: "sdlcAgent",
  name: "SDLC Agent",
  instructions:
    "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
    "createNote (write_low), and applyMigrations (write_high). Use createNote when the user asks for a note; " +
    "use applyMigrations when the user asks to migrate. For everything else, answer from chat.",
  model: "opencode-go/hy3",
  tools: { echoTool, createNoteTool, applyMigrationsTool },
});

// Per-call `requireToolApproval` resolver (Mastra 1.60 signature).
// Honors session-wide approvalMode (from AutoApproveToggle) and active approval_grants (5-min batch button).
// 'always' from resolveApproval() maps to true (gate the call); false/true map through unchanged.
export async function toolApprovalResolver(
  ctx: ToolApprovalContext,
): Promise<boolean> {
  const rc = (ctx.requestContext ?? {}) as { approvalMode?: ApprovalMode };
  const grants = await loadActiveGrants();
  return resolveApproval(ctx.toolName, { approvalMode: rc.approvalMode, grants }) === "always";
}
