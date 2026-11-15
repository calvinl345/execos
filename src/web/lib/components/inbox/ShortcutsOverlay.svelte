<script lang="ts">
  import { Dialog } from "bits-ui";
  import { fade, scale } from "svelte/transition";
  import { X } from "@lucide/svelte";
  import Kbd from "../Kbd.svelte";

  let { onClose }: { onClose: () => void } = $props();
  let open = $state(true);

  const groups = [
    {
      label: "Navigate",
      items: [
        { keys: ["j", "k"], label: "Move between rows" },
        { keys: ["↑", "↓"], label: "Move between rows" },
        { keys: ["Enter"], label: "Open details" },
        { keys: ["Tab"], label: "Cycle sort view" },
        { keys: ["Shift", "Tab"], label: "Cycle sort view backwards" },
      ],
    },
    {
      label: "Act on a task",
      items: [
        { keys: ["e"], label: "Done" },
        { keys: ["u"], label: "Restore done task" },
        { keys: ["c"], label: "Copy context for your agent" },
        { keys: ["h"], label: "Open Handoff" },
        { keys: ["n"], label: "Copy Nudge" },
        { keys: ["s"], label: "Snooze" },
      ],
    },
    {
      label: "Find",
      items: [
        { keys: ["/"], label: "Focus search" },
        { keys: ["Esc"], label: "Clear search" },
      ],
    },
    {
      label: "Help",
      items: [
        { keys: ["?"], label: "Show this overlay" },
        { keys: ["Esc"], label: "Close overlay / return to agent rank" },
      ],
    },
  ];
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) onClose(); }}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} transition:fade={{ duration: 120 }}
               class="fixed inset-0 z-50 bg-neutral-950/45"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props}
               transition:scale={{ duration: 120, start: 0.98 }}
               class="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)]
                      max-w-md -translate-x-1/2 -translate-y-1/2 overflow-auto
                      rounded-lg border border-neutral-200 bg-white text-neutral-900
                      shadow-2xl outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">
            <header class="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <Dialog.Title class="text-base font-semibold">Keyboard shortcuts</Dialog.Title>
              <Dialog.Close
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                aria-label="Close keyboard shortcuts"
              >
                <X class="h-4 w-4" />
              </Dialog.Close>
            </header>

            <div class="grid gap-5 px-5 py-4">
              {#each groups as group (group.label)}
                <section class="space-y-2">
                  <h3 class="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    {group.label}
                  </h3>
                  <div class="grid gap-1.5">
                    {#each group.items as item, itemIndex (`${group.label}-${item.label}-${itemIndex}`)}
                      <div class="flex items-center justify-between gap-3 text-sm">
                        <div class="flex items-center gap-1">
                          {#each item.keys as key (`${group.label}-${itemIndex}-${key}`)}
                            <Kbd>{key}</Kbd>
                          {/each}
                        </div>
                        <span class="text-right text-neutral-500 dark:text-neutral-400">{item.label}</span>
                      </div>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>

            <footer class="border-t border-neutral-200 px-5 py-3 text-right dark:border-neutral-800">
              <span class="text-xs text-neutral-400 dark:text-neutral-500">
                Press <Kbd>Esc</Kbd> to close
              </span>
            </footer>
          </div>
        {/if}
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
