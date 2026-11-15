import { describe, expect, it } from "vitest";
import {
  classifyError,
  CliError,
  EXIT_APP_SETTING_MISSING,
  EXIT_DEPENDENCY_CYCLE,
  EXIT_GENERIC,
  EXIT_HEALTH_FAIL,
  EXIT_TASK_NOT_FOUND,
  EXIT_TRANSITION_DENIED,
  EXIT_WIP_CAP_EXCEEDED,
  HealthCheckFailedError,
  InputValidationError,
  TransitionDeniedError,
} from "../../src/cli/errors.js";
import {
  AppSettingMissingError,
  DbError,
  PZeroWipCapExceededError,
  TaskDependencyCycleError,
  TaskNotFoundError,
} from "../../src/db/errors.js";

describe("classifyError", () => {
  it("maps PZeroWipCapExceededError to EXIT_WIP_CAP_EXCEEDED", () => {
    const err = new PZeroWipCapExceededError(3, 3);
    const summary = classifyError(err);
    expect(summary.exitCode).toBe(EXIT_WIP_CAP_EXCEEDED);
    expect(summary.category).toBe("p0_wip_cap_exceeded");
    expect(summary.details).toEqual({ cap: 3, currentCount: 3 });
  });

  it("maps TaskNotFoundError to EXIT_TASK_NOT_FOUND with id detail", () => {
    const err = new TaskNotFoundError("KS-999");
    const summary = classifyError(err);
    expect(summary.exitCode).toBe(EXIT_TASK_NOT_FOUND);
    expect(summary.category).toBe("task_not_found");
    expect(summary.details).toEqual({ taskId: "KS-999" });
  });

  it("maps AppSettingMissingError to EXIT_APP_SETTING_MISSING", () => {
    const err = new AppSettingMissingError("task_id_prefix");
    const summary = classifyError(err);
    expect(summary.exitCode).toBe(EXIT_APP_SETTING_MISSING);
    expect(summary.category).toBe("app_setting_missing");
    expect(summary.details).toEqual({ key: "task_id_prefix" });
  });

  it("maps TaskDependencyCycleError to EXIT_DEPENDENCY_CYCLE", () => {
    const err = new TaskDependencyCycleError("KS-001", "KS-002");
    const summary = classifyError(err);
    expect(summary.exitCode).toBe(EXIT_DEPENDENCY_CYCLE);
    expect(summary.details).toEqual({
      blockerTaskId: "KS-001",
      blockedTaskId: "KS-002",
    });
  });

  it("maps unknown DbError to EXIT_GENERIC, lowercased category", () => {
    const err = new DbError("SOME_OTHER_CODE", "boom");
    const summary = classifyError(err);
    expect(summary.exitCode).toBe(EXIT_GENERIC);
    expect(summary.category).toBe("some_other_code");
  });

  it("respects CliError exit codes", () => {
    const inputErr = new InputValidationError("bad");
    expect(classifyError(inputErr).exitCode).toBe(inputErr.exitCode);

    const transition = new TransitionDeniedError(
      "done",
      "in_progress",
      "terminal_source",
      "terminal source",
    );
    expect(classifyError(transition).exitCode).toBe(EXIT_TRANSITION_DENIED);

    const health = new HealthCheckFailedError("supabase down");
    expect(classifyError(health).exitCode).toBe(EXIT_HEALTH_FAIL);
  });

  it("maps unknown Error to EXIT_GENERIC unhandled", () => {
    const summary = classifyError(new Error("???"));
    expect(summary.exitCode).toBe(EXIT_GENERIC);
    expect(summary.category).toBe("unhandled");
  });

  it("maps non-Error throws to EXIT_GENERIC unhandled", () => {
    const summary = classifyError("plain string");
    expect(summary.exitCode).toBe(EXIT_GENERIC);
    expect(summary.message).toBe("plain string");
  });

  it("CliError preserves details on classification", () => {
    const err = new CliError("custom", "msg", EXIT_GENERIC, { foo: "bar" });
    const summary = classifyError(err);
    expect(summary.details).toEqual({ foo: "bar" });
  });
});
