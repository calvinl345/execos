<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { fly, fade } from "svelte/transition";
  import type { DashboardTask, TeamMember } from "$lib/types.js";
  import TaskDetail from "./TaskDetail.svelte";
  import ActionModal, { type ActionModalMode } from "./inbox/ActionModal.svelte";

  let {
    taskId,
    onClose,
    onNavigate,
    resolveGoalHref,
  }: {
    taskId: string;
    onClose: () => void;
    onNavigate: (id: string) => void;
    /** Compose `?goal=` with current task-board query state (omit for bare `/?goal=`). */
    resolveGoalHref?: (goalId: string) => "/" | `/?${string}`;
  } = $props();

  // The Kanban/List drawer hosts its own completion confirmation modal
  // because InboxView's instance only serves the inbox path.
  let activeModal = $state<{ taskId: string; mode: ActionModalMode } | null>(null);
  const drawerTeam = $derived((page.data.team ?? []) as TeamMember[]);
  const activeModalTask = $derived.by(() => {
    if (!activeModal) return null;
    const tasks = (page.data.activeTasks ?? []) as DashboardTask[];
    return tasks.find((t) => t.id === activeModal?.taskId) ?? null;
  });

  function handleAction(actionTaskId: string, mode: ActionModalMode): void {
    activeModal = { taskId: actionTaskId, mode };
  }

  async function handleModalClose(didMutate: boolean): Promise<void> {
    activeModal = null;
    if (didMutate) await invalidateAll();
  }

  let panelEl: HTMLElement | undefined = $state();
  let drawerWidth = $state(480);
  let isResizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  const drawerWidthStorageKey = "execos.taskDrawerWidth";
  const minDrawerWidth = 380;
  const maxDrawerWidth = 920;

  function clampDrawerWidth(width: number): number {
    const viewportMax =
      typeof window === "undefined" ? maxDrawerWidth : Math.max(minDrawerWidth, window.innerWidth - 32);
    return Math.min(Math.max(width, minDrawerWidth), Math.min(maxDrawerWidth, viewportMax));
  }

  function saveDrawerWidth(): void {
    localStorage.setItem(drawerWidthStorageKey, String(drawerWidth));
  }

  function startResize(event: PointerEvent): void {
    isResizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = drawerWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleResizeMove(event: PointerEvent): void {
    if (!isResizing) return;
    drawerWidth = clampDrawerWidth(resizeStartWidth + resizeStartX - event.clientX);
  }

  function finishResize(): void {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    saveDrawerWidth();
  }

  function adjustDrawerWidth(delta: number): void {
    drawerWidth = clampDrawerWidth(drawerWidth + delta);
    saveDrawerWidth();
  }

  function handleWindowKeydown(e: KeyboardEvent): void {
    // While the drawer's ActionModal is open, Esc belongs to the modal alone:
    // it must close the modal, never the drawer underneath it (A11/T14).
    // The Bits UI dialog closes on a document-level Escape listener that runs
    // before this window listener and nulls activeModal synchronously, so the
    // guard alone no longer protects the very keystroke that closed the modal;
    // Bits preventDefault()s the Escape it consumed, so honor that too.
    if (e.key === "Escape" && !e.defaultPrevented && activeModal === null) onClose();
  }

  function handleWindowResize(): void {
    drawerWidth = clampDrawerWidth(drawerWidth);
  }

  onMount(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const storedWidth = Number(localStorage.getItem(drawerWidthStorageKey));
    if (Number.isFinite(storedWidth) && storedWidth > 0) {
      drawerWidth = clampDrawerWidth(storedWidth);
    } else {
      drawerWidth = clampDrawerWidth(drawerWidth);
    }

    void tick().then(() => {
      panelEl?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      previouslyFocused?.focus?.();
    };
  });
</script>

<svelte:window
  onkeydown={handleWindowKeydown}
  onpointermove={handleResizeMove}
  onpointerup={finishResize}
  onresize={handleWindowResize}
/>

<button
  type="button"
  aria-label="close drawer"
  class="fixed inset-0 z-40 cursor-default bg-black/30"
  transition:fade={{ duration: 120 }}
  onclick={onClose}
></button>

<div
  bind:this={panelEl}
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="drawer-title"
  class="fixed right-0 top-0 z-50 flex h-screen max-w-full flex-col overflow-y-auto bg-white shadow-2xl outline-none"
  style={`width: min(100vw, ${drawerWidth}px);`}
  transition:fly={{ x: 480, duration: 200 }}
>
  <button
    type="button"
    class="absolute left-0 top-0 z-20 h-full w-2 cursor-ew-resize border-l border-transparent transition-colors hover:border-neutral-300 hover:bg-neutral-100/70 focus:border-neutral-400 focus:bg-neutral-100 focus:outline-none"
    aria-label="resize task details drawer"
    title="Resize drawer"
    onpointerdown={startResize}
    onkeydown={(event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        adjustDrawerWidth(40);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        adjustDrawerWidth(-40);
      }
    }}
  ></button>

  <TaskDetail
    {taskId}
    {onClose}
    {onNavigate}
    onAction={handleAction}
    {resolveGoalHref}
    team={drawerTeam}
  />
</div>

{#if activeModal && activeModalTask}
  <ActionModal
    mode={activeModal.mode}
    task={activeModalTask}
    onClose={(didMutate) => void handleModalClose(didMutate)}
  />
{/if}
