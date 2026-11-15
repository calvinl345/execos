#!/usr/bin/env node

console.error([
  "Refusing to run DB integration tests from an npm script.",
  "",
  "Reason: this suite resets database tables and must not run against the",
  "application database from .env. Normal automation should use npm test,",
  "which is stateless and does not load database credentials.",
  "",
  "Use npm run test:db:local only with .env.test.local pointed at local",
  "disposable Supabase/Postgres infrastructure. The local harness verifies",
  "the target, runs migrations, and keeps destructive setup guarded.",
].join("\n"));

process.exit(1);
