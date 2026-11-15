<script module lang="ts">
  import type { DashboardTask } from "../../types.js";

  export type ActionModalMode = "complete-confirm";
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { Dialog } from "bits-ui";
  import { AlertCircle, Loader2, X } from "@lucide/svelte";
  import { postTaskAction } from "../../utils/task-actions.js";
  import Kbd from "../Kbd.svelte";

  interface Props {
    mode: ActionModalMode;
    task: DashboardTask;
    onClose: (didMutate: boolean) => void;
  }

  let { task, onClose }: Props = $props();

  let open = $state(true);
  let panelEl = $state<HTMLDivElement | null>(null);
  let isSubmitting = $state(false);
  let errorMsg = $state<string | null>(null);

  onMount(() => {
    focusFirst();
  });

  function closeWithoutMutating(): void {
    onClose(false);
  }

  function focusFirst(): void {
    void tick().then(() => {
      const preferred = panelEl?.querySelector<HTMLElement>("[data-autofocus]");
      if (preferred && !preferred.hasAttribute("disabled")) {
        preferred.focus();
        return;
      }
      if (!panelEl) return;
      const first = Array.from(
        panelEl.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        )
      ).find((el) => !el.hasAttribute("aria-hidden"));
      first?.focus();
    });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      submit();
    }
  }

  function submit(): void {
    void submitConfirm();
  }

  async function submitConfirm(): Promise<void> {
    if (isSubmitting) return;
    isSubmitting = true;
    errorMsg = null;
    const res = await postTaskAction(task.id, {
      action: "complete",
    });
    isSubmitting = false;
    if (res.ok) {
      onClose(true);
    } else {
      errorMsg = res.message;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) closeWithoutMutating(); }}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} transition:fade={{ duration: 120 }}
               class="fixed inset-0 z-50 bg-neutral-950/45"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content forceMount onOpenAutoFocus={(e) => { e.preventDefault(); focusFirst(); }}>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} bind:this={panelEl}
               transition:scale={{ duration: 120, start: 0.98 }}
               class="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)]
                      max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-auto
                      rounded-lg border border-neutral-200 bg-white text-neutral-900
                      shadow-2xl outline-none dark:border-neutral-700
                      dark:bg-neutral-950 dark:text-neutral-100">
            <header class="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <div>
                <Dialog.Title class="text-base font-semibold">Complete</Dialog.Title>
                <Dialog.Description class="mt-0.5 text-sm text-neutral-500">{task.id} · {task.title}</Dialog.Description>
              </div>
              <Dialog.Close
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                aria-label="Close action modal"
              >
                <X class="h-4 w-4" />
              </Dialog.Close>
            </header>

            <div class="px-5 py-4">
              <div class="space-y-3">
                <p class="text-sm text-neutral-700 dark:text-neutral-300">
                  Mark "{task.title}" as Done?
                </p>
                {#if errorMsg}
                  <div class="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                {/if}
              </div>
            </div>

            <footer class="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <button
                type="button"
                class="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                disabled={isSubmitting}
                onclick={closeWithoutMutating}
              >
                Cancel <span class="ml-1"><Kbd>Esc</Kbd></span>
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-950"
                disabled={isSubmitting}
                data-autofocus=""
                onclick={submit}
              >
                {#if isSubmitting}
                  <Loader2 class="h-4 w-4 animate-spin" />
                {/if}
                Submit <span class="ml-1"><Kbd tone="inverse">Ctrl+Enter</Kbd></span>
              </button>
            </footer>
          </div>
        {/if}
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
