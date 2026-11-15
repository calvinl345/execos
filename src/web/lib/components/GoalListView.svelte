<script lang="ts">
  import type { GoalStatus, GoalSummary } from "$lib/types";
  import { relativeAgo } from "$lib/utils/dates";
  import IdBadge from "./IdBadge.svelte";

  let {
    goals,
    onNavigate,
  }: {
    goals: GoalSummary[];
    onNavigate: (id: string) => void;
  } = $props();

  const statusDot: Record<GoalStatus, string> = {
    active: "bg-blue-500",
    achieved: "bg-purple-500",
    dropped: "bg-red-500",
  };

  function openFromKeyboard(event: KeyboardEvent, goalId: string): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onNavigate(goalId);
  }
</script>

<div
  class="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
>
  <table class="w-full min-w-[46rem] border-collapse text-left">
    <thead>
      <tr class="border-b border-neutral-200 bg-neutral-50/80">
        <th class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          ID
        </th>
        <th class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Goal
        </th>
        <th class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Status
        </th>
        <th class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Quarter
        </th>
        <th class="px-3 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Active Tasks
        </th>
        <th class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Updated
        </th>
      </tr>
    </thead>
    <tbody>
      {#each goals as goal (goal.id)}
        <tr
          role="button"
          tabindex="0"
          aria-label="open {goal.id}"
          class="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
          onclick={() => onNavigate(goal.id)}
          onkeydown={(event) => openFromKeyboard(event, goal.id)}
        >
          <td class="px-3 py-3 align-middle">
            <IdBadge id={goal.id} dim />
          </td>
          <td class="px-3 py-3 align-middle">
            <div class="max-w-[28rem]">
              <p class="line-clamp-1 text-[13px] font-medium text-neutral-900">{goal.title}</p>
              <p class="mt-0.5 line-clamp-1 text-[12px] text-neutral-500">{goal.description}</p>
            </div>
          </td>
          <td class="px-3 py-3 align-middle">
            <span class="inline-flex items-center gap-1.5 font-mono text-[11px] text-neutral-700">
              <span class="h-1.5 w-1.5 shrink-0 rounded-full {statusDot[goal.status]}"></span>
              {goal.status}
            </span>
          </td>
          <td class="px-3 py-3 align-middle font-mono text-[11px] text-neutral-700">
            {goal.quarter}
          </td>
          <td class="px-3 py-3 text-right align-middle font-mono text-[11px] text-neutral-700">
            {goal.active_task_count}
          </td>
          <td class="px-3 py-3 align-middle font-mono text-[11px] text-neutral-500">
            {relativeAgo(goal.updated_at)}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="6" class="px-3 py-12 text-center text-[12px] text-neutral-400">
            no goals match these filters
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
