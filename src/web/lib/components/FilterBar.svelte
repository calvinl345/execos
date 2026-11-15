<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import type { TaskCategory, TaskPriority, TaskStatus } from "$lib/types";
  import BoardSettingsMenu from "$lib/components/BoardSettingsMenu.svelte";
  import ViewToggle from "$lib/components/ViewToggle.svelte";
  import { TASK_FLAG_META } from "$lib/utils/flags";
  import type { TaskCardFieldPreferences } from "$lib/utils/task-card-fields";
  import type { TaskListColumnPreferences } from "$lib/utils/task-list-columns";
  import { DropdownMenu } from "bits-ui";
  import {
    FILTER_CATEGORY_VALUES,
    FILTER_CLOSED_STATUS_VALUES,
    FILTER_FLAG_VALUES,
    FILTER_PRIORITY_VALUES,
    FILTER_STATUS_VALUES,
    clearFilterCriteria,
    hasActiveFilterCriteria,
    type Filters,
    type FlagKey,
  } from "$lib/utils/filters";
  import { taskStatusLabel } from "$lib/utils/status-labels";
  import { Check, ChevronDown, FunnelX, X } from "@lucide/svelte";

  let {
    filters,
    ownerOptions,
    showClosed,
    searchDraft = $bindable(""),
    onChange,
    onViewChange,
    onShowClosedChange,
    columnPrefs,
    cardFieldPrefs,
    onColumnPrefsChange,
    onCardFieldPrefsChange,
  }: {
    filters: Filters;
    ownerOptions: string[];
    showClosed: boolean;
    /** Live search text, lifted to the page (A13): the filter pipeline reads
     * this on every keystroke; the URL `q` write stays debounced persistence. */
    searchDraft?: string;
    onChange: (next: Filters) => void;
    onViewChange: (view: Filters["view"]) => void;
    onShowClosedChange: (showClosed: boolean) => void;
    columnPrefs: TaskListColumnPreferences;
    cardFieldPrefs: TaskCardFieldPreferences;
    onColumnPrefsChange: (next: TaskListColumnPreferences) => void;
    onCardFieldPrefsChange: (next: TaskCardFieldPreferences) => void;
  } = $props();

  let categoryOpen = $state(false);
  let priorityOpen = $state(false);
  let statusOpen = $state(false);
  let ownerOpen = $state(false);
  let flagsOpen = $state(false);

  let barEl: HTMLDivElement | undefined = $state();
  let statusOptions = $derived(
    showClosed
      ? [...FILTER_STATUS_VALUES, ...FILTER_CLOSED_STATUS_VALUES]
      : FILTER_STATUS_VALUES,
  );

  let searchInput: HTMLInputElement | undefined = $state();
  let lastCommitted = "";
  let hasSyncedInitialSearch = false;
  let debounceId: ReturnType<typeof setTimeout> | undefined;
  // Set when a commit-driven navigation might steal focus from the input; the
  // effect/afterNavigate hooks restore it once the committed filters land
  // (A13/ISS-011).
  let restoreFocusAfterCommit = false;
  let focusRestoreToken = 0;

  $effect(() => {
    const upstream = filters.search.trim();
    if (!hasSyncedInitialSearch) {
      hasSyncedInitialSearch = true;
      searchDraft = filters.search;
      lastCommitted = upstream;
      return;
    }
    if (upstream !== lastCommitted) {
      searchDraft = filters.search;
      lastCommitted = upstream;
    }
  });

  function focusSearchInputIfCurrent(token: number) {
    if (token !== focusRestoreToken) return;
    searchInput?.focus({ preventScroll: true });
  }

  function queueSearchFocusRestore() {
    const token = ++focusRestoreToken;
    requestAnimationFrame(() => {
      focusSearchInputIfCurrent(token);
      setTimeout(() => focusSearchInputIfCurrent(token), 0);
      setTimeout(() => focusSearchInputIfCurrent(token), 50);
      setTimeout(() => focusSearchInputIfCurrent(token), 250);
    });
  }

  function cancelSearchFocusRestore() {
    restoreFocusAfterCommit = false;
    focusRestoreToken += 1;
  }

  function restoreSearchFocusIfRequested() {
    if (!restoreFocusAfterCommit) return;
    restoreFocusAfterCommit = false;
    queueSearchFocusRestore();
  }

  afterNavigate(() => {
    restoreSearchFocusIfRequested();
  });

  // After a committed filter value lands, give focus back to the input if it
  // had it when the commit was scheduled. The afterNavigate hook covers the
  // actual SvelteKit navigation; this effect also handles same-component URL
  // state changes that arrive through the reactive filters prop.
  $effect(() => {
    void filters.search;
    restoreSearchFocusIfRequested();
  });

  function commitSearch(next: string, restoreFocus = true) {
    clearTimeout(debounceId);
    const shouldRestoreFocus =
      restoreFocus && searchInput !== undefined && document.activeElement === searchInput;
    if (!shouldRestoreFocus) cancelSearchFocusRestore();
    if (next === lastCommitted) return;
    lastCommitted = next;
    restoreFocusAfterCommit = shouldRestoreFocus;
    if (shouldRestoreFocus) queueSearchFocusRestore();
    onChange({ ...filters, search: next });
  }

  function scheduleSearchCommit() {
    const next = searchDraft.trim();
    if (next === "") {
      commitSearch(next);
      return;
    }
    clearTimeout(debounceId);
    debounceId = setTimeout(() => {
      commitSearch(searchDraft.trim());
    }, 200);
  }

  function clearSearch(restoreFocus = true) {
    searchDraft = "";
    commitSearch("", restoreFocus);
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (searchDraft !== "") {
      clearSearch(false);
    }
    searchInput?.blur();
  }

  function handleSearchClearClick() {
    clearSearch();
    searchInput?.focus();
  }

  function toggleCategory(cat: TaskCategory, checked: boolean) {
    const next = new Set(filters.categories);
    if (checked) next.add(cat);
    else next.delete(cat);
    onChange({ ...filters, categories: next });
  }

  function togglePriority(p: TaskPriority, checked: boolean) {
    const next = new Set(filters.priorities);
    if (checked) next.add(p);
    else next.delete(p);
    onChange({ ...filters, priorities: next });
  }

  function toggleStatus(s: TaskStatus, checked: boolean) {
    const next = new Set(filters.statuses);
    if (checked) next.add(s);
    else next.delete(s);
    onChange({ ...filters, statuses: next });
  }

  function toggleOwner(o: string, checked: boolean) {
    const next = new Set(filters.owners);
    if (checked) next.add(o);
    else next.delete(o);
    onChange({ ...filters, owners: next });
  }

  function toggleFlag(fl: FlagKey, checked: boolean) {
    const next = new Set(filters.flags);
    if (checked) next.add(fl);
    else next.delete(fl);
    onChange({ ...filters, flags: next });
  }

  function clearAll() {
    clearTimeout(debounceId);
    searchDraft = "";
    lastCommitted = "";
    categoryOpen = false;
    priorityOpen = false;
    statusOpen = false;
    ownerOpen = false;
    flagsOpen = false;
    onChange(clearFilterCriteria(filters));
  }

  const showClear = $derived(hasActiveFilterCriteria(filters));
  const showClosedDisabled = $derived(filters.view === "inbox");

  // Shared button + panel classes — keeps every menu visually consistent.
  const triggerBase =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors";
  const triggerIdle =
    "border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600";
  const triggerOpen = "border-neutral-400 bg-white text-neutral-900 shadow-sm dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100";
