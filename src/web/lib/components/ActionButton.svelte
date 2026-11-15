<script lang="ts">
  import type { Snippet } from "svelte";
  import Kbd from "./Kbd.svelte";
  import { Tooltip } from "bits-ui";
  import { Check, CornerUpLeft } from "@lucide/svelte";

  let {
    label,
    keys = [],
    onclick,
    children,
    checkbox = false,
    checked = false,
  }: {
    label: string;
    /** Keyboard shortcut hints shown in the tooltip, e.g. ["e"]. */
    keys?: readonly string[];
    onclick: (event: MouseEvent) => void;
    children?: Snippet;
    checkbox?: boolean;
    checked?: boolean;
  } = $props();

  // Accessible floating tooltip using Bits UI Tooltip primitive: provides instant
  // keyboard/hover tooltips with formatted shortcut hints, and portals to the body
  // to escape scroll containers and prevent clipping.
</script>

<Tooltip.Provider delayDuration={0}>
  <Tooltip.Root>
    <Tooltip.Trigger
      type="button"
      class={checkbox
        ? `inline-flex h-[1.35rem] w-[1.35rem] items-center justify-center rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 dark:focus:ring-neutral-500 dark:focus:ring-offset-neutral-900 group/checkbox ${
            checked
              ? 'border-emerald-500 bg-emerald-500 text-white hover:border-red-500 hover:bg-red-500 dark:border-emerald-600 dark:bg-emerald-600 dark:hover:border-red-600 dark:hover:bg-red-600 focus:ring-emerald-500'
              : 'border-neutral-400 bg-white text-emerald-500 shadow-sm hover:border-emerald-500 hover:bg-emerald-50 dark:border-neutral-500 dark:bg-neutral-800 dark:text-emerald-400 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/20 focus:ring-emerald-500'
          }`
        : 'inline-flex h-[1.65rem] w-[1.65rem] items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-colors hover:border-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus:ring-neutral-600'}
      aria-label={label}
      onclick={onclick}
    >
      {#if checkbox}
        {#if checked}
          <span class="group-hover/checkbox:hidden group-focus/checkbox:hidden flex items-center justify-center">
            <Check class="h-3 w-3 stroke-[3.5]" />
          </span>
          <span class="hidden group-hover/checkbox:flex group-focus/checkbox:flex items-center justify-center">
            <CornerUpLeft class="h-3 w-3 stroke-[3]" />
          </span>
        {:else}
          <Check class="h-3 w-3 stroke-[3] opacity-0 group-hover/checkbox:opacity-100 group-focus/checkbox:opacity-100 transition-opacity" />
        {/if}
      {:else}
        {@render children?.()}
      {/if}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side="top"
        sideOffset={6}
        class="pointer-events-none z-[80] flex items-center gap-1.5 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
      >
        <span>{label}</span>
        {#each keys as key (key)}
          <Kbd tone="inverse">{key}</Kbd>
        {/each}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
