import "dotenv/config";
import { db } from "@/db/client";
import { toolDocs } from "@/db/schema";
import { nanoid } from "nanoid";

// 01-06 — fetch the 4 official MCP server READMEs, split by `#`/`##` headings,
// write (tool, version, section, content, source_url) rows to tool_docs.
// Embedding happens in scripts/embed-tool-docs.ts. Re-runnable; unique index on
// (tool, version, section) means duplicates collapse via ON CONFLICT DO NOTHING.

const TOOLS: Array<{ tool: string; version: string; url: string }> = [
  { tool: "notion", version: "2.0.0", url: "https://raw.githubusercontent.com/makenotion/notion-mcp-server/main/README.md" },
  { tool: "linear", version: "0.7.0", url: "https://raw.githubusercontent.com/tacticlaunch/mcp-linear/main/README.md" },
  { tool: "playwright", version: "0.0.40", url: "https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md" },
  { tool: "sentry", version: "0.0.5", url: "https://raw.githubusercontent.com/getsentry/sentry-mcp/main/README.md" },
];

// Split markdown by H1/H2/H3 headings. Returns [{section, content}].
function chunkMarkdown(md: string): Array<{ section: string; content: string }> {
  const lines = md.split(/\r?\n/);
  const chunks: Array<{ section: string; content: string[] }> = [];
  let current: { section: string; content: string[] } | null = null;
  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (m) {
      if (current) chunks.push(current);
      current = { section: m[2].trim(), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) chunks.push(current);
  return chunks
    .filter((c) => c.content.join("\n").trim().length > 0)
    .map((c) => ({ section: c.section, content: c.content.join("\n").trim() }));
}

async function main() {
  for (const { tool, version, url } of TOOLS) {
    console.log(`scrape: ${tool} @ ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`scrape: ${tool} HTTP ${res.status} — skipping`);
      continue;
    }
    const md = await res.text();
    const chunks = chunkMarkdown(md);
    let n = 0;
    for (const c of chunks) {
      await db
        .insert(toolDocs)
        .values({
          id: nanoid(),
          tool,
          version,
          section: c.section,
          content: c.content,
          source_url: url,
        })
        .onConflictDoNothing();
      n++;
    }
    console.log(`scrape: ${tool} -> ${n} sections`);
  }
  console.log("scrape: done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
