<script lang="ts">
  import { MessageSquareText, Loader2 } from "@lucide/svelte";
  import { Tooltip } from "bits-ui";
  import { composeDelegationMessage } from "../../../../domain/delegation-messages.js";
  import type { DashboardTask, TeamMember } from "../../types.js";
  import { resolveDisplayName } from "../../utils/inbox-format.js";
  import { toast } from "../../utils/toast.svelte.js";
  import Kbd from "../Kbd.svelte";

  let {
    task,
    team,
    showText = false,
    disabled = false,
  }: {
    task: DashboardTask;
    team: TeamMember[];
    showText?: boolean;
    disabled?: boolean;
  } = $props();

  let isSubmitting = $state(false);

  const displayName = $derived(resolveDisplayName(task.owner, team));
  const isHandoffCopied = $derived(task.handoff_state === "copied");
  const isDisabled = $derived(isSubmitting || disabled || !isHandoffCopied || task.status === "done" || task.status === "cancelled");

  // Compose the nudge message for the tooltip preview
  const nudgeMessage = $derived.by(() => {
    return composeDelegationMessage({
      kind: "nudge",
      task: {
        title: task.title,
        description: task.description,
        dueDate: task.due_date,
        owner: task.owner,
      },
      followUpDate: task.follow_up_date,
      ownerDisplayName: displayName,
    });
  });

  async function handleNudgeClick(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (isDisabled) return;

    isSubmitting = true;
    try {
      await navigator.clipboard.writeText(nudgeMessage);
    } catch {
      isSubmitting = false;
      toast.error("Clipboard copy failed. Please copy manually from detail page.");
      return;
    }
    isSubmitting = false;

    toast.success("Nudge copied");
  }
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

<Tooltip.Provider delayDuration={150}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="inline-block">
          <button
            id={`nudge-button-${task.id}`}
            type="button"
            onclick={handleNudgeClick}
            disabled={isDisabled}
            class={buttonClass}
          >
            {#if isSubmitting}
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
            {:else}
              <MessageSquareText class="h-3.5 w-3.5" />
            {/if}
            {#if showText}
              <span>Nudge</span>
              <Kbd>n</Kbd>
            {/if}
          </button>
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side="top"
        sideOffset={6}
        class="pointer-events-none z-[90] max-w-72 rounded-md bg-neutral-900 px-3 py-2 text-xs font-normal text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900 border border-neutral-800 dark:border-neutral-200 whitespace-pre-wrap break-words"
      >
        {#if isHandoffCopied}
          <div class="flex items-center justify-between gap-3 font-semibold mb-1 text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            <span>Copy nudge to clipboard:</span>
            <Kbd tone="inverse">n</Kbd>
          </div>
          <p class="leading-relaxed font-sans">{nudgeMessage}</p>
        {:else}
          <div class="flex items-center justify-between gap-3 font-semibold mb-1 text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            <span>Nudge (Locked):</span>
            <Kbd tone="inverse">n</Kbd>
          </div>
          <p class="leading-relaxed text-neutral-300 dark:text-neutral-600 font-sans">
            Hand off the task to activate nudge copying.
          </p>
        {/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
