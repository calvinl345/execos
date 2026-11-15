<script lang="ts">
  import { Popover, Tooltip } from "bits-ui";
  import Kbd from "../Kbd.svelte";
  import { AlertCircle, Handshake, Loader2 } from "@lucide/svelte";
  import { composeDelegationMessage } from "../../../../domain/delegation-messages.js";
  import type { DashboardTask, TeamMember } from "../../types.js";
  import { resolveDisplayName } from "../../utils/inbox-format.js";
  import { postTaskAction } from "../../utils/task-actions.js";
  import {
    datePhraseForInput,
    handoffControlState,
  } from "../../utils/task-row-workflow.js";
  import { toast } from "../../utils/toast.svelte.js";
  import DateTimePicker from "../DateTimePicker.svelte";

  let {
    task,
    team,
    onMutate = async () => {},
    showText = false,
    disabled = false,
  }: {
    task: DashboardTask;
    team: TeamMember[];
    onMutate?: (taskId: string) => void | Promise<void>;
    showText?: boolean;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let followUpPhrase = $state("");
  let followUpIso = $state<string | null>(null);
  let isSubmitting = $state(false);
  let fallbackMessage = $state<string | null>(null);
  let fallbackKind = $state<"handoff" | "nudge">("handoff");
  let errorMsg = $state<string | null>(null);

  const controlState = $derived(handoffControlState(task));
  const displayName = $derived(resolveDisplayName(task.owner, team));

  const isDisabled = $derived(isSubmitting || disabled || task.status === "done" || task.status === "cancelled");

  const buttonClass = $derived.by(() => {
    if (showText) {
      const base = "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300";
      if (isDisabled) {
        return `${base} border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-500`;
      }
      if (task.handoff_state === "copied") {
        return `${base} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300`;
      }
      if (controlState?.tone === "needs-date") {
        return `${base} border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300`;
      }
      return `${base} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300`;
    } else {
      const base = "inline-flex h-[1.65rem] w-[1.65rem] items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300";
      if (isDisabled) {
        return `${base} border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-500`;
      }
      if (task.handoff_state === "copied") {
        return `${base} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus:ring-emerald-200 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 dark:focus:ring-emerald-500/30`;
      }
      if (controlState?.tone === "needs-date") {
        return `${base} border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-200 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20 dark:focus:ring-red-500/30`;
      }
      return `${base} border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 focus:ring-amber-200 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20 dark:focus:ring-amber-500/30`;
    }
  });


  function prepareOpen(): void {
    followUpPhrase = datePhraseForInput(task.follow_up_date) || "in 3 days";
    followUpIso = task.follow_up_date;
    fallbackMessage = null;
    errorMsg = null;
    fallbackKind = "handoff";
  }

  function buildMessageForKind(kind: "handoff" | "nudge"): string | null {
    if (!followUpIso) {
      errorMsg = "Choose a follow-up date.";
      return null;
    }
    return composeDelegationMessage({
      kind,
      task: {
        title: task.title,
        description: task.description,
        dueDate: task.due_date,
        owner: task.owner,
      },
      followUpDate: followUpIso,
      ownerDisplayName: displayName,
    });
  }

  async function confirmMessageCopiedWithKind(kind: "handoff" | "nudge"): Promise<boolean> {
    if (!followUpIso) return false;

    isSubmitting = true;
    errorMsg = null;
    const result = await postTaskAction(task.id, {
      action: "delegation-message",
      kind,
      followUpDate: followUpIso,
    });
    isSubmitting = false;

    if (!result.ok) {
      errorMsg = result.message;
      toast.error(result.message);
      return false;
    }

    toast.success(kind === "handoff" ? "Handoff copied" : "Nudge copied");
    open = false;
    fallbackMessage = null;
    await onMutate(task.id);
    return true;
  }

  async function copyMessageWithKind(kind: "handoff" | "nudge"): Promise<void> {
    if (isSubmitting) return;
    const message = buildMessageForKind(kind);
    if (!message) return;

    try {
      await navigator.clipboard.writeText(message);
    } catch {
      fallbackMessage = message;
      fallbackKind = kind;
      return;
    }

    await confirmMessageCopiedWithKind(kind);
  }

  async function confirmManualCopy(): Promise<void> {
    if (!fallbackMessage || isSubmitting) return;
    await confirmMessageCopiedWithKind(fallbackKind);
  }
</script>

{#if controlState}
  <Popover.Root bind:open>
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Popover.Trigger
              {...props}
              id={`handoff-trigger-${task.id}`}
              type="button"
              aria-label={task.handoff_state === "copied" ? "Handoff copied" : "Copy handoff"}
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
                <Handshake class="h-3.5 w-3.5" />
              {/if}
              {#if showText}
                <span>Handoff</span>
                <Kbd>h</Kbd>
              {/if}
            </Popover.Trigger>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            class="pointer-events-none z-[80] flex items-center gap-1.5 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900 border border-neutral-800 dark:border-neutral-200"
          >
            <span>{task.handoff_state === "copied" ? "Handoff copied" : "Copy handoff"}</span>
            <Kbd tone="inverse">h</Kbd>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>

    <Popover.Portal>
      <Popover.Content
        align="end"
        sideOffset={8}
        class="z-[90] w-80 rounded-md border border-neutral-200 bg-white p-3 text-left shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
        onclick={(event) => event.stopPropagation()}
      >
        <form
          class="space-y-3"
          onsubmit={(event) => {
            event.preventDefault();
            void copyMessageWithKind("handoff");
          }}
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
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Handoff Message
            </h3>
            <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {task.handoff_state === "copied" ? "Handoff has been copied." : "Set a follow-up date and copy the Slack message."}
            </p>
          </div>

          <label class="block space-y-1.5" for={`handoff-followup-${task.id}`}>
            <span class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Follow-up date
            </span>
            <DateTimePicker
              id={`handoff-followup-${task.id}`}
              bind:value={followUpPhrase}
              placeholder="in 3 days"
              disabled={isSubmitting}
              autofocus
              onResolve={(iso) => (followUpIso = iso)}
            />
          </label>

          {#if fallbackMessage}
            <div class="rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
                <AlertCircle class="h-3.5 w-3.5" />
                Copy manually
              </div>
              <textarea
                readonly
                class="h-24 w-full resize-none rounded border border-amber-200 bg-white p-2 text-xs text-neutral-800 outline-none dark:border-amber-500/30 dark:bg-neutral-950 dark:text-neutral-100"
                value={fallbackMessage}
                onclick={(event) => {
                  event.currentTarget.focus();
                  event.currentTarget.select();
                }}
              ></textarea>
              <button
                type="button"
                class="mt-2 inline-flex w-full items-center justify-center rounded-md bg-amber-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                disabled={isSubmitting}
                onclick={() => void confirmManualCopy()}
              >
                I copied it manually
              </button>
            </div>
          {/if}

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
              disabled={isSubmitting || !followUpIso}
            >
              {#if isSubmitting}
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
              {/if}
              <span>{task.handoff_state === "copied" ? "Copy handoff again" : "Copy handoff"}</span>
              <Kbd tone="inverse">Enter</Kbd>
            </button>
          </div>
        </form>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}
