<script lang="ts">
  import { resolve } from "$app/paths";
  import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, Paperclip } from "@lucide/svelte";
  import type { DashboardTask } from "$lib/types";
  import type { SortKey } from "$lib/utils/filters";
  import { assigneeThemeStyle } from "$lib/utils/assignee-theme";
  import { dueLabel, relativeAgo } from "$lib/utils/dates";
  import {
    TASK_FLAG_META,
    flagsFor,
    staleDays,
    type TaskFlag,
  } from "$lib/utils/flags";
  import {
    TASK_LIST_COLUMNS,
    clampTaskListColumnWidth,
    defaultTaskListColumnWidth,
    normalizeTaskListColumnPreferences,
    type TaskListColumnId,
    type TaskListColumnPreferences,
  } from "$lib/utils/task-list-columns";
  import { TASK_STATUS_META } from "$lib/utils/status-meta";
  import { taskStatusLabelLower } from "$lib/utils/status-labels";
  import { ownerInitials } from "$lib/utils/task-row-workflow";
  import IdBadge from "./IdBadge.svelte";
  import PriorityIndicator from "./PriorityIndicator.svelte";
  import TaskPromptMenu from "./TaskPromptMenu.svelte";

  let {
    tasks,
    sort,
    sortDir,
    onSort,
    onNavigate,
    resolveGoalHref,
    columnPrefs,
    onColumnPrefsChange,
  }: {
    tasks: DashboardTask[];
    sort: SortKey;
    sortDir: "asc" | "desc";
    onSort: (key: SortKey, dir: "asc" | "desc") => void;
    onNavigate: (id: string) => void;
    resolveGoalHref: (goalId: string) => "/" | `/?${string}`;
    columnPrefs: TaskListColumnPreferences;
    onColumnPrefsChange: (next: TaskListColumnPreferences) => void;
  } = $props();

  const sortableColumns = new Set<TaskListColumnId>([
    "id",
    "priority",
    "title",
    "category",
    "goal",
    "status",
    "owner",
    "due",
    "updated",
  ]);

  const defaultSortDir: Record<SortKey, "asc" | "desc"> = {
    id: "asc",
    priority: "asc",
    title: "asc",
    category: "asc",
    goal: "asc",
    status: "asc",
    owner: "asc",
    due: "asc",
    updated: "desc",
  };

  let draggedColumn = $state<TaskListColumnId | null>(null);
  let dropTarget = $state<{
    id: TaskListColumnId;
    side: "before" | "after";
  } | null>(null);
  let resizingColumn = $state<{
    id: TaskListColumnId;
    startX: number;
    startWidth: number;
  } | null>(null);

  const columnsById = Object.fromEntries(
    TASK_LIST_COLUMNS.map((column) => [column.id, column]),
  ) as Record<TaskListColumnId, (typeof TASK_LIST_COLUMNS)[number]>;

  const orderedColumns = $derived.by(() =>
    columnPrefs.order.map((id) => columnsById[id]).filter(Boolean),
  );

  const visibleColumns = $derived.by(() =>
    orderedColumns.filter((column) => !columnPrefs.hidden.includes(column.id)),
  );

  const tableWidthPx = $derived.by(
    () => 40 + visibleColumns.reduce((total, column) => total + columnWidth(column.id), 0),
  );

  const tableStyle = $derived(`width: ${tableWidthPx}px; min-width: 100%;`);

  function columnWidth(id: TaskListColumnId): number {
    return columnPrefs.widths[id] ?? defaultTaskListColumnWidth(id);
  }

  function isSortableColumn(id: TaskListColumnId): id is SortKey {
    return sortableColumns.has(id);
  }

  function sortIconFor(id: TaskListColumnId): typeof ArrowUpDown {
    if (!isSortableColumn(id) || sort !== id) return ArrowUpDown;
    return sortDir === "asc" ? ArrowUp : ArrowDown;
  }

  function clickSort(id: TaskListColumnId) {
    if (!isSortableColumn(id)) return;
    if (sort === id) {
      onSort(id, sortDir === "asc" ? "desc" : "asc");
    } else {
      onSort(id, defaultSortDir[id]);
    }
  }

  function moveColumnBefore(
    source: TaskListColumnId,
    target: TaskListColumnId,
    side: "before" | "after" = "before",
  ): void {
    if (source === target) return;
    const withoutSource = columnPrefs.order.filter((id) => id !== source);
    let targetIndex = withoutSource.indexOf(target);
    if (targetIndex < 0) return;
    if (side === "after") targetIndex += 1;
    withoutSource.splice(targetIndex, 0, source);
    onColumnPrefsChange(
      normalizeTaskListColumnPreferences({
        order: withoutSource,
        hidden: columnPrefs.hidden,
        widths: columnPrefs.widths,
      }),
    );
  }

  function hideColumn(id: TaskListColumnId): void {
    if (visibleColumns.length <= 1 || columnPrefs.hidden.includes(id)) return;
    onColumnPrefsChange(
      normalizeTaskListColumnPreferences({
        order: columnPrefs.order,
        hidden: [...columnPrefs.hidden, id],
        widths: columnPrefs.widths,
      }),
    );
  }

  function setColumnWidth(id: TaskListColumnId, width: number): void {
    onColumnPrefsChange(
      normalizeTaskListColumnPreferences({
        order: columnPrefs.order,
        hidden: columnPrefs.hidden,
        widths: {
          ...columnPrefs.widths,
          [id]: clampTaskListColumnWidth(id, width),
        },
      }),
    );
  }

  function startColumnResize(event: PointerEvent, id: TaskListColumnId): void {
    event.preventDefault();
    event.stopPropagation();
    resizingColumn = {
      id,
      startX: event.clientX,
      startWidth: columnWidth(id),
    };
  }

  function continueColumnResize(event: PointerEvent): void {
    if (!resizingColumn) return;
    setColumnWidth(
      resizingColumn.id,
      resizingColumn.startWidth + event.clientX - resizingColumn.startX,
    );
  }

  function stopColumnResize(): void {
    resizingColumn = null;
  }

  function startColumnDrag(event: DragEvent, id: TaskListColumnId): void {
    draggedColumn = id;
    dropTarget = null;
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function allowColumnDrop(event: DragEvent, id: TaskListColumnId): void {
    if (!draggedColumn || draggedColumn === id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropTarget = {
      id,
      side: event.clientX < rect.left + rect.width / 2 ? "before" : "after",
    };
  }

  function dropColumn(event: DragEvent, id: TaskListColumnId): void {
    event.preventDefault();
    const source = draggedColumn ?? event.dataTransfer?.getData("text/plain");
    if (source && isTaskListColumnId(source)) {
      moveColumnBefore(source, id, dropTarget?.id === id ? dropTarget.side : "before");
    }
    draggedColumn = null;
    dropTarget = null;
  }

  function endColumnDrag(): void {
    draggedColumn = null;
    dropTarget = null;
  }

  function isTaskListColumnId(value: string): value is TaskListColumnId {
    return TASK_LIST_COLUMNS.some((column) => column.id === value);
  }

  function staleIfAny(task: DashboardTask): string | null {
    const d = staleDays(task);
    return d >= 14 ? `stale ${d}d` : null;
  }

  function flagText(task: DashboardTask, flag: TaskFlag): string {
    if (flag === "overdue") return "OVERDUE";
    if (flag === "stale") return staleIfAny(task) ?? TASK_FLAG_META[flag].label;
    return TASK_FLAG_META[flag].label;
  }

  function headerCellClass(id: TaskListColumnId): string {
    const base =
      "group relative cursor-grab select-none px-3 py-2 pr-11 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600 active:cursor-grabbing";
    if (draggedColumn === id || resizingColumn?.id === id) return `${base} bg-neutral-100`;
    return base;
  }

  function resizeHandleClass(id: TaskListColumnId): string {
    const base =
      "absolute -right-2 top-0 z-20 h-full w-6 cursor-col-resize border-0 bg-transparent p-0 outline-none after:absolute after:right-2 after:top-2 after:h-[calc(100%-1rem)] after:w-px after:bg-neutral-200 hover:after:bg-neutral-500 focus:after:bg-neutral-500";
    if (resizingColumn?.id === id) return `${base} after:bg-neutral-600`;
    return base;
  }

  function dropIndicatorClass(id: TaskListColumnId): string {
    const side = dropTarget?.id === id ? dropTarget.side : null;
    const base =
      "pointer-events-none absolute top-1 z-10 h-[calc(100%-0.5rem)] w-0.5 rounded-full bg-neutral-900";
    if (side === "before") return `${base} left-0`;
    if (side === "after") return `${base} right-0`;
    return "hidden";
  }

  function bodyCellClass(id: TaskListColumnId): string {
    if (id === "category") {
      return "px-3 py-2 align-middle font-mono text-[11px] text-neutral-700";
    }
    if (id === "status") {
      return "px-3 py-2 align-middle font-mono text-[11px] lowercase text-neutral-700";
    }
    if (id === "owner") {
      return "px-3 py-2 align-middle font-mono text-[11px] text-neutral-700";
    }
    if (id === "due") {
      return "px-3 py-2 align-middle font-mono text-[11px] text-neutral-600";
    }
    if (id === "updated") {
      return "px-3 py-2 align-middle font-mono text-[11px] text-neutral-500";
    }
    if (id === "attachments") {
      return "px-3 py-2 align-middle font-mono text-[11px] text-neutral-600";
    }
    return "px-3 py-2 align-middle";
  }
</script>

<svelte:window
  onpointercancel={stopColumnResize}
  onpointermove={continueColumnResize}
  onpointerup={stopColumnResize}
/>

<div
  class="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
>
  <table class="table-fixed border-collapse text-left" style={tableStyle}>
    <colgroup>
      <col style="width: 40px" />
      {#each visibleColumns as column (column.id)}
        <col style={`width: ${columnWidth(column.id)}px`} />
      {/each}
    </colgroup>
    <thead>
      <tr class="border-b border-neutral-200 bg-neutral-50/80">
        <th class="px-2 py-2">
          <span class="sr-only">Actions</span>
        </th>
        {#each visibleColumns as column (column.id)}
          <th
            class={headerCellClass(column.id)}
            draggable="true"
            ondragstart={(event) => startColumnDrag(event, column.id)}
            ondragover={(event) => allowColumnDrop(event, column.id)}
            ondrop={(event) => dropColumn(event, column.id)}
            ondragend={endColumnDrag}
          >
            <div class="flex min-w-0 items-center">
              {#if isSortableColumn(column.id)}
                {@const SortIcon = sortIconFor(column.id)}
                <button
                  type="button"
                  class="relative inline-flex min-w-0 max-w-full items-center rounded px-1 py-0.5 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  title={`Sort by ${column.label}`}
                  draggable="false"
                  onclick={(event) => {
                    event.stopPropagation();
                    clickSort(column.id);
                  }}
                >
                  <span class="truncate">{column.label}</span>
                  <SortIcon
                    class="absolute left-full top-1/2 ml-1 h-3 w-3 -translate-y-1/2 transition-opacity {sort ===
                    column.id
                      ? 'text-neutral-800 opacity-100'
                      : 'text-neutral-300 opacity-0 group-hover:opacity-100'}"
                    aria-hidden="true"
                  />
                </button>
              {:else}
                <span class="min-w-0 truncate">{column.label}</span>
              {/if}
              <button
                type="button"
                class="absolute right-5 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-neutral-400 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-800 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-neutral-300 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"
                aria-label={`hide ${column.label} column`}
                title="Hide column"
                disabled={visibleColumns.length === 1}
                onclick={(event) => {
                  event.stopPropagation();
                  hideColumn(column.id);
                }}
              >
                <EyeOff class="h-3.5 w-3.5" />
              </button>
            </div>
            <span class={dropIndicatorClass(column.id)} aria-hidden="true"></span>
            <button
              type="button"
              class={resizeHandleClass(column.id)}
              aria-label={`resize ${column.label} column`}
              title="Drag to resize"
              draggable="false"
              onpointerdown={(event) => startColumnResize(event, column.id)}
              ondragstart={(event) => event.preventDefault()}
            ></button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each tasks as task (task.id)}
        {@const flags = flagsFor(task)}
        <tr
          role="button"
          tabindex="0"
          aria-label="open {task.id}"
          onclick={() => onNavigate(task.id)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate(task.id);
            }
          }}
          class="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
        >
          <td class="px-2 py-2 align-middle" onclick={(e) => e.stopPropagation()}>
            <TaskPromptMenu {task} align="left" />
          </td>
          {#each visibleColumns as column (column.id)}
            <td
              class={bodyCellClass(column.id)}
              data-mono={column.id === "category" ||
              column.id === "status" ||
              column.id === "owner" ||
              column.id === "due" ||
              column.id === "updated" ||
              column.id === "attachments"
                ? true
                : undefined}
            >
              {#if column.id === "id"}
                <IdBadge id={task.id} dim />
              {:else if column.id === "priority"}
                <PriorityIndicator priority={task.priority} />
              {:else if column.id === "title"}
                <span class="line-clamp-1 text-[13px] font-medium text-neutral-900">{task.title}</span>
              {:else if column.id === "category"}
                {task.category}
              {:else if column.id === "goal"}
                {#if task.goal_id}
                  <a
                    href={resolve(resolveGoalHref(task.goal_id))}
                    title={task.goal_title ?? task.goal_id}
                    aria-label={task.goal_title
                      ? `open goal ${task.goal_id}: ${task.goal_title}`
                      : `open goal ${task.goal_id}`}
                    data-sveltekit-noscroll
                    class="inline-flex max-w-[5.75rem] items-center rounded bg-purple-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-purple-700 ring-1 ring-inset ring-purple-100 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-300"
                    data-mono
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => e.stopPropagation()}
                  >
                    <span class="truncate">{task.goal_id}</span>
                  </a>
                {:else}
                  <span class="font-mono text-[11px] text-neutral-300" data-mono>—</span>
                {/if}
              {:else if column.id === "status"}
                {@const statusMeta = TASK_STATUS_META[task.status]}
                <span
                  class="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold lowercase ring-1 ring-inset {statusMeta.pillClass}"
                  data-mono
                >
                  <span class="h-1.5 w-1.5 shrink-0 rounded-full {statusMeta.dotClass}"></span>
                  <span class="truncate">{taskStatusLabelLower(task.status)}</span>
                </span>
              {:else if column.id === "owner"}
                {@const owner = task.owner ?? "me"}
                <span class="inline-flex max-w-full items-center gap-1.5">
                  <span
                    style={assigneeThemeStyle(owner)}
                    class="assignee-badge inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold"
                    data-mono
                  >
                    {ownerInitials(owner)}
                  </span>
                  <span class="min-w-0 truncate">{owner}</span>
                </span>
              {:else if column.id === "due"}
                {dueLabel(task.due_date)}
                {#if task.hard_deadline && task.due_date}
                  <span
                    class="ml-1 inline-flex rounded bg-orange-50 px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30"
                    title="Hard deadline"
                  >
                    hard
                  </span>
                {/if}
              {:else if column.id === "updated"}
                {relativeAgo(task.updated_at)}
              {:else if column.id === "attachments"}
                {#if task.attachment_count > 0}
                  <span class="inline-flex items-center gap-1">
                    <Paperclip class="h-3 w-3" />
                    {task.attachment_count}
                  </span>
                {:else}
                  <span class="text-neutral-300">—</span>
                {/if}
              {:else if column.id === "flags"}
                <div class="flex flex-wrap items-center gap-1">
                  {#each flags as f (f)}
                    <span
                      class="rounded px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset {TASK_FLAG_META[
                        f
                      ].pillClass}"
                      data-mono
                    >
                      {flagText(task, f)}
                    </span>
                  {/each}
                </div>
              {/if}
            </td>
          {/each}
        </tr>
      {:else}
        <tr>
          <td colspan={visibleColumns.length + 1} class="px-3 py-12 text-center text-[12px] text-neutral-400">
            no tasks match these filters
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .assignee-badge {
    background: var(--assignee-bg);
    border-color: var(--assignee-border);
    color: var(--assignee-text);
    box-shadow: var(--assignee-shadow);
  }
</style>
