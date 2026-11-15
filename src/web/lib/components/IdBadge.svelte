<script lang="ts">
  import { onDestroy } from "svelte";
  import { Copy, Check } from "@lucide/svelte";

  let { id, dim = false }: { id: string; dim?: boolean } = $props();

  let copied = $state(false);
  let copyFailed = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const clipboardWriteTimeoutMs = 300;

  async function copyId(event: MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    copyFailed = false;

    try {
      await writeClipboard(id);
      copied = true;
      resetCopiedState();
    } catch {
      copied = false;
      copyFailed = true;
      resetCopiedState();
    }
  }

  function stopBadgeKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
  }

  async function writeClipboard(value: string): Promise<void> {
    const clipboard = navigator.clipboard;
    if (clipboard) {
      try {
        await writeClipboardApiWithTimeout(clipboard, value);
        return;
      } catch {
        // Some local/browser contexts expose the Clipboard API but reject writes.
      }
    }

    if (!fallbackCopy(value)) {
      throw new Error("clipboard unavailable");
    }
  }

  async function writeClipboardApiWithTimeout(clipboard: Clipboard, value: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        clipboard.writeText(value),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("clipboard write timed out")), clipboardWriteTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  function fallbackCopy(value: string): boolean {
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    const didCopy = document.execCommand("copy");
    document.body.removeChild(textArea);
    return didCopy;
  }

  function resetCopiedState(): void {
    if (resetTimer) {
      clearTimeout(resetTimer);
    }
    resetTimer = setTimeout(() => {
      copied = false;
      copyFailed = false;
    }, 1500);
  }

  onDestroy(() => {
    if (resetTimer) {
      clearTimeout(resetTimer);
    }
  });
</script>

<button
  type="button"
  class="inline-flex min-w-[4.15rem] items-center justify-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ring-1 ring-inset transition-all duration-200 hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:hover:bg-neutral-800 {copied
    ? 'scale-105 bg-emerald-50 text-emerald-700 shadow-sm ring-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-700'
    : copyFailed
      ? 'scale-105 bg-rose-50 text-rose-700 ring-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-700'
      : dim
    ? 'bg-neutral-50 text-neutral-500 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-700'
    : 'bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700'}"
  data-mono
  title={copied ? `Copied ${id}` : copyFailed ? `Could not copy ${id}` : `Copy ${id}`}
  aria-label={copied ? `Copied ${id}` : copyFailed ? `Could not copy ${id}` : `Copy ${id}`}
  onclick={copyId}
  onkeydown={stopBadgeKeydown}
>
  {#if copied}
    <span class="animate-bounce-once inline-flex items-center justify-center">
      <Check size={13} strokeWidth={3} aria-hidden="true" class="text-emerald-600 dark:text-emerald-300" />
    </span>
  {:else}
    <span>{id}</span>
    <Copy size={11} strokeWidth={2.2} aria-hidden="true" />
  {/if}
</button>

<style>
  @keyframes bounce-once {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.3);
    }
  }
  .animate-bounce-once {
    animation: bounce-once 0.3s ease-out;
  }
</style>
