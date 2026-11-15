import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type TaskActionOperations,
  type TaskActionPayload,
} from "../../src/services/task-action-dispatcher.js";
import { FollowUpServiceError } from "../../src/services/follow-up-operations.js";
import { handleTaskActionPost } from "../../src/web/lib/server/task-action-post.js";

type OperationMocks = {
  [K in keyof TaskActionOperations]: ReturnType<typeof vi.fn>;
};

const mocks: OperationMocks = {
  delegateOperation: vi.fn(),
  delegationMessageOperation: vi.fn(),
  recordFollowUpOperation: vi.fn(),
  deferOperation: vi.fn(),
  clearSnoozeOperation: vi.fn(),
  updateTaskFieldsOperation: vi.fn(),
  completeOperation: vi.fn(),
  reopenTaskOperation: vi.fn(),
  undelegateOperation: vi.fn(),
};

const operations = mocks as unknown as TaskActionOperations;

describe("task action dispatcher contract", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
  });

  function post(payload: TaskActionPayload) {
    return handleTaskActionPost({
      taskId: "KS-123",
      readJson: async () => payload,
      operations,
    });
  }

  it("fails with 400 for a badly formed task ID", async () => {
    await expect(
      handleTaskActionPost({
        taskId: "bad-id",
        readJson: async () => ({ action: "complete" }),
        operations,
      }),
    ).rejects.toMatchObject({ status: 400, message: "bad task id" });
  });

  it("fails with 400 for an invalid JSON body", async () => {
    await expect(
      handleTaskActionPost({
        taskId: "KS-123",
        readJson: async () => {
          throw new Error("SyntaxError: Unexpected token");
        },
        operations,
      }),
    ).rejects.toMatchObject({ status: 400, message: "invalid json body" });
  });

  it("routes delegate action to delegateOperation with correct inputs", async () => {
    const payload: TaskActionPayload = {
      action: "delegate",
      owner: "elena",
      followUpDate: "2026-06-15T12:00:00.000Z",
      dueDate: "2026-06-20T12:00:00.000Z",
      notes: "Some delegation note",
    };

    mocks.delegateOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response).toEqual({ status: 200, body: { success: true } });
    expect(mocks.delegateOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      ownerText: "elena",
      followUpDate: new Date("2026-06-15T12:00:00.000Z"),
      dueDate: new Date("2026-06-20T12:00:00.000Z"),
      note: "Some delegation note",
      // W5: dispatcher calls stamp the web surface for gate telemetry.
      surface: "web",
      source: "dashboard",
    });
  });

  it("routes follow-up action to recordFollowUpOperation with correct inputs", async () => {
    const payload: TaskActionPayload = {
      action: "follow-up",
      update: "chased elena, still waiting on docs",
      nextFollowUpDate: "2026-06-15T12:00:00.000Z",
      dueDate: "2026-06-25T12:00:00.000Z",
      status: "blocked",
    };

    mocks.recordFollowUpOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response).toEqual({ status: 200, body: { success: true } });
    expect(mocks.recordFollowUpOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      update: "chased elena, still waiting on docs",
      nextFollowUpDate: new Date("2026-06-15T12:00:00.000Z"),
      dueDate: new Date("2026-06-25T12:00:00.000Z"),
      status: "blocked",
      source: "dashboard",
    });
  });

  it("routes delegation-message action to delegationMessageOperation with parsed follow-up date", async () => {
    const payload: TaskActionPayload = {
      action: "delegation-message",
      kind: "handoff",
      followUpDate: "tomorrow at 5pm",
    };

    mocks.delegationMessageOperation.mockResolvedValue({ message: "handoff copied" });

    const response = await post(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "handoff copied" });
    expect(mocks.delegationMessageOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      kind: "handoff",
      followUpDate: expect.any(Date),
      source: "dashboard",
    });
  });

  it("routes defer action to deferOperation when natural-language parsing succeeds", async () => {
    const payload: TaskActionPayload = {
      action: "defer",
      until: "tomorrow at 5pm",
    };

    mocks.deferOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.deferOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      until: expect.any(Date),
      source: "dashboard",
    });
  });

  it("returns 400 with error when defer action has invalid natural-language date", async () => {
    const payload: TaskActionPayload = {
      action: "defer",
      until: "invalid-date-phrase-that-fails-parsing",
    };

    const response = await post(payload);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: expect.stringContaining("could not parse date phrase"),
    });
  });

  it("routes clear-snooze action to clearSnoozeOperation with correct inputs", async () => {
    const payload: TaskActionPayload = { action: "clear-snooze" };

    mocks.clearSnoozeOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response).toEqual({ status: 200, body: { success: true } });
    expect(mocks.clearSnoozeOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      source: "dashboard",
    });
  });

  it("routes update-fields action to updateTaskFieldsOperation with correct inputs", async () => {
    const payload: TaskActionPayload = {
      action: "update-fields",
      dueDate: "2026-06-30T12:00:00.000Z",
    };

    mocks.updateTaskFieldsOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response).toEqual({ status: 200, body: { success: true } });
    expect(mocks.updateTaskFieldsOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      dueDate: new Date("2026-06-30T12:00:00.000Z"),
      source: "dashboard",
    });
  });

  it("routes complete action to completeOperation with correct inputs", async () => {
    const payload: TaskActionPayload = {
      action: "complete",
    };

    mocks.completeOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response).toEqual({ status: 200, body: { success: true } });
    expect(mocks.completeOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      // W5: dispatcher calls stamp the web surface for gate telemetry.
      surface: "web",
      source: "dashboard",
    });
  });

  it("routes reopen action to reopenTaskOperation with correct inputs", async () => {
    const payload: TaskActionPayload = {
      action: "reopen",
    };

    mocks.reopenTaskOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response).toEqual({ status: 200, body: { success: true } });
    expect(mocks.reopenTaskOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      surface: "web",
      source: "dashboard",
    });
  });

  it("routes undelegate action to undelegateOperation with correct inputs", async () => {
    const payload: TaskActionPayload = {
      action: "undelegate",
    };

    mocks.undelegateOperation.mockResolvedValue({ success: true });

    const response = await post(payload);

    expect(response).toEqual({ status: 200, body: { success: true } });
    expect(mocks.undelegateOperation).toHaveBeenCalledWith({
      taskId: "KS-123",
      source: "dashboard",
    });
  });

  it("returns 400 error for unknown action type", async () => {
    const payload = {
      action: "some-unknown-action",
    } as unknown as TaskActionPayload;

    const response = await post(payload);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "unknown action" });
  });

  it("maps FollowUpServiceError illegal_transition to 409 status code", async () => {
    const payload: TaskActionPayload = {
      action: "complete",
    };

    mocks.completeOperation.mockRejectedValue(
      new FollowUpServiceError("illegal_transition", "Cannot complete a task from backlog directly"),
    );

    const response = await post(payload);

    expect(response).toEqual({
      status: 409,
      body: {
        error: "Cannot complete a task from backlog directly",
        code: "illegal_transition",
      },
    });
  });

  it("maps generic error to 500 status code", async () => {
    const payload: TaskActionPayload = {
      action: "complete",
    };

    mocks.completeOperation.mockRejectedValue(new Error("Database connection lost"));

    const response = await post(payload);

    expect(response).toEqual({
      status: 500,
      body: {
        error: "Database connection lost",
      },
    });
  });
});
