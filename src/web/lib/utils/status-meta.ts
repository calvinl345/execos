import type { TaskStatus } from "../types.js";

export const TASK_STATUS_META: Record<
  TaskStatus,
  {
    pillClass: string;
    dotClass: string;
  }
> = {
  triage: {
    pillClass:
      "bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-700/50 dark:text-neutral-100 dark:ring-neutral-600",
    dotClass: "bg-neutral-500 dark:bg-neutral-300",
  },
  backlog: {
    pillClass:
      "bg-neutral-50 text-neutral-600 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700",
    dotClass: "bg-neutral-400 dark:bg-neutral-500",
  },
  in_progress: {
    pillClass:
      "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30",
    dotClass: "bg-blue-500 dark:bg-blue-400",
  },
  blocked: {
    pillClass:
      "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
    dotClass: "bg-amber-500 dark:bg-amber-400",
  },
  review: {
    pillClass:
      "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:ring-purple-500/30",
    dotClass: "bg-purple-500 dark:bg-purple-400",
  },
  done: {
    pillClass:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    dotClass: "bg-emerald-500 dark:bg-emerald-400",
  },
  cancelled: {
    pillClass:
      "bg-neutral-50 text-neutral-500 ring-neutral-200 dark:bg-neutral-800/70 dark:text-neutral-400 dark:ring-neutral-700",
    dotClass: "bg-neutral-300 dark:bg-neutral-600",
  },
};
