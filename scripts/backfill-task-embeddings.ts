/**
 * Backfill stored dedup embeddings for existing open tasks (change-008 / A9).
 *
 * Usage:
 *   node --env-file=.env --import=tsx scripts/backfill-task-embeddings.ts [--strict]
 *
 * Selects open tasks (`status NOT IN ('done','cancelled')`) whose `embedding`
 * is NULL, embeds `title + "\n\n" + description` via the central embed()
 * adapter, and writes the vector through the setTaskEmbedding db helper
 * (row-level task writes live in src/db/helpers only).
 *
 * Idempotent by construction: only NULL embeddings are filled, so re-running
 * picks up exactly the rows a previous run skipped or failed. By default a
 * failed embed logs the failure and skips the row. In --strict mode, any skip
 * or remaining eligible NULL embedding exits nonzero for install/update.
 */

import { and, count, isNull, notInArray } from "drizzle-orm";
import { db, tasks, closeDb } from "../src/db/index.js";
import { embed } from "../src/embeddings/index.js";
import { setTaskEmbedding } from "../src/db/helpers/update-task-fields.js";
import {
  parseBackfillArgs,
  runBackfillTaskEmbeddings,
} from "./lib/backfill-task-embeddings-core.mjs";

const eligibleNullEmbeddingPredicate = and(
  notInArray(tasks.status, ["done", "cancelled"]),
  isNull(tasks.embedding),
);

async function main(): Promise<void> {
  const options = parseBackfillArgs(process.argv.slice(2));

  await runBackfillTaskEmbeddings({
    strict: options.strict,
    listEligibleTasks: async () =>
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
        })
        .from(tasks)
        .where(eligibleNullEmbeddingPredicate)
        .orderBy(tasks.id),
    countEligibleTasks: async () => {
      const rows = await db
        .select({ value: count() })
        .from(tasks)
        .where(eligibleNullEmbeddingPredicate);
      return Number(rows[0]?.value ?? 0);
    },
    embedText: embed,
    storeEmbedding: setTaskEmbedding,
  });
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfill] FAILED");
    console.error(err);
    await closeDb().catch(() => {
      /* ignore */
    });
    process.exit(1);
  });
