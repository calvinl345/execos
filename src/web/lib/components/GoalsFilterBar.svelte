<script lang="ts">
  import type { GoalStatus } from "$lib/types";
  import type { GoalsBoardViewMode } from "$lib/utils/dashboard-url.js";
  import type { ViewMode } from "$lib/utils/filters";
  import { ChevronDown } from "@lucide/svelte";
  import { DropdownMenu } from "bits-ui";
  import ViewToggle from "./ViewToggle.svelte";

  let {
    status,
    quarter,
    view,
    quarters,
    showClosed,
    onChange,
    onViewChange,
    onShowClosedChange,
  }: {
    status: GoalStatus | "all";
    quarter: string | "all";
    view: GoalsBoardViewMode;
    quarters: string[];
    showClosed: boolean;
    onChange: (next: { status?: GoalStatus | "all"; quarter?: string | "all" }) => void;
    onViewChange: (view: GoalsBoardViewMode) => void;
    onShowClosedChange: (showClosed: boolean) => void;
  } = $props();

  let statusOpen = $state(false);
  let quarterOpen = $state(false);
  let barEl: HTMLDivElement | undefined = $state();

  function pickStatus(next: GoalStatus | "all") {
    onChange({ status: next });
  }

  function pickQuarter(next: string | "all") {
    onChange({ quarter: next });
  }

  function clearAll() {
    onChange({ status: showClosed ? "all" : "active", quarter: "all" });
  }

  function handleViewChange(next: ViewMode) {
    if (next === "kanban" || next === "list") {
      onViewChange(next);
    }
  }

  const showClear = $derived(status !== (showClosed ? "all" : "active") || quarter !== "all");

  const triggerBase =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors";
  const triggerIdle =
    "border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white";
  const triggerOpen = "border-neutral-400 bg-white text-neutral-900 shadow-sm";

  const STATUS_OPTIONS: (GoalStatus | "all")[] = ["all", "active", "achieved", "dropped"];
  const GOALS_VIEW_OPTIONS: readonly GoalsBoardViewMode[] = ["kanban", "list"];
</script>

<div
  bind:this={barEl}
  class="relative mb-6 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
>
  <div class="flex flex-wrap items-end gap-x-3 gap-y-3">
    <DropdownMenu.Root bind:open={statusOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter goals by status"
        class="{triggerBase} {statusOpen ? triggerOpen : triggerIdle}"
      >
        <span class="font-medium uppercase tracking-wider text-neutral-600">Status</span>
        <span class="text-neutral-500">({status})</span>
        <ChevronDown
          class="h-3 w-3 text-neutral-400 transition-transform {statusOpen
            ? 'rotate-180'
            : ''}"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          class="z-50 min-w-[11rem] rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <DropdownMenu.RadioGroup value={status} onValueChange={(v) => pickStatus(v as GoalStatus | "all")}>
            {#each STATUS_OPTIONS as st (st)}
              <DropdownMenu.RadioItem
                value={st}
                class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left font-mono text-[11px] outline-none select-none hover:bg-neutral-50 dark:hover:bg-neutral-800 {status === st
                  ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                  : 'text-neutral-800 dark:text-neutral-200'}"
              >
                {st}
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <DropdownMenu.Root bind:open={quarterOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter goals by quarter"
        class="{triggerBase} {quarterOpen ? triggerOpen : triggerIdle}"
      >
        <span class="font-medium uppercase tracking-wider text-neutral-600">Quarter</span>
        <span class="text-neutral-500">({quarter === "all" ? "all" : quarter})</span>
        <ChevronDown
          class="h-3 w-3 text-neutral-400 transition-transform {quarterOpen
            ? 'rotate-180'
            : ''}"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          class="z-50 min-w-[10rem] rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <DropdownMenu.RadioGroup value={quarter} onValueChange={(v) => pickQuarter(v)}>
            <DropdownMenu.RadioItem
              value="all"
              class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left font-mono text-[11px] outline-none select-none hover:bg-neutral-50 dark:hover:bg-neutral-800 {quarter === 'all'
                ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                : 'text-neutral-800 dark:text-neutral-200'}"
            >
              all
            </DropdownMenu.RadioItem>
            {#each quarters as q (q)}
              <DropdownMenu.RadioItem
                value={q}
                class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left font-mono text-[11px] outline-none select-none hover:bg-neutral-50 dark:hover:bg-neutral-800 {quarter === q
                  ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                  : 'text-neutral-800 dark:text-neutral-200'}"
              >
                {q}
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <div class="ml-auto flex items-center gap-3">
      <label
        class="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 font-mono text-[11px] transition-colors {showClosed
          ? 'border-neutral-400 bg-white text-neutral-900 shadow-sm'
          : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white'}"
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-neutral-900"
          checked={showClosed}
          onchange={(e) => onShowClosedChange(e.currentTarget.checked)}
        />
        <span class="font-medium uppercase tracking-wider">Show Closed</span>
      </label>
      {#if showClear}
        <button
          type="button"
          class="font-mono text-[11px] font-medium text-neutral-600 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
          onclick={clearAll}
        >
          Clear all
        </button>
      {/if}
      <ViewToggle {view} options={GOALS_VIEW_OPTIONS} onChange={handleViewChange} />
    </div>
  </div>
</div>
