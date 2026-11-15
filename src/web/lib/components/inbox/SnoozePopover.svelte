<script lang="ts">
  import { Popover } from "bits-ui";
  import { Clock, Loader2 } from "@lucide/svelte";
  import type { DashboardTask } from "../../types.js";
  import { postTaskAction } from "../../utils/task-actions.js";
  import { datePhraseForInput } from "../../utils/task-row-workflow.js";
  import { toast } from "../../utils/toast.svelte.js";
  import DateTimePicker from "../DateTimePicker.svelte";
  import Kbd from "../Kbd.svelte";

  let {
    task,
    onMutate = async () => {},
    showText = false,
    disabled = false,
  }: {
    task: DashboardTask;
    onMutate?: (taskId: string) => void | Promise<void>;
    showText?: boolean;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let phrase = $state("");
  let untilIso = $state<string | null>(null);
  let isSubmitting = $state(false);
  let isClearing = $state(false);
  let errorMsg = $state<string | null>(null);

  const isSnoozed = $derived(task.snoozed_until !== null);

  function prepareOpen(): void {
    phrase = datePhraseForInput(task.snoozed_until);
    untilIso = task.snoozed_until;
    errorMsg = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    if (!untilIso) {
      errorMsg = "Choose a snooze date.";
      return;
    }

    isSubmitting = true;
    errorMsg = null;
    const result = await postTaskAction(task.id, {
      action: "defer",
      until: untilIso,
    });
    isSubmitting = false;

    if (!result.ok) {
      errorMsg = result.message;
      toast.error(result.message);
      return;
    }

    toast.success("Task snoozed");
    open = false;
    await onMutate(task.id);
  }

  async function clearSnooze(): Promise<void> {
    if (isSubmitting || isClearing) return;

    isClearing = true;
    errorMsg = null;
    const result = await postTaskAction(task.id, { action: "clear-snooze" });
    isClearing = false;

    if (!result.ok) {
      errorMsg = result.message;
      toast.error(result.message);
      return;
    }

    toast.success("Snooze cleared");
    open = false;
    await onMutate(task.id);
  }

  const isDisabled = $derived(isSubmitting || isClearing || disabled || task.status === "done" || task.status === "cancelled");

  const buttonClass = $derived.by(() => {
    if (showText) {
      const base = "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300";
      if (isDisabled) {
        return `${base} border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-500`;
      }
      return `${base} border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700`;
    } else {
      const base = "inline-flex h-[1.65rem] w-[1.65rem] items-center justify-center rounded-md border shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300";
      if (isDisabled) {
        return `${base} border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-500`;
      }
      return `${base} border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus:ring-neutral-600`;
    }
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    id={`snooze-trigger-${task.id}`}
    type="button"
    aria-label="Snooze"
    title={showText ? undefined : "Snooze"}
    disabled={isDisabled}
    onclick={(event) => {
      event.stopPropagation();
      prepareOpen();
    }}
    class={buttonClass}
  >
    {#if isSubmitting}
      <Loader2 class="h-3.5 w-3.5 animate-spin" />
    {:else}
      <Clock class="h-3.5 w-3.5" />
    {/if}
    {#if showText}
      <span>Snooze</span>
      <Kbd>s</Kbd>
    {/if}
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content
      align="end"
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
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Snooze</h3>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Move this self-owned task out of attention until a future time.
          </p>
        </div>

        <DateTimePicker
          id={`snooze-${task.id}`}
          bind:value={phrase}
          placeholder="tomorrow at 9"
          disabled={isSubmitting}
          autofocus
          onResolve={(iso) => (untilIso = iso)}
        />

        {#if errorMsg}
          <p class="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {errorMsg}
          </p>
        {/if}

        <div class="flex items-center justify-between gap-2">
          {#if isSnoozed}
            <button
              type="button"
              onclick={clearSnooze}
              disabled={isSubmitting || isClearing}
              class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {#if isClearing}
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
              {/if}
              <span>Clear snooze</span>
            </button>
          {:else}
            <span></span>
          {/if}
          <div class="flex items-center gap-2">
            <Popover.Close
              type="button"
              class="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              disabled={isSubmitting || isClearing}
            >
              <span>Cancel</span>
              <Kbd>Esc</Kbd>
            </Popover.Close>
            <button
              type="submit"
              class="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-200"
              disabled={isSubmitting || isClearing || !untilIso}
            >
              {#if isSubmitting}
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
              {/if}
              <span>Snooze</span>
              <Kbd tone="inverse">Enter</Kbd>
            </button>
          </div>
        </div>
      </form>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
