import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// 01-06 — RAG retrieval. Embed query, cosineDistance top-5 (D-21), format as context string.
// Embedding route goes through OpenRouter (NOTES.md resolves the 01-B "InsForge /v1/embeddings"
// assumption to OPENROUTER_API_KEY). 1536 dims locked in db/schema/tool-docs.ts.

const EMBED_MODEL = process.env.EMBED_MODEL ?? "openai/text-embedding-3-small";
const EMBED_DIMS = Number(process.env.EMBED_DIMS ?? 1536);
const TOP_K = 5;

export async function embed(text: string): Promise<number[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required for embeddings");
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const v = json.data[0].embedding;
  if (v.length !== EMBED_DIMS) {
    throw new Error(`embed: dims ${v.length} != ${EMBED_DIMS} — patch db/schema/tool-docs.ts`);
  }
  return v;
}

export interface RagHit {
  tool: string;
  section: string;
  content: string;
  source_url: string | null;
}

export async function retrieve(query: string): Promise<RagHit[]> {
  const v = await embed(query);
  const vStr = `[${v.join(",")}]`;
  // Cosine distance via pgvector operator; D-21 — top 5 nearest rows.
  const rows = await db.execute(sql`
    SELECT tool, section, content, source_url,
           1 - (embedding <=> ${vStr}::vector) AS score
    FROM tool_docs
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vStr}::vector
    LIMIT ${TOP_K}
  `);
  return (rows as unknown as RagHit[]).slice(0, TOP_K);
}

export function formatContext(hits: RagHit[]): string {
  if (hits.length === 0) return "(no tool_docs matched)";
  return hits
    .map((h) => `## ${h.tool} — ${h.section}\n${h.content}`)
    .join("\n\n");
}
