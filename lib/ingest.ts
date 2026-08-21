import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { toolDocs } from "@/db/schema";
import { nanoid } from "nanoid";
import { embed } from "@/worker/src/lib/rag";

// Shared doc-ingest: chunk markdown by H1/H2/H3, insert into tool_docs, embed
// each row. Used by the CLI (scripts/ingest-doc.ts) and the UI upload route
// (app/api/ingest/route.ts) so the logic lives in one place.

export function chunkMarkdown(md: string): Array<{ section: string; content: string }> {
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

export interface IngestResult {
  tool: string;
  version: string;
  total: number;
  inserted: number;
  embedded: number;
}

export async function ingestMarkdown(
  md: string,
  opts: { tool?: string; version?: string; source?: string } = {},
): Promise<IngestResult> {
  const tool = opts.tool ?? "unknown";
  const version = opts.version ?? "local";
  const source = opts.source ?? "upload";
  const chunks = chunkMarkdown(md);

  let inserted = 0;
  for (const c of chunks) {
    try {
      await db
        .insert(toolDocs)
        .values({
          id: nanoid(),
          tool,
          version,
          section: c.section,
          content: c.content,
          source_url: source,
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

  let embedded = 0;
  for (const row of pending) {
    try {
      const v = await embed(row.content);
      await db.execute(sql`
        UPDATE tool_docs SET embedding = ${`[${v.join(",")}]`}::vector WHERE id = ${row.id}
      `);
      embedded++;
    } catch (e) {
      console.error(`ingest: embed row ${row.id} failed — ${(e as Error).message}`);
    }
  }

  return { tool, version, total: chunks.length, inserted, embedded };
}
