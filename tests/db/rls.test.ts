import { beforeEach, describe, expect, it } from "vitest";
import { anonClient } from "../../src/db/anon-client.js";
import { resetDbData } from "./db-test-utils.js";

const TABLES = [
  "tasks",
  "goals",
  "task_notes",
  "task_activities",
  "task_dependencies",
  "team",
  "documents",
  "document_tasks",
  "memories",
  "triage_sessions",
  "triage_items",
  "app_settings",
] as const;

const SAMPLE_ROWS: Record<(typeof TABLES)[number], Record<string, unknown>> = {
  tasks: {
    id: "KS-RLS",
    title: "RLS Task",
    description: "A valid task description",
    category: "client",
  },
  goals: {
    id: "G-RLS",
    title: "RLS Goal",
    description: "A valid goal description",
    quarter: "2026-Q2",
  },
  task_notes: {
    id: "N-RLS",
    task_id: "KS-RLS",
    content: "note",
  },
  task_activities: {
    id: "ACT-RLS",
    task_id: "KS-RLS",
    event_type: "task_created",
    summary: "Task created",
    payload: {},
  },
  task_dependencies: {
    id: "D-RLS",
    blocker_task_id: "KS-RLS-A",
    blocked_task_id: "KS-RLS-B",
  },
  team: {
    id: "TM-RLS",
    slug: "rls-user",
    display_name: "RLS User",
  },
  documents: {
    id: "DOC-RLS",
    filename: "x.pdf",
    category: "client",
    storage_path: "client/x.pdf",
  },
  document_tasks: {
    document_id: "DOC-RLS",
    task_id: "KS-RLS",
  },
  memories: {
    id: "M-RLS",
    scope: "global",
    content: "memory",
    applicability: "testing",
    content_embedding: Array.from({ length: 3072 }, () => 0),
    applicability_embedding: Array.from({ length: 3072 }, () => 0),
  },
  triage_sessions: {
    id: "TS-RLS",
  },
  triage_items: {
    id: "TI-RLS",
    session_id: "TS-RLS",
    superhuman_message_id: "msg-rls",
    disposition: "skipped",
  },
  app_settings: {
    key: "rls_test_setting",
    value: "x",
  },
};

describe("RLS anon role denies writes", () => {
  beforeEach(async () => {
    await resetDbData();
  });

  for (const table of TABLES) {
    it(`denies anon INSERT/UPDATE/DELETE on ${table}`, async () => {
      const client = anonClient();

      const insertResult = await client.from(table).insert(SAMPLE_ROWS[table]);
      expect(insertResult.error, `${table} insert should be denied`).toBeTruthy();

      const updateResult = await client.from(table).update({ id: "x" }).limit(1);
      expect(updateResult.error, `${table} update should be denied`).toBeTruthy();

      const deleteResult = await client.from(table).delete().limit(1);
      expect(deleteResult.error, `${table} delete should be denied`).toBeTruthy();
    });
  }
});
