import { describe, expect, test } from "vitest";
import { createCaptureOutputContext } from "../../src/cli/adapters/fakes.js";
import { defaultContext } from "../../src/cli/output-formatters/index.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: capture OutputContext.
- Real: production stdout/stderr OutputContext.

Modules under test:
- OutputContext command dependency interface
*/

describe("OutputContext capture and production output contexts satisfy the OutputContext interface", () => {
  test("AC-6: assert command output can be captured without process stdout monkey-patching", () => {
    const ctx = createCaptureOutputContext();
    ctx.out("hello");
    ctx.err("warning");
    expect(ctx.stdout).toEqual(["hello"]);
    expect(ctx.stderr).toEqual(["warning"]);

    const production = defaultContext("text");
    expect(production.out).toEqual(expect.any(Function));
    expect(production.err).toEqual(expect.any(Function));
  });
});
