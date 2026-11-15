/**
 * P0 WIP cap proactive-options handler (Appendix A.6.5.1, AC-073).
 *
 * When `enforcePZeroWipCap` rejects a P0 create/update, the CLI does
 * not just bail with an error. It surfaces the four canonical proactive
 * options listed in AC-073 plus a free-text response so the operator
 * can resolve the conflict without restarting the command.
 *
 * Options surfaced (verbatim from AC-073):
 *   (a) downgrade-to-p1     - downgrade the new task itself to P1
 *   (b) demote-existing-p0  - demote one of the currently-open P0 tasks
 *   (c) bump-cap            - raise `app_settings.p0_wip_cap`
 *   (d) hold-in-backlog     - defer the new task at status=backlog
 *
 * AC-073 explicitly forbids a silent bypass / "override and create at
 * P0 anyway" path: the agent must surface options, never auto-decide.
 *
 * The handler itself does not pick the option. It returns a structured
 * description that the CLI can render and that an interactive UX
 * (e.g. an agent skill) can compose into a prompt. Each option's `command`
 * field documents the CLI invocation that executes the option, so a
 * skill or operator can map a selection to the next concrete action.
 * Tests assert that the four AC-073 options and the free-text path are
 * present.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import type { TaskPriority } from "../db/schema.js";

export type WipCapOptionKey =
  | "downgrade-to-p1"
  | "demote-existing-p0"
  | "bump-cap"
  | "hold-in-backlog";

export interface WipCapOption {
  key: WipCapOptionKey;
  label: string;
  description: string;
  /** Concrete CLI invocation that executes this option. The handler
   *  does not run it; it is documented for the skill / operator layer
   *  that maps a selection to the next action. */
  command: string;
  /** Operator must confirm explicitly before this option proceeds. */
  requiresConfirmation: boolean;
}

export interface WipCapDescriptor {
  cap: number;
  currentCount: number;
  /** Existing P0 tasks that block the requested create/update, sorted
   * by created_at desc. Limited to a small number for ergonomics. */
  existingP0: Array<{
    id: string;
    title: string;
    status: string;
    priority: TaskPriority | null;
  }>;
  options: WipCapOption[];
  /** Free-text response is always accepted; the CLI does not constrain
   * the operator to the four listed options. */
  freeTextAccepted: true;
}

const PROACTIVE_OPTIONS: ReadonlyArray<WipCapOption> = Object.freeze([
  Object.freeze({
    key: "downgrade-to-p1" as const,
    label: "Downgrade to P1 (the new task itself becomes P1)",
    description:
      "Lower the priority of the new task from P0 to P1 so it fits under the cap without changing existing work.",
    command: "execos task create ... --due <date> -p P1",
    requiresConfirmation: false,
  }),
  Object.freeze({
    key: "demote-existing-p0" as const,
    label: "Demote an existing P0",
    description:
      "Pick one of the open P0 tasks below and demote it to P1. The new task will then fit under the cap.",
    command: "execos task update <existing-id> -p P1",
    requiresConfirmation: true,
  }),
  Object.freeze({
    key: "bump-cap" as const,
    label: "Bump cap (raise infrastructure.p0_wip_cap)",
    description:
      "Raise the `app_settings.infrastructure.p0_wip_cap` value so the new task fits under the new cap. Operator-only decision.",
    command:
      "UPDATE app_settings SET value = '<new-cap>' WHERE key = 'infrastructure.p0_wip_cap'",
    requiresConfirmation: true,
  }),
  Object.freeze({
    key: "hold-in-backlog" as const,
    label: "Hold in backlog",
    description:
      "Defer the new task at status=backlog (still P0). It will not start in_progress until the cap clears.",
    command:
      "execos task create ... --due <date> -p P0; execos task update <new-id> --status backlog",
    requiresConfirmation: false,
  }),
]);

export async function describeWipCapOptions(
  cap: number,
  currentCount: number,
): Promise<WipCapDescriptor> {
  const existing = await fetchOpenP0(5);
  return {
    cap,
    currentCount,
    existingP0: existing,
    options: PROACTIVE_OPTIONS.map((o) => ({ ...o })),
    freeTextAccepted: true,
  };
}

interface OpenP0Row {
  id: string;
  title: string;
  status: string;
  priority: TaskPriority | null;
}

async function fetchOpenP0(limit: number): Promise<OpenP0Row[]> {
  const rows = await db.execute<OpenP0Row & Record<string, unknown>>(
    sql`SELECT id, title, status, priority FROM tasks
        WHERE priority = 'P0' AND status NOT IN ('done', 'cancelled')
        ORDER BY created_at DESC
        LIMIT ${limit}`,
  );
  return rows as unknown as OpenP0Row[];
}

/**
 * Pure helper exported for tests: build a descriptor from already-known
 * cap state and a candidate list, without DB access. The CLI uses this
 * shape for `--format json` rendering.
 */
export function buildWipCapDescriptor(args: {
  cap: number;
  currentCount: number;
  existingP0: OpenP0Row[];
}): WipCapDescriptor {
  return {
    cap: args.cap,
    currentCount: args.currentCount,
    existingP0: args.existingP0,
    options: PROACTIVE_OPTIONS.map((o) => ({ ...o })),
    freeTextAccepted: true,
  };
}
