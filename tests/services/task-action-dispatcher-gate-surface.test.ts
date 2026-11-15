/**
 * W5: calls arriving through the web task-action dispatcher stamp
 * surface "web" onto the service operation inputs, so any gate-decision
 * telemetry those operations record carries the right surface. CLI calls
 * pass no surface and the operations default to "cli".
 */

import { describe, expect, it } from "vitest";
import {
  dispatchTaskAction,
  type TaskActionOperations,
} from "../../src/services/task-action-dispatcher.js";

function unexpected(name: string): () => never {
  return () => {
    throw new Error(`unexpected operation call: ${name}`);
  };
}

function makeOperations(overrides: Partial<TaskActionOperations>): TaskActionOperations {
  return {
    delegateOperation: unexpected("delegateOperation") as never,
    delegationMessageOperation: unexpected("delegationMessageOperation") as never,
    recordFollowUpOperation: unexpected("recordFollowUpOperation") as never,
    deferOperation: unexpected("deferOperation") as never,
    clearSnoozeOperation: unexpected("clearSnoozeOperation") as never,
    updateTaskFieldsOperation: unexpected("updateTaskFieldsOperation") as never,
    completeOperation: unexpected("completeOperation") as never,
    reopenTaskOperation: unexpected("reopenTaskOperation") as never,
    undelegateOperation: unexpected("undelegateOperation") as never,
    ...overrides,
  };
}

describe("task-action dispatcher stamps surface 'web' (gate_events telemetry)", () => {
  it("delegate calls carry surface 'web' into delegateOperation", async () => {
    let captured: { surface?: string } | undefined;
    const operations = makeOperations({
      delegateOperation: (async (input: { surface?: string }) => {
        captured = input;
        return { ok: true, receipt: {} } as never;
      }) as never,
    });

    const response = await dispatchTaskAction(
      "KS-001",
      { action: "delegate", owner: "noah" },
      operations,
    );

    expect(response.status).toBe(200);
    expect(captured).toBeDefined();
    expect(captured!.surface).toBe("web");
  });

  it("complete calls carry surface 'web' into completeOperation", async () => {
    let captured: { surface?: string } | undefined;
    const operations = makeOperations({
      completeOperation: (async (input: { surface?: string }) => {
        captured = input;
        return {} as never;
      }) as never,
    });

    const response = await dispatchTaskAction("KS-001", { action: "complete" }, operations);

    expect(response.status).toBe(200);
    expect(captured).toBeDefined();
    expect(captured!.surface).toBe("web");
  });

  it("reopen calls carry surface 'web' into reopenTaskOperation", async () => {
    let captured: { surface?: string } | undefined;
    const operations = makeOperations({
      reopenTaskOperation: (async (input: { surface?: string }) => {
        captured = input;
        return {} as never;
      }) as never,
    });

    const response = await dispatchTaskAction("KS-001", { action: "reopen" }, operations);

    expect(response.status).toBe(200);
    expect(captured).toBeDefined();
    expect(captured!.surface).toBe("web");
  });
});
