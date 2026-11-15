<script lang="ts">
  import TaskDetail from "./TaskDetail.svelte";
  import type { ActionModalMode } from "./inbox/ActionModal.svelte";
  import type { TeamMember } from "$lib/types.js";

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
    onClose: () => void;
    onNavigate: (id: string) => void;
    /** Threads InboxView's completion confirmation through to TaskDetail. */
    onAction: (taskId: string, mode: ActionModalMode) => void;
    resolveGoalHref?: (goalId: string) => "/" | `/?${string}`;
    refreshToken?: number;
    team?: TeamMember[];
  } = $props();
</script>

<div
  role="complementary"
  aria-label="Task Details Side Panel"
  class="flex h-full min-h-0 w-full max-w-full shrink-0 flex-col overflow-y-auto bg-white/95 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 lg:w-[480px]"
>
  <TaskDetail
    {taskId}
    {onClose}
    {onNavigate}
    {onAction}
    {resolveGoalHref}
    {refreshToken}
    {team}
  />
</div>
