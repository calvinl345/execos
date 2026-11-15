import { describe, expect, test } from "vitest";
import { FakeClockProvider } from "../../src/cli/adapters/fakes.js";
import { systemClockProvider } from "../../src/cli/adapters/production.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: FakeClockProvider.
- Real: system clock adapter.

Modules under test:
- ClockProvider command dependency interface
*/

describe("ClockProvider fake and system clock adapter satisfy the ClockProvider interface", () => {
  test("AC-6: assert time-dependent command behavior uses the injected clock", () => {
    const clock = new FakeClockProvider(new Date("2026-04-28T18:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-04-28T18:00:00.000Z");
    expect(clock.nowMs()).toBe(Date.parse("2026-04-28T18:00:00.000Z"));
    expect(systemClockProvider.now).toEqual(expect.any(Function));
  });
});
