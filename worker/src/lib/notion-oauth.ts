import type { MastraFetchLike } from "@mastra/mcp";

// Notion OAuth (authorization-code flow) for the hosted MCP at https://mcp.notion.com/mcp.
// Replaces the static NOTION_TOKEN: the UI redirects the user to Notion, Notion redirects
// back with a `code`, we exchange it for an access token, and the token is injected
// per-request into the MCP client via a custom `fetch` (keyed by sessionId).
//
// ponytail: env vars are read at CALL time, not captured in module-level consts. ES module
// imports are hoisted and execute BEFORE index.ts's dotenv block, so a top-level
// `const CLIENT_ID = process.env.NOTION_CLIENT_ID` would capture `undefined` and stay wrong
// even after dotenv loads worker/.env. Reading inside each function avoids that trap.

const AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.notion.com/v1/oauth/token";

function notionCreds(): { clientId?: string; clientSecret?: string } {
  return {
    clientId: process.env.NOTION_CLIENT_ID,
    clientSecret: process.env.NOTION_CLIENT_SECRET,
  };
}

// ponytail: in-memory token store keyed by sessionId. Single-process worker demo;
// swap for the DB sessions table if multi-instance or token persistence is needed.
const tokens = new Map<string, { accessToken: string; savedAt: number }>();

export function notionOAuthConfigured(): boolean {
  const { clientId, clientSecret } = notionCreds();
  return Boolean(clientId && clientSecret);
}

export function getNotionToken(sessionId: string): string | undefined {
  return tokens.get(sessionId)?.accessToken;
}

export function buildNotionAuthUrl(sessionId: string): string {
  const { clientId } = notionCreds();
  const redirectUri = process.env.NOTION_REDIRECT_URI ?? "http://localhost:4111/oauth/notion/callback";
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", clientId!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("owner", "user");
  u.searchParams.set("state", sessionId);
  return u.toString();
}

export async function exchangeNotionCode(code: string): Promise<string> {
  const { clientId, clientSecret } = notionCreds();
  const redirectUri = process.env.NOTION_REDIRECT_URI ?? "http://localhost:4111/oauth/notion/callback";
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`notion token exchange: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export function storeNotionToken(sessionId: string, accessToken: string): void {
  tokens.set(sessionId, { accessToken, savedAt: Date.now() });
}

// Most-recently stored OAuth token — seeds the local Notion MCP server's auth at
// agent-build time (no session context yet). Single-user demo; per-session routing
// if multi-user ships.
export function getActiveNotionToken(): string | undefined {
  return getFallbackToken();
}

export function notionRedirectTarget(): string {
  return process.env.WEB_URL ?? "http://localhost:3000";
}

// Single-user demo: a token is needed before any sessionId is in scope — e.g.
// MCPClient.listTools() at agent-build time runs with no request context. Fall back
// to the most-recently stored token so the Notion MCP tools still load. (ponytail:
// ambiguous for multi-session; replace with per-session routing if that ships.)
function getFallbackToken(): string | undefined {
  let latest: { accessToken: string; savedAt: number } | undefined;
  for (const v of tokens.values()) {
    if (!latest || v.savedAt > latest.savedAt) latest = v;
  }
  return latest?.accessToken;
}

// Custom fetch for the Notion MCP client: injects the session's OAuth access token.
// The 3rd arg is the request-scoped context (we set sessionId via requestContext in the
// chat handler), so the right token is used per request when present; otherwise the
// fallback token keeps build-time calls (listTools) authenticated.
export const notionFetch: MastraFetchLike = (url, init, requestContext) => {
  const sessionId = (requestContext as unknown as { get?: (k: string) => unknown } | null)?.get?.("sessionId") as string | undefined;
  const token = (sessionId ? getNotionToken(sessionId) : undefined) ?? getFallbackToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers } as RequestInit);
};
