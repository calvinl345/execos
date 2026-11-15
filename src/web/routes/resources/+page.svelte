<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import ResourceRow from "$lib/components/ResourceRow.svelte";
  import ResourcesFilterBar from "$lib/components/ResourcesFilterBar.svelte";
  import { X } from "@lucide/svelte";
  import {
    applyResourceFilters,
    parseResourceFilters,
    patchResourceFilterParams,
    type ResourceFilters,
  } from "./resource-filters.js";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  let filters = $derived(parseResourceFilters(page.url.searchParams));
  let filtered = $derived(applyResourceFilters(data.documents, filters));
  function resourcesHref(params: URLSearchParams): "/resources" | `/resources?${string}` {
    const query = params.toString();
    return query ? `/resources?${query}` : "/resources";
  }

  function commit(next: Partial<ResourceFilters>): void {
    const params = patchResourceFilterParams(page.url.searchParams, next);
    goto(resolve(resourcesHref(params)), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
      invalidateAll: true,
    });
  }
</script>

<ResourcesFilterBar
  {filters}
  totalCount={data.documents.length}
  filteredCount={filtered.length}
  onChange={commit}
/>


{#if data.filteredTask}
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <span class="font-mono text-[11px] text-neutral-600">Filtered by task:</span>
    <span
      class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 font-mono text-[11px] text-blue-800 ring-1 ring-inset ring-blue-200"
    >
      <span class="shrink-0 font-semibold">{data.filteredTask.id}</span>
      {#if data.filteredTask.title}
        <span class="shrink-0 text-blue-500">·</span>
        <span class="min-w-0 truncate">{data.filteredTask.title}</span>
      {/if}
      <button
        type="button"
        class="ml-1 shrink-0 rounded p-0.5 hover:bg-blue-100"
        aria-label="clear task filter"
        onclick={() => commit({ task: null })}
      >
        <X class="h-3 w-3" />
      </button>
    </span>
  </div>
{/if}

{#if data.documents.length === 0}
  <div class="rounded-xl border border-dashed border-neutral-200 bg-white px-6 py-20 text-center">
    <p class="font-mono text-[11px] uppercase tracking-wider text-neutral-500">Resources</p>
    <h1 class="mt-2 text-lg font-semibold text-neutral-700">No documents yet</h1>
    <p class="mt-2 text-sm text-neutral-500">
      Drop a file into Claude and your agent will file it here for browsing and download.
    </p>
  </div>
{:else}
  <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
    <table class="w-full min-w-[58rem] border-collapse text-left">
      <thead>
        <tr class="border-b border-neutral-200 bg-neutral-50/80">
          <th
            class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600"
          >
            Filename
          </th>
          <th
            class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600"
          >
            Category
          </th>
          <th
            class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600"
          >
            Size
          </th>
          <th
            class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600"
          >
            Uploaded
          </th>
          <th
            class="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600"
          >
            Linked tasks
          </th>
          <th
            class="px-3 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600"
          >
            Download
          </th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as doc (doc.id)}
          <ResourceRow {doc} />
        {:else}
          <tr>
            <td colspan="6" class="px-3 py-12 text-center text-[12px] text-neutral-400">
              no documents match these filters
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
