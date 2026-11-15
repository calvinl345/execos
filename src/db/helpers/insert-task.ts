import { tasks } from "../index.js";
import type { TaskWriteClient } from "./types.js";

/**
 * The single sanctioned `.insert(tasks)` call site in the codebase (change-008
 * A7/A13). Row-level task inserts belong to db/helpers; services compose this
 * inside their transactions. One thin function, no logic.
 */
export async function insertTask(
  tx: TaskWriteClient,
  row: typeof tasks.$inferInsert,
): Promise<void> {
  await tx.insert(tasks).values(row);
}
