import { config as loadEnv } from "dotenv";

loadEnv();                              // .env
loadEnv({ path: ".env.local" });        // .env.local wins

import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
