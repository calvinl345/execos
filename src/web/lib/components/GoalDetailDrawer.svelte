<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { X } from "@lucide/svelte";
  import type { DashboardTask, GoalStatus, GoalSummary, TaskStatus } from "$lib/types.js";
  import { relativeAgo } from "$lib/utils/dates.js";
  import { TASK_STATUS_META } from "$lib/utils/status-meta.js";
  import { taskStatusLabel } from "$lib/utils/status-labels.js";
  import IdBadge from "./IdBadge.svelte";
  import PriorityIndicator from "./PriorityIndicator.svelte";

  let {
    goal,
    linkedTasks,
    onClose,
    onTaskNavigate,
  }: {
    goal: GoalSummary;
    linkedTasks: DashboardTask[];
    onClose: () => void;
    onTaskNavigate: (id: string) => void;
  } = $props();

  let panelEl: HTMLElement | undefined = $state();
  let drawerWidth = $state(560);
  let isResizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  const drawerWidthStorageKey = "execos.goalDrawerWidth";
  const minDrawerWidth = 420;
  const maxDrawerWidth = 980;

  function formatQuarter(quarter: string): string {
    const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
    if (!match) return quarter;
    return `Q${match[2]} ${match[1]}`;
  }

  function statusLabel(status: GoalStatus | TaskStatus): string {
    switch (status) {
      case "in_progress":
        return "In Progress";
      case "review":
        return taskStatusLabel(status);
      default:
        return status.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
    }
  }

  function goalStatusDot(status: GoalStatus): string {
    switch (status) {
      case "active":
        return "bg-blue-600";
      case "achieved":
        return "bg-purple-600";
      case "dropped":
        return "bg-red-600";
    }
  }

  function clampDrawerWidth(width: number): number {
    const viewportMax =
      typeof window === "undefined" ? maxDrawerWidth : Math.max(minDrawerWidth, window.innerWidth - 32);
    return Math.min(Math.max(width, minDrawerWidth), Math.min(maxDrawerWidth, viewportMax));
  }

  function saveDrawerWidth(): void {
    localStorage.setItem(drawerWidthStorageKey, String(drawerWidth));
  }

  function startResize(event: PointerEvent): void {
    isResizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = drawerWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleResizeMove(event: PointerEvent): void {
    if (!isResizing) return;
    drawerWidth = clampDrawerWidth(resizeStartWidth + resizeStartX - event.clientX);
  }

  function finishResize(): void {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    saveDrawerWidth();
  }

  function adjustDrawerWidth(delta: number): void {
    drawerWidth = clampDrawerWidth(drawerWidth + delta);
    saveDrawerWidth();
  }

  function handleWindowKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }

  function handleWindowResize(): void {
    drawerWidth = clampDrawerWidth(drawerWidth);
  }

  onMount(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const storedWidth = Number(localStorage.getItem(drawerWidthStorageKey));
    if (Number.isFinite(storedWidth) && storedWidth > 0) {
      drawerWidth = clampDrawerWidth(storedWidth);
    } else {
      drawerWidth = clampDrawerWidth(drawerWidth);
    }

    void tick().then(() => {
      panelEl?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      previouslyFocused?.focus?.();
    };
  });
</script>

<svelte:window
  onkeydown={handleWindowKeydown}
  onpointermove={handleResizeMove}
  onpointerup={finishResize}
  onresize={handleWindowResize}
/>

<button
  type="button"
  aria-label="close goal drawer"
  class="fixed inset-0 z-40 cursor-default bg-black/30"
  transition:fade={{ duration: 120 }}
  onclick={onClose}
></button>

<div
  bind:this={panelEl}
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="goal-drawer-title"
  class="fixed right-0 top-0 z-50 flex h-screen max-w-full flex-col overflow-y-auto bg-white shadow-2xl outline-none"
  style={`width: min(100vw, ${drawerWidth}px);`}
  transition:fly={{ x: 560, duration: 200 }}
