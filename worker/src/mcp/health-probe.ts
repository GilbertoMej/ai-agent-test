import { mcpLifecycle, type McpServerSpec } from "../mcp-lifecycle";

// Per-server ping with a 2s deadline. Returns deterministic status from the lifecycle, not env-var presence.
// ponytail: races listTools() against setTimeout; the timeout promise wins after 2s.
const PROBE_TIMEOUT_MS = 2_000;

export async function probe(server: McpServerSpec["id"]): Promise<"connected" | "failed" | "not_loaded"> {
  const lc = mcpLifecycle();
  // If the lifecycle has a cached tool list, we already know it's connected — skip the probe.
  if (lc.getState(server) === "connected") return "connected";
  const timeout = new Promise<"failed">((r) => setTimeout(() => r("failed"), PROBE_TIMEOUT_MS));
  const probe = (async (): Promise<"connected" | "failed"> => {
    try {
      await lc.listTools(server);
      return "connected";
    } catch {
      return "failed";
    }
  })();
  return Promise.race([probe, timeout]);
}

export async function probeAll(): Promise<Record<string, string>> {
  const ids: McpServerSpec["id"][] = ["notion", "linear", "playwright", "sentry"];
  const results = await Promise.all(ids.map(async (id) => [id, await probe(id)] as const));
  return Object.fromEntries(results);
}
