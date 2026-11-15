<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import FilterBar from "$lib/components/FilterBar.svelte";
  import { X } from "@lucide/svelte";
  import TaskListView from "$lib/components/TaskListView.svelte";
  import KanbanBoard from "$lib/components/KanbanBoard.svelte";
  import GoalKanbanBoard from "$lib/components/GoalKanbanBoard.svelte";
  import GoalListView from "$lib/components/GoalListView.svelte";
  import GoalsFilterBar from "$lib/components/GoalsFilterBar.svelte";
  import TaskDetailDrawer from "$lib/components/TaskDetailDrawer.svelte";
  import GoalDetailDrawer from "$lib/components/GoalDetailDrawer.svelte";
  import InboxView from "$lib/components/inbox/InboxView.svelte";
  import {
    clearGoalDetailsParam,
    mergeDashboardNavState,
    mergeUrlForGoalTaskView,
    parseGoalsBoardFilters,
    parseMainBoardTab,
    pathWithQuery,
    setGoalDetailsParam,
    type GoalsBoardStatusFilter,
    type GoalsBoardViewMode,
    type MainBoardTab,
  } from "$lib/utils/dashboard-url";
  import {
    applyFilters,
    parseFilters,
    serializeFilters,
    type Filters,
  } from "$lib/utils/filters";
  import { partitionInbox } from "$lib/utils/inbox-partition";
  import {
    buildInboxCandidates,
    groupTasksForView,
    type ViewKey,
  } from "$lib/utils/inbox-views";
  import { readClearedDoneAt, writeClearedDoneAt } from "$lib/utils/done-watermark";
  import { clearTaskParam, setTaskParam } from "$lib/utils/drawer";
  import {
    TASK_CARD_FIELD_PREFS_STORAGE_KEY,
    defaultTaskCardFieldPreferences,
    normalizeTaskCardFieldPreferences,
    type TaskCardFieldPreferences,
  } from "$lib/utils/task-card-fields";
  import {
    TASK_LIST_COLUMN_PREFS_STORAGE_KEY,
    defaultTaskListColumnPreferences,
    normalizeTaskListColumnPreferences,
    type TaskListColumnPreferences,
  } from "$lib/utils/task-list-columns";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  let filters = $derived(parseFilters(page.url.searchParams));

  // Live search draft, lifted from FilterBar (A13): filtering reads this on
  // every keystroke; the URL `q` param is written on FilterBar's debounce
  // purely for persistence. Initialized from the URL so a shared ?q= link
  // still lands filtered.
  let searchDraft = $state(page.url.searchParams.get("q")?.trim() ?? "");
  let liveFilters = $derived({ ...filters, search: searchDraft.trim() });

  let mainBoardTab = $derived.by((): MainBoardTab => parseMainBoardTab(page.url.searchParams));

  let goalsBoard = $derived.by(() => parseGoalsBoardFilters(page.url.searchParams));
  let showClosed = $derived(page.url.searchParams.get("closed") === "1");
  let effectiveGoalStatus = $derived(
    showClosed && page.url.searchParams.get("gstatus") === null ? "all" : goalsBoard.status,
  );

  let filteredTasks = $derived(applyFilters(data.activeTasks, liveFilters));

  // Inbox browse view: ephemeral component state (deliberately not URL-persisted,
  // A7) — Agent rank is always the view on load; it survives invalidateAll because
  // the component is reused across navigations, same as prefsHydrated.
  let inboxView = $state<ViewKey>("agent");

  // Three-state done watermark (A9): null before hydration (the server never
  // paints done rows that hydration might remove), epoch 0 once hydrated with no
  // stored key (a user who never cleared still sees recentlyDone), the stored
  // instant otherwise. Read in onMount like the other prefs.
  let watermarkHydrated = $state(false);
  let clearedDoneAt = $state<Date | null>(null);
  let doneVisibleSince = $derived(watermarkHydrated ? (clearedDoneAt ?? new Date(0)) : null);

  // The whole inbox pipeline is client-side: candidates = activeTasks minus all
  // terminal rows plus deduped recentlyDone, then dropdown filters + search via
  // applyFilters, then the section split with the done watermark. Nothing is ever
  // hidden by date (S16). The 2s live-refresh poll replaces `data` wholesale, so
  // all of this recomputes against fresh rows automatically.
  let inbox = $derived.by(() => {
    const candidates = applyFilters(
      buildInboxCandidates(data.activeTasks, data.recentlyDone),
      liveFilters,
    );
    return partitionInbox(candidates, { now: new Date(), doneVisibleSince });
  });

  let inboxTaskBands = $derived(groupTasksForView(inbox.tasks, inboxView, new Date()));

  type GoalsQuarterFilter = string | "all";

  let goalsFiltered = $derived.by(() => {
    const st = effectiveGoalStatus;
    const { quarter: qr } = goalsBoard;
    return data.goals.filter((g) => {
      if (!showClosed && g.status !== "active") return false;
      if (st !== "all" && g.status !== st) return false;
      if (qr !== "all" && g.quarter !== qr) return false;
      return true;
    });
  });
  let visibleGoalCount = $derived(data.goals.filter((g) => showClosed || g.status === "active").length);

  let openTaskId = $derived(page.url.searchParams.get("task"));
  let openGoalId = $derived(
    mainBoardTab === "goals" ? page.url.searchParams.get("goal") : null,
  );
  let openGoal = $derived(
    openGoalId ? (data.goals.find((g) => g.id === openGoalId) ?? null) : null,
  );
  let openGoalLinkedTasks = $derived(
    openGoalId ? data.activeTasks.filter((task) => task.goal_id === openGoalId) : [],
  );
  let ownerOptions = $derived(
    [...new Set(data.activeTasks.map((t) => t.owner).filter((o): o is string => !!o))].sort(),
  );
  let prefsHydrated = $state(false);
  let taskListColumnPrefs = $state<TaskListColumnPreferences>(
    defaultTaskListColumnPreferences(),
  );
  let taskCardFieldPrefs = $state<TaskCardFieldPreferences>(
    defaultTaskCardFieldPreferences(),
  );

  onMount(() => {
    taskListColumnPrefs = readStoredPrefs(
      TASK_LIST_COLUMN_PREFS_STORAGE_KEY,
      normalizeTaskListColumnPreferences,
      defaultTaskListColumnPreferences(),
    );
    taskCardFieldPrefs = readStoredPrefs(
      TASK_CARD_FIELD_PREFS_STORAGE_KEY,
      normalizeTaskCardFieldPreferences,
      defaultTaskCardFieldPreferences(),
    );
    prefsHydrated = true;
    clearedDoneAt = readClearedDoneAt();
    watermarkHydrated = true;
  });

  /** Presentation-only (A9): sets the client watermark; no server roundtrip. */
  function clearDoneTasks(): void {
    const at = new Date();
    writeClearedDoneAt(at);
    clearedDoneAt = at;
  }

  $effect(() => {
    if (!prefsHydrated) return;
    localStorage.setItem(TASK_LIST_COLUMN_PREFS_STORAGE_KEY, JSON.stringify(taskListColumnPrefs));
    localStorage.setItem(TASK_CARD_FIELD_PREFS_STORAGE_KEY, JSON.stringify(taskCardFieldPrefs));
  });

  function readStoredPrefs<T>(key: string, normalize: (candidate: unknown) => T, fallback: T): T {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return normalize(JSON.parse(raw));
    } catch {
      return fallback;
    }
  }

  function commit(next: Filters): void {
    const params = mergeDashboardNavState(serializeFilters(next), page.url.searchParams);
    goto(resolve(pathWithQuery(params)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function changeView(view: Filters["view"]): void {
    const params = mergeDashboardNavState(
      serializeFilters({ ...filters, view }),
      page.url.searchParams,
    );
    // `task` means "inbox selection" in inbox view but "open drawer" in kanban/list;
    // drop it when crossing that boundary so switching views never auto-opens a drawer.
    if ((filters.view === "inbox") !== (view === "inbox")) params.delete("task");
    goto(resolve(pathWithQuery(params)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function setMainBoard(next: MainBoardTab): void {
    const p = new URLSearchParams(page.url.searchParams);
    if (next === "goals") p.set("board", "goals");
    else p.delete("board");
    goto(resolve(pathWithQuery(p)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function setShowClosed(next: boolean): void {
    const p = new URLSearchParams(page.url.searchParams);
    if (next) p.set("closed", "1");
    else p.delete("closed");

    if (mainBoardTab === "tasks" && !next) {
      const activeStatuses = p.getAll("status").filter((s) => s !== "done" && s !== "cancelled");
      p.delete("status");
      for (const status of activeStatuses) p.append("status", status);
    }

    if (mainBoardTab === "goals") {
      if (next && (goalsBoard.status === "active" || p.get("gstatus") === null)) {
        p.set("gstatus", "all");
      } else if (!next && goalsBoard.status !== "active") {
        p.delete("gstatus");
      }
    }

    goto(resolve(pathWithQuery(p)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  function commitGoalsTab(next: {
    status?: GoalsBoardStatusFilter;
    quarter?: GoalsQuarterFilter;
    view?: GoalsBoardViewMode;
  }): void {
    const p = new URLSearchParams(page.url.searchParams);
    p.set("board", "goals");
    const status = next.status ?? effectiveGoalStatus;
    const quarter = next.quarter ?? goalsBoard.quarter;
    const view = next.view ?? goalsBoard.view;
    if (status === "active") p.delete("gstatus");
    else if (status === "all") p.set("gstatus", "all");
    else p.set("gstatus", status);
    if (quarter === "all") p.delete("gq");
    else p.set("gq", quarter);
    if (view === "kanban") p.delete("gview");
    else p.set("gview", view);
    goto(resolve(pathWithQuery(p)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function openGoalDetails(goalId: string): void {
    goto(resolve(pathWithQuery(setGoalDetailsParam(page.url.searchParams, goalId))), {
      replaceState: false,
      keepFocus: false,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function openTask(id: string): void {
    const params = setTaskParam(page.url.searchParams, id);
    goto(resolve(pathWithQuery(params)), {
      replaceState: false,
      keepFocus: false,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function closeTask(): void {
    const params = clearTaskParam(page.url.searchParams);
    goto(resolve(pathWithQuery(params)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function closeGoalDetails(): void {
    goto(resolve(pathWithQuery(clearGoalDetailsParam(page.url.searchParams))), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function clearGoalFilter(): void {
    const next: Filters = { ...filters, goal: null };
    const params = mergeDashboardNavState(serializeFilters(next), page.url.searchParams);
    goto(resolve(pathWithQuery(params)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function resolveGoalHrefFromPage(goalId: string): "/" | `/?${string}` {
    return pathWithQuery(
      mergeUrlForGoalTaskView(new URLSearchParams(page.url.searchParams), goalId),
    ) as "/" | `/?${string}`;
  }

  function resolveGoalDetailsHrefFromPage(goalId: string): "/" | `/?${string}` {
    return pathWithQuery(
      setGoalDetailsParam(new URLSearchParams(page.url.searchParams), goalId),
    ) as "/" | `/?${string}`;
  }

  /** Underlined tabs — flat, one band of chrome instead of a pill container */
  const tabActive = "border-neutral-900 text-neutral-900 font-medium";
  const tabIdle =
    "border-transparent text-neutral-500 hover:text-neutral-800";
</script>

<section>
  <div
    class="mb-5 flex items-center gap-6 border-b border-neutral-200"
    role="tablist"
    aria-label="main board view"
  >
    <button
      type="button"
      role="tab"
      aria-selected={mainBoardTab === "tasks"}
      aria-controls="dashboard-board-region"
      class="-mb-px border-b-2 px-1 pb-2.5 text-sm transition-colors {mainBoardTab === 'tasks'
        ? tabActive
        : tabIdle}"
      onclick={() => setMainBoard("tasks")}
    >
      Tasks
      <span
        class="ml-1 font-mono text-[11px] tabular-nums {mainBoardTab === 'tasks'
          ? 'text-neutral-500'
          : 'text-neutral-400'}"
      >
        {data.activeTasks.length}
      </span>
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mainBoardTab === "goals"}
      aria-controls="dashboard-board-region"
      class="-mb-px border-b-2 px-1 pb-2.5 text-sm transition-colors {mainBoardTab === 'goals'
        ? tabActive
        : tabIdle}"
      onclick={() => setMainBoard("goals")}
    >
      Goals
      <span
        class="ml-1 font-mono text-[11px] tabular-nums {mainBoardTab === 'goals'
          ? 'text-neutral-500'
          : 'text-neutral-400'}"
      >
        {visibleGoalCount}
      </span>
    </button>
  </div>

  {#if mainBoardTab === "tasks"}
    <FilterBar
      {filters}
      {ownerOptions}
      {showClosed}
      bind:searchDraft
      onChange={commit}
      onViewChange={changeView}
      onShowClosedChange={setShowClosed}
      columnPrefs={taskListColumnPrefs}
      cardFieldPrefs={taskCardFieldPrefs}
      onColumnPrefsChange={(next) => (taskListColumnPrefs = next)}
      onCardFieldPrefsChange={(next) => (taskCardFieldPrefs = next)}
    />
  {:else}
    <GoalsFilterBar
      status={effectiveGoalStatus}
      quarter={goalsBoard.quarter}
      view={goalsBoard.view}
      quarters={data.goalQuarters}
      {showClosed}
      onChange={commitGoalsTab}
      onViewChange={(view) => commitGoalsTab({ view })}
      onShowClosedChange={setShowClosed}
    />
  {/if}

  <div id="dashboard-board-region" role="tabpanel">
    {#if mainBoardTab === "tasks"}
      {#if filters.view === "inbox"}
        <InboxView
          followUps={inbox.followUps}
          tasks={inbox.tasks}
          taskBands={inboxTaskBands}
          view={inboxView}
          onViewChange={(view) => (inboxView = view)}
          onClearDone={clearDoneTasks}
          team={data.team}
          searchQuery={liveFilters.search}
        />
      {:else}
        {#if data.filteredGoal}
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <span class="font-mono text-[11px] text-neutral-600">Filtered by goal:</span>
            <span
              class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-purple-50 px-2 py-1 font-mono text-[11px] text-purple-800 ring-1 ring-inset ring-purple-200"
            >
              <span class="shrink-0 font-semibold">{data.filteredGoal.id}</span>
              {#if data.filteredGoal.title}
                <span class="shrink-0 text-purple-500">·</span>
                <span class="min-w-0 truncate">{data.filteredGoal.title}</span>
              {/if}
              <button
                type="button"
                class="ml-1 shrink-0 rounded p-0.5 hover:bg-purple-100"
                aria-label="clear goal filter"
                onclick={() => clearGoalFilter()}
              >
                <X class="h-3 w-3" />
              </button>
            </span>
          </div>
        {/if}
        {#if filters.view === "list"}
          <TaskListView
            tasks={filteredTasks}
            sort={filters.sort}
            sortDir={filters.sortDir}
            onSort={(sortKey, sortDirVal) => commit({ ...filters, sort: sortKey, sortDir: sortDirVal })}
            onNavigate={openTask}
            resolveGoalHref={resolveGoalDetailsHrefFromPage}
            columnPrefs={taskListColumnPrefs}
            onColumnPrefsChange={(next) => (taskListColumnPrefs = next)}
          />
        {:else}
          <KanbanBoard
            tasks={filteredTasks}
            onNavigate={openTask}
            cardFieldPrefs={taskCardFieldPrefs}
            {showClosed}
          />
        {/if}
      {/if}
    {:else}
      <header class="mb-4">
        <span class="font-mono text-[11px] font-medium uppercase tracking-wider text-neutral-700">
          Goals Board
        </span>
      </header>

      {#if goalsFiltered.length === 0}
        <p
          class="rounded-md border border-dashed border-neutral-200 px-4 py-8 text-center font-mono text-[12px] text-neutral-400"
        >
          no goals match these filters
        </p>
      {:else if goalsBoard.view === "list"}
        <GoalListView goals={goalsFiltered} onNavigate={openGoalDetails} />
      {:else}
        <GoalKanbanBoard goals={goalsFiltered} onNavigate={openGoalDetails} {showClosed} />
      {/if}
    {/if}
  </div>
</section>

{#if openTaskId && filters.view !== "inbox"}
  <TaskDetailDrawer
    taskId={openTaskId}
    onClose={closeTask}
    onNavigate={openTask}
    resolveGoalHref={resolveGoalHrefFromPage}
  />
{:else if openGoal}
  <GoalDetailDrawer
    goal={openGoal}
    linkedTasks={openGoalLinkedTasks}
    onClose={closeGoalDetails}
    onTaskNavigate={openTask}
  />
{/if}

