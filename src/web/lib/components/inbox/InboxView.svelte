<script lang="ts">
  import { tick } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import type { DashboardTask, TeamMember } from "$lib/types.js";
  import { buildAgentContextPrompt } from "$lib/utils/agent-context-prompt.js";
  import { pathWithQuery } from "$lib/utils/dashboard-url.js";
  import { setTaskParam, clearTaskParam } from "$lib/utils/drawer.js";
  import { relativeAgo } from "$lib/utils/dates.js";
  import { hasShortcutModifier } from "$lib/utils/keyboard-shortcuts.js";
  import { postTaskAction } from "$lib/utils/task-actions.js";
  import { toast } from "$lib/utils/toast.svelte.js";
  import {
    FOLLOW_UPS_VISIBLE,
    REVEAL_STEP,
    TASKS_VISIBLE,
    VIEW_ORDER,
    type Band,
    type ViewKey,
  } from "$lib/utils/inbox-views.js";
  import { suspendLiveRefresh, resumeLiveRefresh } from "$lib/utils/live-refresh.svelte.js";

  import { Check, CheckCheck, ChevronDown, Clipboard, Keyboard } from "@lucide/svelte";
  import { DropdownMenu } from "bits-ui";
  import ActionButton from "../ActionButton.svelte";
  import Kbd from "../Kbd.svelte";
  import TaskDetailSidePanel from "../TaskDetailSidePanel.svelte";
  import ActionModal, { type ActionModalMode } from "./ActionModal.svelte";
  import InboxCard from "./InboxCard.svelte";
  import InboxEmptyState from "./InboxEmptyState.svelte";
  import ShortcutsOverlay from "./ShortcutsOverlay.svelte";

  const VIEW_LABELS: Record<ViewKey, string> = {
    agent: "Agent rank",
    due: "Due date",
    priority: "Priority",
    updated: "Last updated",
    title: "Title A-Z",
  };

  const PRIORITIZE_QUEUE_PROMPT =
    "Please review my active task list and prioritize my queue for today. Rank the tasks I should work from top to bottom, explain briefly why each item belongs in that position, and leave anything that is not actionable or not important right now outside the queue.";

  type SelectionAccent = {
    focusClass: string;
    railClass: string;
  };

  type Accent = SelectionAccent & {
    contextBarClass: string;
  };

  const VIEW_ACCENTS: Record<ViewKey, Accent> = {
    agent: {
      contextBarClass: "bg-amber-400 dark:bg-amber-300",
      focusClass: "shadow-[inset_3px_0_0_rgb(245,158,11)] dark:shadow-[inset_3px_0_0_rgb(252,211,77)]",
      railClass: "bg-amber-500 dark:bg-amber-300",
    },
    due: {
      contextBarClass: "bg-red-500 dark:bg-red-300",
      focusClass: "shadow-[inset_3px_0_0_rgb(239,68,68)] dark:shadow-[inset_3px_0_0_rgb(252,165,165)]",
      railClass: "bg-red-500 dark:bg-red-300",
    },
    priority: {
      contextBarClass: "bg-violet-500 dark:bg-violet-300",
      focusClass: "shadow-[inset_3px_0_0_rgb(139,92,246)] dark:shadow-[inset_3px_0_0_rgb(196,181,253)]",
      railClass: "bg-violet-500 dark:bg-violet-300",
    },
    updated: {
      contextBarClass: "bg-teal-500 dark:bg-teal-300",
      focusClass: "shadow-[inset_3px_0_0_rgb(20,184,166)] dark:shadow-[inset_3px_0_0_rgb(94,234,212)]",
      railClass: "bg-teal-500 dark:bg-teal-300",
    },
    title: {
      contextBarClass: "bg-sky-500 dark:bg-sky-300",
      focusClass: "shadow-[inset_3px_0_0_rgb(14,165,233)] dark:shadow-[inset_3px_0_0_rgb(125,211,252)]",
      railClass: "bg-sky-500 dark:bg-sky-300",
    },
  };

  const GROUP_SELECTION_ACCENTS: Record<string, SelectionAccent> = {
    queue: {
      focusClass: "shadow-[inset_3px_0_0_rgb(139,92,246)] dark:shadow-[inset_3px_0_0_rgb(196,181,253)]",
      railClass: "bg-violet-500 dark:bg-violet-300",
    },
    overdue: {
      focusClass: "shadow-[inset_3px_0_0_rgb(239,68,68)] dark:shadow-[inset_3px_0_0_rgb(252,165,165)]",
      railClass: "bg-red-500 dark:bg-red-300",
    },
    today: {
      focusClass: "shadow-[inset_3px_0_0_rgb(245,158,11)] dark:shadow-[inset_3px_0_0_rgb(252,211,77)]",
      railClass: "bg-amber-500 dark:bg-amber-300",
    },
    week: {
      focusClass: "shadow-[inset_3px_0_0_rgb(14,165,233)] dark:shadow-[inset_3px_0_0_rgb(125,211,252)]",
      railClass: "bg-sky-500 dark:bg-sky-300",
    },
    "not-queued": {
      focusClass: "shadow-[inset_3px_0_0_rgb(59,130,246)] dark:shadow-[inset_3px_0_0_rgb(147,197,253)]",
      railClass: "bg-blue-500 dark:bg-blue-300",
    },
    p0: {
      focusClass: "shadow-[inset_3px_0_0_rgb(239,68,68)] dark:shadow-[inset_3px_0_0_rgb(252,165,165)]",
      railClass: "bg-red-500 dark:bg-red-300",
    },
    p1: {
      focusClass: "shadow-[inset_3px_0_0_rgb(245,158,11)] dark:shadow-[inset_3px_0_0_rgb(252,211,77)]",
      railClass: "bg-amber-500 dark:bg-amber-300",
    },
    p2: {
      focusClass: "shadow-[inset_3px_0_0_rgb(14,165,233)] dark:shadow-[inset_3px_0_0_rgb(125,211,252)]",
      railClass: "bg-sky-500 dark:bg-sky-300",
    },
  };

  let {
    followUps,
    tasks,
    taskBands,
    view,
    onViewChange,
    onClearDone,
    team,
    searchQuery,
  }: {
    followUps: DashboardTask[];
    tasks: DashboardTask[];
    taskBands: Band[];
    view: ViewKey;
    onViewChange: (view: ViewKey) => void;
    onClearDone: () => void;
    team: TeamMember[];
    searchQuery: string;
  } = $props();

  let activeModal = $state<{
    taskId: string;
    mode: ActionModalMode;
  } | null>(null);

  let shortcutsOpen = $state(false);

  let hasAutoOpened = $state(false);

  let sortMenuOpen = $state(false);

  let detailRefreshToken = $state(0);

  // Queue status line (A8): ranked-at is the shared queue_ranked_at of queued
  // tasks (a delegated queued member may sit in Follow-ups, so scan both
  // sections); the order is stale when any open own-task changed after it.
  let queueRankedAt = $derived.by(() => {
    let latest: string | null = null;
    for (const t of [...tasks, ...followUps]) {
      if (t.queue_rank === null || t.queue_ranked_at === null) continue;
      if (latest === null || new Date(t.queue_ranked_at).getTime() > new Date(latest).getTime()) {
        latest = t.queue_ranked_at;
      }
    }
    return latest;
  });
  let queueStale = $derived.by(() => {
    if (queueRankedAt === null) return false;
    const rankedMs = new Date(queueRankedAt).getTime();
    return tasks.some(
      (t) =>
        t.status !== "done" &&
        t.status !== "cancelled" &&
        new Date(t.updated_at).getTime() > rankedMs,
    );
  });

  let visibleDoneCount = $derived(
    [...followUps, ...tasks].filter((t) => t.status === "done").length,
  );

  // Volume expanders (A15): per-section cap + repeatable reveal. In the tasks
  // section the cap applies across bands, but the MY QUEUE band is never
  // collapsed; a band straddling the cap shows partial rows.
  let followUpsRevealed = $state(0);
  let tasksRevealed = $state(0);

  let visibleFollowUps = $derived(followUps.slice(0, FOLLOW_UPS_VISIBLE + followUpsRevealed));
  let hiddenFollowUpsCount = $derived(followUps.length - visibleFollowUps.length);

  let cappedTaskBands = $derived.by(() => {
    let budget = TASKS_VISIBLE + tasksRevealed;
    const bands: { band: Band; visible: DashboardTask[] }[] = [];
    let hidden = 0;
    for (const band of taskBands) {
      if (band.key === "queue") {
        bands.push({ band, visible: band.tasks });
        continue;
      }
      const take = Math.max(0, Math.min(band.tasks.length, budget));
      budget -= take;
      hidden += band.tasks.length - take;
      bands.push({ band, visible: band.tasks.slice(0, take) });
    }
    return { bands, hidden };
  });

  let visibleTaskRows = $derived(cappedTaskBands.bands.flatMap((entry) => entry.visible));

  // j/k traversal covers rendered rows only, in visual order (A22); rows
  // collapsed behind Show more are not traversed.
  let allItems = $derived([...visibleFollowUps, ...visibleTaskRows]);
  let activeModalTask = $derived(
    activeModal ? (allItems.find((item) => item.id === activeModal?.taskId) ?? null) : null,
  );

  let focusedTaskId = $derived.by(() => {
    const taskParam = page.url.searchParams.get("task");
    if (taskParam && allItems.some((item) => item.id === taskParam)) {
      return taskParam;
    }
    return allItems[0]?.id ?? null;
  });

  let focusedIndex = $derived.by(() => {
    if (!focusedTaskId) return -1;
    return allItems.findIndex(item => item.id === focusedTaskId);
  });

  $effect(() => {
    if (activeModal) {
      suspendLiveRefresh();
    } else {
      resumeLiveRefresh();
    }
  });

  // Auto-open first task on mount/data load if no task is in the URL
  $effect(() => {
    if (allItems.length > 0 && !hasAutoOpened) {
      hasAutoOpened = true;
      const taskParam = page.url.searchParams.get("task");
      if (!taskParam) {
        const firstId = allItems[0].id;
        handleOpenTask(firstId, true);
      }
    }
  });

  function handleOpenTask(id: string, replaceState = false) {
    const params = setTaskParam(page.url.searchParams, id);
    goto(resolve(pathWithQuery(params)), {
      replaceState,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function handleCloseTask() {
    const params = clearTaskParam(page.url.searchParams);
    goto(resolve(pathWithQuery(params)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: false,
    });
  }

  function handleClearSearch() {
    const params = new URLSearchParams(page.url.searchParams);
    params.delete("q");
    goto(resolve(pathWithQuery(params)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  function openModal(taskId: string, mode: ActionModalMode): void {
    handleOpenTask(taskId, true);
    activeModal = { taskId, mode };
  }

  function focusTaskRow(taskId: string): void {
    document.querySelector<HTMLElement>(`[data-task-row-id="${taskId}"]`)?.focus();
  }

  async function handleReopenTask(taskId: string): Promise<void> {
    const res = await postTaskAction(taskId, { action: "reopen" });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`${taskId} reopened`);
    await invalidateAll();
    detailRefreshToken += 1;
    await tick();
    handleOpenTask(taskId, true);
    await tick();
    focusTaskRow(taskId);
  }

  async function handleInlineMutation(taskId: string): Promise<void> {
    await invalidateAll();
    detailRefreshToken += 1;
    await tick();
    handleOpenTask(taskId, true);
    await tick();
    focusTaskRow(taskId);
  }

  function shortcutKey(event: KeyboardEvent): string {
    return event.key.length === 1 ? event.key.toLowerCase() : event.key;
  }

  function isTextEntryTarget(target: EventTarget | null): target is HTMLElement {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT"
    );
  }

  function isSearchInputTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement && target.id === "task-search";
  }

  function isNativeButtonActivation(target: EventTarget | null, key: string): boolean {
    return target instanceof HTMLButtonElement && (key === "Enter" || key === " ");
  }

  function hasSelectedText(): boolean {
    const selection = window.getSelection();
    return selection !== null && !selection.isCollapsed && selection.toString().length > 0;
  }

  // Tab is claimed ONLY on the document body or an inbox row (A14): everywhere
  // else (inputs, buttons, the details panel's controls) native focus
  // navigation is preserved. Deliberate tradeoff: rows hold real DOM focus, so
  // claiming Tab there removes the Tab path into a row's hover ActionButtons —
  // acceptable because every row action keeps a dedicated key.
  function isViewCycleTarget(target: EventTarget | null): boolean {
    if (target === document.body) return true;
    return target instanceof HTMLElement && target.dataset.taskRowId !== undefined;
  }

  function cycleView(direction: 1 | -1): void {
    const idx = VIEW_ORDER.indexOf(view);
    const next = VIEW_ORDER[(idx + direction + VIEW_ORDER.length) % VIEW_ORDER.length];
    onViewChange(next);
  }

  // `c` copies the focused task's context (A12, same builder as the panel bar).
  async function copyContextFor(task: DashboardTask): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildAgentContextPrompt(task));
      toast.success("Context copied — paste it to your agent");
    } catch {
      toast.error("Couldn't copy — use the panel's copy button");
    }
  }

  async function copyPrioritizeQueuePrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(PRIORITIZE_QUEUE_PROMPT);
      toast.success("Prioritization prompt copied");
    } catch {
      toast.error("Couldn't copy prioritization prompt");
    }
  }

  async function handleModalClose(didMutate: boolean): Promise<void> {
    const closedTaskId = activeModal?.taskId;
    if (!closedTaskId) return;

    activeModal = null;

    if (didMutate) {
      await invalidateAll();
      detailRefreshToken += 1;
      await tick();
    }

    const preferred = closedTaskId && allItems.some((item) => item.id === closedTaskId)
      ? closedTaskId
      : (allItems[0]?.id ?? null);
    if (preferred) {
      handleOpenTask(preferred, true);
      await tick();
      focusTaskRow(preferred);
    } else {
      handleCloseTask();
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    const key = shortcutKey(e);
    // Esc chain steps 1-2 (A14): the shortcuts overlay and the action modal
    // own their Escape handling; everything else is inert while they're open.
    // The sort menu likewise closes itself first (A21).
    // Bits UI dialogs close on a document-level Escape listener that runs
    // before this window listener and nulls activeModal/shortcutsOpen
    // synchronously, so the guard below no longer sees the keystroke that
    // closed them; Bits preventDefault()s what it consumed, so honor that.
    if (e.defaultPrevented) return;
    if (activeModal || shortcutsOpen || sortMenuOpen) return;
    if (hasShortcutModifier(e)) return;

    if (e.key === "Tab") {
      if (isViewCycleTarget(e.target)) {
        e.preventDefault();
        cycleView(e.shiftKey ? -1 : 1);
      }
      return;
    }

    if (isTextEntryTarget(e.target)) {
      if (key === "Escape" && !isSearchInputTarget(e.target)) {
        e.preventDefault();
        e.target.blur();
      }
      return;
    }

    if (isNativeButtonActivation(e.target, key)) return;

    if (key === "j" || key === "ArrowDown") {
      e.preventDefault();
      if (allItems.length === 0) return;
      let nextId: string;
      if (focusedIndex < allItems.length - 1) {
        nextId = allItems[focusedIndex + 1].id;
      } else {
        nextId = allItems[0].id;
      }
      handleOpenTask(nextId, true);
    } else if (key === "k" || key === "ArrowUp") {
      e.preventDefault();
      if (allItems.length === 0) return;
      let nextId: string;
      if (focusedIndex > 0) {
        nextId = allItems[focusedIndex - 1].id;
      } else {
        nextId = allItems[allItems.length - 1].id;
      }
      handleOpenTask(nextId, true);
    } else if (key === "Enter" || key === "o") {
      e.preventDefault();
      if (focusedTaskId) {
        handleOpenTask(focusedTaskId);
      }
    } else if (key === "e") {
      e.preventDefault();
      const focusedItem = allItems[focusedIndex];
      if (focusedItem && focusedItem.status !== "done" && focusedItem.status !== "cancelled") {
        openModal(focusedItem.id, "complete-confirm");
      }
    } else if (key === "u") {
      e.preventDefault();
      const focusedItem = allItems[focusedIndex];
      if (focusedItem?.status === "done") {
        void handleReopenTask(focusedItem.id);
      }
    } else if (key === "c") {
      if (hasSelectedText()) return;
      e.preventDefault();
      const focusedItem = allItems[focusedIndex];
      if (focusedItem) {
        void copyContextFor(focusedItem);
      }
    } else if (key === "h") {
      e.preventDefault();
      const focusedItem = allItems[focusedIndex];
      if (focusedItem) {
        document.getElementById(`handoff-trigger-${focusedItem.id}`)?.click();
      }
    } else if (key === "n") {
      e.preventDefault();
      const focusedItem = allItems[focusedIndex];
      if (focusedItem) {
        document.getElementById(`nudge-button-${focusedItem.id}`)?.click();
      }
    } else if (key === "s") {
      e.preventDefault();
      const focusedItem = allItems[focusedIndex];
      if (focusedItem) {
        document.getElementById(`snooze-trigger-${focusedItem.id}`)?.click();
      }
    } else if (key === "/") {
      e.preventDefault();
      const input = document.getElementById("task-search") as HTMLInputElement;
      input?.focus();
      input?.select();
    } else if (key === "?") {
      e.preventDefault();
      shortcutsOpen = true;
    } else if (key === "Escape") {
      // Chain steps 5-6 (A14): browse mode returns to Agent rank; otherwise
      // no-op — the details panel closes via its X button, never Esc. Step 3
      // (search clear+reset+blur) lives in FilterBar, which stopPropagation()s
      // Escape inside the search input, so this handler never sees that case.
      e.preventDefault();
      if (view !== "agent") onViewChange("agent");
    }
  }

  const openTaskId = $derived(page.url.searchParams.get("task"));

  function resolveGoalHref(goalId: string): "/" | `/?${string}` {
    const p = new URLSearchParams(page.url.searchParams);
    p.set("goal", goalId);
    return pathWithQuery(p) as "/" | `/?${string}`;
  }

  function taskCountLabel(n: number): string {
    return `${n} ${n === 1 ? "task" : "tasks"}`;
  }

  const VIEW_CONTEXT: Record<ViewKey, { title: string; description: string }> = {
    agent: {
      title: "Agent Rank View",
      description: "Your queue is ranked by the agent. Work from the top when you want the next best task.",
    },
    due: {
      title: "Due Date View",
      description: "Tasks are grouped by deadline so overdue and due-today work is easiest to spot.",
    },
    priority: {
      title: "Priority View",
      description: "Tasks are grouped by priority, with the agent-ranked queue still marked in each row.",
    },
    updated: {
      title: "Recently Updated View",
      description: "Most recently changed tasks appear first, useful after reviews and follow-ups.",
    },
    title: {
      title: "Title View",
      description: "Tasks are sorted alphabetically for quick lookup by name.",
    },
  };

  function bandDisplayLabel(band: Band): string {
    const labels: Record<string, string> = {
      queue: "My Queue",
      "not-queued": "In Your List - Not Queued",
      overdue: "Overdue",
      today: "Due Today",
      week: "Due This Week",
      later: "After This Week",
      "no-due": "No Due Date",
      p0: "P0",
      p1: "P1",
      p2: "P2",
      p3: "P3",
      "no-priority": "No Priority",
    };
    return labels[band.key] ?? band.label;
  }

  function bandContextLabel(band: Band): string {
    if (band.key === "queue") {
      if (queueRankedAt === null) return "not ranked yet";
      return `ranked ${relativeAgo(queueRankedAt)}${queueStale ? " - may be stale" : ""}`;
    }
    const labels: Record<string, string> = {
      overdue: "handle first",
      today: "due today",
      week: "next 7 days",
      later: "parked after this week",
      "no-due": "needs scheduling",
    };
    return labels[band.key] ?? "";
  }

  function viewAccent(): Accent {
    return VIEW_ACCENTS[view];
  }

  function selectionAccentForBand(key: string | null): SelectionAccent {
    return (key === null ? undefined : GROUP_SELECTION_ACCENTS[key]) ?? viewAccent();
  }

  function bandHeaderClass(key: string): string {
    if (key === "queue") {
      return "border-l-violet-400 bg-violet-50/45 dark:border-l-violet-300 dark:bg-violet-500/10";
    }
    if (key === "overdue") {
      return "border-l-red-500 bg-red-50/50 dark:border-l-red-300 dark:bg-red-500/10";
    }
    if (key === "today") {
      return "border-l-amber-400 bg-amber-50/45 dark:border-l-amber-300 dark:bg-amber-500/10";
    }
    if (key === "week") {
      return "border-l-sky-400 bg-sky-50/45 dark:border-l-sky-300 dark:bg-sky-500/10";
    }
    if (key === "not-queued") {
      return "border-l-blue-400 bg-blue-50/45 dark:border-l-blue-300 dark:bg-blue-500/10";
    }
    if (key === "p0") {
      return "border-l-red-500 bg-red-50/45 dark:border-l-red-300 dark:bg-red-500/10";
    }
    if (key === "p1") {
      return "border-l-amber-400 bg-amber-50/45 dark:border-l-amber-300 dark:bg-amber-500/10";
    }
    if (key === "p2") {
      return "border-l-sky-400 bg-sky-50/45 dark:border-l-sky-300 dark:bg-sky-500/10";
    }
    if (key === "later" || key === "no-due" || key === "p3" || key === "no-priority") {
      return "border-l-neutral-400 bg-neutral-50/45 dark:border-l-neutral-500 dark:bg-neutral-900/55";
    }
    return "border-l-neutral-300 bg-neutral-50/40 dark:border-l-neutral-600 dark:bg-neutral-900/50";
  }

  function bandDotClass(key: string): string {
    if (key === "queue") return "bg-violet-500 dark:bg-violet-300";
    if (key === "overdue" || key === "p0") return "bg-red-500 dark:bg-red-300";
    if (key === "today") return "bg-amber-400 dark:bg-amber-300";
    if (key === "week" || key === "p2") return "bg-sky-400 dark:bg-sky-300";
    if (key === "not-queued") return "bg-blue-500 dark:bg-blue-300";
    if (key === "p1") return "bg-amber-400 dark:bg-amber-300";
    return "bg-neutral-400 dark:bg-neutral-500";
  }

  function shouldRenderBand(entry: { band: Band; visible: DashboardTask[] }): boolean {
    return entry.visible.length > 0 || entry.band.key === "queue";
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="inbox-workspace grid w-full grid-cols-1 gap-3 overflow-visible rounded-lg bg-neutral-50/70 p-2 dark:bg-neutral-950/40 sm:p-3 lg:grid-cols-[minmax(0,1fr)_480px] lg:overflow-hidden"
>
  <!-- Left Side: Inbox main list -->
  <div
    class="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-neutral-800 dark:bg-neutral-950 lg:min-h-0"
  >
    <!-- Header bar -->
    <div class="border-b border-neutral-200 dark:border-neutral-800">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5">
        <div class="min-w-0">
          <h2 class="text-lg font-bold text-neutral-900 dark:text-neutral-100">Command Inbox</h2>
        </div>

        <div class="flex items-center gap-2">
          {#if visibleDoneCount > 0}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-mono text-[11px] font-medium text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
              title="Tasks stay done in the database; this only hides completed rows from the inbox view"
              onclick={onClearDone}
            >
              <CheckCheck class="h-3.5 w-3.5" />
              Hide done tasks ({visibleDoneCount})
            </button>
          {/if}

          <DropdownMenu.Root bind:open={sortMenuOpen}>
            <DropdownMenu.Trigger
              aria-label="change inbox view"
              class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors {sortMenuOpen
                ? 'border-neutral-400 bg-white text-neutral-900 shadow-sm dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100'
                : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600'}"
            >
              <span class="font-medium uppercase tracking-wider">{VIEW_LABELS[view]}</span>
              <Kbd>Tab</Kbd>
              <ChevronDown
                class="h-3 w-3 text-neutral-400 transition-transform {sortMenuOpen ? 'rotate-180' : ''}"
              />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                class="z-50 min-w-[11rem] rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <DropdownMenu.RadioGroup value={view} onValueChange={(v) => onViewChange(v as typeof view)}>
                  {#each VIEW_ORDER as key (key)}
                    <DropdownMenu.RadioItem
                      value={key}
                      class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-neutral-800 outline-none select-none hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      <Check class="h-3 w-3 {view === key ? 'text-neutral-700 dark:text-neutral-200' : 'invisible'}" />
                      {VIEW_LABELS[key]}
                    </DropdownMenu.RadioItem>
                  {/each}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <ActionButton label="Keyboard shortcuts" keys={["?"]} onclick={() => (shortcutsOpen = true)}>
            <Keyboard class="h-3.5 w-3.5" />
          </ActionButton>
        </div>
      </div>

      <div
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-neutral-200 bg-neutral-50/80 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/55"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <span
            class="h-8 w-1 shrink-0 rounded-full {viewAccent().contextBarClass}"
            aria-hidden="true"
          ></span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-mono text-[11px] font-bold uppercase tracking-wider text-neutral-800 dark:text-neutral-100">
                {VIEW_CONTEXT[view].title}
              </p>
            </div>
            <p class="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
              {VIEW_CONTEXT[view].description}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="font-mono text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Tab cycles view
          </span>
          {#if view !== "agent"}
            <span class="font-mono text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              <Kbd>Esc</Kbd> returns to Agent Rank
            </span>
          {/if}
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      <!-- Section 1: Follow-ups -->
      <div class="overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div
          class="flex items-center justify-between border-b border-neutral-200 bg-neutral-50/90 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/60"
        >
          <div class="flex items-center gap-2">
            <h3 class="font-mono text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              FOLLOW-UPS <span class="ml-1 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] text-neutral-700 tabular-nums dark:bg-neutral-800 dark:text-neutral-300">{followUps.length}</span>
            </h3>
          </div>
          <span class="font-mono text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            delegated — you chase, they do
          </span>
        </div>

        {#if followUps.length === 0}
          <InboxEmptyState variant={searchQuery ? "search-no-results" : "followups-empty"} query={searchQuery} onClearSearch={handleClearSearch} />
        {:else}
          <div class="divide-y divide-neutral-100 dark:divide-neutral-800">
            {#each visibleFollowUps as task (task.id)}
              {@const isFocused = task.id === focusedTaskId}
              <InboxCard
                {task}
                section="followups"
                {team}
                focused={isFocused}
                selectionAccent={selectionAccentForBand(null)}
                onOpen={() => handleOpenTask(task.id)}
                onComplete={() => openModal(task.id, "complete-confirm")}
                onReopen={() => void handleReopenTask(task.id)}
                onMutate={(taskId: string) => void handleInlineMutation(taskId)}
              />
            {/each}
          </div>
          {#if hiddenFollowUpsCount > 0}
            <button
              type="button"
              class="block w-full border-t border-neutral-200 bg-neutral-50/60 px-3 py-2 text-center font-mono text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
              onclick={() => (followUpsRevealed += REVEAL_STEP)}
            >
              Show more ({hiddenFollowUpsCount})
            </button>
          {/if}
        {/if}
      </div>

      <!-- Section 2: Tasks -->
      <div class="mt-4 overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div
          class="flex items-center justify-between border-b border-neutral-200 bg-neutral-50/90 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/60"
        >
          <div class="flex items-center gap-2">
            <h3 class="font-mono text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              TASKS <span class="ml-1 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] text-neutral-700 tabular-nums dark:bg-neutral-800 dark:text-neutral-300">{tasks.length}</span>
            </h3>
          </div>
          <span class="font-mono text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            queue
          </span>
        </div>

        {#if tasks.length === 0}
          <InboxEmptyState variant={searchQuery ? "search-no-results" : "tasks-empty"} query={searchQuery} onClearSearch={handleClearSearch} />
        {:else}
          {#each cappedTaskBands.bands as entry (entry.band.key)}
            {#if shouldRenderBand(entry)}
              {#if entry.band.label}
                <div
                  class="flex items-center justify-between border-b border-l-2 border-neutral-200 px-3 py-2 dark:border-neutral-800 {bandHeaderClass(entry.band.key)}"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full {bandDotClass(entry.band.key)}" aria-hidden="true"></span>
                    <span class="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
                      {bandDisplayLabel(entry.band)}
                    </span>
                    <span class="rounded-full bg-neutral-100 px-1.5 py-0.5 font-mono text-[9px] text-neutral-600 tabular-nums ring-1 ring-inset ring-neutral-200/70 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-700/70">
                      {taskCountLabel(entry.band.tasks.length)}
                    </span>
                  </div>
                  {#if bandContextLabel(entry.band)}
                    <span class="font-mono text-[9px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                      {bandContextLabel(entry.band)}
                    </span>
                  {/if}
                </div>
              {/if}
              {#if entry.visible.length === 0 && entry.band.key === "queue"}
                <div class="border-b border-neutral-200 bg-violet-50/20 px-3 py-2.5 dark:border-neutral-800 dark:bg-violet-500/5">
                  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-dashed border-violet-200 bg-white/55 px-3 py-3 dark:border-violet-400/30 dark:bg-neutral-950/35">
                    <div class="min-w-[14rem] flex-1">
                      <p class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">No prioritized queue yet</p>
                      <p class="mt-0.5 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                      Your tasks are captured, but your agent has not ranked them into a do-next order.
                      </p>
                    </div>
                    <button
                      type="button"
                      class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-violet-700 shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-400/30 dark:bg-neutral-900 dark:text-violet-300 dark:hover:bg-violet-500/10 dark:hover:text-violet-200"
                      onclick={() => void copyPrioritizeQueuePrompt()}
                    >
                      <Clipboard class="h-3.5 w-3.5" />
                      Copy prompt
                    </button>
                  </div>
                </div>
              {:else}
                <div class="divide-y divide-neutral-100 border-b border-neutral-200 last:border-b-0 dark:divide-neutral-800 dark:border-neutral-800">
                  {#each entry.visible as task (task.id)}
                    {@const isFocused = task.id === focusedTaskId}
                    <InboxCard
                      {task}
                      section="tasks"
                      {team}
                      {view}
                      focused={isFocused}
                      selectionAccent={selectionAccentForBand(entry.band.key)}
                      onOpen={() => handleOpenTask(task.id)}
                      onComplete={() => openModal(task.id, "complete-confirm")}
                      onReopen={() => void handleReopenTask(task.id)}
                      onMutate={(taskId: string) => void handleInlineMutation(taskId)}
                    />
                  {/each}
                </div>
              {/if}
            {/if}
          {/each}
          {#if cappedTaskBands.hidden > 0}
            <button
              type="button"
              class="block w-full bg-neutral-50/60 px-3 py-2 text-center font-mono text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:bg-neutral-900/40 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
              onclick={() => (tasksRevealed += REVEAL_STEP)}
            >
              Show more ({cappedTaskBands.hidden})
            </button>
          {/if}
        {/if}
      </div>
    </div>

    <!-- Footer hint line -->
    <div
      class="border-t border-neutral-200 px-4 py-2 text-center font-mono text-[10px] text-neutral-400 dark:text-neutral-500 dark:border-neutral-800"
    >
      j/k move · tab cycle sort · e done · u restore · c copy context · ? all shortcuts
    </div>
  </div>

  <!-- Right Side: Side Panel -->
  <div
    class="flex min-h-[420px] w-full shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-neutral-800 dark:bg-neutral-950 lg:h-full lg:w-[480px]"
  >
    {#if openTaskId}
      <TaskDetailSidePanel
        taskId={openTaskId}
        onClose={handleCloseTask}
        onNavigate={handleOpenTask}
        onAction={openModal}
        resolveGoalHref={resolveGoalHref}
        refreshToken={detailRefreshToken}
        {team}
      />
    {:else}
      <div class="flex flex-1 flex-col justify-center bg-neutral-50/40 p-6 dark:bg-neutral-900/30">
        <InboxEmptyState variant="no-selection" onShowShortcuts={() => (shortcutsOpen = true)} />
      </div>
    {/if}
  </div>
</div>

{#if shortcutsOpen}
  <ShortcutsOverlay onClose={() => (shortcutsOpen = false)} />
{/if}

{#if activeModal && activeModalTask}
  <ActionModal
    mode={activeModal.mode}
    task={activeModalTask}
    onClose={(didMutate) => void handleModalClose(didMutate)}
  />
{/if}

<style>
  @media (min-width: 1024px) {
    .inbox-workspace {
      height: max(30rem, calc(100vh - 19.5rem));
    }
  }
</style>
