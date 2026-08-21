import { Agent } from "@mastra/core/agent";
import type { ToolApprovalContext } from "@mastra/core/tools";
import { echoTool } from "../tools/echo";
import { createNoteTool } from "../tools/create-note";
import { applyMigrationsTool } from "../tools/apply-migrations";
import { ragQueryTool } from "../tools/rag-query";
import { resolveApproval, loadActiveGrants, type ApprovalMode } from "../lib/approval";

// D-02: OpenCode Zen Go provider. Iterated from Nemotron 3 Ultra (premature stream close)
// → GLM 5.2 (rate-limited) → Poolside Laguna S 2.1 (also prematurely closed). OpenCode Go
// is the current stable choice; see https://mastra.ai/models/providers/opencode-go.
// D-21 (research): `maxSteps: 4-6` keeps free-tier tool-call degradation from derailing long runs.
// Mastra 1.60: the `gateway` field was removed from the model config object; pass a
// `provider/model` string and Mastra auto-routes via the provider registry.
// `modelSettings: { maxTokens }` moved off the agent config — Mastra 1.60 only accepts
// it inside a model-fallbacks array. Per-call `agent.stream(messages, { maxTokens })` covers it.
// Key -> tool id, derived from the tools object so classify() (which matches
// IDs) always sees the canonical name. Mastra 1.60 passes the property KEY
// (e.g. ragQueryTool) to the approval resolver, not the id (rag_query) — without
// this mapping rag_query normalizes to "ragQuery", misses classify(), and falls
// through to write_high, gating RAG in every mode.
const tools = { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool };

export const sdlcAgent = new Agent({
  id: "sdlcAgent",
  name: "SDLC Agent",
  instructions:
    "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
    "rag_query (read), createNote (write_low), and applyMigrations (write_high). " +
    "Call rag_query BEFORE invoking any MCP tool whose usage you are unsure about — it returns the top-5 tool_docs rows relevant to the user's request. " +
    "Use createNote when the user asks for a note; use applyMigrations when the user asks to migrate. " +
    "For everything else, answer from chat.",
  model: "opencode-go/hy3",
  tools,
});

// Mastra 1.60 passes the property KEY (e.g. "ragQueryTool") to
// ToolApprovalContext, not the tool's `id` ("rag_query"). classify() matches
// ids, so normalizeToolName maps key -> id (TOOL_KEY_TO_ID below) before
// classifying. Without it, rag_query normalizes to "ragQuery", misses
// classify(), falls through to write_high, and the resolver gates RAG.
const TOOL_KEY_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(tools).map(([k, v]) => [k, (v as { id: string }).id]),
) as Record<string, string>;

function normalizeToolName(n: string): string {
  return TOOL_KEY_TO_ID[n] ?? (n.endsWith("Tool") ? n.slice(0, -4) : n);
}

// Per-call `requireToolApproval` resolver (Mastra 1.60 signature).
// Honors session-wide approvalMode (from AutoApproveToggle) and active approval_grants (5-min batch button).
// 'always' from resolveApproval() maps to true (gate the call); false/true map through unchanged.
export async function toolApprovalResolver(
  ctx: ToolApprovalContext,
): Promise<boolean> {
  // Mastra 1.60 passes the RequestContext class instance at runtime — values
  // live in a private Map and are reachable only via .getRaw(key). Property
  // access always returns undefined. The .approvalMode fallback covers the
  // plain-object shape that the SDK type docstring promises, in case a future
  // version switches to it.
  const rc = (ctx.requestContext ?? {}) as {
    getRaw?: (k: string) => unknown;
    approvalMode?: ApprovalMode;
  };
  const raw = rc.getRaw?.("approvalMode");
  const approvalMode = (raw ?? rc.approvalMode) as ApprovalMode | undefined;
  const grants = await loadActiveGrants();
  const toolName = normalizeToolName(ctx.toolName);
  console.log(`[approval-resolver] tool=${toolName} mode=${approvalMode ?? "undef"}`);
  return resolveApproval(toolName, { approvalMode, grants }) === "always";
}
