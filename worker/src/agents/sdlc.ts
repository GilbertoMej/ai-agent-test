import { Agent } from "@mastra/core/agent";
import type { Tool, ToolApprovalContext } from "@mastra/core/tools";
import { MCPClient } from "@mastra/mcp";
import { join } from "node:path";
import { getActiveNotionToken } from "../lib/notion-oauth";
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

// Phase-1 local tools. Notion MCP tools are merged in at agent-build time
// (createSdlcAgent) when NOTION_TOKEN is configured, so the builder is async.
const localTools = { echoTool, createNoteTool, applyMigrationsTool, ragQueryTool };

// Absolute path to the installed Notion MCP server binary. The worker launches
// from the repo root (pnpm dev), so cwd-relative resolution is stable; joining
// with process.cwd() makes it absolute regardless.
const notionBin = join(process.cwd(), "node_modules/@notionhq/notion-mcp-server/bin/cli.mjs");

// Builds the agent with local + Notion MCP tools merged. Async because the MCP
// client connects lazily on listTools(); the agent can't be a module-level const
// under CJS (top-level await is invalid — see index.ts 01-G1).
export async function createSdlcAgent(): Promise<Agent> {
  const notionTools = await loadNotionTools();
  const tools = { ...localTools, ...notionTools } as Record<string, Tool>;
  return new Agent({
    id: "sdlcAgent",
    name: "SDLC Agent",
    instructions:
      "You are the SDLC Playground agent. For Phase 1 (Walking Skeleton), you have echo (read), " +
      "rag_query (read), createNote (write_low), and applyMigrations (write_high). " +
      "Call rag_query BEFORE invoking any MCP tool whose usage you are unsure about — it returns the top-5 tool_docs rows relevant to the user's request. " +
      "When the user works with Notion (pages, databases, blocks, search), use the Notion MCP tools. " +
      "Use createNote when the user asks for a note; use applyMigrations when the user asks to migrate. " +
      "For everything else, answer from chat.",
    model: "opencode-go/hy3",
    tools,
  });
}

// Map Mastra's property key -> the tool's declared id so classify() matches.
// Derived from `localTools`; fallback strips a "Tool" suffix for any new tool.
// Notion MCP tools keep their own names (notion_*) and fall through classify()
// to write_high (gated) — expected for unmapped external tools.
const TOOL_KEY_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(localTools).map(([k, v]) => [k, (v as { id: string }).id]),
) as Record<string, string>;

function normalizeToolName(n: string): string {
  return TOOL_KEY_TO_ID[n] ?? (n.endsWith("Tool") ? n.slice(0, -4) : n);
}

// Self-host the official Notion MCP server (STDIO). mcp.notion.com is Notion's
// first-party MCP: its authorization_servers is ["https://mcp.notion.com"], so it
// only trusts tokens IT issues — our integration/OAuth token (from api.notion.com)
// is rejected there with invalid_token. The local server takes our token via
// OPENAPI_MCP_HEADERS and calls the Notion API directly, which accepts it.
// Auth: prefers the per-session OAuth token (set after Connect Notion), else a
// static NOTION_TOKEN. Returns {} when neither exists so boot degrades gracefully.
async function loadNotionTools(): Promise<Record<string, Tool>> {
  const token = getActiveNotionToken() ?? process.env.NOTION_TOKEN;
  if (!token) {
    console.warn("[notion-mcp] no Notion token (OAuth not connected and NOTION_TOKEN unset) — Notion MCP tools disabled");
    return {};
  }
  try {
    const client = new MCPClient({
      id: "notion",
      servers: {
        notion: {
          command: "node",
          // Run the installed binary directly (avoids `npx`, which hangs resolving
          // against pnpm's symlinked layout). notionBin is an absolute path.
          args: [notionBin],
          env: {
            ...process.env,
            OPENAPI_MCP_HEADERS: JSON.stringify({ Authorization: `Bearer ${token}` }),
          },
        },
      },
    });
    const tools = await client.listTools();
    console.log(`[notion-mcp] connected — ${Object.keys(tools).length} tools (local @notionhq/notion-mcp-server)`);
    return tools as Record<string, Tool>;
  } catch (e) {
    console.error(`[notion-mcp] failed to load: ${(e as Error).message}`);
    return {};
  }
}

// Live agent reference. Rebuilt after a successful Notion OAuth so the Notion
// MCP tools (which need a per-session token) become available without restart.
let currentAgent: Agent | null = null;

export async function getSdlcAgent(): Promise<Agent> {
  if (!currentAgent) currentAgent = await createSdlcAgent();
  return currentAgent;
}

export async function rebuildSdlcAgent(): Promise<Agent> {
  currentAgent = await createSdlcAgent();
  return currentAgent;
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
