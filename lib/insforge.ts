import "dotenv/config";
import { createClient, type InsforgeClient } from "@insforge/sdk";

// Single-user mode (D-22 / BCK-02). Server-side only — never expose to browser.
let _client: InsforgeClient | null = null;

export function insforge(): InsforgeClient {
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
