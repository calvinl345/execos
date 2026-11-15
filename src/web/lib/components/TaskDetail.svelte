<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { base, resolve } from "$app/paths";
  import { liveRefresh } from "$lib/utils/live-refresh.svelte.js";
  import type { TaskActivity, TaskActivityEventType, TaskDetailPayload, TaskNoteType, TeamMember } from "$lib/types.js";
  import IdBadge from "./IdBadge.svelte";
  import Kbd from "./Kbd.svelte";
  import PriorityIndicator from "./PriorityIndicator.svelte";
  import type { ActionModalMode } from "./inbox/ActionModal.svelte";
  import AssigneeAvatarPicker from "./inbox/AssigneeAvatarPicker.svelte";
  import DueDatePopover from "./inbox/DueDatePopover.svelte";
  import HandoffNudgeControl from "./inbox/HandoffNudgeControl.svelte";
  import InstantNudgeButton from "./inbox/InstantNudgeButton.svelte";
  import SnoozePopover from "./inbox/SnoozePopover.svelte";
  import { buildAgentContextPrompt } from "$lib/utils/agent-context-prompt.js";
  import { dueLabel, relativeAgo } from "$lib/utils/dates.js";
  import { TASK_STATUS_META } from "$lib/utils/status-meta.js";
  import { taskStatusLabelLower } from "$lib/utils/status-labels.js";
  import { postTaskAction } from "$lib/utils/task-actions.js";
  import { isWellFormedTaskId } from "$lib/utils/task-id.js";
  import { isSelfOwned } from "$lib/utils/task-row-workflow.js";
  import { formatTaskActivityForDisplay } from "$lib/utils/task-activities.js";
  import { queueRankContext, queueRationaleBody, queueRationaleTitle, shouldShowQueueRationale } from "$lib/utils/queue-rationale-card.js";
  import { toast } from "$lib/utils/toast.svelte.js";
  import { X, Pencil, ClipboardCheck, ArrowRightLeft, Plug, Cog, FileText, ArrowLeft, Flag, Link, ListOrdered, Paperclip, UserRound, Check, Clipboard, Sparkles } from "@lucide/svelte";

  let {
    taskId,
    onClose,
    onNavigate,
    onAction,
    resolveGoalHref,
    refreshToken = 0,
    team = [],
  }: {
    taskId: string;
    onClose?: () => void;
    onNavigate: (id: string) => void;
    /** Opens the hosting surface's completion confirmation modal. */
    onAction: (taskId: string, mode: ActionModalMode) => void;
    /** Compose `?goal=` with current task-board query state (omit for bare `/?goal=`). */
    resolveGoalHref?: (goalId: string) => "/" | `/?${string}`;
    /** Parent-owned invalidation hook for list-level mutations that affect the open task. */
    refreshToken?: number;
    team?: TeamMember[];
  } = $props();

  function goalRouteFor(gid: string): "/" | `/?${string}` {
    return resolveGoalHref?.(gid) ?? `/?goal=${encodeURIComponent(gid)}`;
  }

  let payload = $state<TaskDetailPayload | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let retryNonce = $state(0);

  let selectedActivityForDetails = $state<TaskActivity | null>(null);
  let rankSignalsOpen = $state(false);
  // Activity feed shows the latest entries with a "Show earlier" expander (S14).
  const ACTIVITY_VISIBLE = 10;
  let activityShown = $state(ACTIVITY_VISIBLE);

  // Copy-context bar states (A11): idle / copied (auto-clearing) / error with
  // the prompt text selectable — a failure is never silent.
  let copyState = $state<"idle" | "copied" | "error">("idle");
  let copyPromptText = $state("");
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreSubmitting = $state(false);

  async function copyContext(): Promise<void> {
    const task = payload?.task;
    if (!task) return;
    const text = buildAgentContextPrompt(task);
    copyPromptText = text;
    clearTimeout(copyResetTimer);
    try {
      await navigator.clipboard.writeText(text);
      copyState = "copied";
      copyResetTimer = setTimeout(() => (copyState = "idle"), 2000);
    } catch {
      copyState = "error";
    }
  }

  let fetchGen = 0;
  let liveRefreshCtrl: AbortController | null = null;

  function formatBytes(n: number | null): string {
    if (n === null || n === 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    const rounded = v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10;
    return `${rounded} ${units[i]}`;
  }

  function noteIcon(noteType: TaskNoteType): typeof Pencil {
    switch (noteType) {
      case "manual":
        return FileText;
      case "intake_checklist":
        return ClipboardCheck;
      case "status_change":
        return ArrowRightLeft;
      case "mcp_action":
        return Plug;
      default:
        return Cog;
    }
  }

  function noteIconClass(noteType: TaskNoteType): string {
    switch (noteType) {
      case "manual":
        return "text-neutral-500";
      case "intake_checklist":
        return "text-blue-600";
      case "status_change":
        return "text-amber-600";
      case "mcp_action":
        return "text-purple-600";
      default:
        return "text-neutral-500";
    }
  }

  function activityIcon(eventType: TaskActivityEventType): typeof Pencil {
    switch (eventType) {
      case "task_created":
        return ClipboardCheck;
      case "task_status_changed":
        return ArrowRightLeft;
      case "task_goal_linked":
      case "task_goal_unlinked":
      case "task_dependency_added":
      case "task_dependency_removed":
        return Link;
      case "task_attention_flagged":
      case "task_attention_cleared":
        return Flag;
      case "task_delegation_updated":
        return UserRound;
      case "task_resource_attached":
        return Paperclip;
      case "task_mcp_action_recorded":
        return Plug;
      case "task_queue_changed":
        return ListOrdered;
      default:
        return Cog;
    }
  }

  function activityIconClass(eventType: TaskActivityEventType): string {
    switch (eventType) {
      case "task_created":
        return "text-emerald-600";
      case "task_status_changed":
        return "text-amber-600";
      case "task_delegation_updated":
        return "text-sky-600";
      case "task_attention_flagged":
      case "task_attention_cleared":
        return "text-orange-600";
      case "task_resource_attached":
        return "text-indigo-600";
      case "task_mcp_action_recorded":
        return "text-purple-600";
      case "task_queue_changed":
        return "text-indigo-600";
      default:
        return "text-neutral-500";
    }
  }

  function retryFetch(): void {
    retryNonce += 1;
  }

  function isDelegatedOwner(owner: string | null | undefined): boolean {
    const normalized = owner?.trim().toLowerCase() || "me";
    return normalized !== "me";
  }

  function queueReasoningSignals(current: TaskDetailPayload): string[] {
    const task = current.task;
    if (task.queue_rank === null) return [];

    const signals: string[] = [];
    if (task.due_date) {
      signals.push(`${task.hard_deadline ? "Hard deadline" : "Due"}: ${dueLabel(task.due_date)}`);
    }
    if (task.priority) signals.push(`Priority: ${task.priority}`);
    if (task.status === "blocked") signals.push("Status: blocked");
    if (current.dependenciesIn.length > 0) {
      signals.push(
        `Blocked by ${current.dependenciesIn.length} ${current.dependenciesIn.length === 1 ? "task" : "tasks"}`,
      );
    }
    if (task.goal_id) signals.push(`Goal: ${task.goal_id}`);
    if (task.effort) signals.push(`Effort: ${task.effort}`);
    if (task.queue_ranked_at) signals.push(`Last ranked: ${relativeAgo(task.queue_ranked_at)}`);

    return signals;
  }

  async function handleInlineMutation(): Promise<void> {
    await invalidateAll();
    retryFetch();
  }

  async function handleReopenDone(): Promise<void> {
    const task = payload?.task;
    if (!task || task.status !== "done" || restoreSubmitting) return;

    restoreSubmitting = true;
    const res = await postTaskAction(task.id, { action: "reopen" });
    restoreSubmitting = false;

    if (!res.ok) {
      toast.error(res.message);
      return;
    }

    toast.success(`${task.id} restored`);
    await invalidateAll();
    retryFetch();
  }

  $effect(() => {
    void taskId;
    void refreshToken;
    void retryNonce;

    const myGen = ++fetchGen;
    liveRefreshCtrl?.abort(); // cancel any background refresh from the previous task
    const ctrl = new AbortController();
    loading = untrack(() => payload === null);
    errorMsg = null;
    selectedActivityForDetails = null;
    rankSignalsOpen = false;
    activityShown = ACTIVITY_VISIBLE;
    restoreSubmitting = false;
    clearTimeout(copyResetTimer);
    copyState = "idle";

    if (!isWellFormedTaskId(taskId)) {
      payload = null;
      errorMsg = "task not found";
      loading = false;
      return () => ctrl.abort();
    }

    fetch(`${base}/api/task/${encodeURIComponent(taskId)}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TaskDetailPayload>;
      })
      .then((p) => {
        if (myGen !== fetchGen) return;
        errorMsg = null;
        payload = p;
      })
      .catch((e) => {
        if (myGen !== fetchGen) return;
        if ((e as Error).name === "AbortError") return;
        errorMsg = String((e as Error).message ?? e);
      })
      .finally(() => {
        if (myGen !== fetchGen) return;
        loading = false;
      });

    return () => ctrl.abort();
  });

  // Live refresh: silently re-fetch the open task each poll tick. Keep showing the
  // last good data until new data arrives; swallow transient errors.
  $effect(() => {
    void liveRefresh.tick; // the only tracked dependency

    const id = untrack(() => taskId);
    const haveData = untrack(() => payload !== null);
    if (!haveData || !isWellFormedTaskId(id)) return; // first load owned by the other effect

    const myGen = ++fetchGen;
    const ctrl = new AbortController();
    liveRefreshCtrl = ctrl; // so a task switch can abort it
    fetch(`${base}/api/task/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<TaskDetailPayload>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((p) => {
        if (myGen === fetchGen) payload = p;
      })
      .catch(() => {
        /* keep last good payload on transient poll error */
      });
    return () => ctrl.abort();
  });
</script>

<header class="sticky top-0 z-10 flex flex-col gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
  <div class="flex items-start justify-between gap-2">
    <div class="flex flex-wrap items-center gap-2">
      {#if payload}
        <IdBadge id={payload.task.id} />
      {:else}
        <span class="font-mono text-[12px] font-semibold text-neutral-800 dark:text-neutral-100">{taskId}</span>
      {/if}
      {#if payload}
        <span class="rounded px-1.5 py-0.5 font-mono text-[10px] lowercase ring-1 ring-inset {TASK_STATUS_META[
          payload.task.status
        ].pillClass}">
          {taskStatusLabelLower(payload.task.status)}
        </span>
        <PriorityIndicator priority={payload.task.priority} />
        <DueDatePopover task={payload.task} align="start" badge={true} disabled={payload.task.status === "done" || payload.task.status === "cancelled"} onMutate={() => void handleInlineMutation()} />
      {/if}
    </div>
    {#if onClose}
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          aria-label="close"
          onclick={onClose}
        >
          <X class="h-5 w-5" />
        </button>
      </div>
    {/if}
  </div>
  {#if payload}
    <h2 id="drawer-title" class="text-[15px] font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
      {payload.task.title}
    </h2>
  {/if}
</header>

<div class="flex-1 px-4 pb-4 pt-3 dark:bg-neutral-900">
  {#if loading}
    <div class="space-y-3" aria-busy="true">
      <div class="h-6 w-[75%] animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
      <div class="h-24 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
      <div class="h-32 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
    </div>
  {:else if errorMsg}
    <div class="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <p class="mb-2">{errorMsg}</p>
      <button
        type="button"
        class="rounded border border-red-300 bg-white px-2 py-1 text-[12px] font-medium text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-neutral-900 dark:text-red-300 dark:hover:bg-red-950/60"
        onclick={retryFetch}
      >
        retry
      </button>
    </div>
  {:else if payload}
    {#if selectedActivityForDetails}
      {@const activityDisplay = formatTaskActivityForDisplay(selectedActivityForDetails)}
      <div class="space-y-5">
        <div class="flex items-center">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 transition-colors dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
            onclick={() => selectedActivityForDetails = null}
          >
            <ArrowLeft class="h-3.5 w-3.5" />
            Back to task
          </button>
        </div>

        <div>
          <div class="flex items-center gap-2">
            <span class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-neutral-600 uppercase tracking-wider dark:bg-neutral-700 dark:text-neutral-300">
              {activityDisplay.label}
            </span>
            <span class="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
              {relativeAgo(selectedActivityForDetails.occurred_at)}
            </span>
          </div>
          <h2 class="mt-3 text-[15px] font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
            {activityDisplay.title}
          </h2>
          <p class="mt-1 text-[11px] text-neutral-500 font-mono dark:text-neutral-400">
            by <span class="font-semibold text-neutral-700 dark:text-neutral-200">{selectedActivityForDetails.actor_label}</span>
            <span class="text-neutral-400 dark:text-neutral-500"> · {selectedActivityForDetails.source}</span>
          </p>
        </div>

        {#if activityDisplay.rows.length > 0}
          <div class="rounded-md border border-neutral-200 bg-white overflow-hidden dark:border-neutral-700 dark:bg-neutral-800">
            <div class="border-b border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/60">
              <h4 class="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Details
              </h4>
            </div>
            <dl class="divide-y divide-neutral-150 text-[12px] dark:divide-neutral-700">
              {#each activityDisplay.rows as row (row.label)}
                <div class="grid grid-cols-[100px_1fr] gap-3 px-3 py-2.5">
                  <dt class="font-mono text-neutral-500 self-start dark:text-neutral-400">{row.label}</dt>
                  <dd class="min-w-0 break-words font-mono text-neutral-800 dark:text-neutral-100">{row.value}</dd>
                </div>
              {/each}
            </dl>
          </div>
    {/if}
  </div>
    {:else}
      {@const detailTask = payload.task}
      {@const detailIsTerminal = detailTask.status === "done" || detailTask.status === "cancelled"}
      {@const detailIsDelegated = isDelegatedOwner(detailTask.owner)}
      <!-- Action Groups (Delegation, Actions, Utility) -->
      <section class="mb-4">
        <div class="flex flex-wrap items-center gap-4">
          <!-- 1. Delegation Group -->
          <div class="flex items-center gap-1.5">
            <AssigneeAvatarPicker task={detailTask} {team} compact disabled={detailIsTerminal} onMutate={() => void handleInlineMutation()} />
            {#if detailIsDelegated}
              <HandoffNudgeControl task={detailTask} {team} showText disabled={detailIsTerminal} onMutate={() => void handleInlineMutation()} />
              <InstantNudgeButton task={detailTask} {team} showText disabled={detailIsTerminal} />
            {/if}
          </div>

          <!-- 2. Actions Group -->
          <div class="flex items-center gap-1.5">
            {#if !detailIsDelegated}
              <SnoozePopover task={detailTask} showText disabled={detailIsTerminal} onMutate={() => void handleInlineMutation()} />
            {/if}

            {#if detailTask.status === "done"}
              <button
                type="button"
                aria-label={`Restore ${detailTask.id}`}
                disabled={restoreSubmitting}
                class="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-800 shadow-sm transition-colors hover:border-amber-400 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300/60 disabled:cursor-wait disabled:opacity-70 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20"
                onclick={() => void handleReopenDone()}
              >
                <ArrowRightLeft class="h-3.5 w-3.5" />
                <span>{restoreSubmitting ? "Restoring" : "Restore"}</span>
                <Kbd>u</Kbd>
              </button>
            {:else if detailTask.status === "cancelled"}
              <button
                type="button"
                disabled
                class="inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[12px] font-semibold text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-500 cursor-not-allowed"
              >
                <X class="h-3.5 w-3.5" />
                <span>Cancelled</span>
              </button>
            {:else}
              <button
                type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400 bg-emerald-400 px-3 py-1.5 text-[12px] font-semibold text-neutral-950 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/60 dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-950 dark:hover:border-emerald-300 dark:hover:bg-emerald-300"
                onclick={() => onAction(detailTask.id, "complete-confirm")}
              >
                <Check class="h-3.5 w-3.5" />
                <span>Done</span>
                <Kbd>e</Kbd>
              </button>
            {/if}
          </div>

          <!-- 3. Utility Group -->
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 {copyState === 'copied'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700'}"
              onclick={() => void copyContext()}
            >
              <Clipboard class="h-3.5 w-3.5" />
              <span>{copyState === "copied" ? "Copied" : "Copy Context"}</span>
              <Kbd>c</Kbd>
            </button>
          </div>
        </div>

        {#if copyState === "error"}
          <div class="rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/40">
            <p class="mb-1 text-[12px] font-medium text-red-800 dark:text-red-300">
              Couldn't copy, copy manually:
            </p>
            <pre class="select-all whitespace-pre-wrap break-words font-mono text-[11px] text-red-900 dark:text-red-200">{copyPromptText}</pre>
          </div>
        {/if}
      </section>

      {#if shouldShowQueueRationale(payload.task)}
        {@const rankSignals = queueReasoningSignals(payload)}
        <section
          class="mb-5 rounded-md border border-indigo-200 bg-indigo-50/65 px-3 py-3 dark:border-indigo-500/30 dark:bg-indigo-500/10"
        >
          <div class="flex items-start gap-2">
            <Sparkles class="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-300" />
            <div class="min-w-0 flex-1 text-[12px] leading-5 text-neutral-700 dark:text-neutral-200">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p class="font-semibold text-indigo-800 dark:text-indigo-200">
                  {queueRationaleTitle(payload.task)}
                </p>
                {#if queueRankContext(payload.task)}
                  <span class="rounded-full bg-white/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-indigo-600 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:ring-indigo-500/30">
                    {queueRankContext(payload.task)}
                  </span>
                {/if}
              </div>
              <p class="mt-1">{queueRationaleBody(payload.task)}</p>

              {#if rankSignals.length > 0}
                <button
                  type="button"
                  class="mt-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
                  aria-expanded={rankSignalsOpen}
                  onclick={() => (rankSignalsOpen = !rankSignalsOpen)}
                >
                  {rankSignalsOpen ? "Hide signals" : "Show signals"}
                </button>
                {#if rankSignalsOpen}
                  <ul class="mt-2 grid gap-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                    {#each rankSignals as signal (signal)}
                      <li class="flex items-start gap-1.5">
                        <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-indigo-400 dark:bg-indigo-300" aria-hidden="true"></span>
                        <span>{signal}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          </div>
        </section>
      {/if}

      <section class="mb-5">
        <h3 class="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Description
        </h3>
        <div class="border-l-2 border-neutral-200 pl-3 dark:border-neutral-700">
          {#if payload.task.description.trim()}
            <p class="whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-100">{payload.task.description}</p>
          {:else}
            <p class="text-[14px] text-neutral-400 dark:text-neutral-500">No description.</p>
          {/if}
        </div>
      </section>

      <section class="mb-5">
        <h3 class="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Details
        </h3>
        <div class="rounded-md border border-neutral-200/80 bg-neutral-50/30 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/30">
          <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12px]">
            {#if payload.task.goal_id}
              <dt class="text-neutral-500 dark:text-neutral-400 self-center">Goal</dt>
              <dd class="min-w-0">
                <a
                  href={resolve(goalRouteFor(payload.task.goal_id))}
                  data-sveltekit-noscroll
                  class="inline-flex max-w-full items-center gap-1 rounded bg-purple-50 px-1.5 py-0.5 font-mono text-[11px] text-purple-700 ring-1 ring-inset ring-purple-100 hover:bg-purple-100 dark:bg-purple-900/70 dark:text-purple-200 dark:ring-purple-800 dark:hover:bg-purple-900"
                >
                  <span class="shrink-0 font-semibold">{payload.task.goal_id}</span>
                  {#if payload.task.goal_title}
                    <span class="shrink-0 text-purple-500 dark:text-purple-300">·</span>
                    <span class="min-w-0 truncate text-purple-600 dark:text-purple-200">{payload.task.goal_title}</span>
                  {/if}
                </a>
              </dd>
            {/if}

            <dt class="text-neutral-500 dark:text-neutral-400">Category</dt>
            <dd class="font-mono text-neutral-800 dark:text-neutral-100">{payload.task.category}</dd>
            
            <dt class="text-neutral-500 dark:text-neutral-400">Owner</dt>
            <dd class="font-mono text-neutral-800 dark:text-neutral-100">
              {isSelfOwned(payload.task) ? "me" : (payload.task.owner ?? "—")}
            </dd>

            {#if isDelegatedOwner(payload.task.owner)}
              <dt class="text-neutral-500 dark:text-neutral-400">Follow-up</dt>
              <dd class="font-mono text-neutral-800 dark:text-neutral-100">
                {payload.task.follow_up_date ? dueLabel(payload.task.follow_up_date) : "not set"}
              </dd>
              <dt class="text-neutral-500 dark:text-neutral-400">Handoff</dt>
              <dd class="font-mono text-neutral-800 dark:text-neutral-100">
                {payload.task.handoff_state === "copied" ? "copied" : "pending"}
              </dd>
            {/if}

            {#if payload.task.snoozed_until}
              <dt class="text-neutral-500 dark:text-neutral-400">Snoozed until</dt>
              <dd class="font-mono text-neutral-800 dark:text-neutral-100">{dueLabel(payload.task.snoozed_until)}</dd>
            {/if}

            {#if payload.task.effort !== null}
              <dt class="text-neutral-500 dark:text-neutral-400">Effort</dt>
              <dd class="font-mono text-neutral-800 dark:text-neutral-100">{payload.task.effort}</dd>
            {/if}

            <dt class="text-neutral-500 dark:text-neutral-400">Hard deadline</dt>
            <dd class="font-mono text-neutral-800 dark:text-neutral-100">{payload.task.hard_deadline ? "Yes" : "No"}</dd>

            <dt class="text-neutral-500 dark:text-neutral-400">Created</dt>
            <dd class="font-mono text-neutral-700 dark:text-neutral-200">{relativeAgo(payload.task.created_at)}</dd>

            <dt class="text-neutral-500 dark:text-neutral-400">Updated</dt>
            <dd class="font-mono text-neutral-700 dark:text-neutral-200">{relativeAgo(payload.task.updated_at)}</dd>

            {#if payload.task.completed_at}
              <dt class="text-neutral-500 dark:text-neutral-400">Completed</dt>
              <dd class="font-mono text-neutral-700 dark:text-neutral-200">{relativeAgo(payload.task.completed_at)}</dd>
            {/if}
          </dl>
        </div>
      </section>

      <section class="mb-5">
        <h3 class="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Related
        </h3>
        <div class="space-y-3 rounded-md border border-neutral-200/70 bg-neutral-50/20 px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900/25">
          {#if payload.dependenciesIn.length === 0 && payload.dependenciesOut.length === 0 && payload.attachments.length === 0}
            <p class="text-[13px] text-neutral-400 dark:text-neutral-500">No dependencies or attachments.</p>
          {:else}
            <div>
              <div class="mb-1 flex items-center justify-between gap-2">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Dependencies</p>
                <span class="font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
                  {payload.dependenciesIn.length + payload.dependenciesOut.length}
                </span>
              </div>
              {#if payload.dependenciesIn.length === 0 && payload.dependenciesOut.length === 0}
                <p class="text-[12px] text-neutral-400 dark:text-neutral-500">None linked.</p>
              {:else}
                <div class="space-y-2">
                  {#if payload.dependenciesIn.length > 0}
                    <div>
                      <p class="mb-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Blocked by</p>
                      <ul class="space-y-1">
                        {#each payload.dependenciesIn as d (d.id)}
                          <li>
                            <button
                              type="button"
                              class="w-full rounded border border-neutral-200 bg-white/80 px-2 py-1.5 text-left text-[12px] hover:border-neutral-300 hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/70 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
                              onclick={() => onNavigate(d.id)}
                            >
                              <span class="font-mono font-semibold text-neutral-800 dark:text-neutral-100">{d.id}</span>
                              <span class="text-neutral-500 dark:text-neutral-400">&nbsp;·&nbsp;</span>
                              <span class="font-mono text-[11px] lowercase text-neutral-600 dark:text-neutral-400">
                                {taskStatusLabelLower(d.status)}
                              </span>
                              <span class="block truncate text-neutral-800 dark:text-neutral-100">{d.title}</span>
                            </button>
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if payload.dependenciesOut.length > 0}
                    <div>
                      <p class="mb-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Blocks</p>
                      <ul class="space-y-1">
                        {#each payload.dependenciesOut as d (d.id)}
                          <li>
                            <button
                              type="button"
                              class="w-full rounded border border-neutral-200 bg-white/80 px-2 py-1.5 text-left text-[12px] hover:border-neutral-300 hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/70 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
                              onclick={() => onNavigate(d.id)}
                            >
                              <span class="font-mono font-semibold text-neutral-800 dark:text-neutral-100">{d.id}</span>
                              <span class="text-neutral-500 dark:text-neutral-400">&nbsp;·&nbsp;</span>
                              <span class="font-mono text-[11px] lowercase text-neutral-600 dark:text-neutral-400">
                                {taskStatusLabelLower(d.status)}
                              </span>
                              <span class="block truncate text-neutral-800 dark:text-neutral-100">{d.title}</span>
                            </button>
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>

            <div class="border-t border-neutral-200/80 pt-3 dark:border-neutral-800">
              <div class="mb-1 flex items-center justify-between gap-2">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Attachments</p>
                <span class="font-mono text-[10px] text-neutral-400 dark:text-neutral-500">{payload.attachments.length}</span>
              </div>
              {#if payload.attachments.length === 0}
                <p class="text-[12px] text-neutral-400 dark:text-neutral-500">None yet.</p>
              {:else}
                <ul class="space-y-2">
                  {#each payload.attachments as a (a.id)}
                    <li
                      class="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-200 bg-white/80 px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900/70"
                    >
                      <div class="min-w-0 flex-1">
                        <p class="truncate font-mono text-[12px] text-neutral-800 dark:text-neutral-100">{a.filename}</p>
                        <p class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                          <span
                            class="inline-block rounded bg-neutral-100 px-1 py-0.5 font-mono text-[10px] text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                            >{a.category}</span
                          >
                          <span class="ml-2">{formatBytes(a.size_bytes)}</span>
                        </p>
                      </div>
                      {#if a.signed_url}
                        <a
                          href={a.signed_url}
                          download
                          target="_blank"
                          rel="noopener noreferrer external"
                          class="shrink-0 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                        >
                          Download
                        </a>
                      {:else}
                        <button
                          type="button"
                          disabled
                          class="shrink-0 cursor-not-allowed rounded border border-neutral-200 bg-neutral-100 px-2 py-1 text-[11px] text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500"
                        >
                          Unavailable
                        </button>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      </section>

      {#if payload.notes.length > 0}
        <section class="mb-5">
          <h3 class="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Notes
          </h3>
          <ul class="space-y-2">
            {#each payload.notes as note (note.id)}
              {@const Icon = noteIcon(note.note_type)}
              <li class="rounded border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Icon class={`h-3.5 w-3.5 ${noteIconClass(note.note_type)}`} />
                  <p class="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">{relativeAgo(note.created_at)}</p>
                  <span class="font-mono text-[10px] text-neutral-400 dark:text-neutral-500">by {note.created_by}</span>
                </div>
                <p class="mt-1 whitespace-pre-wrap break-words text-[13px] text-neutral-800 dark:text-neutral-100">
                  {note.content}
                </p>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if payload.activities.length > 0}
        <section class="activity-log">
          <h3 class="activity-log__title font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Activity
          </h3>
          <div class="activity-log__body">
            <ul class="activity-log__list">
              {#each payload.activities.slice(0, activityShown) as activity (activity.id)}
                {@const Icon = activityIcon(activity.event_type)}
                {@const activityDisplay = formatTaskActivityForDisplay(activity)}
                <li>
                  <button
                    type="button"
                    class="activity-log__row"
                    onclick={() => selectedActivityForDetails = activity}
                  >
                    <span class="activity-log__icon">
                      <Icon class={`h-3 w-3 ${activityIconClass(activity.event_type)}`} />
                    </span>
                    <span class="activity-log__content">
                      <span class="activity-log__main">
                        <span class="activity-log__label activity-log__label--inline">{activityDisplay.label}</span>
                        <span class="activity-log__summary">{activityDisplay.title}</span>
                        <span class="activity-log__actor">by {activity.actor_label}</span>
                        <span class="activity-log__time activity-log__time--inline">{relativeAgo(activity.occurred_at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>

          {#if payload.activities.length > activityShown}
            <div class="activity-log__footer">
              <span class="font-mono text-neutral-500 dark:text-neutral-400">
                Showing latest {activityShown} of {payload.activities.length}
              </span>
              <button
                type="button"
                onclick={() => (activityShown = payload?.activities.length ?? activityShown)}
                class="activity-log__pager-button"
              >
                Show earlier ({payload.activities.length - activityShown})
              </button>
            </div>
          {/if}
        </section>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .activity-log {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    padding-top: 0.75rem;
  }

  .activity-log__title {
    flex: 0 0 auto;
    margin-bottom: 0.5rem;
  }

  .activity-log__body {
    min-height: 0;
    flex: 0 1 auto;
    overflow: visible;
  }

  .activity-log__list {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .activity-log__row {
    display: grid;
    width: 100%;
    grid-template-columns: 1.1rem minmax(0, 1fr);
    align-items: center;
    gap: 0.45rem;
    border-radius: 4px;
    padding: 0.22rem 0.25rem;
    color: inherit;
    text-align: left;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .activity-log__row:hover {
    background: color-mix(in srgb, currentColor 7%, transparent);
  }

  .activity-log__icon {
    display: flex;
    height: 1.1rem;
    width: 1.1rem;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, currentColor 55%, transparent);
  }

  .activity-log__content {
    min-width: 0;
  }

  .activity-log__main {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
  }

  .activity-log__label {
    flex: 0 0 auto;
    border-radius: 2px;
    background: color-mix(in srgb, currentColor 12%, transparent);
    padding: 0.08rem 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.5rem;
    font-weight: 700;
    line-height: 1.1;
    color: color-mix(in srgb, currentColor 70%, transparent);
    text-transform: uppercase;
  }

  .activity-log__label--inline {
    width: 4.6rem;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-log__time {
    margin-left: auto;
    flex: 0 0 auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.58rem;
    color: color-mix(in srgb, currentColor 45%, transparent);
  }

  .activity-log__summary {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.2;
    color: color-mix(in srgb, currentColor 88%, transparent);
  }

  .activity-log__actor {
    flex: 0 0 auto;
    overflow: hidden;
    max-width: 45%;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.58rem;
    color: color-mix(in srgb, currentColor 48%, transparent);
  }

  .activity-log__actor::after {
    content: " ";
  }

  .activity-log__footer {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    padding-top: 0.55rem;
    font-size: 0.65rem;
  }

  .activity-log__pager-button {
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
    padding: 0.25rem 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.62rem;
    font-weight: 600;
    color: color-mix(in srgb, currentColor 75%, transparent);
  }

  .activity-log__pager-button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 7%, transparent);
  }

  .activity-log__pager-button:disabled {
    opacity: 0.42;
  }
</style>
