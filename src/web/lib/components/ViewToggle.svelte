<script lang="ts">
  import type { ViewMode } from "$lib/utils/filters";

  const DEFAULT_OPTIONS: readonly ViewMode[] = ["inbox", "kanban", "list"];
  const VIEW_LABELS: Record<ViewMode, string> = {
    inbox: "Inbox",
    kanban: "Kanban",
    list: "List",
  };

  let {
    view,
    onChange,
    options = DEFAULT_OPTIONS,
  }: {
    view: ViewMode;
    onChange: (v: ViewMode) => void;
    options?: readonly ViewMode[];
  } = $props();
</script>

<div
  class="inline-flex rounded-full border border-neutral-200 bg-neutral-100/80 p-0.5"
  role="group"
  aria-label="board view mode"
>
  {#each options as option (option)}
    <button
      type="button"
      class="rounded-full px-3 py-1 font-mono text-[11px] font-medium transition-colors {view === option
        ? 'bg-neutral-900 text-white'
        : 'text-neutral-600 hover:bg-neutral-100'}"
      onclick={() => onChange(option)}
    >
      {VIEW_LABELS[option]}
    </button>
  {/each}
</div>
