import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase Drizzle DATABASE_URL from the project header Connect dialog.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
  // Drizzle-kit's default migration table is `__drizzle_migrations` in the
  // `drizzle` schema. We keep that default — gives us a clean separation
  // from our own `app_settings` and ten data tables.
});
