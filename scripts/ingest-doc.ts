import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnv();
loadEnv({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { toolDocs } from "@/db/schema";
import { nanoid } from "nanoid";
import { embed } from "@/worker/src/lib/rag";

// Usage: pnpm ingest:doc <path-to-md> [tool] [version]
// Splits markdown by H1/H2/H3, inserts into tool_docs, embeds in one pass.

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
  const [, , pathArg, toolArg, versionArg] = process.argv;
  if (!pathArg) {
    console.error("usage: pnpm ingest:doc <path-to-md> [tool] [version]");
    process.exit(2);
  }
  const filePath = resolve(pathArg);
  const tool = toolArg ?? pathArg.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
  const version = versionArg ?? "local";
  const md = readFileSync(filePath, "utf8");
  const chunks = chunkMarkdown(md);
  console.log(`ingest: ${filePath} (${chunks.length} sections) → tool=${tool} version=${version}`);

  let inserted = 0;
  for (const c of chunks) {
    const id = nanoid();
    try {
      await db
        .insert(toolDocs)
        .values({
          id,
          tool,
          version,
          section: c.section,
          content: c.content,
          source_url: `file://${filePath}`,
        })
        .onConflictDoNothing();
      inserted++;
    } catch (e) {
      console.error(`ingest: insert '${c.section}' failed — ${(e as Error).message}`);
    }
  }

  const pending = (await db.execute(sql`
    SELECT id, content FROM tool_docs WHERE embedding IS NULL AND tool = ${tool}
  `)) as unknown as Array<{ id: string; content: string }>;
  console.log(`ingest: ${pending.length} rows pending embedding`);
  for (const row of pending) {
    try {
      const v = await embed(row.content);
      await db.execute(sql`
        UPDATE tool_docs SET embedding = ${`[${v.join(",")}]`}::vector WHERE id = ${row.id}
      `);
    } catch (e) {
      console.error(`ingest: embed row ${row.id} failed — ${(e as Error).message}`);
    }
  }

  console.log(`ingest: done — ${inserted}/${chunks.length} sections inserted, ${pending.length} embedded`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
