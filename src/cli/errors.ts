/**
 * CLI error catalog and structured exit codes.
 *
 * Every error surfaced to the shell maps to a stable numeric exit code
 * so downstream callers (skills, scripts, the dashboard) can branch on
 * a small, fixed set of outcomes rather than parsing stderr text.
 *
 * Code ranges (reserve room per category):
 *   0    success
 *   1    generic / unclassified failure
 *   10-19  input / argument errors
 *   20-29  not-found errors (task, goal, app_settings row)
 *   30-39  policy / transition denials
 *   40-49  WIP cap and similar capacity errors
 *   50-59  storage and downstream service errors
 *   60-69  health probe failures
 *   70-79  configuration / environment errors
 *
 * The mapping is intentionally narrow: every domain error from src/db
 * has a single home here. Adding a new error class without registering
 * it falls back to exit code 1 (generic failure) and is visible to the
 * reader of CLI output, which is the desired tripwire.
 */

import {
  AppSettingMissingError,
  DbError,
  GoalNotFoundError,
  PZeroWipCapExceededError,
  TaskDependencyCycleError,
  TaskNotFoundError,
} from "../db/errors.js";

export const EXIT_OK = 0;
export const EXIT_GENERIC = 1;
export const EXIT_INPUT = 10;
export const EXIT_INPUT_VALIDATION = 11;
export const EXIT_NOT_FOUND = 20;
export const EXIT_TASK_NOT_FOUND = 21;
export const EXIT_APP_SETTING_MISSING = 22;
export const EXIT_GOAL_NOT_FOUND = 23;
export const EXIT_POLICY = 30;
export const EXIT_TRANSITION_DENIED = 31;
export const EXIT_DEPENDENCY_CYCLE = 32;
export const EXIT_WIP_CAP_EXCEEDED = 40;
export const EXIT_STORAGE = 50;
export const EXIT_HEALTH_FAIL = 60;
export const EXIT_CONFIG = 70;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_GENERIC
  | typeof EXIT_INPUT
  | typeof EXIT_INPUT_VALIDATION
  | typeof EXIT_NOT_FOUND
  | typeof EXIT_TASK_NOT_FOUND
  | typeof EXIT_APP_SETTING_MISSING
  | typeof EXIT_GOAL_NOT_FOUND
  | typeof EXIT_POLICY
  | typeof EXIT_TRANSITION_DENIED
  | typeof EXIT_DEPENDENCY_CYCLE
  | typeof EXIT_WIP_CAP_EXCEEDED
  | typeof EXIT_STORAGE
  | typeof EXIT_HEALTH_FAIL
  | typeof EXIT_CONFIG;

export class CliError extends Error {
  public readonly exitCode: ExitCode;
  public readonly category: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    category: string,
    message: string,
    exitCode: ExitCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CliError";
    this.category = category;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class InputValidationError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("input_validation", message, EXIT_INPUT_VALIDATION, details);
    this.name = "InputValidationError";
  }
}

export class TransitionDeniedError extends CliError {
  public readonly fromStatus: string;
  public readonly toStatus: string;
  public readonly denyReason: string;

  constructor(
    fromStatus: string,
    toStatus: string,
    denyReason: string,
    message: string,
  ) {
    super("transition_denied", message, EXIT_TRANSITION_DENIED, {
      from: fromStatus,
      to: toStatus,
      reason: denyReason,
    });
    this.name = "TransitionDeniedError";
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.denyReason = denyReason;
  }
}

export class HealthCheckFailedError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("health_fail", message, EXIT_HEALTH_FAIL, details);
    this.name = "HealthCheckFailedError";
  }
}

export class ResourceStorageError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("resource_storage", message, EXIT_STORAGE, details);
    this.name = "ResourceStorageError";
  }
}

export interface CliErrorSummary {
  category: string;
  message: string;
  exitCode: ExitCode;
  details?: Record<string, unknown>;
}

/**
 * Classify any thrown value into a CliErrorSummary. The CLI entry point
 * runs every command inside a single try/catch; this function decides
 * the exit code and surface message.
 */
export function classifyError(err: unknown): CliErrorSummary {
  if (err instanceof CliError) {
    return {
      category: err.category,
      message: err.message,
      exitCode: err.exitCode,
      ...(err.details ? { details: err.details } : {}),
    };
  }
  if (err instanceof PZeroWipCapExceededError) {
    return {
      category: "p0_wip_cap_exceeded",
      message: err.message,
      exitCode: EXIT_WIP_CAP_EXCEEDED,
      details: { cap: err.cap, currentCount: err.currentCount },
    };
  }
  if (err instanceof TaskNotFoundError) {
    return {
      category: "task_not_found",
      message: err.message,
      exitCode: EXIT_TASK_NOT_FOUND,
      details: { taskId: err.taskId },
    };
  }
  if (err instanceof GoalNotFoundError) {
    return {
      category: "goal_not_found",
      message: err.message,
      exitCode: EXIT_GOAL_NOT_FOUND,
      details: { goalId: err.goalId },
    };
  }
  if (err instanceof AppSettingMissingError) {
    return {
      category: "app_setting_missing",
      message: err.message,
      exitCode: EXIT_APP_SETTING_MISSING,
      details: { key: err.key },
    };
  }
  if (err instanceof TaskDependencyCycleError) {
    return {
      category: "task_dependency_cycle",
      message: err.message,
      exitCode: EXIT_DEPENDENCY_CYCLE,
      details: {
        blockerTaskId: err.blockerTaskId,
        blockedTaskId: err.blockedTaskId,
      },
    };
  }
  if (err instanceof DbError) {
    return {
      category: err.code.toLowerCase(),
      message: err.message,
      exitCode: EXIT_GENERIC,
    };
  }
  if (err instanceof Error) {
    return {
      category: "unhandled",
      message: err.message,
      exitCode: EXIT_GENERIC,
    };
  }
  return {
    category: "unhandled",
    message: String(err),
    exitCode: EXIT_GENERIC,
  };
}
