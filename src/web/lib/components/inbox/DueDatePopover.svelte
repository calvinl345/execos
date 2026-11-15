<script lang="ts">
  import { Popover } from "bits-ui";
  import { ChevronDown, Loader2, Lock } from "@lucide/svelte";
  import type { DashboardTask } from "../../types.js";
  import { dueLabel } from "../../utils/dates.js";
  import { postTaskAction } from "../../utils/task-actions.js";
  import { datePhraseForInput, dueDateStatus } from "../../utils/task-row-workflow.js";
  import { toast } from "../../utils/toast.svelte.js";
  import DateTimePicker from "../DateTimePicker.svelte";
  import Kbd from "../Kbd.svelte";

  let {
    task,
    onMutate = async () => {},
    align = "end",
    disabled = false,
    badge = false,
  }: {
    task: DashboardTask;
    onMutate?: (taskId: string) => void | Promise<void>;
    align?: "start" | "center" | "end";
    disabled?: boolean;
    badge?: boolean;
  } = $props();

  let open = $state(false);
  let phrase = $state("");
  let dueIso = $state<string | null>(null);
  let isSubmitting = $state(false);
  let errorMsg = $state<string | null>(null);

  const status = $derived(dueDateStatus(task));
  const label = $derived.by(() => {
    if (!task.due_date) return "no due date";
    if (status === "overdue") return `overdue ${dueLabel(task.due_date)}`;
    if (status === "today") return "due today";
    return `Due ${dueLabel(task.due_date)}`;
  });

  function prepareOpen(): void {
    phrase = datePhraseForInput(task.due_date);
    dueIso = task.due_date;
    errorMsg = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    if (!dueIso) {
      errorMsg = "Choose a due date.";
      return;
    }

    isSubmitting = true;
    errorMsg = null;
    const result = await postTaskAction(task.id, {
      action: "update-fields",
      dueDate: dueIso,
    });
    isSubmitting = false;

    if (!result.ok) {
      errorMsg = result.message;
      toast.error(result.message);
      return;
    }

    toast.success("Due date updated");
    open = false;
    await onMutate(task.id);
  }
  const triggerClass = $derived.by(() => {
    const isTerminal = task.status === "done" || task.status === "cancelled";
    const disabledClass = (disabled || isTerminal) ? "opacity-50 cursor-not-allowed" : "cursor-pointer";
    
    if (badge) {
      const base = "inline-flex items-center gap-1 rounded font-mono text-[10px] px-1.5 py-0.5 ring-1 ring-inset outline-none focus:ring-2 focus:ring-neutral-300 transition-colors";
      if (task.hard_deadline && task.due_date) {
        return `${base} bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30 ${disabledClass}`;
      }
      if (status === "overdue") {
        return `${base} bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30 ${disabledClass}`;
      }
      if (status === "today") {
        return `${base} bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30 ${disabledClass}`;
      }
      return `${base} bg-neutral-50 text-neutral-600 ring-neutral-200 dark:bg-neutral-800/60 dark:text-neutral-400 dark:ring-neutral-600 ${disabledClass}`;
    } else {
      const base = "inline-flex w-full items-center justify-between gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium transition-colors outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700";
      let colorClass = "";
      if (status === "overdue") {
        colorClass = "bg-red-50/60 hover:bg-red-100/60 text-red-700 dark:bg-red-500/10 dark:hover:bg-red-500/20 dark:text-red-400 ring-1 ring-inset ring-red-200/50 dark:ring-red-500/20";
      } else if (status === "today") {
        colorClass = "bg-amber-50/60 hover:bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:hover:bg-amber-500/20 dark:text-amber-400 ring-1 ring-inset ring-amber-200/50 dark:ring-amber-500/20";
      } else {
        colorClass = "bg-neutral-50 hover:bg-neutral-100/80 text-neutral-600 dark:bg-neutral-800/40 dark:hover:bg-neutral-800/70 dark:text-neutral-400 ring-1 ring-inset ring-neutral-200/30 dark:ring-neutral-700/30";
      }
      return `${base} ${colorClass} ${disabled || isTerminal ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`;
    }
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    type="button"
    aria-label={`Change due date. Current due date: ${label}`}
    title="Change due date"
    disabled={disabled || isSubmitting || task.status === "done" || task.status === "cancelled"}
    onclick={(event) => {
      event.stopPropagation();
      prepareOpen();
    }}
    class={triggerClass}
  >
    {#if badge}
      {#if task.hard_deadline && task.due_date}
        <Lock class="h-2.5 w-2.5" />
        <span>hard · due {dueLabel(task.due_date)}</span>
      {:else if status === "overdue"}
        <span>overdue {dueLabel(task.due_date)}</span>
      {:else if status === "today"}
        <span>due today</span>
      {:else if task.due_date}
        <span>due {dueLabel(task.due_date)}</span>
      {:else}
        <span>no due date</span>
      {/if}
      <ChevronDown class="h-2.5 w-2.5 opacity-60 ml-0.5" />
    {:else}
      <span>{label}</span>
      <ChevronDown class="h-3 w-3 shrink-0 opacity-60" />
    {/if}
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content
      {align}
      sideOffset={8}
      class="z-[90] w-80 rounded-md border border-neutral-200 bg-white p-3 text-left shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
      onclick={(event) => event.stopPropagation()}
    >
      <form
        class="space-y-3"
        onsubmit={submit}
        onkeydowncapture={(event) => {
          const target = event.target as HTMLElement;
          if (event.key === "Enter" && !event.isComposing && target.tagName !== "TEXTAREA") {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        <div>
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Due date</h3>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Change the task deadline. Follow-ups and snoozes stay separate.
          </p>
        </div>

        <DateTimePicker
          id={`due-date-${task.id}`}
          bind:value={phrase}
          placeholder="next friday at 5"
          disabled={isSubmitting}
          autofocus
          onResolve={(iso) => (dueIso = iso)}
        />

        {#if errorMsg}
          <p class="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {errorMsg}
          </p>
        {/if}

        <div class="flex justify-end gap-2">
          <Popover.Close
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            disabled={isSubmitting}
          >
            <span>Cancel</span>
            <Kbd>Esc</Kbd>
          </Popover.Close>
          <button
            type="submit"
            class="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-200"
            disabled={isSubmitting || !dueIso}
          >
            {#if isSubmitting}
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
            {/if}
            <span>Update due date</span>
            <Kbd tone="inverse">Enter</Kbd>
          </button>
        </div>
      </form>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
