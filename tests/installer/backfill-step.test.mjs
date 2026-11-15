import { readFileSync } from "node:fs";

function expectAfter(text, earlier, later) {
  const earlierIndex = text.indexOf(earlier);
  const laterIndex = text.indexOf(later);
  expect(earlierIndex, `${earlier} missing`).toBeGreaterThanOrEqual(0);
  expect(laterIndex, `${later} missing`).toBeGreaterThanOrEqual(0);
  expect(laterIndex, `${later} should appear after ${earlier}`).toBeGreaterThan(earlierIndex);
}

describe("installer task embedding backfill step", () => {
  it("runs strict backfill after seed and before health check on Linux", () => {
    const text = readFileSync("scripts/installer/run.mjs", "utf8");

    expectAfter(text, "Seeding app settings", "Backfilling task embeddings");
    expectAfter(text, "Backfilling task embeddings", "Running health check");
    expect(text).toContain('"scripts/backfill-task-embeddings.ts"');
    expect(text).toContain('"--strict"');
    expect(text).toContain("total += 3; // migrate + seed + backfill embeddings");
  });

  it("runs strict backfill after seed and before health check on Windows", () => {
    const text = readFileSync("scripts/install.ps1", "utf8");

    expectAfter(text, "Seeding app settings", "Backfilling task embeddings");
    expectAfter(text, "Backfilling task embeddings", "Running health check");
    expect(text).toContain('"scripts/backfill-task-embeddings.ts"');
    expect(text).toContain('"--strict"');
  });
});
