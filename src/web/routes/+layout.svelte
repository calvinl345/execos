<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import Header from "$lib/components/Header.svelte";
  import Toaster from "$lib/components/Toaster.svelte";
  import { startLiveRefresh } from "$lib/utils/live-refresh.svelte.js";

  let { data, children } = $props();
  const envKind = $derived(data.envInfo.kind);
  const showTargetBar = $derived(envKind !== "production" && !data.demoMode);
  const isSandbox = $derived(envKind === "production-sandbox" || envKind === "development-sandbox");

  onMount(() => startLiveRefresh());
</script>

{#if showTargetBar}
  <div class="target-bar" class:sandbox={isSandbox} class:live={!isSandbox}>
    {data?.targetLabel ?? "LIVE PRODUCTION"}
  </div>
{/if}

{#if page.data?.stale}
  <div class="stale-bar">Reconnecting… showing last known data</div>
{/if}

<div class="min-h-screen bg-neutral-50">
  <Header />
  <main class="mx-auto max-w-[1440px] px-6 pb-16 pt-6">
    {@render children()}
  </main>
</div>
<Toaster />

<style>
  .target-bar {
    position: sticky; top: 0; z-index: 50;
    text-align: center; font-weight: 700; padding: 4px; font-size: 12px;
    letter-spacing: 0.04em;
  }
  .target-bar.sandbox { background: #166534; color: white; }
  .target-bar.live { background: #b91c1c; color: white; }

  .stale-bar {
    position: sticky;
    top: 24px;
    z-index: 49;
    text-align: center;
    font-weight: 600;
    padding: 6px;
    font-size: 12px;
    background: #d97706; /* amber-600 */
    color: white;
  }
</style>
