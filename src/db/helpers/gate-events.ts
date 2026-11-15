/**
 * gate_events writes (W5, docs/plans/feedback-batch-waves-2-3.md).
 *
 * appendGateEvent() is the ONLY write path to the gate_events table —
 * the append-only scan in tests/db/append-only-scan.test.ts enforces that
 * no other module inserts, updates, or deletes gate_events rows.
 *
 * Telemetry discipline (the plan's rules):
 *   - One row per gate DECISION; a clean gate pass writes nothing.
 *   - Events tied to a successful write (overridden / warned / skipped)
 *     insert in the SAME transaction as the write. tryAppendGateEvent's
 *     `inTransaction` mode protects the host transaction with a SAVEPOINT
 *     so a telemetry failure can never poison the surrounding write.
 *   - Blocked outcomes insert standalone on the refusal path, best-effort:
 *     tryAppendGateEvent never throws; it returns a warning instead, so a
 *     telemetry failure can never turn a clean refusal into a crash.
 *   - outcome 'overridden' requires a non-empty justification (validated
 *     here so the requirement is structural, not conventional).
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, gateEvents } from "../index.js";
import type {
  GateEventGate,
  GateEventOutcome,
  GateEventSurface,
} from "../schema.js";

export interface AppendGateEventInput {
  gate: GateEventGate;
  /** The taskops operation name (create, update, delegate, ...). */
  operation: string;
  outcome: GateEventOutcome;
  surface: GateEventSurface;
  /** Null/omitted when a blocked create produced no task row. */
  taskId?: string | null;
  /** Required when outcome is 'overridden'. */
  justification?: string | null;
  /** Dedup-gate events only (dedupInputFingerprint from src/domain/intake). */
  inputFingerprint?: string | null;
  detail?: Record<string, unknown>;
  occurredAt?: Date;
  id?: string;
}

export interface AppendGateEventResult {
  gateEventId: string;
}

/** Minimal client shape for the insert; db, a tx, and fakes all satisfy it. */
type GateEventInsertClient = Pick<typeof db, "insert">;

/** Client shape for savepoint protection inside a host transaction. */
type GateEventTxClient = GateEventInsertClient & Partial<Pick<typeof db, "execute">>;

/**
 * Insert one gate_events row. The only write path to the table (append-only;
 * no update or delete exists anywhere in src/). Throws when outcome is
 * 'overridden' without a non-empty justification.
 */
export async function appendGateEvent(
  client: GateEventInsertClient,
  input: AppendGateEventInput,
): Promise<AppendGateEventResult> {
  if (
    input.outcome === "overridden" &&
    (input.justification == null || input.justification.trim().length === 0)
  ) {
    throw new Error(
      "appendGateEvent: outcome 'overridden' requires a non-empty justification.",
    );
  }
  const gateEventId = input.id ?? randomUUID();
  await client.insert(gateEvents).values({
    id: gateEventId,
    gate: input.gate,
    operation: input.operation,
    outcome: input.outcome,
    surface: input.surface,
    taskId: input.taskId ?? null,
    justification: input.justification ?? null,
    inputFingerprint: input.inputFingerprint ?? null,
    detail: input.detail ?? {},
    ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
  });
  return { gateEventId };
}

export interface TryAppendGateEventResult {
  /** Null when the telemetry insert failed (see warning). */
  gateEventId: string | null;
  /** Human-readable degradation message; null on success. */
  warning: string | null;
}

const SAVEPOINT_NAME = "gate_event_append";

/**
 * Best-effort wrapper around appendGateEvent: never throws. A telemetry
 * failure surfaces as a warning string instead of an error, so it can never
 * crash a refusal path or block a legitimate write.
 *
 * With `inTransaction: true` (and a client that exposes `execute`, i.e. a
 * real Postgres transaction), the insert runs inside a SAVEPOINT so a failed
 * telemetry statement cannot abort the host transaction.
 */
export async function tryAppendGateEvent(
  client: GateEventTxClient,
  input: AppendGateEventInput,
  options: { inTransaction?: boolean } = {},
): Promise<TryAppendGateEventResult> {
  const useSavepoint = options.inTransaction === true && typeof client.execute === "function";

  if (useSavepoint) {
    try {
      await client.execute!(sql.raw(`SAVEPOINT ${SAVEPOINT_NAME}`));
    } catch (err) {
      return failure(input, err);
    }
    try {
      const result = await appendGateEvent(client, input);
      await client.execute!(sql.raw(`RELEASE SAVEPOINT ${SAVEPOINT_NAME}`));
      return { gateEventId: result.gateEventId, warning: null };
    } catch (err) {
      try {
        await client.execute!(sql.raw(`ROLLBACK TO SAVEPOINT ${SAVEPOINT_NAME}`));
      } catch {
        /* host transaction is already doomed; nothing more to protect */
      }
      return failure(input, err);
    }
  }

  try {
    const result = await appendGateEvent(client, input);
    return { gateEventId: result.gateEventId, warning: null };
  } catch (err) {
    return failure(input, err);
  }
}

function failure(input: AppendGateEventInput, err: unknown): TryAppendGateEventResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    gateEventId: null,
    warning: `Gate-event telemetry skipped (${input.gate}/${input.outcome}): ${message}`,
  };
}

// ---------------------------------------------------------------------------
// Service deps seam.
// ---------------------------------------------------------------------------

export interface RecordGateEventOptions {
  /**
   * Host transaction for events tied to a successful write (overridden /
   * warned / skipped). Omitted for standalone blocked-path events.
   */
  tx?: GateEventTxClient;
}

/**
 * The shape service deps expose for gate telemetry. Implementations must be
 * best-effort (never throw); production wires recordGateEvent below, fakes
 * record in memory.
 */
export type RecordGateEvent = (
  input: AppendGateEventInput,
  options?: RecordGateEventOptions,
) => Promise<TryAppendGateEventResult>;

/**
 * Production RecordGateEvent: standalone best-effort insert against the
 * service-role client, or a savepoint-protected insert inside the provided
 * host transaction.
 */
export const recordGateEvent: RecordGateEvent = async (input, options = {}) => {
  if (options.tx !== undefined) {
    return tryAppendGateEvent(options.tx, input, { inTransaction: true });
  }
  return tryAppendGateEvent(db, input);
};
