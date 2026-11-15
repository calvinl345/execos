/**
 * Copy-context prompt builder (S10/A12).
 *
 * The copied prompt is deliberately small and live, not a context dump: id,
 * title, a compact state snapshot, and an instruction to pull full live
 * context via `execos taskops show <id>` (the id is positional; the command
 * has no --task-id flag). One prompt covers any follow-on intent because the
 * agent hydrates the rest itself.
 */

import type { DashboardTask } from "../types.js";
import { shouldShowQueueRationale } from "./queue-rationale-card.js";

function datePart(value: string | null): string {
  if (value === null) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "none";
  return value.slice(0, 10);
}

export function buildAgentContextPrompt(task: DashboardTask): string {
  const lines: string[] = [];
  lines.push(`Task ${task.id}: ${task.title}`);

  const snapshot = [
    `status ${task.status}`,
    `priority ${task.priority ?? "none"}`,
    `due ${datePart(task.due_date)}${task.hard_deadline ? " (hard deadline)" : ""}`,
    `owner ${task.owner ?? "me"}`,
  ];
  if (task.follow_up_date !== null) {
    snapshot.push(`follow-up ${datePart(task.follow_up_date)}`);
  }
  lines.push(`Snapshot: ${snapshot.join(" | ")}`);

  if (shouldShowQueueRationale(task)) {
    lines.push(
      `Queue: #${task.queue_rank} of 5${task.queue_rationale ? ` (${task.queue_rationale})` : ""}`,
    );
  }

  lines.push(
    `Run \`execos taskops show ${task.id}\` for full live context, then help me with what I ask next.`,
  );
  return lines.join("\n");
}
