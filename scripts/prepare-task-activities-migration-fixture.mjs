#!/usr/bin/env node
/**
 * Prepare a local-only pre-0001 fixture for task_activities migration rehearsal.
 *
 * This is destructive by design, but only against the local Supabase stack
 * discovered via `supabase status`. It resets public/drizzle locally, applies
 * 0000_init, seeds varied task/task_notes data, and marks only 0000 as applied
 * so `npm run db:verify-migration` applies the pending task_activities DDL.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
  getLocalStatus,
  getLocalDbContainer,
  loadSqlIntoLocal,
} from "./lib/supabase-cli.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INIT_MIGRATION_HASH = "618b3961a3ad9f330ce197cb491a9f8b8a03bcdc7c3bb1bd947165f2ebe1288e";
const INIT_MIGRATION_CREATED_AT = 1777262052690;

function fail(message) {
  console.error(`[fixture] ERROR: ${message}`);
  process.exit(1);
}

function assertLocalUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.port !== "54322") {
    fail(`Refusing to reset non-local database URL: ${url}`);
  }
}

async function resetLocal(localUrl) {
  const sql = postgres(localUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.unsafe(
      [
        "DROP SCHEMA IF EXISTS public CASCADE;",
        "DROP SCHEMA IF EXISTS drizzle CASCADE;",
        "CREATE SCHEMA public;",
        "CREATE SCHEMA IF NOT EXISTS extensions;",
        "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;",
        "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;",
        "GRANT USAGE ON SCHEMA public TO anon;",
        "GRANT USAGE ON SCHEMA public TO authenticated;",
      ].join("\n"),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function seedFixture(localUrl) {
  const sql = postgres(localUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO app_settings (key, value, description)
      VALUES
        ('task_id_prefix', 'FIX', 'Fixture task id prefix'),
        ('goal_id_prefix', 'FG', 'Fixture goal id prefix')
    `;

    await sql`
      INSERT INTO goals (id, title, description, quarter, status, created_at, updated_at)
      VALUES
        ('FG-001', 'Fixture Migration Goal', 'Goal used for migration fixture data.', '2026-Q2', 'active', '2026-05-01T10:00:00Z', '2026-05-01T10:00:00Z')
    `;

    await sql`
      INSERT INTO tasks (
        id, title, description, status, priority, category, owner, due_date, goal_id,
        created_at, updated_at, completed_at, cancelled_at, last_status_change_at,
        last_unblocked_at, needs_attention, needs_attention_set_at, needs_attention_reason
      )
      VALUES
        (
          'FIX-001',
          'Legacy notes coverage task',
          'Task with every legacy note type and multiline content.',
          'in_progress',
          'P1',
          'client',
          'elena',
          '2026-06-15T17:00:00Z',
          'FG-001',
          '2026-05-10T09:00:00Z',
          '2026-05-12T11:15:00Z',
          NULL,
          NULL,
          '2026-05-11T14:00:00Z',
          NULL,
          false,
          NULL,
          NULL
        ),
        (
          'FIX-002',
          'Attention and status history task',
          'Task carrying attention fields and older status notes.',
          'blocked',
          'P0',
          'business',
          'execos',
          NULL,
          NULL,
          '2026-04-20T08:30:00Z',
          '2026-05-20T16:45:00Z',
          NULL,
          NULL,
          '2026-05-20T16:45:00Z',
          '2026-05-19T12:00:00Z',
          true,
          '2026-05-20T16:45:00Z',
          'Waiting on client access before moving forward.'
        ),
        (
          'FIX-003',
          'Closed task with preserved notes',
          'Done task with completion and manual note history.',
          'done',
          'P2',
          'personal',
          'me',
          NULL,
          'FG-001',
          '2026-03-01T13:00:00Z',
          '2026-03-07T18:30:00Z',
          '2026-03-07T18:30:00Z',
          NULL,
          '2026-03-07T18:30:00Z',
          NULL,
          false,
          NULL,
          NULL
        )
    `;

    const notes = [
      [
        "FIX-N001",
        "FIX-001",
        "manual",
        "Manual note with multiple lines.\n- first bullet\n- second bullet\nContains quotes: \"client said yes\" and apostrophe: Jordan's task.",
        "2026-05-10T09:05:00Z",
        "user-direct",
      ],
      [
        "FIX-N002",
        "FIX-001",
        "intake_checklist",
        "Checklist:\n[x] title captured\n[x] owner assigned\n[ ] waiting on acceptance criteria",
        "2026-05-10T09:10:00Z",
        "agent",
      ],
      [
        "FIX-N003",
        "FIX-001",
        "status_change",
        "Status changed from triage to backlog, then backlog to in_progress.",
        "2026-05-11T14:00:00Z",
        "system",
      ],
      [
        "FIX-N004",
        "FIX-001",
        "mcp_action",
        "{\"tool\":\"crm.update\",\"recordId\":\"rec_fixture_001\",\"result\":\"ok\"}",
        "2026-05-11T15:30:00Z",
        "agent",
      ],
      [
        "FIX-N005",
        "FIX-002",
        "system",
        "Needs attention set because the task is blocked by missing credentials.",
        "2026-05-20T16:45:00Z",
        "system",
      ],
      [
        "FIX-N006",
        "FIX-002",
        "manual",
        "Edge-ish content: commas, pipes | delimiters | brackets [test], JSON-looking {\"not\":\"parsed\"}.",
        "2026-05-21T08:00:00Z",
        "user-direct",
      ],
      [
        "FIX-N007",
        "FIX-003",
        "status_change",
        "Status changed from review to done.",
        "2026-03-07T18:30:00Z",
        "system",
      ],
      [
        "FIX-N008",
        "FIX-003",
        "manual",
        "Completion note should remain visible as manual prose, not activity history.",
        "2026-03-07T18:35:00Z",
        "agent",
      ],
    ];

    for (const note of notes) {
      await sql`
        INSERT INTO task_notes (id, task_id, note_type, content, created_at, created_by)
        VALUES (${note[0]}, ${note[1]}, ${note[2]}, ${note[3]}, ${note[4]}, ${note[5]})
      `;
    }

    await sql`
      INSERT INTO task_dependencies (id, blocker_task_id, blocked_task_id, created_at)
      VALUES ('FIX-D001', 'FIX-002', 'FIX-001', '2026-05-21T09:00:00Z')
    `;

    await sql`
      INSERT INTO documents (id, filename, category, notes, storage_path, size_bytes, mime_type, uploaded_at)
      VALUES (
        'FIX-DOC-001',
        'fixture migration evidence.txt',
        'client',
        'Fixture document linked to a task.',
        'fixtures/migration-evidence.txt',
        1234,
        'text/plain',
        '2026-05-22T10:00:00Z'
      )
    `;

    await sql`
      INSERT INTO document_tasks (document_id, task_id, linked_at)
      VALUES ('FIX-DOC-001', 'FIX-001', '2026-05-22T10:05:00Z')
    `;

    await sql`CREATE SCHEMA drizzle`;
    await sql`
      CREATE TABLE drizzle.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
      VALUES (1, ${INIT_MIGRATION_HASH}, ${INIT_MIGRATION_CREATED_AT})
    `;
    await sql`SELECT setval('drizzle.__drizzle_migrations_id_seq', 1, true)`;

    const fingerprint = await taskNotesFingerprint(sql);
    console.log(`[fixture] task_notes rows: ${fingerprint.count}`);
    console.log(`[fixture] task_notes fingerprint: ${fingerprint.fingerprint}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function taskNotesFingerprint(sql) {
  const rows = await sql`
    SELECT
      count(*)::int AS count,
      md5(coalesce(string_agg(
        jsonb_build_object(
          'id', id,
          'task_id', task_id,
          'note_type', note_type,
          'content', content,
          'created_at', created_at,
          'created_by', created_by
        )::text,
        E'\n'
        ORDER BY id
      ), '')) AS fingerprint
    FROM task_notes
  `;
  return rows[0];
}

async function main() {
  console.log("[fixture] discovering local Supabase stack...");
  const localUrl = getLocalStatus(repoRoot).DB_URL;
  if (!localUrl) fail("Could not read local DB URL from `supabase status`.");
  assertLocalUrl(localUrl);
  const container = getLocalDbContainer();
  console.log(`[fixture] local DB: ${localUrl}`);
  console.log(`[fixture] local container: ${container}`);

  console.log("[fixture] resetting local schemas...");
  await resetLocal(localUrl);

  console.log("[fixture] applying 0000_init only...");
  const initSql = readFileSync(
    path.join(repoRoot, "src", "db", "migrations", "0000_init.sql"),
    "utf8",
  );
  const load = loadSqlIntoLocal(
    container,
    `SET search_path TO public, extensions;\n${initSql}`,
  );
  if (load.status !== 0) fail("loading 0000_init into local failed.");

  console.log("[fixture] seeding rich pre-activity task data...");
  await seedFixture(localUrl);
  console.log("[fixture] OK: local fixture is ready. Run `npm run db:verify-migration` next.");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
