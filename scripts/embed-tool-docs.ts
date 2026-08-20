import { config as loadEnv } from "dotenv";

loadEnv();                              // .env
loadEnv({ path: ".env.local" });        // .env.local wins

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { embed } from "@/worker/src/lib/rag";

// 01-06 — embed every tool_docs row whose embedding IS NULL.
// Run after scripts/scrape-tool-docs.ts; the embed bootstrap (worker/src/lib/embed-bootstrap.ts)
// calls this same loop on cold boot when count==0 or updated_at is stale (D-20).

const BATCH = 16;

async function main() {
  const rows = (await db.execute(sql`
    SELECT id, content FROM tool_docs WHERE embedding IS NULL
  `)) as unknown as Array<{ id: string; content: string }>;
  if (rows.length === 0) {
    console.log("embed: nothing to do (all rows have embeddings)");
    process.exit(0);
  }
  console.log(`embed: ${rows.length} rows pending`);

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    for (const row of slice) {
      try {
        const v = await embed(row.content);
        await db.execute(sql`
          UPDATE tool_docs SET embedding = ${`[${v.join(",")}]`}::vector WHERE id = ${row.id}
        `);
      } catch (e) {
        console.error(`embed: row ${row.id} failed — ${(e as Error).message}`);
      }
    }
    console.log(`embed: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log("embed: done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
