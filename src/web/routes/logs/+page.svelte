<script lang="ts">
  import { resolve } from "$app/paths";
  import { Check, ChevronDown, Clipboard } from "@lucide/svelte";
  import {
    buildDayAnalysisPrompt,
    type LogDay,
    type LogEvent,
    type LogRecordKind,
  } from "$lib/utils/logs.js";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  type KindFilter = "all" | LogRecordKind;
  let kindFilter = $state<KindFilter>("all");
  let surfaceFilter = $state<string | null>(null);

  let collapsedDays = $state<Record<string, boolean>>({});
  let expandedRowKey = $state<string | null>(null);
  let copyStatus = $state<Record<string, "copied" | "failed">>({});
  const copyTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  let kindCounts = $derived.by(() => {
    let activity = 0;
    let gate = 0;
    for (const day of data.days) {
      for (const event of day.events) {
        if (event.kind === "activity") activity += 1;
        else gate += 1;
      }
    }
    return { activity, gate };
  });

  let surfaces = $derived.by(() => {
    const seen: string[] = [];
    for (const day of data.days) {
      for (const event of day.events) {
        if (!seen.includes(event.surface)) seen.push(event.surface);
      }
    }
    return seen.sort();
  });

  let filteredDays = $derived(
    data.days
      .map((day) => ({
        day,
        shown: day.events.filter(
          (event) =>
            (kindFilter === "all" || event.kind === kindFilter) &&
            (surfaceFilter === null || event.surface === surfaceFilter),
        ),
      }))
      .filter((entry) => entry.shown.length > 0),
  );

  let kindChips = $derived([
    { value: "all" as KindFilter, label: `All (${kindCounts.activity + kindCounts.gate})` },
    { value: "activity" as KindFilter, label: `Activities (${kindCounts.activity})` },
    { value: "gate" as KindFilter, label: `Gate events (${kindCounts.gate})` },
  ]);

  function rowKey(event: LogEvent): string {
    return `${event.kind}:${event.id}`;
  }

  function toggleRow(event: LogEvent): void {
    const key = rowKey(event);
    expandedRowKey = expandedRowKey === key ? null : key;
  }

  function toggleDay(key: string): void {
    collapsedDays[key] = !collapsedDays[key];
  }

  function timeLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  async function copyDay(day: LogDay): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildDayAnalysisPrompt(day));
      copyStatus[day.key] = "copied";
    } catch {
      copyStatus[day.key] = "failed";
    }
    clearTimeout(copyTimers[day.key]);
    copyTimers[day.key] = setTimeout(() => {
      delete copyStatus[day.key];
    }, 2000);
  }

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors";
  const chipIdle =
    "border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white";
  const chipActive = "border-neutral-400 bg-white text-neutral-900 shadow-sm";
</script>

<div class="mb-4">
  <h1 class="text-lg font-semibold text-neutral-900">Logs</h1>
  <p class="mt-1 max-w-3xl text-sm text-neutral-500">
    Single source of truth: task activities (what changed) and gate events (what was
    blocked, overridden, warned, or skipped, and why). State changes and gate decisions
    only; reads are never logged.
  </p>
</div>

<!-- bounded-window indicator: always says exactly what is and is not shown -->
<div
  class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-[11px] text-neutral-600"
