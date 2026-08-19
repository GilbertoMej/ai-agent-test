import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { MCPClient } from "@mastra/mcp";

// Test that the lifecycle reconnects within 3 attempts on stdio pipe death.
// Spawns a fake stdio MCP server, kills the pipe mid-listTools(), then asserts
// that the lifecycle's bounded retry restores the cache. Exits 0 on success.
// ponytail: this is a one-shot harness, not a vitest suite. The smoke script greps for the success marker.

const FAKE_STDIO_SCRIPT = `
const tools = { greet: { description: "fake", inputSchema: { type: "object" } } };
let killed = false;
process.stdin.on("data", (b) => {
  const s = b.toString();
  if (s.includes('"method":"tools/list"') || s.includes('"method":"initialize"')) {
    if (killed && s.includes('"method":"tools/list"')) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools } }) + "\\n");
      return;
    }
    if (!killed) {
      killed = true;
      process.exit(0);  // kill the pipe immediately on first tools/list
      return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools } }) + "\\n");
  }
});
`;

async function main() {
  // First run: lifecycle should reconnect within 3 attempts.
  const proc: ChildProcess = spawn(process.execPath, ["-e", FAKE_STDIO_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
  const id = "fake-server";

  const client = new MCPClient({
    id,
    servers: {
      [id]: { command: process.execPath, args: ["-e", FAKE_STDIO_SCRIPT], inheritDefaultEnv: false },
    },
  });

  // First call: pipe dies. Retry up to 3 times (1s/2s/4s backoff).
  let attempt = 0;
  let connected = false;
  while (attempt < 3) {
    try {
      await client.listTools();
      connected = true;
      break;
    } catch {
      attempt++;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  proc.kill();
  if (!connected) {
    console.error("reconnect failed after 3 attempts");
    process.exit(1);
  }
  console.log("reconnect within 3 attempts OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
