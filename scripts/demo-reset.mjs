#!/usr/bin/env node
/**
 * Wipe the LOCAL Supabase database and reload the fictional demo data.
 * Refuses to run unless the development env file points at 127.0.0.1/localhost.
 *
 *   npm run demo:reset
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const envFile = join(root, ".env.development.local");
const dbUrl = /^DATABASE_URL=(.*)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.replace(/^"|"$/g, "");
const host = dbUrl ? new URL(dbUrl).hostname : "";
if (!["127.0.0.1", "localhost"].includes(host)) {
  console.error(`Refusing to reset: DATABASE_URL in .env.development.local points at '${host}', not a local database.`);
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
};

run("npx --yes supabase@2.105.0 db reset");
execFileSync(process.execPath, ["scripts/run-with-env.cjs", ".env.development.local", process.execPath, "-e",
  "const p=require('postgres');const s=p(process.env.DATABASE_URL,{max:1});" +
  "s.unsafe('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;')" +
  ".then(()=>{console.log('extensions ok');return s.end()})"], { cwd: root, stdio: "inherit" });
run("npm run db:migrate:dev");
run("npm run db:seed:dev");
run("node scripts/seed-demo.mjs");
