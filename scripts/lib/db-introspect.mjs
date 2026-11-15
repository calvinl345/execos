/**
 * Lightweight schema/data introspection for the Phase 2 verify harness.
 *
 * A "snapshot" captures, for every base table in the public schema, its row
 * count and its column list. Diffing a before/after snapshot surfaces the
 * three ways a migration can lose data against real-shaped data:
 *   - a dropped table (all its rows gone)
 *   - a table that lost rows (DELETE / TRUNCATE)
 *   - a dropped column (its data gone, even though the row count is unchanged
 *     -- this is the insidious case a row-count check alone would miss, e.g.
 *     a column rename that drizzle-kit emits as DROP COLUMN + ADD COLUMN)
 */

import postgres from "postgres";

/**
 * @param {string} connectionString
 * @returns {Promise<Record<string, { rows: number, columns: string[] }>>}
 */
export async function snapshotPublic(connectionString) {
  const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const tableRows = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const columnRows = await sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;

    const snapshot = {};
    for (const { table_name } of tableRows) {
      snapshot[table_name] = { rows: 0, columns: [] };
    }
    for (const { table_name, column_name } of columnRows) {
      if (snapshot[table_name]) snapshot[table_name].columns.push(column_name);
    }
    for (const table of Object.keys(snapshot)) {
      const result = await sql.unsafe(`SELECT count(*)::int AS n FROM public."${table}"`);
      snapshot[table].rows = result[0].n;
    }
    return snapshot;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Compare two snapshots and report data-loss problems. Pure function so it
 * is unit-testable without a database.
 *
 * @returns {{
 *   rows: { table: string, kind: string, before: number|null, after: number|null, delta: number|null, droppedColumns: string[] }[],
 *   problems: string[],
 * }}
 */
export function diffSnapshots(before, after) {
  const tables = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const rows = [];
  const problems = [];

  for (const table of tables) {
    const b = before[table];
    const a = after[table];

    if (!b) {
      rows.push({ table, kind: "added", before: null, after: a.rows, delta: null, droppedColumns: [] });
      continue;
    }
    if (!a) {
      rows.push({ table, kind: "dropped", before: b.rows, after: null, delta: null, droppedColumns: [] });
      problems.push(`table "${table}" was dropped (${b.rows} row(s) lost)`);
      continue;
    }

    const delta = a.rows - b.rows;
    const droppedColumns = b.columns.filter((c) => !a.columns.includes(c));
    if (delta < 0) problems.push(`table "${table}" lost ${-delta} row(s)`);
    for (const column of droppedColumns) {
      problems.push(`column "${table}"."${column}" was dropped (data lost)`);
    }
    rows.push({
      table,
      kind: delta < 0 || droppedColumns.length > 0 ? "loss" : "ok",
      before: b.rows,
      after: a.rows,
      delta,
      droppedColumns,
    });
  }

  return { rows, problems };
}
