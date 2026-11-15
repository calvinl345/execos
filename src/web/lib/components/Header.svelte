<script lang="ts">
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { Info, Moon, Sun } from "@lucide/svelte";
  import type { EnvInfo } from "$lib/types.js";

  let path = $derived(page.url.pathname);
  let envInfo = $derived(page.data.envInfo as EnvInfo);
  let demoMode = $derived(Boolean(page.data.demoMode));
  type Theme = "light" | "dark";

  const storageKey = "execos.theme";
  let theme = $state<Theme>("dark");

  onMount(() => {
    theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  function applyTheme(next: Theme): void {
    theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = next;
    localStorage.setItem(storageKey, next);
  }

  function toggleTheme(): void {
    applyTheme(theme === "dark" ? "light" : "dark");
  }
</script>

<header class="border-b border-neutral-200 bg-neutral-50">
  <div class="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
    <div class="flex min-w-0 items-center gap-3">
      <div
        class="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-sm font-semibold text-white"
      >
        E
      </div>
      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline gap-2 text-[15px]">
          <span class="whitespace-nowrap font-semibold text-neutral-900">ExecOS</span>
          <span class="hidden whitespace-nowrap text-xs text-neutral-500 sm:inline">An AI chief of staff for founders</span>
        </div>
        {#if !demoMode}
        <div class="group relative flex w-fit items-center gap-1 text-xs text-neutral-500">
          <span>Environment: {envInfo.kind}</span>
          <button
            type="button"
            class="inline-flex h-4 w-4 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            aria-label="Environment details"
          >
            <Info class="h-3.5 w-3.5" />
          </button>
          <div
            class="pointer-events-none absolute left-0 top-6 z-20 hidden w-72 rounded-md border border-neutral-200 bg-white p-3 text-xs leading-5 text-neutral-700 shadow-lg group-focus-within:block group-hover:block sm:w-80"
          >
            <p class="font-medium text-neutral-900">
              Supabase project: {envInfo.supabaseProjectName || "not provided"}
            </p>
            <p class="font-medium text-neutral-900">
              Active profile: {envInfo.activeProfile || "not provided"}
            </p>
            <p class="font-medium text-neutral-900">
              Env file: {envInfo.envFile || "not provided"}
            </p>
            {#if envInfo.sandboxSource}
              <p>Clone source: {envInfo.sandboxSource}</p>
            {/if}
            {#if envInfo.clonedAt}
              <p>Cloned at: {envInfo.clonedAt}</p>
            {/if}
          </div>
        </div>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-2">
      <nav class="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1">
        <a
          href={resolve("/")}
          class="rounded-md px-3 py-1 text-sm transition-colors {path === '/'
            ? 'bg-neutral-900 text-white'
            : 'text-neutral-600 hover:text-neutral-900'}"
        >
          Dashboard
        </a>
        <a
          href={resolve("/resources")}
          class="rounded-md px-3 py-1 text-sm transition-colors {path.startsWith('/resources')
            ? 'bg-neutral-900 text-white'
            : 'text-neutral-600 hover:text-neutral-900'}"
        >
          Resources
        </a>
        <a
          href={resolve("/logs")}
          class="rounded-md px-3 py-1 text-sm transition-colors {path.startsWith('/logs')
            ? 'bg-neutral-900 text-white'
            : 'text-neutral-600 hover:text-neutral-900'}"
        >
          Logs
        </a>
      </nav>

      <button
        type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        aria-label={theme === "dark" ? "switch to light mode" : "switch to dark mode"}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onclick={toggleTheme}
      >
        {#if theme === "dark"}
          <Sun class="h-4 w-4" />
        {:else}
          <Moon class="h-4 w-4" />
        {/if}
      </button>
    </div>
  </div>
</header>
