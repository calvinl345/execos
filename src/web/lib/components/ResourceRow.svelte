<script lang="ts">
  import { relativeAgo } from "$lib/utils/dates.js";
  import type { ResourceRow } from "../../routes/resources/+page.server.js";

  let { doc }: { doc: ResourceRow } = $props();

  const maxVisibleTaskLinks = 3;
  const visibleTaskIds = $derived(doc.linked_task_ids.slice(0, maxVisibleTaskLinks));
  const extraTaskCount = $derived(Math.max(0, doc.linked_task_ids.length - maxVisibleTaskLinks));

  function humanSize(bytes: number | null): string {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;

    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(1);
    return `${formatted} ${units[unitIndex]}`;
  }
</script>

<tr class="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70">
  <td class="max-w-[28rem] px-3 py-2.5 align-middle">
    <span class="block truncate font-mono text-[12px] font-medium text-neutral-900" title={doc.filename}>
      {doc.filename}
    </span>
    {#if doc.mime_type}
      <span class="mt-0.5 block truncate font-mono text-[10px] text-neutral-400">
        {doc.mime_type}
      </span>
    {/if}
  </td>
  <td class="px-3 py-2.5 align-middle">
    <span
      class="inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200"
    >
      {doc.category}
    </span>
  </td>
  <td class="px-3 py-2.5 align-middle font-mono text-[11px] text-neutral-600">
    {humanSize(doc.size_bytes)}
  </td>
  <td class="px-3 py-2.5 align-middle font-mono text-[11px] text-neutral-500">
    {relativeAgo(doc.uploaded_at)}
  </td>
  <td class="px-3 py-2.5 align-middle">
    {#if doc.linked_task_ids.length === 0}
      <span class="font-mono text-[11px] text-neutral-400">—</span>
    {:else}
      <div class="flex flex-wrap items-center gap-1">
        {#each visibleTaskIds as taskId (taskId)}
          <span
            class="inline-flex rounded bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200"
          >
            {taskId}
          </span>
        {/each}
        {#if extraTaskCount > 0}
          <span
            class="inline-flex rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-500"
          >
            +{extraTaskCount}
          </span>
        {/if}
      </div>
    {/if}
  </td>
  <td class="px-3 py-2.5 text-right align-middle">
    {#if doc.signed_url}
      <a
        href={doc.signed_url}
        download
        class="inline-flex rounded-md border border-neutral-200 bg-white px-2 py-1 font-mono text-[11px] font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:ring-offset-1"
      >
        Download
      </a>
    {:else}
      <span
        class="inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-[11px] font-medium text-neutral-400"
        aria-disabled="true"
      >
        unavailable
      </span>
    {/if}
  </td>
</tr>
