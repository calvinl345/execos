<script lang="ts">
  import type { DashboardTask } from "$lib/types";
  import type { ColumnId } from "$lib/utils/buckets";
  import { dueLabel, relativeAgo } from "$lib/utils/dates";
  import {
    TASK_FLAG_META,
    flagsFor,
    staleDays,
    type TaskFlag,
  } from "$lib/utils/flags";
  import { TASK_STATUS_META } from "$lib/utils/status-meta";
  import { taskStatusLabelLower } from "$lib/utils/status-labels";
  import { assigneeThemeStyle } from "$lib/utils/assignee-theme";
  import { ownerInitials } from "$lib/utils/task-row-workflow";
  import type { TaskCardFieldId, TaskCardFieldPreferences } from "$lib/utils/task-card-fields";
  import IdBadge from "./IdBadge.svelte";
  import PriorityIndicator from "./PriorityIndicator.svelte";
  import TaskPromptMenu from "./TaskPromptMenu.svelte";
  import { Paperclip } from "@lucide/svelte";

  let {
    task,
    column,
    onNavigate,
    cardFieldPrefs,
  }: {
    task: DashboardTask;
    column: ColumnId;
    onNavigate: (id: string) => void;
    cardFieldPrefs: TaskCardFieldPreferences;
  } = $props();

  const borderByColumn: Record<ColumnId, string> = {
    triage: "border-l-neutral-300",
    backlog: "border-l-neutral-500",
    in_progress: "border-l-blue-500",
    blocked: "border-l-amber-500",
    review: "border-l-purple-400",
    closed: "border-l-emerald-500",
  };

  const isDelegatedColumn = $derived(column === "review");
  const flags = $derived(flagsFor(task));

  function showField(id: TaskCardFieldId): boolean {
    return !cardFieldPrefs.hidden.includes(id);
  }

  function ownerInitial(owner: string | null): string {
    return ownerInitials(owner ?? "me");
  }
  function staleIfAny(): string | null {
    const d = staleDays(task);
    return d >= 14 ? `stale ${d}d` : null;
  }
  function flagText(flag: TaskFlag): string {
    if (flag === "overdue") return "OVERDUE";
    if (flag === "stale") return staleIfAny() ?? TASK_FLAG_META[flag].label;
    return TASK_FLAG_META[flag].label;
  }
</script>

<article
  class="group relative w-full rounded-md border border-neutral-200 border-l-4 text-left {borderByColumn[
    column
  ]} {isDelegatedColumn ? 'bg-amber-50/40' : 'bg-white'} px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow hover:z-20 hover:border-neutral-300 hover:shadow-md focus-within:z-[200]"
>
  <button
    type="button"
    class="absolute inset-0 z-0 cursor-pointer rounded-md bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
    aria-label={`open task details for ${task.id}: ${task.title}`}
    onclick={() => onNavigate(task.id)}
  ></button>

  <div class="pointer-events-none relative z-10">
    <div class="mb-1.5 flex min-h-3 items-center gap-2">
      <div class="flex items-center gap-1.5">
        <PriorityIndicator priority={task.priority} />
        {#if flags.length > 0}
          <span
            class="font-mono text-[9px] uppercase tracking-wide text-neutral-400"
            aria-label={`attention: ${flags.map((flag) => TASK_FLAG_META[flag].label).join(", ")}`}
          >
            attention
          </span>
        {/if}
      </div>
    </div>

    {#if showField("id")}
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          {#if showField("id")}
            <div class="pointer-events-auto">
              <IdBadge id={task.id} dim />
            </div>
          {/if}
        </div>
        <div class="pointer-events-auto">
          <TaskPromptMenu {task} />
        </div>
      </div>
    {:else}
      <div class="mb-1.5 flex justify-end">
        <div class="pointer-events-auto">
          <TaskPromptMenu {task} />
        </div>
      </div>
    {/if}

    {#if showField("title")}
      <h3 class="mb-2 text-[13px] font-medium leading-snug text-neutral-900">
        {task.title}
      </h3>
    {/if}

    {#if showField("category") || showField("status")}
      <div class="mb-2 flex flex-wrap items-center gap-1.5">
        {#if showField("category")}
          <span
            class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700"
            data-mono
          >
            {task.category}
          </span>
        {/if}
        {#if showField("status")}
          <span
            class="rounded px-1.5 py-0.5 font-mono text-[10px] lowercase ring-1 ring-inset {TASK_STATUS_META[
              task.status
            ].pillClass}"
            data-mono
          >
            {taskStatusLabelLower(task.status)}
          </span>
        {/if}
      </div>
    {/if}

    {#if showField("goal") && task.goal_id}
      <div class="mb-2">
        <span
          class="inline-flex items-center gap-1.5 rounded bg-purple-50 px-1.5 py-0.5 font-mono text-[10px] text-purple-700 ring-1 ring-inset ring-purple-100"
          data-mono
        >
          <span class="font-semibold">{task.goal_id}</span>
          {#if task.goal_title}
            <span class="text-purple-500">·</span>
            <span class="text-purple-600">{task.goal_title}</span>
          {/if}
        </span>
      </div>
    {/if}

    <div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
      <div class="flex items-center gap-2">
        {#if showField("owner") && isDelegatedColumn && task.owner}
          <span class="flex items-center gap-1">
            <span
              style={assigneeThemeStyle(task.owner)}
              class="assignee-badge flex h-4 w-4 items-center justify-center rounded-full border font-mono text-[9px] font-semibold"
              data-mono
            >
              {ownerInitial(task.owner)}
            </span>
            <span class="text-neutral-700">{task.owner}</span>
          </span>
        {/if}
        {#if showField("due")}
          <span class="font-mono" data-mono>
            {task.due_date ? `due ${dueLabel(task.due_date)}` : "no due date"}
          </span>
        {/if}
        {#if showField("updated")}
          <span class="font-mono" data-mono>
            upd {relativeAgo(task.updated_at)}
          </span>
        {/if}
        {#if showField("attachments") && task.attachment_count > 0}
          <span class="flex items-center gap-0.5 font-mono" data-mono>
            <Paperclip class="h-3 w-3" />
            {task.attachment_count}
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-1">
        {#if showField("flags")}
          {#each flags as f (f)}
            <span
              class="rounded px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset {TASK_FLAG_META[
                f
              ].pillClass}"
              data-mono
            >
              {flagText(f)}
            </span>
          {/each}
        {/if}
        {#if showField("owner") && !task.owner && task.status !== "review"}
          <span
            style={assigneeThemeStyle("me")}
            class="assignee-badge flex h-4 w-4 items-center justify-center rounded-full border font-mono text-[9px] font-semibold"
            data-mono
          >
            {ownerInitial("me")}
          </span>
        {/if}
      </div>
    </div>
  </div>
</article>

<style>
  .assignee-badge {
    background: var(--assignee-bg);
    border-color: var(--assignee-border);
    color: var(--assignee-text);
    box-shadow: var(--assignee-shadow);
  }
</style>
