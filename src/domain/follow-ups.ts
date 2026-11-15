export type FollowUpTaskStatus =
  | "triage"
  | "backlog"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "cancelled";

export interface FollowUpTaskLike {
  id: string;
  title: string;
  status: FollowUpTaskStatus;
  owner: string | null;
  dueDate: Date | null;
  followUpDate: Date | null;
  snoozedUntil?: Date | null;
  description?: string | null;
}

export interface FollowUpDraftItem extends FollowUpTaskLike {
  expectation?: string | null;
  lastContact?: string | null;
}

export interface TeamMemberLike {
  slug: string;
  displayName: string;
  email?: string | null;
}

export type OwnerResolution =
  | { status: "resolved"; slug: string; displayName: string; member: TeamMemberLike }
  | { status: "unresolved"; input: string }
  | { status: "ambiguous"; input: string; matches: TeamMemberLike[] };

const TERMINAL_STATUSES = new Set<FollowUpTaskStatus>(["done", "cancelled"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NO_DUE_DAYS = 7;
const NEAR_DEADLINE_DAYS = 2;

export function dueFollowUpTasks<T extends FollowUpTaskLike>(tasks: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return tasks.filter(
    (task) =>
      !TERMINAL_STATUSES.has(task.status) &&
      normalizedOwner(task.owner) !== "me" &&
      task.followUpDate !== null &&
      task.followUpDate.getTime() <= nowMs,
  );
}

export function followUpSurfaceVerb(task: Pick<FollowUpTaskLike, "owner">): string {
  return `follow up with ${task.owner?.trim() ?? "unassigned"}`;
}

export function defaultFollowUpDate(args: {
  now: Date;
  dueDate?: Date | null;
}): Date {
  const { now, dueDate = null } = args;
  if (!dueDate) return addDays(now, DEFAULT_NO_DUE_DAYS);

  const midpoint = new Date(now.getTime() + (dueDate.getTime() - now.getTime()) / 2);
  if (midpoint.getTime() - now.getTime() < NEAR_DEADLINE_DAYS * DAY_MS) {
    return addDays(now, 1);
  }
  return midpoint;
}

export function groupFollowUpsByPerson<T extends FollowUpTaskLike>(
  tasks: T[],
): Array<{ person: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const person = task.owner?.trim() || "unassigned";
    groups.set(person, [...(groups.get(person) ?? []), task]);
  }
  return Array.from(groups.entries())
    .map(([person, items]) => ({
      person,
      items: items.slice().sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.person.localeCompare(b.person));
}

export function formatDraftContextBlock(group: {
  person: string;
  items: FollowUpDraftItem[];
}): string {
  if (group.items.length === 0) {
    return `## ${group.person}\nNo due follow-ups.`;
  }

  const lines = [`## ${group.person}`, `Items: ${group.items.length}`];
  for (const item of group.items) {
    lines.push("");
    lines.push(`- ${item.id}: ${item.title}`);
    lines.push(`  Surface verb: ${followUpSurfaceVerb(item)}`);
    lines.push(`  Status: ${item.status}`);
    lines.push(`  Work due: ${formatDate(item.dueDate)}`);
    lines.push(`  Follow-up due: ${formatDate(item.followUpDate)}`);
    lines.push(`  Expectation: ${item.expectation?.trim() || item.description?.trim() || "-"}`);
    lines.push(`  Last contact: ${item.lastContact?.trim() || "-"}`);
  }
  return lines.join("\n");
}

export function followUpAfterDueWarning(args: {
  followUpDate: Date | null;
  dueDate: Date | null;
}): { warning: false } | { warning: true; message: string } {
  if (!args.followUpDate || !args.dueDate || args.followUpDate.getTime() <= args.dueDate.getTime()) {
    return { warning: false };
  }
  return {
    warning: true,
    message: "Follow-up date is after the task due date; ask whether to move the due date.",
  };
}

export function resolveOwnerToTeamSlug(input: string, team: TeamMemberLike[]): OwnerResolution {
  const raw = input.trim();
  if (raw === "") return { status: "unresolved", input };

  const query = normalize(raw);
  const exact = team.filter(
    (member) =>
      normalize(member.slug) === query ||
      normalize(member.displayName) === query ||
      normalize(member.email ?? "") === query,
  );
  if (exact.length === 1) return resolved(exact[0]);
  if (exact.length > 1) return { status: "ambiguous", input, matches: exact };

  const loose = team.filter((member) => {
    const names = normalize(member.displayName).split(" ").filter(Boolean);
    return names.includes(query) || normalize(member.slug).split("-").includes(query);
  });
  if (loose.length === 1) return resolved(loose[0]);
  if (loose.length > 1) return { status: "ambiguous", input, matches: loose };

  return { status: "unresolved", input };
}

function resolved(member: TeamMemberLike): OwnerResolution {
  return {
    status: "resolved",
    slug: member.slug,
    displayName: member.displayName,
    member,
  };
}

export function requireFollowUpForDelegatedOwner(
  owner: string | null | undefined,
  followUpDate: Date | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (normalizedOwner(owner) === "me") {
    return { ok: true };
  }
  if (followUpDate == null) {
    return { ok: false, reason: "A delegated task must have a follow-up date" };
  }
  return { ok: true };
}

export function normalizedOwner(owner: string | null | undefined): string {
  return (owner?.trim() || "me").toLowerCase();
}

/**
 * True when the owner value normalizes to the self owner ("me").
 * Null/undefined/empty/whitespace and case variants all count as self;
 * anything else is a delegated owner and must route through delegation.
 */
export function isSelfOwner(owner: string | null | undefined): boolean {
  return normalizedOwner(owner) === "me";
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function formatDate(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "-";
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
