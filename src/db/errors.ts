/**
 * Typed errors raised by db helpers.
 *
 * Each error has a stable `code` so CLI handlers can switch on it and
 * surface user-friendly messages (per Appendix A.6.5.1 for the WIP cap
 * proactive-options UX).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export class DbError extends Error {
  public readonly code: string;
  public override readonly cause?: unknown;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.code = code;
    this.cause = options?.cause;
    this.name = "DbError";
  }
}

export class PZeroWipCapExceededError extends DbError {
  public readonly cap: number;
  public readonly currentCount: number;

  constructor(currentCount: number, cap: number) {
    super(
      "P0_WIP_CAP_EXCEEDED",
      `P0 work-in-progress cap of ${cap} would be exceeded (current: ${currentCount}).`,
    );
    this.name = "PZeroWipCapExceededError";
    this.cap = cap;
    this.currentCount = currentCount;
  }
}

export class TaskDependencyCycleError extends DbError {
  public readonly blockerTaskId: string;
  public readonly blockedTaskId: string;

  constructor(blockerTaskId: string, blockedTaskId: string) {
    super(
      "TASK_DEPENDENCY_CYCLE",
      `Adding dependency '${blockerTaskId} blocks ${blockedTaskId}' would create a cycle.`,
    );
    this.name = "TaskDependencyCycleError";
    this.blockerTaskId = blockerTaskId;
    this.blockedTaskId = blockedTaskId;
  }
}

export class TaskNotFoundError extends DbError {
  public readonly taskId: string;

  constructor(taskId: string) {
    super("TASK_NOT_FOUND", `Task '${taskId}' was not found.`);
    this.name = "TaskNotFoundError";
    this.taskId = taskId;
  }
}

export class GoalNotFoundError extends DbError {
  public readonly goalId: string;

  constructor(goalId: string) {
    super("GOAL_NOT_FOUND", `Goal '${goalId}' was not found.`);
    this.name = "GoalNotFoundError";
    this.goalId = goalId;
  }
}

export class AppSettingMissingError extends DbError {
  public readonly key: string;

  constructor(key: string) {
    super(
      "APP_SETTING_MISSING",
      `app_settings has no row for key '${key}'. Seed required at install time.`,
    );
    this.name = "AppSettingMissingError";
    this.key = key;
  }
}
