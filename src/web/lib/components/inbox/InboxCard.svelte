<script lang="ts">
  import type { DashboardTask, TeamMember } from "$lib/types.js";
  import { relativeAgo } from "$lib/utils/dates.js";
  import { TASK_FLAG_META, flagsFor, staleDays } from "$lib/utils/flags.js";
  import { resolveDisplayName } from "$lib/utils/inbox-format.js";
  import type { ViewKey } from "$lib/utils/inbox-views.js";
  import { TASK_STATUS_META } from "$lib/utils/status-meta.js";
  import { taskStatusLabelLower } from "$lib/utils/status-labels.js";
  import { Lock, Sparkles } from "@lucide/svelte";
  import ActionButton from "../ActionButton.svelte";
  import IdBadge from "../IdBadge.svelte";
  import PriorityIndicator from "../PriorityIndicator.svelte";
  import AssigneeAvatarPicker from "./AssigneeAvatarPicker.svelte";
  import DueDatePopover from "./DueDatePopover.svelte";
  import HandoffNudgeControl from "./HandoffNudgeControl.svelte";
  import InstantNudgeButton from "./InstantNudgeButton.svelte";
  import SnoozePopover from "./SnoozePopover.svelte";
  import {
    isSelfOwned,
    secondaryTimingLabel,
    shouldDimForWaiting,
  } from "$lib/utils/task-row-workflow.js";

  type SelectionAccent = {
    focusClass: string;
    railClass: string;
  };

  const DEFAULT_SELECTION_ACCENT: SelectionAccent = {
    focusClass: "shadow-[inset_3px_0_0_rgb(139,92,246)] dark:shadow-[inset_3px_0_0_rgb(196,181,253)]",
    railClass: "bg-violet-500 dark:bg-violet-300",
  };

  let {
    task,
    section,
    team,
    focused,
    view = "agent",
    selectionAccent = DEFAULT_SELECTION_ACCENT,
    onOpen,
    onComplete,
    onReopen,
    onMutate,
  }: {
    task: DashboardTask;
    section: "followups" | "tasks";
    team: TeamMember[];
    focused: boolean;
    /** Active inbox view; emphasizes the updated-ago value in "updated" (S5). */
    view?: ViewKey;
    selectionAccent?: SelectionAccent;
    onOpen: () => void;
    onComplete?: () => void;
    onReopen?: () => void;
    onMutate?: (taskId: string) => void | Promise<void>;
  } = $props();

  let rowEl = $state<HTMLDivElement | null>(null);

  const resolvedOwnerName = $derived(resolveDisplayName(task.owner, team));
  const isHardDue = $derived(task.hard_deadline && task.due_date !== null);
  const isDone = $derived(task.status === "done");
  const showStatusChip = $derived(task.status === "done" || task.status === "blocked");
  const flags = $derived(flagsFor(task));
  const isStale = $derived(flags.includes("stale"));
  const ownerIsSelf = $derived(isSelfOwned(task));
  const dimmedForWaiting = $derived(shouldDimForWaiting(task));
  // Rank chip + rationale render only when the queued task sits in the own-tasks
  // section (A10/A20) and is not dimmed for waiting; a delegated queued task
  // renders in Follow-ups without them. Defer now clears the rank, so a snoozed
  // row is never queued. The not-dimmed guard is belt-and-suspenders: it keeps
  // any legacy row whose rank predates that change from showing a "#rank" chip
  // while parked.
  const showQueueMarkers = $derived(
    section === "tasks" && task.queue_rank !== null && !dimmedForWaiting,
  );
  const secondaryTiming = $derived(secondaryTimingLabel(task));
  const focusedSelectionClass = $derived(
    focused
      ? `bg-neutral-100/80 dark:bg-neutral-900/85 ${selectionAccent.focusClass}`
      : "",
  );

  function searchInputHasFocus(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement && active.id === "task-search";
  }

  $effect(() => {
    if (focused && rowEl && !searchInputHasFocus()) rowEl.focus();
  });

  function stopAndRun(event: MouseEvent, callback: (() => void) | undefined): void {
    event.preventDefault();
    event.stopPropagation();
    callback?.();
  }


</script>

<div
  bind:this={rowEl}
  role="button"
  tabindex="-1"
  data-task-row-id={task.id}
  onclick={onOpen}
  onkeydown={(event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onOpen();
    }
  }}
  class="group relative flex min-h-[3.5rem] w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-900/70 sm:px-4 {focusedSelectionClass} {dimmedForWaiting ? 'opacity-60' : ''}"