</script>

<div
  bind:this={barEl}
  class="relative mb-4 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-2">
    <!-- search ----------------------------------------------------------- -->
    <div class="min-w-[22ch] flex-1">
      <div class="relative max-w-[44ch]">
        <input
          id="task-search"
          bind:this={searchInput}
          type="search"
          autocomplete="off"
          placeholder="search id, title, or description"
          class="w-full rounded-md border border-neutral-200 bg-neutral-50 py-1.5 pl-2.5 pr-12 font-mono text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-300"
          aria-label="search tasks"
          bind:value={searchDraft}
          oninput={() => {
            scheduleSearchCommit();
          }}
          onkeydown={handleSearchKeydown}
        />
        {#if searchDraft === ""}
          <div class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-neutral-400 opacity-50">
            ( / )
          </div>
        {:else}
          <button
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-600 focus:outline-none"
            onclick={handleSearchClearClick}
            aria-label="Clear search"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        {/if}
      </div>
    </div>

    <!-- category ---------------------------------------------------------- -->
    <DropdownMenu.Root bind:open={categoryOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter by category"
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
          {#each FILTER_CATEGORY_VALUES as cat (cat)}
            <DropdownMenu.CheckboxItem
              checked={filters.categories.has(cat)}
              onCheckedChange={(checked) => toggleCategory(cat, checked)}
              closeOnSelect={false}
              class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-neutral-800 outline-none select-none hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {#snippet children({ checked })}
                <div class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
                  {#if checked}
                    <Check class="h-2.5 w-2.5" />
                  {/if}
                </div>
                <span>{cat}</span>
              {/snippet}
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <!-- priority ---------------------------------------------------------- -->
    <DropdownMenu.Root bind:open={priorityOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter by priority"
        class="{triggerBase} {priorityOpen ? triggerOpen : triggerIdle}"
      >
        <span class="font-medium uppercase tracking-wider text-neutral-600">Priority</span>
        {#if filters.priorities.size > 0}
          <span class="text-neutral-500">({filters.priorities.size})</span>
        {/if}
        <ChevronDown
          class="h-3 w-3 text-neutral-400 transition-transform {priorityOpen
            ? 'rotate-180'
            : ''}"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          class="z-50 min-w-[8rem] rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {#each FILTER_PRIORITY_VALUES as p (p)}
            <DropdownMenu.CheckboxItem
              checked={filters.priorities.has(p)}
              onCheckedChange={(checked) => togglePriority(p, checked)}
              closeOnSelect={false}
              class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-neutral-800 outline-none select-none hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {#snippet children({ checked })}
                <div class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
                  {#if checked}
                    <Check class="h-2.5 w-2.5" />
                  {/if}
                </div>
                <span>{p}</span>
              {/snippet}
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <!-- status ------------------------------------------------------------ -->
    <DropdownMenu.Root bind:open={statusOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter by status"
        class="{triggerBase} {statusOpen ? triggerOpen : triggerIdle}"
      >
        <span class="font-medium uppercase tracking-wider text-neutral-600">Status</span>
        {#if filters.statuses.size > 0}
          <span class="text-neutral-500">({filters.statuses.size})</span>
        {/if}
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
          {#each statusOptions as st (st)}
            <DropdownMenu.CheckboxItem
              checked={filters.statuses.has(st)}
              onCheckedChange={(checked) => toggleStatus(st, checked)}
              closeOnSelect={false}
              class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-neutral-800 outline-none select-none hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {#snippet children({ checked })}
                <div class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
                  {#if checked}
                    <Check class="h-2.5 w-2.5" />
                  {/if}
                </div>
                <span>{taskStatusLabel(st)}</span>
              {/snippet}
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <!-- owner ------------------------------------------------------------- -->
    <DropdownMenu.Root bind:open={ownerOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter by owner"
        class="{triggerBase} {ownerOpen ? triggerOpen : triggerIdle}"
      >
        <span class="font-medium uppercase tracking-wider text-neutral-600">Owner</span>
        {#if filters.owners.size > 0}
          <span class="text-neutral-500">({filters.owners.size})</span>
        {/if}
        <ChevronDown
          class="h-3 w-3 text-neutral-400 transition-transform {ownerOpen
            ? 'rotate-180'
            : ''}"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          class="z-50 max-h-48 min-w-[10rem] overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {#each ownerOptions as o (o)}
            <DropdownMenu.CheckboxItem
              checked={filters.owners.has(o)}
              onCheckedChange={(checked) => toggleOwner(o, checked)}
              closeOnSelect={false}
              class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-neutral-800 outline-none select-none hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {#snippet children({ checked })}
                <div class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
                  {#if checked}
                    <Check class="h-2.5 w-2.5" />
                  {/if}
                </div>
                <span>{o}</span>
              {/snippet}
            </DropdownMenu.CheckboxItem>
          {/each}
          {#if ownerOptions.length === 0}
            <p class="px-3 py-2 font-mono text-[10px] text-neutral-400">no owners in data</p>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <!-- flags ------------------------------------------------------------- -->
    <DropdownMenu.Root bind:open={flagsOpen}>
      <DropdownMenu.Trigger
        type="button"
        aria-label="filter by flags"
        class="{triggerBase} {flagsOpen ? triggerOpen : triggerIdle}"
      >
        <span class="font-medium uppercase tracking-wider text-neutral-600">Flags</span>
        {#if filters.flags.size > 0}
          <span class="text-neutral-500">({filters.flags.size})</span>
        {/if}
        <ChevronDown
          class="h-3 w-3 text-neutral-400 transition-transform {flagsOpen
            ? 'rotate-180'
            : ''}"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          class="z-50 min-w-[10rem] rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {#each FILTER_FLAG_VALUES as fl (fl)}
            <DropdownMenu.CheckboxItem
              checked={filters.flags.has(fl)}
              onCheckedChange={(checked) => toggleFlag(fl, checked)}
              closeOnSelect={false}
              class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-neutral-800 outline-none select-none hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {#snippet children({ checked })}
                <div class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
                  {#if checked}
                    <Check class="h-2.5 w-2.5" />
                  {/if}
                </div>
                <span>{TASK_FLAG_META[fl].label}</span>
              {/snippet}
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <!-- counts + clear ---------------------------------------------------- -->
    <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
      <label
        class="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 font-mono text-[11px] transition-colors {showClosedDisabled
          ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-500 opacity-40'
          : showClosed
            ? 'border-neutral-400 bg-white text-neutral-900 shadow-sm'
            : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white'}"
        aria-disabled={showClosedDisabled}
        title={showClosedDisabled ? "Closed tasks show on Kanban or List" : undefined}
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-neutral-900 disabled:cursor-not-allowed"
          checked={showClosed}
          disabled={showClosedDisabled}
          onchange={(e) => {
            if (showClosedDisabled) return;
            onShowClosedChange(e.currentTarget.checked);
          }}
        />
        <span class="font-medium uppercase tracking-wider">Show Closed</span>
      </label>
      {#if showClear}
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300 hover:bg-white hover:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          aria-label="clear task filters"
          title="Clear filters"
          onclick={clearAll}
        >
          <FunnelX class="h-4 w-4" />
        </button>
      {/if}
      <ViewToggle view={filters.view} onChange={onViewChange} />
      <BoardSettingsMenu
        view={filters.view}
        {columnPrefs}
        {cardFieldPrefs}
        {onColumnPrefsChange}
        {onCardFieldPrefsChange}
      />
    </div>
  </div>
</div>

<style>
  /* Double-clear fix (A13): the native WebKit cancel control overlapped the
     custom clear button; exactly one clear affordance remains. */
  input[type="search"]::-webkit-search-cancel-button {
    display: none;
  }
</style>
