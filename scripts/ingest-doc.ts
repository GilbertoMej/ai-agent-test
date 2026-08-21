import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnv();
loadEnv({ path: ".env.local" });

import { ingestMarkdown } from "@/lib/ingest";

// Usage: pnpm ingest:doc <path-to-md> [tool] [version]
// Splits markdown by H1/H2/H3, inserts into tool_docs, embeds in one pass.
// Logic lives in lib/ingest.ts (shared with the UI upload route).

async function main() {
  const [, , pathArg, toolArg, versionArg] = process.argv;
  if (!pathArg) {
    console.error("usage: pnpm ingest:doc <path-to-md> [tool] [version]");
    process.exit(2);
  }
  const filePath = resolve(pathArg);
  const tool = toolArg ?? filePath.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
  const version = versionArg ?? "local";
  const md = readFileSync(filePath, "utf8");
  const res = await ingestMarkdown(md, { tool, version, source: `file://${filePath}` });
  console.log(`ingest: done — ${res.inserted}/${res.total} sections inserted, ${res.embedded} embedded (tool=${res.tool})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
