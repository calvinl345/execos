<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { Check, ChevronDown } from "@lucide/svelte";
  import { DropdownMenu } from "bits-ui";
  import {
    hasActiveResourceFilters,
    isWellFormedResourceTaskId,
    RESOURCE_CATEGORY_VALUES,
    type ResourceFilters,
  } from "../../routes/resources/resource-filters.js";
  import type { TaskCategory } from "$lib/types.js";

  let {
    filters,
    totalCount,
    filteredCount,
    onChange,
  }: {
    filters: ResourceFilters;
    totalCount: number;
    filteredCount: number;
    onChange: (next: Partial<ResourceFilters>) => void;
  } = $props();

  let categoryOpen = $state(false);
  let barEl: HTMLDivElement | undefined = $state();

  let searchInput: HTMLInputElement | undefined = $state();
  let searchDraft = $state(untrack(() => filters.q));
  let searchDebounceId: ReturnType<typeof setTimeout> | undefined;
  let restoreFocusAfterCommit = false;

  let taskDraft = $state(untrack(() => filters.task ?? ""));

  let lastSeenQ = $state(untrack(() => filters.q));
  $effect(() => {
    if (filters.q !== lastSeenQ) {
      searchDraft = filters.q;
      lastSeenQ = filters.q;
    }
  });

  let lastSeenTask = $state(untrack(() => filters.task));
  $effect(() => {
    if (filters.task !== lastSeenTask) {
      taskDraft = filters.task ?? "";
      lastSeenTask = filters.task;
    }
  });

  // After a committed navigation, restore focus if needed
  $effect(() => {
    void filters.q;
    if (!restoreFocusAfterCommit) return;
    restoreFocusAfterCommit = false;
    searchInput?.focus();
  });

  onDestroy(() => {
    clearTimeout(searchDebounceId);
  });

  function scheduleSearchCommit() {
    clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => {
      const next = searchDraft.trim();
      if (next === filters.q.trim()) {
        return;
      }
      restoreFocusAfterCommit = document.activeElement === searchInput;
      onChange({ q: next });
    }, 200);
  }

  function toggleCategory(category: TaskCategory, checked: boolean) {
    const next = new SvelteSet(filters.categories);
    if (checked) next.add(category);
    else next.delete(category);
    onChange({ categories: next });
  }

  function commitTaskDraft(value: string) {
    const normalized = value.trim().toUpperCase();
    taskDraft = normalized;

    if (normalized === "") {
      if (filters.task !== null) onChange({ task: null });
      return;
    }

    if (isWellFormedResourceTaskId(normalized)) {
      if (filters.task !== normalized) onChange({ task: normalized });
    }
  }

  function clearAll() {
    clearTimeout(searchDebounceId);
    searchDraft = "";
    taskDraft = "";
    categoryOpen = false;
    onChange({ q: "", categories: new SvelteSet<TaskCategory>(), task: null });
  }

  const showActiveFilters = $derived(hasActiveResourceFilters(filters));
  const taskMalformed = $derived(
    taskDraft.trim() !== "" && !isWellFormedResourceTaskId(taskDraft.trim().toUpperCase()),
  );

  const triggerBase =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors";
  const triggerIdle =
    "border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white";
  const triggerOpen = "border-neutral-400 bg-white text-neutral-900 shadow-sm";
</script>

<div
  bind:this={barEl}
  class="relative mb-6 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
>
  <div class="flex flex-wrap items-end gap-x-3 gap-y-3">
    <div class="flex min-w-[22ch] flex-1 flex-col gap-1">
      <label
        for="resource-search"
        class="font-mono text-[10px] font-medium uppercase tracking-wider text-neutral-500"
      >
        Search
      </label>
      <input
        id="resource-search"
        bind:this={searchInput}
        type="search"
        autocomplete="off"
        placeholder="search filename"
        class="w-full max-w-[28ch] rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 font-mono text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-300"
        aria-label="search filenames"
        bind:value={searchDraft}
        oninput={() => {
          scheduleSearchCommit();
        }}
      />
    </div>

    <DropdownMenu.Root bind:open={categoryOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter resources by category"
        class="{triggerBase} {categoryOpen ? triggerOpen : triggerIdle}"
      >
        <span class="font-medium uppercase tracking-wider text-neutral-600">Category</span>
        {#if filters.categories.size > 0}
          <span class="text-neutral-500">({filters.categories.size})</span>
        {/if}
        <ChevronDown
          class="h-3 w-3 text-neutral-400 transition-transform {categoryOpen
            ? 'rotate-180'
            : ''}"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          class="z-50 min-w-[12rem] rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {#each RESOURCE_CATEGORY_VALUES as category (category)}
            <DropdownMenu.CheckboxItem
              checked={filters.categories.has(category)}
              onCheckedChange={(checked) => toggleCategory(category, checked)}
              closeOnSelect={false}
              class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-neutral-800 outline-none select-none hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {#snippet children({ checked })}
                <div class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
                  {#if checked}
                    <Check class="h-2.5 w-2.5" />
                  {/if}
                </div>
                <span>{category}</span>
              {/snippet}
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <div class="flex flex-col gap-1">
      <label
        for="resource-task"
        class="font-mono text-[10px] font-medium uppercase tracking-wider text-neutral-500"
      >
        Task
      </label>
      <input
        id="resource-task"
        type="text"
        inputmode="text"
        autocomplete="off"
        placeholder="KS-###"
        class="w-[11ch] rounded-md border bg-neutral-50 px-2.5 py-1.5 font-mono text-[12px] uppercase text-neutral-800 placeholder:text-neutral-400 focus:bg-white focus:outline-none focus:ring-1 {taskMalformed
          ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
          : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-300'}"
        aria-label="filter by task id"
        aria-invalid={taskMalformed}
        bind:value={taskDraft}
        oninput={(e) => {
          commitTaskDraft(e.currentTarget.value);
        }}
        onblur={() => commitTaskDraft(taskDraft)}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            commitTaskDraft(taskDraft);
          }
        }}
      />
    </div>

    <div class="ml-auto flex items-center gap-3">
      <span class="font-mono text-[11px] text-neutral-500">
        {filteredCount} of {totalCount} documents
      </span>
      {#if showActiveFilters}
        <button
          type="button"
          class="font-mono text-[11px] font-medium text-neutral-600 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
          onclick={clearAll}
        >
          Clear all
        </button>
      {/if}
    </div>
  </div>
</div>
