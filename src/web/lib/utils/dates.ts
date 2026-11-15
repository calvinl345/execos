/**
 * Pure date helpers for the dashboard.
 *
 * Server-rendered output: dates are formatted with the user's TZ (per
 * Appendix H.8.1, the dashboard relies on the host's Intl). Each function
 * here takes an optional `now` parameter so unit tests can pin time.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function dueLabel(due: Date | string | null, now: Date = new Date()): string {
  if (!due) return "no due date";
  const d = typeof due === "string" ? new Date(due) : due;
  if (Number.isNaN(d.getTime())) return "no due date";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function relativeAgo(at: Date | string | null, now: Date = new Date()): string {
  if (!at) return "never";
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "never";
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function shortWeekday(at: Date | string | null): string {
  if (!at) return "—";
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function daysOverdue(due: Date | string | null, now: Date = new Date()): number {
  if (!due) return 0;
  const d = typeof due === "string" ? new Date(due) : due;
  if (Number.isNaN(d.getTime())) return 0;
  const diff = now.getTime() - d.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

export function isBeforeLocalDay(at: Date | string | null, now: Date = new Date()): boolean {
  if (!at) return false;
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return false;
  return localDayStart(d).getTime() < localDayStart(now).getTime();
}

export function daysSince(at: Date | string | null, now: Date = new Date()): number {
  if (!at) return Infinity;
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return Infinity;
  return Math.floor((now.getTime() - d.getTime()) / DAY_MS);
}

function localDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
