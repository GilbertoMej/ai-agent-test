import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  // Fail loud at boot rather than at first query.
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

// `max: 1` keeps the worker to a single connection — Phase 1 has tiny throughput.
const client = postgres(url, { max: 1, prepare: false });
export const db = drizzle(client, { schema });
export type DB = typeof db;
