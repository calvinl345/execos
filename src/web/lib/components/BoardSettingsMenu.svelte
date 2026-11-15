<script lang="ts">
  import { Popover } from "bits-ui";
  import {
    ChevronDown,
    ChevronUp,
    Eye,
    EyeOff,
    GripVertical,
    RotateCcw,
    Settings2,
  } from "@lucide/svelte";
  import type { ViewMode } from "$lib/utils/filters";
  import {
    TASK_CARD_FIELDS,
    defaultTaskCardFieldPreferences,
    normalizeTaskCardFieldPreferences,
    type TaskCardFieldId,
    type TaskCardFieldPreferences,
  } from "$lib/utils/task-card-fields";
  import {
    TASK_LIST_COLUMNS,
    defaultTaskListColumnPreferences,
    normalizeTaskListColumnPreferences,
    type TaskListColumnId,
    type TaskListColumnPreferences,
  } from "$lib/utils/task-list-columns";

  let {
    view,
    columnPrefs,
    cardFieldPrefs,
    onColumnPrefsChange,
    onCardFieldPrefsChange,
  }: {
    view: ViewMode;
    columnPrefs: TaskListColumnPreferences;
    cardFieldPrefs: TaskCardFieldPreferences;
    onColumnPrefsChange: (next: TaskListColumnPreferences) => void;
    onCardFieldPrefsChange: (next: TaskCardFieldPreferences) => void;
  } = $props();

  let menuOpen = $state(false);
  let draggedColumn = $state<TaskListColumnId | null>(null);

  const columnsById = Object.fromEntries(
    TASK_LIST_COLUMNS.map((column) => [column.id, column]),
  ) as Record<TaskListColumnId, (typeof TASK_LIST_COLUMNS)[number]>;

  const orderedColumns = $derived.by(() =>
    columnPrefs.order.map((id) => columnsById[id]).filter(Boolean),
  );

  const visibleColumnIds = $derived(
    orderedColumns
      .filter((column) => !columnPrefs.hidden.includes(column.id))
      .map((column) => column.id),
  );

  const visibleCardFieldCount = $derived(TASK_CARD_FIELDS.length - cardFieldPrefs.hidden.length);
  const disabled = $derived(view === "inbox");

  function isColumnVisible(id: TaskListColumnId): boolean {
    return !columnPrefs.hidden.includes(id);
  }

  function toggleColumn(id: TaskListColumnId): void {
    let hidden = columnPrefs.hidden;
    if (hidden.includes(id)) {
      hidden = hidden.filter((columnId) => columnId !== id);
    } else if (visibleColumnIds.length > 1) {
      hidden = [...hidden, id];
    }

    onColumnPrefsChange(
      normalizeTaskListColumnPreferences({
        order: columnPrefs.order,
        hidden,
        widths: columnPrefs.widths,
      }),
    );
  }

  function resetColumns(): void {
    onColumnPrefsChange(defaultTaskListColumnPreferences());
  }

  function moveColumn(id: TaskListColumnId, offset: -1 | 1): void {
    const order = [...columnPrefs.order];
    const from = order.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(from, 1);
    order.splice(to, 0, id);
    onColumnPrefsChange(
      normalizeTaskListColumnPreferences({
        order,
        hidden: columnPrefs.hidden,
        widths: columnPrefs.widths,
      }),
    );
  }

  function moveColumnBefore(source: TaskListColumnId, target: TaskListColumnId): void {
    if (source === target) return;
    const withoutSource = columnPrefs.order.filter((id) => id !== source);
    const targetIndex = withoutSource.indexOf(target);
    if (targetIndex < 0) return;
    withoutSource.splice(targetIndex, 0, source);
    onColumnPrefsChange(
      normalizeTaskListColumnPreferences({
        order: withoutSource,
        hidden: columnPrefs.hidden,
        widths: columnPrefs.widths,
      }),
    );
  }

  function startColumnDrag(event: DragEvent, id: TaskListColumnId): void {
    draggedColumn = id;
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function allowColumnDrop(event: DragEvent, id: TaskListColumnId): void {
    if (draggedColumn && draggedColumn !== id) event.preventDefault();
  }

  function dropColumn(event: DragEvent, id: TaskListColumnId): void {
    event.preventDefault();
    const source = draggedColumn ?? event.dataTransfer?.getData("text/plain");
    if (source && isTaskListColumnId(source)) moveColumnBefore(source, id);
    draggedColumn = null;
  }

  function isTaskListColumnId(value: string): value is TaskListColumnId {
    return TASK_LIST_COLUMNS.some((column) => column.id === value);
  }

  function isCardFieldVisible(id: TaskCardFieldId): boolean {
    return !cardFieldPrefs.hidden.includes(id);
  }

  function toggleCardField(id: TaskCardFieldId): void {
    let hidden = cardFieldPrefs.hidden;
    if (hidden.includes(id)) {
      hidden = hidden.filter((fieldId) => fieldId !== id);
    } else if (visibleCardFieldCount > 1) {
      hidden = [...hidden, id];
    }

    onCardFieldPrefsChange(normalizeTaskCardFieldPreferences({ hidden }));
  }

  function resetCardFields(): void {
    onCardFieldPrefsChange(defaultTaskCardFieldPreferences());
  }

  $effect(() => {
    if (disabled) {
      menuOpen = false;
    }
  });
</script>

<Popover.Root bind:open={menuOpen}>
  <Popover.Trigger
    disabled={disabled}
    class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 {disabled
      ? 'cursor-not-allowed opacity-40'
      : 'hover:border-neutral-300 hover:bg-white hover:text-neutral-800'}"
    aria-label={view === "list" ? "configure list columns" : "configure card fields"}
    title={disabled ? "This can only be used on Kanban or list" : view === "list" ? "Columns" : "Card fields"}
  >
    <Settings2 class="h-4 w-4" />
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      align="end"
      sideOffset={8}
      class="z-50 w-72 rounded-md border border-neutral-200 bg-white p-2 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
      role="dialog"
      aria-label={view === "list" ? "table columns" : "card fields"}
    >
      <div class="mb-2 flex items-center justify-between border-b border-neutral-100 pb-2">
        <span class="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
          {view === "list" ? "Columns" : "Card fields"}
        </span>
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          aria-label={view === "list" ? "reset columns" : "reset card fields"}
          title="Reset"
          onclick={view === "list" ? resetColumns : resetCardFields}
        >
          <RotateCcw class="h-3.5 w-3.5" />
        </button>
      </div>

      {#if view === "list"}
        <div class="space-y-1" role="list">
          {#each orderedColumns as column, index (column.id)}
            {@const visible = isColumnVisible(column.id)}
            <div
              role="listitem"
              class="flex items-center gap-2 rounded px-1.5 py-1.5 {draggedColumn === column.id
                ? 'bg-neutral-100'
                : 'hover:bg-neutral-50'}"
              draggable="true"
              ondragstart={(event) => startColumnDrag(event, column.id)}
              ondragover={(event) => allowColumnDrop(event, column.id)}
              ondrop={(event) => dropColumn(event, column.id)}
              ondragend={() => (draggedColumn = null)}
            >
              <GripVertical class="h-4 w-4 shrink-0 text-neutral-300" aria-hidden="true" />
              <button
                type="button"
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={visible ? `hide ${column.label}` : `show ${column.label}`}
                title={visible ? "Hide" : "Show"}
                disabled={visible && visibleColumnIds.length === 1}
                onclick={() => toggleColumn(column.id)}
              >
                {#if visible}
                  <Eye class="h-3.5 w-3.5" />
                {:else}
                  <EyeOff class="h-3.5 w-3.5" />
                {/if}
              </button>
              <span class="min-w-0 flex-1 truncate text-[12px] text-neutral-700">{column.label}</span>
              <button
                type="button"
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`move ${column.label} left`}
                title="Move left"
                disabled={index === 0}
                onclick={() => moveColumn(column.id, -1)}
              >
                <ChevronUp class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`move ${column.label} right`}
                title="Move right"
                disabled={index === orderedColumns.length - 1}
                onclick={() => moveColumn(column.id, 1)}
              >
                <ChevronDown class="h-3.5 w-3.5" />
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <div class="space-y-1" role="list">
          {#each TASK_CARD_FIELDS as field (field.id)}
            {@const visible = isCardFieldVisible(field.id)}
            <div role="listitem" class="flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-neutral-50">
              <button
                type="button"
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={visible ? `hide ${field.label}` : `show ${field.label}`}
                title={visible ? "Hide" : "Show"}
                disabled={visible && visibleCardFieldCount === 1}
                onclick={() => toggleCardField(field.id)}
              >
                {#if visible}
                  <Eye class="h-3.5 w-3.5" />
                {:else}
                  <EyeOff class="h-3.5 w-3.5" />
                {/if}
              </button>
              <span class="min-w-0 flex-1 truncate text-[12px] text-neutral-700">{field.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
