<script lang="ts">
  import type { DashboardTask } from "$lib/types";
  import { columnsFor, groupByColumn, type ColumnId } from "$lib/utils/buckets";
  import type { TaskCardFieldPreferences } from "$lib/utils/task-card-fields";
  import TaskCard from "./TaskCard.svelte";
  import { Plus } from "@lucide/svelte";

  let {
    tasks,
    onNavigate,
    cardFieldPrefs,
    showClosed,
  }: {
    tasks: DashboardTask[];
    onNavigate: (id: string) => void;
    cardFieldPrefs: TaskCardFieldPreferences;
    showClosed: boolean;
  } = $props();

  let columns = $derived(columnsFor(showClosed));
  let grouped = $derived(groupByColumn(tasks, showClosed));

  const columnMarkerByCol: Record<ColumnId, string> = {
    triage: "bg-neutral-300",
    backlog: "bg-neutral-500",
    in_progress: "bg-blue-500",
    blocked: "bg-amber-500",
    review: "bg-purple-500",
    closed: "bg-emerald-500",
  };
</script>

<div
  class="grid grid-cols-1 gap-4 md:grid-cols-2 {showClosed
    ? 'lg:grid-cols-3 2xl:grid-cols-6'
    : 'lg:grid-cols-5'}"
>
  {#each columns as col (col.id)}
    {@const items = grouped[col.id]}
    <div class="flex flex-col">
      <header class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="h-3.5 w-1 rounded-full {columnMarkerByCol[col.id]}"></span>
          <span class="font-mono text-[11px] font-medium uppercase tracking-wider text-neutral-600"
            >{col.label}</span
          >
          <span class="font-mono text-[11px] text-neutral-400">{items.length}</span>
        </div>
        <button
          class="rounded p-0.5 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-500"
          aria-label="add task"
          disabled
        >
          <Plus class="h-4 w-4" />
        </button>
      </header>
      <div class="flex flex-col gap-2.5">
        {#each items as task (task.id)}
          <TaskCard {task} column={col.id} {onNavigate} {cardFieldPrefs} />
        {/each}
        {#if items.length === 0}
          <div class="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center">
            <p class="text-[11px] text-neutral-400">no tasks</p>
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>
