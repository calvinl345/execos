function logInfo(logger, message) {
  if (typeof logger.info === "function") {
    logger.info(message);
  } else if (typeof logger.log === "function") {
    logger.log(message);
  }
}

function logError(logger, message) {
  if (typeof logger.error === "function") {
    logger.error(message);
  }
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

export function parseBackfillArgs(argv) {
  const options = { strict: false };
  for (const arg of argv) {
    if (arg === "--strict") {
      options.strict = true;
    } else {
      throw new Error(
        `Unknown option '${arg}'. Usage: node --import=tsx scripts/backfill-task-embeddings.ts [--strict]`,
      );
    }
  }
  return options;
}

export async function runBackfillTaskEmbeddings({
  strict = false,
  listEligibleTasks,
  countEligibleTasks,
  embedText,
  storeEmbedding,
  logger = console,
}) {
  const rows = await listEligibleTasks();
  logInfo(
    logger,
    `[backfill] ${rows.length} open task(s) with NULL embedding to process`,
  );

  let updated = 0;
  let skipped = 0;

  for (const [i, row] of rows.entries()) {
    const label = `[backfill] (${i + 1}/${rows.length}) ${row.id}`;
    try {
      const vector = await embedText(`${row.title}\n\n${row.description}`);
      await storeEmbedding(row.id, vector);
      updated += 1;
      logInfo(logger, `${label} embedding stored`);
    } catch (err) {
      skipped += 1;
      logError(logger, `${label} SKIPPED: ${errorMessage(err)}`);
    }
  }

  const remaining = await countEligibleTasks();
  logInfo(
    logger,
    `[backfill] done: ${updated} updated, ${skipped} skipped, ${remaining} remaining`,
  );

  if (strict && (skipped > 0 || remaining > 0)) {
    throw new Error(
      `[backfill] strict mode failed: ${skipped} skipped, ${remaining} open task(s) still have NULL embeddings`,
    );
  }

  return {
    processed: rows.length,
    updated,
    skipped,
    remaining,
  };
}
