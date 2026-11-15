<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { Check, ChevronDown, Loader2 } from "@lucide/svelte";
  import type { DashboardTask, TeamMember } from "../../types.js";
  import { assigneeThemeStyle, assigneeThemeStylesFor } from "../../utils/assignee-theme.js";
  import { resolveDisplayName } from "../../utils/inbox-format.js";
  import { postTaskAction } from "../../utils/task-actions.js";
  import { isSelfOwned, ownerInitials } from "../../utils/task-row-workflow.js";
  import { toast } from "../../utils/toast.svelte.js";

  let {
    task,
    team,
    onMutate = async () => {},
    compact = false,
    disabled = false,
  }: {
    task: DashboardTask;
    team: TeamMember[];
    onMutate?: (taskId: string) => void | Promise<void>;
    compact?: boolean;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let isSubmitting = $state(false);
  let errorMsg = $state<string | null>(null);

  const currentOwner = $derived(isSelfOwned(task) ? "me" : task.owner!.trim().toLowerCase());
  const displayName = $derived(isSelfOwned(task) ? "ME" : resolveDisplayName(task.owner, team));
  const initials = $derived(ownerInitials(displayName));
  const ownerOptions = $derived([
    { slug: "me", displayName: "ME" },
    ...team.filter((member) => member.slug.trim().toLowerCase() !== "me"),
  ]);
  const ownerThemeStyles = $derived.by(() => assigneeThemeStylesFor(ownerOptions.map((owner) => owner.slug)));
  const currentOwnerThemeStyle = $derived(ownerThemeStyles[currentOwner] ?? assigneeThemeStyle(currentOwner));

  async function selectOwner(slug: string): Promise<void> {
    if (isSubmitting || slug === currentOwner) {
      open = false;
      return;
    }

    isSubmitting = true;
    errorMsg = null;

    const result = slug === "me"
      ? await postTaskAction(task.id, { action: "undelegate" })
      : await postTaskAction(task.id, {
          action: "delegate",
          owner: slug,
          ...(task.follow_up_date ? { followUpDate: task.follow_up_date } : {}),
        });

    isSubmitting = false;

    if (!result.ok) {
      errorMsg = result.message;
      toast.error(result.message);
      return;
    }

    toast.success(slug === "me" ? "Task returned to you" : "Owner updated");
    open = false;
    await onMutate(task.id);
  }
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger
    type="button"
    aria-label={`Assigned to ${displayName}. Change owner`}
    title={`Assigned to ${displayName}`}
    disabled={disabled || isSubmitting || task.status === "done" || task.status === "cancelled"}
    onclick={(event) => event.stopPropagation()}
    class="group relative inline-flex shrink-0 rounded-full outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600 {compact
      ? 'h-7 w-7'
      : 'h-8 w-8'}"
  >
    <span
      style={currentOwnerThemeStyle}
      class="assignee-avatar relative inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full border shadow-sm transition-all duration-200 {(disabled || task.status === 'done' || task.status === 'cancelled') ? 'opacity-50 cursor-not-allowed' : 'group-hover:ring-2'}"
    >
      {#if isSubmitting}
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
      {:else}
        <span class="font-mono text-[10px] font-semibold transition-all duration-200 group-hover:scale-90 group-hover:opacity-80">
          {initials}
        </span>
      {/if}
    </span>

    {#if !(disabled || isSubmitting || task.status === 'done' || task.status === 'cancelled')}
      <div class="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-neutral-700 dark:bg-neutral-800">
        <ChevronDown class="h-2.5 w-2.5 text-neutral-500 dark:text-neutral-400" />
      </div>
    {/if}
  </DropdownMenu.Trigger>

  <DropdownMenu.Portal>
    <DropdownMenu.Content
      align="end"
      sideOffset={6}
      class="z-[90] min-w-44 rounded-md border border-neutral-200 bg-white p-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900"
      onclick={(event) => event.stopPropagation()}
    >
      <DropdownMenu.RadioGroup value={currentOwner} onValueChange={(value) => void selectOwner(value)}>
        <DropdownMenu.GroupHeading
          class="px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
        >
          Assign to
        </DropdownMenu.GroupHeading>
        {#each ownerOptions as owner (owner.slug)}
          <DropdownMenu.RadioItem
            value={owner.slug}
            disabled={isSubmitting}
            class="flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-neutral-700 outline-none transition-colors hover:bg-neutral-50 data-[highlighted]:bg-neutral-900 data-[highlighted]:text-white dark:text-neutral-200 dark:hover:bg-neutral-800 dark:data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:text-neutral-950"
          >
            <span
              style={ownerThemeStyles[owner.slug] ?? assigneeThemeStyle(owner.slug)}
              class="assignee-avatar inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold"
            >
              {ownerInitials(owner.displayName)}
            </span>
            <span class="min-w-0 flex-1 truncate">{owner.displayName}</span>
            <Check class="h-3.5 w-3.5 {currentOwner === owner.slug ? 'opacity-100' : 'opacity-0'}" />
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
      {#if errorMsg}
        <p class="px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">{errorMsg}</p>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  .assignee-avatar {
    background: var(--assignee-bg);
    border-color: var(--assignee-border);
    color: var(--assignee-text);
    box-shadow: var(--assignee-shadow);
  }

  :global(.group:hover) .assignee-avatar {
    --tw-ring-color: var(--assignee-ring);
  }
</style>
