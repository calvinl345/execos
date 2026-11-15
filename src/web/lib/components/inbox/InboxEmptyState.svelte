<script lang="ts">
  import { CheckCircle, Inbox, MousePointerClick, Search, X } from "@lucide/svelte";
  import Kbd from "../Kbd.svelte";

  let {
    variant,
    query = "",
    onClearSearch,
    onShowShortcuts,
  }: {
    variant: "followups-empty" | "tasks-empty" | "search-no-results" | "no-selection";
    query?: string;
    onClearSearch?: () => void;
    onShowShortcuts?: () => void;
  } = $props();
</script>

<div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-6 py-12 text-center dark:border-neutral-700 dark:bg-neutral-900/40">
  {#if variant === "no-selection"}
    <MousePointerClick class="mb-3 h-8 w-8 text-neutral-400" />
    <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">No task selected</h3>
    <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Choose a row to fill this detail panel.</p>
    {#if onShowShortcuts}
      <button
        type="button"
        onclick={onShowShortcuts}
        class="mt-4 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <Kbd>?</Kbd>
        Keyboard shortcuts
      </button>
    {/if}
  {:else if variant === "followups-empty"}
    <CheckCircle class="mb-3 h-8 w-8 text-emerald-500" />
    <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Nothing to chase right now</h3>
    <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">All delegated tasks are up to date.</p>
  {:else if variant === "tasks-empty"}
    <Inbox class="mb-3 h-8 w-8 text-neutral-400" />
    <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Inbox zero</h3>
    <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">No active tasks in your queue.</p>
  {:else}
    <Search class="mb-3 h-8 w-8 text-neutral-400" />
    <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">No tasks match "{query}"</h3>
    <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Try adjusting your keywords.</p>
    {#if onClearSearch}
      <button
        type="button"
        onclick={onClearSearch}
        class="mt-4 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <X class="h-3.5 w-3.5" />
        Clear search
      </button>
    {/if}
  {/if}
</div>
