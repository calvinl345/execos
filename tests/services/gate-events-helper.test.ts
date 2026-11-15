/**
 * Contract tests for the gate_events write helper (see
 * architecture/decisions/020-gate-events-telemetry.md).
 *
 * appendGateEvent() is the only write path to gate_events (the append-only
 * scan in tests/db/append-only-scan.test.ts enforces that mechanically);
 * tryAppendGateEvent() is the best-effort wrapper services use: it never
 * throws — a telemetry failure surfaces as a warning so it can never crash
 * a refusal path or block a legitimate write, and in `inTransaction` mode
 * the insert is savepoint-protected so a failed telemetry statement cannot
 * poison the host transaction.
 *
 * Fast suite: fully fake client, no DB.
 */

import { describe, expect, it } from "vitest";
import {
  appendGateEvent,
  tryAppendGateEvent,
  type AppendGateEventInput,
} from "../../src/db/helpers/gate-events.js";

type InsertClient = Parameters<typeof appendGateEvent>[0];
type TxClient = Parameters<typeof tryAppendGateEvent>[0];

interface FakeClientOptions {
  insertError?: Error;
  withExecute?: boolean;
  executeError?: Error;
}

function makeClient(opts: FakeClientOptions = {}): {
  client: TxClient;
  rows: Array<Record<string, unknown>>;
  executed: string[];
} {
  const rows: Array<Record<string, unknown>> = [];
  const executed: string[] = [];
  const client: Record<string, unknown> = {
    insert: (_table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (opts.insertError) throw opts.insertError;
        rows.push(row);
      },
    }),
  };
  if (opts.withExecute !== false) {
    client.execute = async (query: unknown) => {
      if (opts.executeError) throw opts.executeError;
      // sql.raw(...) carries its text inside queryChunks; serializing the
      // object is enough to assert which statement ran.
      executed.push(JSON.stringify(query));
    };
  } else {
    // No execute at all (e.g. a minimal fake tx): savepoint mode must fall
    // back to a plain insert.
    delete client.execute;
  }
  return { client: client as unknown as TxClient, rows, executed };
}

function baseInput(partial: Partial<AppendGateEventInput> = {}): AppendGateEventInput {
  return {
    gate: "dedup",
    operation: "create",
    outcome: "blocked",
    surface: "cli",
    ...partial,
  };
}

describe("appendGateEvent (the only gate_events write path)", () => {
  it("inserts one row with the provided fields and a generated uuid id", async () => {
    const { client, rows } = makeClient();
    const result = await appendGateEvent(client as InsertClient, baseInput({
      taskId: "KS-001",
      inputFingerprint: "abc123",
      detail: { matches: [] },
    }));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      gate: "dedup",
      operation: "create",
      outcome: "blocked",
      surface: "cli",
      taskId: "KS-001",
      justification: null,
      inputFingerprint: "abc123",
      detail: { matches: [] },
    });
    expect(result.gateEventId).toBe(rows[0].id);
    expect(String(rows[0].id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("defaults taskId/justification/inputFingerprint to null and detail to {}", async () => {
    const { client, rows } = makeClient();
    await appendGateEvent(client as InsertClient, baseInput());
    expect(rows[0]).toMatchObject({
      taskId: null,
      justification: null,
      inputFingerprint: null,
      detail: {},
    });
  });

  it("refuses outcome 'overridden' without a justification", async () => {
    const { client, rows } = makeClient();
    await expect(
      appendGateEvent(client as InsertClient, baseInput({ outcome: "overridden" })),
    ).rejects.toThrow(/requires a non-empty justification/);
    await expect(
      appendGateEvent(
        client as InsertClient,
        baseInput({ outcome: "overridden", justification: "   " }),
      ),
    ).rejects.toThrow(/requires a non-empty justification/);
    expect(rows).toHaveLength(0);
  });

  it("accepts outcome 'overridden' with a non-empty justification", async () => {
    const { client, rows } = makeClient();
    await appendGateEvent(
      client as InsertClient,
      baseInput({ outcome: "overridden", justification: "recurring weekly task" }),
    );
    expect(rows[0]).toMatchObject({
      outcome: "overridden",
      justification: "recurring weekly task",
    });
  });
});

describe("tryAppendGateEvent (best-effort wrapper)", () => {
  it("returns the id and no warning on success (standalone)", async () => {
    const { client, rows } = makeClient();
    const result = await tryAppendGateEvent(client, baseInput());
    expect(result.warning).toBeNull();
    expect(result.gateEventId).toBe(rows[0].id);
  });

  it("never throws: an insert failure returns a warning instead", async () => {
    const { client, rows } = makeClient({
      insertError: new Error('relation "gate_events" does not exist'),
    });
    const result = await tryAppendGateEvent(client, baseInput());
    expect(result.gateEventId).toBeNull();
    expect(result.warning).toMatch(/Gate-event telemetry skipped \(dedup\/blocked\)/);
    expect(result.warning).toMatch(/does not exist/);
    expect(rows).toHaveLength(0);
  });

  it("never throws: a justification validation failure returns a warning", async () => {
    const { client } = makeClient();
    const result = await tryAppendGateEvent(client, baseInput({ outcome: "overridden" }));
    expect(result.gateEventId).toBeNull();
    expect(result.warning).toMatch(/requires a non-empty justification/);
  });

  it("inTransaction mode wraps the insert in a savepoint and releases it on success", async () => {
    const { client, rows, executed } = makeClient();
    const result = await tryAppendGateEvent(client, baseInput(), { inTransaction: true });
    expect(result.warning).toBeNull();
    expect(rows).toHaveLength(1);
    expect(executed).toHaveLength(2);
    expect(executed[0]).toContain("SAVEPOINT gate_event_append");
    expect(executed[1]).toContain("RELEASE SAVEPOINT gate_event_append");
  });

  it("inTransaction mode rolls back to the savepoint on failure, protecting the host transaction", async () => {
    const { client, executed } = makeClient({
      insertError: new Error("insert failed"),
    });
    const result = await tryAppendGateEvent(client, baseInput(), { inTransaction: true });
    expect(result.gateEventId).toBeNull();
    expect(result.warning).toMatch(/insert failed/);
    expect(executed).toHaveLength(2);
    expect(executed[0]).toContain("SAVEPOINT gate_event_append");
    expect(executed[1]).toContain("ROLLBACK TO SAVEPOINT gate_event_append");
  });

  it("inTransaction mode degrades to a warning when even the savepoint cannot be created", async () => {
    const { client, rows } = makeClient({
      executeError: new Error("connection lost"),
    });
    const result = await tryAppendGateEvent(client, baseInput(), { inTransaction: true });
    expect(result.gateEventId).toBeNull();
    expect(result.warning).toMatch(/connection lost/);
    expect(rows).toHaveLength(0);
  });

  it("inTransaction mode falls back to a plain insert when the client has no execute", async () => {
    const { client, rows } = makeClient({ withExecute: false });
    const result = await tryAppendGateEvent(client, baseInput(), { inTransaction: true });
    expect(result.warning).toBeNull();
    expect(rows).toHaveLength(1);
  });
});
