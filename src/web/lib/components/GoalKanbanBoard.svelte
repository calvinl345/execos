<script lang="ts">
  import type { GoalStatus, GoalSummary } from "$lib/types";
  import GoalCard from "./GoalCard.svelte";

  let {
    goals,
    onNavigate,
    showClosed,
  }: {
    goals: GoalSummary[];
    onNavigate: (id: string) => void;
    showClosed: boolean;
  } = $props();

  const COLUMNS: { id: GoalStatus; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "achieved", label: "Achieved" },
    { id: "dropped", label: "Dropped" },
  ];
  const columns = $derived(showClosed ? COLUMNS : COLUMNS.filter((col) => col.id === "active"));

  const columnDotByStatus: Record<GoalStatus, string> = {
    active: "bg-blue-500",
    achieved: "bg-purple-500",
    dropped: "bg-red-500",
  };

  let grouped = $derived.by(() => {
    const out: Record<GoalStatus, GoalSummary[]> = {
      active: [],
      achieved: [],
      dropped: [],
    };
    for (const goal of goals) {
      out[goal.status].push(goal);
    }
    return out;
  });
</script>

<div class="grid grid-cols-1 gap-4 {showClosed ? 'md:grid-cols-3' : 'md:grid-cols-1'}">
  {#each columns as col (col.id)}
    {@const items = grouped[col.id]}
    <div class="flex flex-col">
      <header class="mb-3 flex items-center gap-2">
        <span class="h-2 w-2 rounded-full {columnDotByStatus[col.id]}"></span>
        <span class="font-mono text-[11px] font-medium uppercase tracking-wider text-neutral-600">
          {col.label}
        </span>
        <span class="font-mono text-[11px] text-neutral-400">{items.length}</span>
      </header>
      <div class="flex flex-col gap-2.5">
        {#each items as goal (goal.id)}
          <GoalCard {goal} {onNavigate} />
        {/each}
        {#if items.length === 0}
          <div class="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center">
            <p class="text-[11px] text-neutral-400">no goals</p>
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>
