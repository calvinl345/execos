import { describe, expect, it } from "vitest";
import {
  collectAppDataSnapshot,
  describeBackupTarget,
} from "../../scripts/lib/db-backup.mjs";

function fakeSql() {
  const unsafeQueries = [];

  const sql = async (strings) => {
    const query = strings.join("?");
    if (query.includes("information_schema.tables")) {
      return [
        { table_schema: "drizzle", table_name: "__drizzle_migrations" },
        { table_schema: "public", table_name: "tasks" },
      ];
    }
    if (query.includes("information_schema.columns")) {
      return [
        {
          table_schema: "drizzle",
          table_name: "__drizzle_migrations",
          column_name: "id",
          ordinal_position: 1,
          data_type: "integer",
          udt_name: "int4",
          is_nullable: "NO",
          column_default: null,
        },
        {
          table_schema: "public",
          table_name: "tasks",
          column_name: "id",
          ordinal_position: 1,
          data_type: "text",
          udt_name: "text",
          is_nullable: "NO",
          column_default: null,
        },
        {
          table_schema: "public",
          table_name: "tasks",
          column_name: "title",
          ordinal_position: 2,
          data_type: "text",
          udt_name: "text",
          is_nullable: "NO",
          column_default: null,
        },
      ];
    }
    if (query.includes("information_schema.table_constraints")) {
      return [
        {
          table_schema: "public",
          table_name: "tasks",
          column_name: "id",
          ordinal_position: 1,
        },
      ];
    }
    if (query.includes("pg_sequences")) {
      return [
        {
          schemaname: "public",
          sequencename: "task_id_sequence",
          last_value: 7,
        },
      ];
    }
    throw new Error(`Unexpected query: ${query}`);
  };

  sql.unsafe = async (query) => {
    unsafeQueries.push(query);
    if (query === 'SELECT * FROM "drizzle"."__drizzle_migrations"') {
      return [{ id: 1 }];
    }
    if (query === 'SELECT * FROM "public"."tasks" ORDER BY "id"') {
      return [{ id: "KS-001", title: "Launch backup fallback" }];
    }
    throw new Error(`Unexpected unsafe query: ${query}`);
  };

  return { sql, unsafeQueries };
}

describe("describeBackupTarget", () => {
  it("describes the target without including the database password", () => {
    const target = describeBackupTarget(
      "postgresql://postgres.abc123:super-secret@aws-1.pooler.supabase.com:6543/postgres",
    );

    expect(target).toMatchObject({
      host: "aws-1.pooler.supabase.com",
      port: "6543",
      database: "postgres",
      username: "postgres.abc123",
      supabaseProjectRef: "abc123",
    });
    expect(JSON.stringify(target)).not.toContain("super-secret");
  });
});

describe("collectAppDataSnapshot", () => {
  it("exports public and drizzle table data for the built-in backup fallback", async () => {
    const { sql, unsafeQueries } = fakeSql();
    const snapshot = await collectAppDataSnapshot(
      sql,
      "postgresql://postgres.abc123:super-secret@aws-1.pooler.supabase.com:6543/postgres",
    );

    expect(snapshot.format).toBe("daily-app-data-backup");
    expect(snapshot.scope.schemas).toEqual(["public", "drizzle"]);
    expect(snapshot.tables.map((table) => `${table.schema}.${table.name}`)).toEqual([
      "drizzle.__drizzle_migrations",
      "public.tasks",
    ]);
    expect(snapshot.tables.find((table) => table.name === "tasks")).toMatchObject({
      rowCount: 1,
      primaryKey: ["id"],
      rows: [{ id: "KS-001", title: "Launch backup fallback" }],
    });
    expect(snapshot.sequences).toEqual([
      {
        schemaname: "public",
        sequencename: "task_id_sequence",
        last_value: 7,
      },
    ]);
    expect(unsafeQueries).toEqual([
      'SELECT * FROM "drizzle"."__drizzle_migrations"',
      'SELECT * FROM "public"."tasks" ORDER BY "id"',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("super-secret");
  });
});
