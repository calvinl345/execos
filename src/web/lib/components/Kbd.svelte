<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    tone = "surface",
    children,
  }: {
    /** "surface" sits on page backgrounds; "inverse" sits on the dark tooltip bubble. */
    tone?: "surface" | "inverse";
    children: Snippet;
  } = $props();
</script>

<kbd
  class="inline-flex min-w-[1.35rem] items-center justify-center rounded border px-1 py-px font-mono text-[10px] font-semibold leading-4 {tone === 'inverse'
    ? 'border-white/25 bg-white/10 text-white/90 dark:border-neutral-900/25 dark:bg-neutral-900/10 dark:text-neutral-900'
    : 'border-neutral-300 bg-white/60 text-neutral-600 dark:border-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300'}"
  >{@render children()}</kbd
>
