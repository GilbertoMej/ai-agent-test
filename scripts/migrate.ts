import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = postgres(url, { max: 1 });

async function main() {
  // Phase 1 ships a single canonical migration. Future plans append 0002_*.sql etc.
  // and this script discovers them in lexical order. Keeping it tiny for now.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.resolve("drizzle");
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const body = await fs.readFile(path.join(dir, f), "utf8");
    console.log(`migrate: applying ${f}`);
    // One statement at a time — postgres-js splits on `;` inside the file.
    // `IF NOT EXISTS` clauses make this idempotent for re-runs.
    await sql.unsafe(body);
  }

  await sql.end({ timeout: 1 });
  console.log("migrate: done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
