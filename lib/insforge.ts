import { config as loadEnv } from "dotenv";

loadEnv();                              // .env
loadEnv({ path: ".env.local" });        // .env.local wins

import { createClient, type InsforgeClient } from "@insforge/sdk";

// Single-user mode (D-22 / BCK-02). Server-side only — never expose to browser.
let _client: InsforgeClient | null = null;

// BCK-05 / 01-12 — guard InsForge-specific helpers when BACKEND_PROVIDER=supabase.
// The InsForge SDK is only available against an InsForge project; on the Supabase
// path embeddings still go through OpenRouter (worker/src/lib/rag.ts), so callers
// that need the SDK must check `backendProvider === "insforge"` first.
export function insforge(): InsforgeClient {
  if (process.env.BACKEND_PROVIDER === "supabase") {
    throw new Error("insforge() unavailable: BACKEND_PROVIDER=supabase. Use OpenRouter embeddings instead.");
  }
  if (_client) return _client;
  const baseUrl = process.env.INSFORGE_BASE_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error(
      "INSFORGE_BASE_URL and INSFORGE_SERVICE_KEY are required for embeddings + InsForge helpers.",
    );
  }
  _client = createClient({ baseUrl, serviceKey });
  return _client;
}