>
  <span>
    Showing the {data.shownCount} most recent of {data.totalCount} events
    ({data.activitiesTotal} activities, {data.gateEventsTotal} gate events in total).
  </span>
  {#if data.hasMore && data.nextLimit !== null}
    <span>Older events are not loaded.</span>
    <a
      href={resolve(`/logs?limit=${data.nextLimit}`)}
      class="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 font-medium text-neutral-800 hover:border-neutral-300 hover:bg-white"
    >
      Load older events
    </a>
  {:else if data.hasMore}
    <span>Window cap reached ({data.limit}); older events exist but are not loaded.</span>
  {:else}
    <span>All events are loaded.</span>
  {/if}
</div>

<!-- filter chips: dual-encoded (text label + check glyph), never color alone -->
<div class="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2">
  <span class="font-mono text-[10px] uppercase tracking-wider text-neutral-500">Type</span>
  {#each kindChips as chip (chip.value)}
    <button
      type="button"
      aria-pressed={kindFilter === chip.value}
      class="{chipBase} {kindFilter === chip.value ? chipActive : chipIdle}"
      onclick={() => (kindFilter = chip.value)}
    >
      {#if kindFilter === chip.value}
        <Check class="h-3 w-3" />
      {/if}
      {chip.label}
    </button>
  {/each}

  {#if surfaces.length > 0}
    <span class="ml-2 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
      Surface
    </span>
    <button
      type="button"
      aria-pressed={surfaceFilter === null}
      class="{chipBase} {surfaceFilter === null ? chipActive : chipIdle}"
      onclick={() => (surfaceFilter = null)}
    >
      {#if surfaceFilter === null}
        <Check class="h-3 w-3" />
      {/if}
      All
    </button>
    {#each surfaces as surface (surface)}
      <button
        type="button"
        aria-pressed={surfaceFilter === surface}
        class="{chipBase} {surfaceFilter === surface ? chipActive : chipIdle}"
        onclick={() => (surfaceFilter = surface)}
      >
        {#if surfaceFilter === surface}
          <Check class="h-3 w-3" />
        {/if}
        {surface}
      </button>
    {/each}
  {/if}
</div>

{#each filteredDays as entry (entry.day.key)}
  <section
    class="mb-3 rounded-lg border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
  >
    <div class="flex flex-wrap items-center gap-2 px-3 py-2">
      <button
        type="button"
        aria-expanded={!collapsedDays[entry.day.key]}
        class="flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-neutral-50"
        onclick={() => toggleDay(entry.day.key)}
      >
        <ChevronDown
          class="h-3.5 w-3.5 text-neutral-400 transition-transform {collapsedDays[entry.day.key]
            ? '-rotate-90'
            : ''}"
        />
        <span class="text-sm font-semibold text-neutral-900">{entry.day.label}</span>
      </button>
      <span class="font-mono text-[11px] text-neutral-500">
        {entry.shown.length === entry.day.events.length
          ? `${entry.day.events.length} event${entry.day.events.length === 1 ? "" : "s"}`
          : `${entry.shown.length} of ${entry.day.events.length} events (filtered)`}
      </span>
      <div class="ml-auto">
        <button
          type="button"
          class="{chipBase} {chipIdle}"
          aria-label={`Copy analysis prompt for ${entry.day.label}`}
          onclick={() => copyDay(entry.day)}
        >
          {#if copyStatus[entry.day.key] === "copied"}
            <Check class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Copied
          {:else if copyStatus[entry.day.key] === "failed"}
            Copy failed
          {:else}
            <Clipboard class="h-3.5 w-3.5" />
            Copy prompt
          {/if}
        </button>
      </div>
    </div>

    {#if !collapsedDays[entry.day.key]}
      <ul class="border-t border-neutral-100">
        {#each entry.shown as event (rowKey(event))}
          <li class="border-b border-neutral-100 last:border-b-0">
            <button
              type="button"
              aria-expanded={expandedRowKey === rowKey(event)}
              class="grid w-full grid-cols-[6.5rem_1fr_auto] items-baseline gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-neutral-50 sm:grid-cols-[6.5rem_11rem_1fr_auto_auto]"
              onclick={() => toggleRow(event)}
            >
              {#if event.kind === "activity"}
                <span
                  class="inline-flex w-fit items-center rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
                >
                  Activity
                </span>
              {:else}
                <span
                  class="inline-flex w-fit items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  Gate event
                </span>
              {/if}
              <span class="truncate text-[13px] font-medium text-neutral-800">
                {event.name}
              </span>
              <span class="col-span-3 min-w-0 truncate text-[13px] text-neutral-600 sm:col-span-1">
                {event.summary}
              </span>
              <span class="hidden font-mono text-[11px] text-neutral-500 sm:inline">
                {event.actor} via {event.surface}{event.taskId ? ` · ${event.taskId}` : ""}
              </span>
              <span class="font-mono text-[11px] tabular-nums text-neutral-500">
                {timeLabel(event.occurredAt)}
              </span>
            </button>
            {#if expandedRowKey === rowKey(event)}
              <div class="border-t border-neutral-100 bg-neutral-50 px-3 py-2">
                <p class="mb-1 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                  Raw record ({event.kind === "activity" ? "task_activities" : "gate_events"})
                </p>
                <pre
                  class="overflow-x-auto rounded-md border border-neutral-200 bg-white p-3 font-mono text-[11px] leading-5 text-neutral-800">{JSON.stringify(
                    event.raw,
                    null,
                    2,
                  )}</pre>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else}
  <div class="rounded-xl border border-dashed border-neutral-200 bg-white px-6 py-20 text-center">
    <p class="font-mono text-[11px] uppercase tracking-wider text-neutral-500">Logs</p>
    <h2 class="mt-2 text-lg font-semibold text-neutral-700">
      {data.totalCount === 0 ? "No events yet" : "No events match the current filters"}
    </h2>
    <p class="mt-2 text-sm text-neutral-500">
      {data.totalCount === 0
        ? "Task activity and gate decisions will appear here as they happen."
        : "Adjust the type or surface filters to see the loaded events."}
    </p>
  </div>
{/each}
