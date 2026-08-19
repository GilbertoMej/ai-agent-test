import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// BCK-05 / 01-12 — BACKEND_PROVIDER switch. Default = insforge. When
// "supabase", the connection uses SUPABASE_DATABASE_URL against a
// pgvector-enabled Postgres (Docker test image: pgvector/pgvector:pg16).
const url =
  process.env.BACKEND_PROVIDER === "supabase"
    ? process.env.SUPABASE_DATABASE_URL
    : process.env.DATABASE_URL;
if (!url) {
  const key = process.env.BACKEND_PROVIDER === "supabase" ? "SUPABASE_DATABASE_URL" : "DATABASE_URL";
  throw new Error(`${key} is not set. Copy .env.example to .env.local and fill it in.`);
}

// `max: 1` keeps the worker to a single connection — Phase 1 has tiny throughput.
const client = postgres(url, { max: 1, prepare: false });
export const db = drizzle(client, { schema });
export type DB = typeof db;

export const backendProvider = (process.env.BACKEND_PROVIDER ?? "insforge") as "insforge" | "supabase";
