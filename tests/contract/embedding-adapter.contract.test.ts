import { describe, expect, test } from "vitest";
import { FakeEmbeddingAdapter } from "../../src/cli/adapters/fakes.js";
import { productionEmbeddingAdapter } from "../../src/cli/adapters/production.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: FakeEmbeddingAdapter.
- Real: production embedding adapter with network boundary isolated from fast tests.

Modules under test:
- EmbeddingAdapter command dependency interface
*/

describe("EmbeddingAdapter fake and production adapter satisfy the EmbeddingAdapter interface", () => {
  test("fake returns configured vector and records call inputs", async () => {
    const adapter = new FakeEmbeddingAdapter({ vector: [1, 0, 1] });
    await expect(adapter.embed("anything")).resolves.toEqual([1, 0, 1]);
    await expect(adapter.embed("else")).resolves.toEqual([1, 0, 1]);
    expect(adapter.calls).toEqual(["anything", "else"]);
  });

  test("fake failureMode='throw' rejects with a stable error so command error branches are testable", async () => {
    const adapter = new FakeEmbeddingAdapter({ failureMode: "throw" });
    await expect(adapter.embed("x")).rejects.toThrow(/failureMode=throw/);
    // Even on failure the call is recorded, so callers can assert "we tried".
    expect(adapter.calls).toEqual(["x"]);
  });

  test("production adapter exposes the EmbeddingAdapter shape", () => {
    expect(typeof productionEmbeddingAdapter.embed).toBe("function");
  });
});