>
  <!-- Selection visuals are driven by the `focused` prop only (URL selection), never
       DOM :focus — the two fall out of sync during keyboard navigation. -->
  <span
    class="absolute left-0 top-2 h-[calc(100%-16px)] w-0.5 rounded-full opacity-0 transition-opacity {selectionAccent.railClass} {focused
      ? 'opacity-100'
      : 'group-hover:opacity-25'}"
  ></span>

  <div class="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
    <!-- Always-rendered fixed-width rank gutter so IdBadge and titles align
         across queued, unqueued, and follow-up rows; the rank itself renders
         as muted plain text, not a solid badge. -->
    <span
      class="inline-flex w-6 shrink-0 items-center justify-center font-mono text-[11px] font-semibold text-neutral-400 dark:text-neutral-500"
      title={showQueueMarkers ? `Queued #${task.queue_rank} by the agent` : undefined}
    >
      {#if showQueueMarkers}#{task.queue_rank}{/if}
    </span>

    <IdBadge id={task.id} dim />

    <PriorityIndicator priority={task.priority} />

    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <h3
          class="truncate text-sm font-medium leading-5 {isDone
            ? 'text-neutral-500 line-through dark:text-neutral-400'
            : 'text-neutral-900 dark:text-neutral-100'}"
        >
          {task.title}
        </h3>
        {#if showStatusChip}
          <span class="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] lowercase ring-1 ring-inset {TASK_STATUS_META[task.status].pillClass}">
            {taskStatusLabelLower(task.status)}
          </span>
        {/if}
        {#if isStale}
          <span
            class="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset {TASK_FLAG_META.stale.pillClass}"
            title={TASK_FLAG_META.stale.description}
          >
            stale {staleDays(task)}d
          </span>
        {/if}
      </div>
      {#if showQueueMarkers && task.queue_rationale}
        <p
          class="mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-neutral-500 dark:text-neutral-400"
          title={task.queue_rationale}
        >
          <Sparkles class="h-3 w-3 shrink-0 text-indigo-400 dark:text-indigo-300" />
          <span class="truncate">{task.queue_rationale}</span>
        </p>
      {/if}
      <p class="truncate text-xs {section === 'tasks' && view === 'updated'
        ? 'font-medium text-blue-600 dark:text-blue-400'
        : 'text-neutral-400 dark:text-neutral-500'}">
        {#if section === "followups"}
          delegated to {resolvedOwnerName}
        {:else}
          updated {relativeAgo(task.updated_at)}
        {/if}
      </p>
    </div>
  </div>

  <div class="flex shrink-0 items-center gap-4">
    <!-- Snooze & Due Date Group -->
    <div class="flex items-center gap-2">
      {#if ownerIsSelf}
        <div>
          <SnoozePopover {task} {onMutate} disabled={isDone} />
        </div>
      {/if}
      <div class="flex w-[8rem] flex-col items-start text-left">
        {#if isHardDue}
          <span
            class="mb-0.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400"
            title="Hard deadline"
          >
            <Lock class="h-2.5 w-2.5" />
            hard due date
          </span>
        {/if}
        <DueDatePopover {task} {onMutate} />
        {#if secondaryTiming}
          <p
            class="mt-0.5 max-w-full truncate text-[10px] {section === 'followups' && task.follow_up_date === null
              ? 'font-medium text-red-500 dark:text-red-400'
              : 'text-neutral-400 dark:text-neutral-500'}"
          >
            {secondaryTiming}
          </p>
        {/if}
      </div>
    </div>

    <!-- Action Rail -->
    <div class="flex items-center gap-4">
      <!-- Delegation / Scheduling Group -->
      <div class="flex items-center gap-1.5">
        <!-- Assignee Avatar Picker (always visible) -->
        <AssigneeAvatarPicker {task} {team} {onMutate} compact disabled={isDone} />

        {#if !ownerIsSelf}
          <div
            class="flex items-center gap-1 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 {focused
              || section === 'followups'
              ? 'opacity-100'
              : 'opacity-40'}"
            >
              <HandoffNudgeControl {task} {team} {onMutate} disabled={isDone} />
              <InstantNudgeButton {task} {team} disabled={isDone} />
          </div>
        {/if}
      </div>

      <!-- Task-specific Actions Group (Done) -->
      <div class="flex items-center">
        {#if isDone}
          <ActionButton
            label="Undo done"
            keys={["u"]}
            onclick={(event) => stopAndRun(event, onReopen)}
            checkbox
            checked
          />
        {:else}
          <ActionButton
            label="Done"
            keys={["e"]}
            onclick={(event) => stopAndRun(event, onComplete)}
            checkbox
          />
        {/if}
      </div>
    </div>
  </div>
</div>
