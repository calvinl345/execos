import { dueLabel, isBeforeLocalDay } from "./dates.js";
import type { DashboardTask } from "../types.js";

export type HandoffControlKind = "handoff" | "nudge";
export type HandoffControlTone = "attention" | "waiting" | "needs-date";

export interface HandoffControlState {
  kind: HandoffControlKind;
  tone: HandoffControlTone;
  buttonLabel: string;
  submitLabel: string;
  statusLabel: string;
}

export function isSelfOwned(task: Pick<DashboardTask, "owner">): boolean {
  const normalized = task.owner?.trim().toLowerCase();
  return !normalized || normalized === "me";
}

export function isTerminal(task: Pick<DashboardTask, "status">): boolean {
  return task.status === "done" || task.status === "cancelled";
}

export function datePhraseForInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const suffix = hours >= 12 ? "pm" : "am";
  const displayHour = hours % 12 || 12;
  return `${month}/${day}/${year} at ${displayHour}:${minutes}${suffix}`;
}

export function isFutureDate(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.getTime() > now.getTime();
}

function isMoreThanOneDayAway(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > now.getTime() + 24 * 60 * 60 * 1000;
}

export function isDueToday(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function shouldDimForWaiting(task: DashboardTask, now: Date = new Date()): boolean {
  if (isTerminal(task)) return true;
  if (isSelfOwned(task)) return isFutureDate(task.snoozed_until, now);
  return task.handoff_state === "copied" && isMoreThanOneDayAway(task.follow_up_date, now);
}

export function secondaryTimingLabel(task: DashboardTask, now: Date = new Date()): string | null {
  if (isSelfOwned(task)) {
    return task.snoozed_until && isFutureDate(task.snoozed_until, now)
      ? `snoozed until ${dueLabel(task.snoozed_until, now)}`
      : null;
  }

  if (task.follow_up_date) return `follow-up ${dueLabel(task.follow_up_date, now)}`;
  return "follow-up not set";
}

export function dueDateStatus(task: DashboardTask, now: Date = new Date()): "overdue" | "today" | "normal" {
  if (isBeforeLocalDay(task.due_date, now)) return "overdue";
  if (isDueToday(task.due_date, now)) return "today";
  return "normal";
}

export function handoffControlState(
  task: DashboardTask,
  now: Date = new Date(),
): HandoffControlState | null {
  if (isSelfOwned(task)) return null;

  if (!task.follow_up_date) {
    return {
      kind: "handoff",
      tone: "needs-date",
      buttonLabel: "Set follow-up",
      submitLabel: "Copy handoff",
      statusLabel: "Needs follow-up date",
    };
  }

  if (task.handoff_state !== "copied") {
    return {
      kind: "handoff",
      tone: "attention",
      buttonLabel: "Copy handoff",
      submitLabel: "Copy handoff",
      statusLabel: "Delegated, not handed off",
    };
  }

  if (isFutureDate(task.follow_up_date, now)) {
    return {
      kind: "handoff",
      tone: "waiting",
      buttonLabel: "Handoff copied",
      submitLabel: "Copy handoff again",
      statusLabel: `Waiting until ${dueLabel(task.follow_up_date, now)}`,
    };
  }

  return {
    kind: "nudge",
    tone: "attention",
    buttonLabel: "Copy nudge",
    submitLabel: "Copy nudge",
    statusLabel: "Follow-up due",
  };
}

export function ownerInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "ME";
  if (parts.length === 1) return parts[0].slice(0, 2).padEnd(2, parts[0][0] ?? "M").toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .padEnd(2, parts[0][0] ?? "M")
    .toUpperCase();
}
