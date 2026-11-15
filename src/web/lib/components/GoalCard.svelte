<script lang="ts">
  import IdBadge from "./IdBadge.svelte";
  import type { GoalSummary } from "$lib/types";

  let {
    goal,
    onNavigate,
  }: {
    goal: GoalSummary;
    onNavigate: (id: string) => void;
  } = $props();

  const statusDot = $derived(
    goal.status === "active"
      ? "bg-emerald-500"
      : goal.status === "achieved"
        ? "bg-purple-500"
        : "bg-red-500",
  );
</script>

<button
  type="button"
  class="w-full rounded-lg border border-neutral-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow hover:border-neutral-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
  onclick={() => onNavigate(goal.id)}
>
  <div class="mb-2 flex items-center justify-between gap-2">
    <IdBadge id={goal.id} />
    <span class="inline-flex items-center gap-1 font-mono text-[11px] text-neutral-600">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full {statusDot}" aria-hidden="true"></span>
      {goal.status}
    </span>
  </div>
  <p class="text-[14px] font-medium text-neutral-900">{goal.title}</p>
  <p class="mt-1 line-clamp-2 text-[12px] text-neutral-600">{goal.description}</p>
  <div class="mt-3 flex items-center justify-between gap-2">
    <span
      class="inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-neutral-700 ring-1 ring-inset ring-neutral-200"
      >{goal.quarter}</span
    >
    <span class="font-mono text-[11px] text-neutral-500">
      {goal.active_task_count === 0 ? "no active tasks" : `${goal.active_task_count} active tasks`}
    </span>
  </div>
</button>
