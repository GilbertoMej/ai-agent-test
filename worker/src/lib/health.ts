import { registerApiRoute } from "@mastra/core/server";
import { probeAll } from "../mcp/health-probe";

// /api/health — UI-07 banner + smoke assertion.
// Per-server status comes from the lifecycle probe, not env-var presence (01-02b).
// 01-07 — explicit token presence + uptime_s so the banner can flip red when the worker stops.
// ponytail: tokens read at request time, not cached — single env-var check is cheaper than a Map.
export const healthRoute = registerApiRoute("/api/health", {
  method: "GET",
  handler: async (c) => {
    const mastra = c.get("mastra");
    const mcp = await probeAll();
    return c.json({
      worker_up: true,
      sessions_active: 0,
      mcp,
      tokens: {
        openrouter_key_present: !!process.env.OPENROUTER_API_KEY,
        insforge_key_present: !!process.env.INSFORGE_SERVICE_KEY,
        database_url_present: !!process.env.DATABASE_URL,
      },
      uptime_s: Math.round(process.uptime()),
      mastra_loaded: !!mastra,
    });
  },
});