>
  <button
    type="button"
    class="absolute left-0 top-0 z-20 h-full w-2 cursor-ew-resize border-l border-transparent transition-colors hover:border-neutral-300 hover:bg-neutral-100/70 focus:border-neutral-400 focus:bg-neutral-100 focus:outline-none"
    aria-label="resize goal details drawer"
    title="Resize drawer"
    onpointerdown={startResize}
    onkeydown={(event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        adjustDrawerWidth(40);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        adjustDrawerWidth(-40);
      }
    }}
  ></button>
  <header class="sticky top-0 z-10 border-b border-neutral-200 bg-white px-5 py-5">
    <div class="mb-5 flex items-start justify-between gap-3">
      <div class="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[12px]">
        <span class="inline-flex items-center gap-2 font-semibold text-neutral-900">
          <span class="h-1.5 w-1.5 rounded-full {goalStatusDot(goal.status)}"></span>
          {statusLabel(goal.status)}
        </span>
        <span class="text-neutral-300">/</span>
        <IdBadge id={goal.id} />
      </div>
      <button
        type="button"
        class="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        aria-label="close"
        onclick={onClose}
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <h2 id="goal-drawer-title" class="text-[22px] font-semibold leading-tight text-neutral-950">
      {goal.title}
    </h2>

    <div class="mt-3 flex flex-wrap items-center gap-2 font-mono text-[12px] text-neutral-600">
      <span
        class="rounded bg-neutral-50 px-2 py-1 font-semibold uppercase tracking-wide text-neutral-700 ring-1 ring-inset ring-neutral-200"
        >{formatQuarter(goal.quarter)}</span
      >
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-1.5 rounded-full {goalStatusDot(goal.status)}"></span>
        {statusLabel(goal.status)}
      </span>
      <span class="text-neutral-300">·</span>
      <span>{linkedTasks.length} linked {linkedTasks.length === 1 ? "task" : "tasks"}</span>
    </div>
  </header>

  <div class="flex-1 px-5 pb-10 pt-6">
    <section class="mb-8">
      <h3 class="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
        Description
      </h3>
      <p class="whitespace-pre-wrap text-[14px] leading-6 text-neutral-800">{goal.description}</p>
    </section>

    <section class="mb-8 border-t border-neutral-200 pt-5">
      <h3 class="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
        Linked Tasks · {linkedTasks.length}
      </h3>
      {#if linkedTasks.length === 0}
        <p class="text-[13px] text-neutral-400">No linked tasks yet.</p>
      {:else}
        <ul class="divide-y divide-neutral-200 overflow-hidden border-y border-neutral-200">
          {#each linkedTasks as task (task.id)}
            <li>
              <button
                type="button"
                class="grid w-full grid-cols-[72px_1fr_auto_auto] items-center gap-3 border-l-2 border-orange-500 px-3 py-3 text-left text-[12px] transition-colors hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
                onclick={() => onTaskNavigate(task.id)}
              >
                <span class="font-mono text-[11px] text-neutral-700">{task.id}</span>
                <span class="min-w-0 truncate font-medium text-neutral-950">{task.title}</span>
                <span class="inline-flex items-center gap-1.5 font-mono text-[11px] text-neutral-700">
                  <span class="h-1.5 w-1.5 rounded-full {TASK_STATUS_META[task.status].dotClass}"></span>
                  {statusLabel(task.status)}
                </span>
                <PriorityIndicator priority={task.priority} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="mb-8 border-t border-neutral-200 pt-5">
      <h3 class="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
        Notes · 0
      </h3>
      <p class="text-[13px] text-neutral-400">No goal notes yet.</p>
    </section>

    <section class="border-t border-neutral-200 pt-5">
      <h3 class="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
        Metadata
      </h3>
      <dl class="grid grid-cols-[112px_1fr] gap-x-4 gap-y-2 text-[12px]">
        <dt class="font-mono text-neutral-500">Quarter</dt>
        <dd class="font-mono text-neutral-800">{formatQuarter(goal.quarter)}</dd>
        <dt class="font-mono text-neutral-500">Created</dt>
        <dd class="font-mono text-neutral-800">{relativeAgo(goal.created_at)}</dd>
        <dt class="font-mono text-neutral-500">Updated</dt>
        <dd class="font-mono text-neutral-800">{relativeAgo(goal.updated_at)}</dd>
        {#if goal.closed_at}
          <dt class="font-mono text-neutral-500">Closed</dt>
          <dd class="font-mono text-neutral-800">{relativeAgo(goal.closed_at)}</dd>
        {/if}
      </dl>
    </section>
  </div>
</div>
