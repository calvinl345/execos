<script lang="ts">
  import { toast } from "$lib/utils/toast.svelte.js";
  import { fly, fade } from "svelte/transition";
  import { CheckCircle, AlertCircle, Info, X } from "@lucide/svelte";
</script>

<div class="fixed bottom-6 left-6 z-50 flex flex-col-reverse gap-2 w-full max-w-sm pointer-events-none">
  {#each toast.items as t (t.id)}
    <div
      in:fly={{ x: -20, duration: 200 }}
      out:fade={{ duration: 150 }}
      class="pointer-events-auto flex items-center gap-3 rounded-lg border p-3 py-2.5 shadow-lg backdrop-blur-md transition-all
        {t.type === 'success'
          ? 'border-emerald-200/50 bg-emerald-50/90 text-emerald-800 dark:border-emerald-950/40 dark:bg-emerald-950/90 dark:text-emerald-200'
          : t.type === 'error'
            ? 'border-rose-200/50 bg-rose-50/90 text-rose-800 dark:border-rose-950/40 dark:bg-rose-950/90 dark:text-rose-200'
            : 'border-neutral-200/50 bg-white/90 text-neutral-800 dark:border-neutral-800/40 dark:bg-neutral-900/90 dark:text-neutral-200'}"
    >
      {#if t.type === "success"}
        <CheckCircle class="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      {:else if t.type === "error"}
        <AlertCircle class="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
      {:else}
        <Info class="h-4 w-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
      {/if}

      <span class="flex-1 font-mono text-[11px] leading-relaxed">
        {t.message}
      </span>

      <button
        type="button"
        onclick={() => toast.dismiss(t.id)}
        class="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors mr-1"
        aria-label="Dismiss notification"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  {/each}
</div>
