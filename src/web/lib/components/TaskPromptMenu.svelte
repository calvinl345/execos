<script lang="ts">
  import { onDestroy } from "svelte";
  import { taskStatusLabel } from "$lib/utils/status-labels";
  import {
    AlertCircle,
    CheckCircle2,
    ChevronRight,
    Copy,
    FilePenLine,
    Flag,
    MoreHorizontal,
    Send,
    SlidersHorizontal,
    Tag,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import type { DashboardTask, TaskPriority, TaskStatus } from "$lib/types";
  import { DropdownMenu } from "bits-ui";

  let {
    task,
    align = "right",
    variant = "menu",
  }: {
    task: DashboardTask;
    align?: "left" | "right";
    variant?: "menu" | "bar";
  } = $props();

  type Tone = "blue" | "rose" | "violet" | "emerald";

  type PromptAction = {
    id: string;
    label: string;
    helper: string;
    icon: Component;
    text: string;
  };

  type ActionGroup = {
    id: string;
    label: string;
    helper: string;
    icon: Component;
    tone: Tone;
    actions: PromptAction[];
  };

  let menuOpen = $state(false);
  let copiedActionId = $state<string | null>(null);
  let copyFailed = $state(false);
  let activeGroupId = $state<string | null>(null);
  let lockedGroupId = $state<string | null>(null);
  let rootEl: HTMLDivElement | undefined = $state();
  let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;

  const statusOptions: Array<{ status: TaskStatus; label: string; helper: string }> = [
    { status: "triage", label: "Triage", helper: "needs sorting" },
    { status: "backlog", label: "Backlog", helper: "not active" },
    { status: "in_progress", label: "In progress", helper: "work now" },
    { status: "blocked", label: "Blocked", helper: "internal wait" },
    { status: "review", label: taskStatusLabel("review"), helper: "external owner" },
    { status: "done", label: "Done", helper: "terminal" },
    { status: "cancelled", label: "Cancelled", helper: "terminal" },
  ];

  const priorityOptions: TaskPriority[] = ["P0", "P1", "P2", "P3"];

  const groups = $derived(actionGroups());
  const activeGroup = $derived(groups.find((group) => group.id === activeGroupId) ?? null);

  function taskLine(): string {
    return `Task: ${task.id} - ${task.title}`;
  }

  function statusPrompt(status: TaskStatus, label: string): string {
    if (status === "done") {
      return [
        `Please mark ${task.id} done in ExecOS via the CLI. I confirm this terminal status change.`,
        "",
        taskLine(),
        "Command to run:",
        `execos taskops complete --task-id ${task.id} --yes`,
      ].join("\n");
    }
    if (status === "cancelled") {
      return [
        `Please cancel ${task.id} in ExecOS via the CLI. I confirm this terminal status change.`,
        "",
        taskLine(),
        "Command to run:",
        `execos taskops cancel --task-id ${task.id} --yes`,
      ].join("\n");
    }
    return [
      `Please move ${task.id} to ${label} in ExecOS via the CLI.`,
      "",
      taskLine(),
      "Command to run:",
      `execos taskops update --task-id ${task.id} --status ${status}`,
    ].join("\n");
  }

  function priorityPrompt(priority: TaskPriority): string {
    return [
      `Please set ${task.id} to priority ${priority} in ExecOS via the CLI.`,
      "",
      taskLine(),
      "Command to run:",
      `execos taskops update --task-id ${task.id} --priority ${priority}`,
    ].join("\n");
  }

  function delegatePrompt(): string {
    return [
      `Please delegate ${task.id} in ExecOS. Set the owner, move it to Delegated, and add any handoff context the assignee needs.`,
      "",
      taskLine(),
      "Command to adapt:",
      `execos taskops delegate --task-id ${task.id} --owner "<team-slug>" --notes "<handoff context>"`,
    ].join("\n");
  }

  function ownerPrompt(): string {
    return [
      `Please change the owner for ${task.id} in ExecOS via the CLI.`,
      "",
      taskLine(),
      "Command to adapt (delegation is the only path to a teammate owner; --owner me takes it back):",
      `execos taskops delegate --task-id ${task.id} --owner "<team-slug>"`,
      `execos taskops update --task-id ${task.id} --owner me`,
    ].join("\n");
  }

  function descriptionPrompt(): string {
    return [
      `Please update the description for ${task.id} in ExecOS with the new context below.`,
      "",
      taskLine(),
      "Command to adapt:",
      `execos taskops update --task-id ${task.id} --description "<new description>"`,
    ].join("\n");
  }

  function flagPrompt(): string {
    return [
      `Please flag ${task.id} for attention in ExecOS via the CLI.`,
      "",
      taskLine(),
      "Command to run:",
      `execos taskops flag-attention --task-id ${task.id} --reason "needs attention"`,
    ].join("\n");
  }

  function actionGroups(): ActionGroup[] {
    return [
      {
        id: "status",
        label: "Status",
        helper: taskStatusLabel(task.status).toLowerCase(),
        icon: SlidersHorizontal,
        tone: "blue",
        actions: statusOptions.map((option) => ({
          id: `status-${option.status}`,
          label: option.label,
          helper: option.helper,
          icon: SlidersHorizontal,
          text: statusPrompt(option.status, option.label),
        })),
      },
      {
        id: "priority",
        label: "Priority",
        helper: task.priority ?? "unset",
        icon: Tag,
        tone: "rose",
        actions: priorityOptions.map((priority) => ({
          id: `priority-${priority}`,
          label: priority,
          helper: priority === "P0" ? "urgent" : priority === "P1" ? "high" : priority === "P2" ? "normal" : "low",
          icon: Tag,
          text: priorityPrompt(priority),
        })),
      },
      {
        id: "delegate",
        label: "Delegate",
        helper: task.owner ?? "assign",
        icon: Send,
        tone: "violet",
        actions: [
          {
            id: "delegate-handoff",
            label: "Handoff",
            helper: "owner + delegated",
            icon: Send,
            text: delegatePrompt(),
          },
          {
            id: "delegate-owner",
            label: "Set owner",
            helper: "owner only",
            icon: Send,
            text: ownerPrompt(),
          },
        ],
      },
      {
        id: "edit",
        label: "Edit",
        helper: "details",
        icon: FilePenLine,
        tone: "emerald",
        actions: [
          {
            id: "edit-description",
            label: "Description",
            helper: "add context",
            icon: FilePenLine,
            text: descriptionPrompt(),
          },
          {
            id: "flag",
            label: "Flag attention",
            helper: "dashboard flag",
            icon: Flag,
            text: flagPrompt(),
          },
          {
            id: "copy-id",
            label: "Copy ID",
            helper: "identifier",
            icon: Copy,
            text: task.id,
          },
        ],
      },
    ];
  }

  function toneDot(tone: Tone): string {
    if (tone === "blue") return "bg-blue-500";
    if (tone === "rose") return "bg-rose-500";
    if (tone === "violet") return "bg-violet-500";
    return "bg-emerald-500";
  }

  function toneIcon(tone: Tone): string {
    if (tone === "blue") return "text-blue-600 dark:text-blue-400";
    if (tone === "rose") return "text-rose-600 dark:text-rose-400";
    if (tone === "violet") return "text-violet-600 dark:text-violet-400";
    return "text-emerald-600 dark:text-emerald-400";
  }

  function toneSurface(tone: Tone): string {
    if (tone === "blue") return "border-blue-100 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/60";
    if (tone === "rose") return "border-rose-100 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/60";
    if (tone === "violet") return "border-violet-100 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/60";
    return "border-emerald-100 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/60";
  }

  function toneText(tone: Tone): string {
    if (tone === "blue") return "text-blue-700 dark:text-blue-300";
    if (tone === "rose") return "text-rose-700 dark:text-rose-300";
    if (tone === "violet") return "text-violet-700 dark:text-violet-300";
    return "text-emerald-700 dark:text-emerald-300";
  }

  function openGroup(groupId: string): void {
    if (activeGroupId === groupId && lockedGroupId === groupId) {
      activeGroupId = null;
      lockedGroupId = null;
      return;
    }

    activeGroupId = groupId;
    lockedGroupId = groupId;
  }

  function closeMenu(): void {
    menuOpen = false;
    activeGroupId = null;
    lockedGroupId = null;
  }

  function scheduleCopiedReset(): void {
    if (copiedResetTimer) clearTimeout(copiedResetTimer);
    copiedResetTimer = setTimeout(() => {
      copiedActionId = null;
      copiedResetTimer = undefined;
    }, 2500);
  }

  async function copyAction(action: PromptAction, closeAfterCopy = true): Promise<void> {
    copiedActionId = null;
    copyFailed = false;
    try {
      await navigator.clipboard.writeText(action.text);
      copiedActionId = action.id;
      scheduleCopiedReset();
      if (closeAfterCopy) {
        closeMenu();
      }
    } catch {
      copyFailed = true;
    }
  }

  onDestroy(() => {
    if (copiedResetTimer) clearTimeout(copiedResetTimer);
  });
</script>

{#if variant === "bar"}
  <div bind:this={rootEl} class="space-y-1.5">
    <div class="flex flex-wrap items-center gap-1">
      <span class="mr-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        Agent actions
      </span>
      {#each groups as group (group.id)}
        {@const Icon = group.icon}
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600 {activeGroupId === group.id
            ? `${toneSurface(group.tone)} ${toneText(group.tone)}`
            : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-700'}"
          aria-expanded={activeGroupId === group.id}
          onclick={() => openGroup(group.id)}
        >
          <Icon class="h-3.5 w-3.5 {activeGroupId === group.id ? toneIcon(group.tone) : ''}" />
          {group.label}
        </button>
      {/each}
      {#if copiedActionId}
        <span class="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 class="h-3.5 w-3.5" />
          copied
        </span>
      {/if}
    </div>

    {#if activeGroup}
      <div class="flex flex-wrap gap-1">
        {#each activeGroup.actions as action (action.id)}
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 text-left text-[11px] text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:border-neutral-600 dark:hover:bg-neutral-700 dark:focus:ring-neutral-600"
            onclick={() => copyAction(action, false)}
          >
            <span class="font-medium">{action.label}</span>
            <span class="font-mono text-[10px] text-neutral-500 dark:text-neutral-400" data-mono>{action.helper}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if copyFailed}
      <div class="flex items-start gap-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle class="mt-0.5 h-3 w-3 shrink-0" />
        <span>Clipboard blocked in this browser.</span>
      </div>
    {/if}
  </div>
{:else}
  <DropdownMenu.Root bind:open={menuOpen} onOpenChange={(o) => { if (o) { copyFailed = false; activeGroupId = null; } }}>
    <DropdownMenu.Trigger
      type="button"
      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 shadow-[0_1px_1px_rgba(0,0,0,0.03)] hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus:ring-neutral-600"
      aria-label={`open agent actions for ${task.id}`}
      title={copiedActionId ? "Copied" : "Agent actions"}
    >
      {#if copiedActionId}
        <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
      {:else}
        <MoreHorizontal class="h-4 w-4" />
      {/if}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align === "right" ? "end" : "start"}
        sideOffset={6}
        class="z-[100] w-[220px] rounded-md border border-neutral-200 bg-white p-1 shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/5"
        aria-label={`agent actions for ${task.id}`}
      >
        <div class="border-b border-neutral-100 px-2 pb-1.5 pt-1 dark:border-neutral-800">
          <p class="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Agent actions
          </p>
          <p class="mt-0.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400">{task.id} · {task.title}</p>
        </div>

        <div class="mt-1 space-y-0.5">
          {#each groups as group (group.id)}
            <DropdownMenu.Sub onOpenChange={(o) => { if (o) activeGroupId = group.id; else if (activeGroupId === group.id) activeGroupId = null; }}>
              <DropdownMenu.SubTrigger
                class="flex h-9 w-full items-center gap-2 rounded px-2 text-left transition-colors hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none dark:hover:bg-neutral-800 dark:focus:bg-neutral-800 {activeGroupId === group.id ? toneSurface(group.tone) : ''}"
              >
                {@const Icon = group.icon}
                <span class="h-1.5 w-1.5 shrink-0 rounded-full {toneDot(group.tone)}"></span>
                <Icon class="h-3.5 w-3.5 shrink-0 {toneIcon(group.tone)}" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[12px] font-medium text-neutral-900 dark:text-neutral-100">
                    {group.label}
                  </span>
                  <span class="block truncate font-mono text-[10px] text-neutral-500 dark:text-neutral-400" data-mono>
                    {group.helper}
                  </span>
                </span>
                <ChevronRight class="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={6}
                  class="z-[100] w-[190px] rounded-md border p-1 shadow-lg ring-1 ring-black/5 dark:ring-white/5 {toneSurface(group.tone)}"
                >
                  <div class="border-b border-white/70 px-2 pb-1.5 pt-1 dark:border-neutral-700/70">
                    <p class="font-mono text-[10px] font-semibold uppercase tracking-wider {toneText(group.tone)}">
                      {group.label}
                    </p>
                  </div>
                  <div class="mt-1 space-y-0.5">
                    {#each group.actions as action (action.id)}
                      <DropdownMenu.Item
                        closeOnSelect={false}
                        onSelect={() => copyAction(action)}
                        class="flex h-8 w-full items-center justify-between gap-2 rounded bg-white/80 px-2 text-left hover:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:bg-neutral-900/80 dark:hover:bg-neutral-900 dark:focus:ring-neutral-600"
                      >
                        <span class="min-w-0">
                          <span class="block truncate text-[12px] font-medium text-neutral-900 dark:text-neutral-100">
                            {action.label}
                          </span>
                          <span class="block truncate font-mono text-[10px] text-neutral-500 dark:text-neutral-400" data-mono>
                            {action.helper}
                          </span>
                        </span>
                        <Copy class="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
                      </DropdownMenu.Item>
                    {/each}
                  </div>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          {/each}
        </div>

        {#if copyFailed}
          <div class="mt-1 flex items-start gap-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle class="mt-0.5 h-3 w-3 shrink-0" />
            <span>Clipboard blocked in this browser.</span>
          </div>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{/if}
