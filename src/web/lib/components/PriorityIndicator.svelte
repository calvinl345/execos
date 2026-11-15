<script lang="ts">
  import type { TaskPriority } from "$lib/types.js";
  import { TASK_PRIORITY_META } from "$lib/utils/flags.js";

  let { priority }: { priority: TaskPriority | null } = $props();

  const meta = $derived(priority ? TASK_PRIORITY_META[priority] : null);
</script>

{#if meta}
  <span
    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold leading-none ring-1 ring-inset {meta.chipClass}"
    title="{meta.label}: {meta.description} priority"
    aria-label="{meta.label} {meta.description} priority"
    data-mono
  >
    {meta.label}
  </span>
{:else}
  <span
    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-neutral-300 font-mono text-[9px] font-semibold leading-none text-neutral-400 dark:border-neutral-600 dark:text-neutral-500"
    title="No priority set"
    aria-label="No priority set"
    data-mono
  >
    -
  </span>
{/if}
