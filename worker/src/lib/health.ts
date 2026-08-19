import { registerApiRoute } from "@mastra/core/server";

// /api/health — UI-07 banner + smoke assertion.
// D-06: per-stage lazy MCP loading means the four Phase-1 MCPs are `not_loaded` until the user picks a stage.
// Real connectivity probe ships in 01-02b-mcp-lifecycle (Wave 2).
export const healthRoute = registerApiRoute("/api/health", {
  method: "GET",
  handler: async (c) => {
    const mastra = c.get("mastra");
    return c.json({
      worker_up: true,
      sessions_active: 0,
      mcp: {
        notion: "not_loaded",
        linear: "not_loaded",
        playwright: "not_loaded",
        sentry: "not_loaded",
      },
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
