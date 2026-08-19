import { Agent } from "@mastra/core/agent";
import { echoTool } from "../tools/echo";
import { classify } from "../lib/audit";

// D-02: Nemotron 3 Ultra free via OpenRouter. 1M context, 65K output, tool calling supported.
// D-21 (research): `maxSteps: 4-6` keeps free-tier tool-call degradation from derailing long runs.
export const sdlcAgent = new Agent({
  id: "sdlcAgent",
  name: "SDLC Agent",
  instructions:
    "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), the only tool you have is `echo`. " +
    "When the user sends a message, call the echo tool with their message and return the result verbatim.",
  model: {
    id: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    gateway: "openrouter",
  },
  modelSettings: { maxTokens: 8192 },
  tools: { echoTool },
});

// Per-call `requireToolApproval` resolver. Phase 1 only has read tools so this
// is effectively a no-op, but the shape is locked here for Phase 2+ (write_low/write_high).
export function toolApprovalResolver(
  toolName: string,
): boolean | "always" {
  const cls = classify(toolName);
  if (cls === "read") return false;          // auto-approve
  return "always";                            // pause for card
}
