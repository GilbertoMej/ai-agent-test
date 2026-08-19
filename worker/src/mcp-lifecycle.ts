import { MCPClient } from "@mastra/mcp";

// Per-server MCP config shape (subset of @mastra/mcp config). Phase-1 servers: notion / linear / playwright / sentry.
export type McpServerSpec = {
  id: "notion" | "linear" | "playwright" | "sentry";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

// Bounded reconnect: 3 attempts, 1s/2s/4s backoff (C1 mitigation).
// ponytail: per-server cache is a Map; eviction happens only on explicit reload. global lock, per-server locks if throughput matters.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MCPLifecycle {
  private cache = new Map<string, Record<string, unknown>>();
  // Last known probe state per server. Surfaced by /api/health for the UI banner.
  private state = new Map<string, "connected" | "failed" | "not_loaded">();

  constructor(private servers: McpServerSpec[]) {
    for (const s of servers) this.state.set(s.id, "not_loaded");
  }

  getState(id: McpServerSpec["id"]) {
    return this.state.get(id) ?? "not_loaded";
  }

  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.state) out[k] = v;
    return out;
  }

  // listTools() with cache + retry-with-reconnect on stdio pipe death.
  async listTools(id: McpServerSpec["id"], forceRefresh = false): Promise<Record<string, unknown>> {
    if (!forceRefresh && this.cache.has(id)) return this.cache.get(id)!;
    const spec = this.servers.find((s) => s.id === id);
    if (!spec) throw new Error(`unknown mcp server: ${id}`);
    return this.connect(spec, 0);
  }

  private async connect(spec: McpServerSpec, attempt: number): Promise<Record<string, unknown>> {
    try {
      // inheritDefaultEnv: false prevents host env from leaking into the MCP child (open question #2).
      const client = new MCPClient({
        id: spec.id,
        servers: { [spec.id]: { command: spec.command, args: spec.args ?? [], env: spec.env ?? {}, inheritDefaultEnv: false } },
      });
      const tools = await client.listTools();
      const flat: Record<string, unknown> = {};
      for (const [name, t] of Object.entries(tools as Record<string, unknown>)) flat[name] = t;
      this.cache.set(spec.id, flat);
      this.state.set(spec.id, "connected");
      return flat;
    } catch (e) {
      if (attempt >= 2) {
        this.state.set(spec.id, "failed");
        throw e;
      }
      await sleep(1000 * 2 ** attempt); // 1s, 2s, 4s
      return this.connect(spec, attempt + 1);
    }
  }

  // Force the next listTools() call to reconnect (e.g. after an explicit health probe failure).
  invalidate(id: McpServerSpec["id"]) {
    this.cache.delete(id);
    this.state.set(id, "not_loaded");
  }
}

let _instance: MCPLifecycle | null = null;
export function mcpLifecycle(servers: McpServerSpec[] = DEFAULT_SERVERS): MCPLifecycle {
  if (_instance) return _instance;
  _instance = new MCPLifecycle(servers);
  return _instance;
}

// Default Phase-1 server set. Real commands are filled in by Phase 2-7; the lifecycle is the contract.
export const DEFAULT_SERVERS: McpServerSpec[] = [
  { id: "notion", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"] },
  { id: "linear", command: "npx", args: ["-y", "@tacticlaunch/mcp-linear"] },
  { id: "playwright", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
  { id: "sentry", command: "npx", args: ["-y", "@sentry/mcp-server@latest"] },
];
