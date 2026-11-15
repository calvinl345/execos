import { afterAll, describe, it } from "vitest";
import { closeDb } from "../../src/db/index.js";

describe("db test cleanup", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("closes the shared db pool after db tests", () => {
    // Vitest requires at least one test in the file. The afterAll does
    // the actual cleanup.
  });
});
