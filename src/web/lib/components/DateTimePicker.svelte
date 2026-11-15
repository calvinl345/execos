<script lang="ts">
  import { DatePicker } from "bits-ui";
  import { CalendarDateTime, getLocalTimeZone, today, type DateValue } from "@internationalized/date";
  import { Calendar, ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { parseNaturalDate } from "../../../domain/dates.js";
  import { dueLabel } from "../utils/dates.js";

  interface Props {
    value?: string;                            // $bindable natural-language phrase
    onResolve: (iso: string | null) => void;   // emits UTC ISO string or null
    placeholder?: string;                      // default "tomorrow at 9"
    id?: string;
    disabled?: boolean;
    autofocus?: boolean;                       // render data-autofocus attr on the text input when true
    showPresets?: boolean;
  }

  const fallbackId = $props.id();
  let {
    value = $bindable(""),
    onResolve,
    placeholder = "tomorrow at 9",
    id,
    disabled = false,
    autofocus = false,
    showPresets = false,
  }: Props = $props();

  const presets = [
    { label: "Tomorrow", phrase: "tomorrow" },
    { label: "In 2 days", phrase: "in 2 days" },
    { label: "Next Monday", phrase: "next monday" },
    { label: "In 1 week", phrase: "in 1 week" },
  ] as const;

  const timeIntervals = (() => {
    const list = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const period = h >= 12 ? "PM" : "AM";
        const displayHour = h % 12 || 12;
        const displayMinute = m.toString().padStart(2, "0");
        list.push({
          hour: h,
          minute: m,
          label: `${displayHour}:${displayMinute} ${period}`,
        });
      }
    }
    return list;
  })();

  let pickerValue = $state<DateValue | undefined>(undefined);
  // Smart-close: a day click keeps the calendar open so the time list stays
  // reachable; picking a time (the terminal step) or the Done button closes it,
  // returning the user to the parent form's submit button.
  let pickerOpen = $state(false);
  // Seed the placeholder with a time so a bare day click in the calendar
  // yields a sensible default time instead of midnight.
  let placeholderValue = $state<DateValue>(initialPlaceholder());
  let timeContainerEl = $state<HTMLDivElement | null>(null);
  let lastSyncedIso = $state<string | null>(null);
  let lastEmittedIso: string | null = null;

  const inputId = $derived(id ?? fallbackId);

  const resolution = $derived.by(() => {
    if (value.trim().length === 0) return null;
    return parseNaturalDate(value);
  });
  const resolvedIso = $derived(resolution?.ok ? resolution.date.toISOString() : null);
  const resolvedLabel = $derived(
    resolution?.ok ? `${dueLabel(resolution.date)}, ${formatTime(resolution.date)}` : null,
  );
  const showError = $derived(value.trim().length > 0 && resolution?.ok === false);

  const selectedTime = $derived.by(() => {
    if (pickerValue && "hour" in pickerValue && "minute" in pickerValue) {
      return { hour: pickerValue.hour, minute: pickerValue.minute };
    }
    return null;
  });

  // 1. Sync resolvedIso to pickerValue
  $effect(() => {
    if (resolvedIso === lastSyncedIso) return;
    lastSyncedIso = resolvedIso;
    if (resolvedIso) {
      const date = new Date(resolvedIso);
      pickerValue = new CalendarDateTime(
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes()
      );
    } else {
      pickerValue = undefined;
    }
  });

  // 2. Sync pickerValue back to value (input phrase). The picker's own
  // time is authoritative when present: effect 1 always seeds a
  // CalendarDateTime, so a day click preserves the prior time and a time
  // click carries the newly chosen one — overriding it here would make
  // the time list a no-op.
  $effect(() => {
    if (!pickerValue) return;

    const jsDate = pickerValue.toDate(getLocalTimeZone());
    if (!("hour" in pickerValue)) {
      // Date-only selection: carry over the previously resolved time, or
      // default to the current time rounded up to the next 30 minutes.
      if (resolvedIso) {
        const prevDate = new Date(resolvedIso);
        jsDate.setHours(prevDate.getHours(), prevDate.getMinutes(), 0, 0);
      } else {
        const defTime = getDefaultTime();
        jsDate.setHours(defTime.hour, defTime.minute, 0, 0);
      }
    }

    const iso = jsDate.toISOString();
    // Compare at minute precision: the picker drops seconds, while a typed
    // phrase like "in 2 hours" resolves with seconds — a full-precision
    // comparison would overwrite the phrase the user just typed.
    if (iso === (resolvedIso ? truncateToMinute(resolvedIso) : null)) return;

    value = phraseFromDate(jsDate);
    lastSyncedIso = iso;
  });

  // 3. Emit onResolve when resolvedIso changes
  $effect(() => {
    if (resolvedIso === lastEmittedIso) return;
    lastEmittedIso = resolvedIso;
    onResolve(resolvedIso);
  });

  // 4. Scroll selected time into view inside popover
  $effect(() => {
    if (selectedTime && timeContainerEl) {
      const activeEl = timeContainerEl.querySelector('[aria-selected="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  });

  function formatTime(date: Date): string {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function phraseFromDate(date: Date): string {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const suffix = hours >= 12 ? "pm" : "am";
    const displayHour = hours % 12 || 12;
    return `${month}/${day}/${year} at ${displayHour}:${minutes}${suffix}`;
  }

  function initialPlaceholder(): CalendarDateTime {
    const todayDate = today(getLocalTimeZone());
    const defTime = getDefaultTime();
    return new CalendarDateTime(
      todayDate.year,
      todayDate.month,
      todayDate.day,
      defTime.hour,
      defTime.minute,
    );
  }

  function truncateToMinute(iso: string): string {
    const date = new Date(iso);
    date.setSeconds(0, 0);
    return date.toISOString();
  }

  function getDefaultTime(): { hour: number; minute: number } {
    const now = new Date();
    const minutes = now.getMinutes();
    if (minutes === 0) {
      return { hour: now.getHours(), minute: 0 };
    } else if (minutes <= 30) {
      return { hour: now.getHours(), minute: 30 };
    } else {
      return { hour: (now.getHours() + 1) % 24, minute: 0 };
    }
  }

  function selectTime(hour: number, minute: number): void {
    let baseDate: CalendarDateTime;
    if (pickerValue && "year" in pickerValue) {
      baseDate = pickerValue as CalendarDateTime;
    } else {
      const now = new Date();
      baseDate = new CalendarDateTime(
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate(),
        now.getHours(),
        now.getMinutes()
      );
    }

    const newPickerValue = new CalendarDateTime(
      baseDate.year,
      baseDate.month,
      baseDate.day,
      hour,
      minute
    );

    pickerValue = newPickerValue;

    const localTimeZone = getLocalTimeZone();
    const targetDate = newPickerValue.toDate(localTimeZone);
    const phrase = phraseFromDate(targetDate);
    value = phrase;
    lastSyncedIso = targetDate.toISOString();

    // Time is the terminal step in the day-then-time flow: close the calendar
    // so the user lands back on the form's submit button.
    pickerOpen = false;
  }

  function choosePhrase(phrase: string): void {
    value = phrase;
  }

  function movePresetFocus(event: KeyboardEvent, index: number, direction: -1 | 1): void {
    event.preventDefault();
    const nextIndex = (index + direction + presets.length) % presets.length;
    document.getElementById(`${inputId}-preset-${nextIndex}`)?.focus();
  }
</script>

<div class="space-y-2">
  <DatePicker.Root
    bind:value={pickerValue}
    bind:open={pickerOpen}
    weekdayFormat="short"
    granularity="minute"
    closeOnDateSelect={false}
    bind:placeholder={placeholderValue}
  >
    <div class="flex items-center gap-2">
      <input
        id={inputId}
        bind:value
        type="text"
        class="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-800"
        {placeholder}
        {disabled}
        data-autofocus={autofocus ? "" : undefined}
        autocomplete="off"
      />
      <DatePicker.Trigger
        type="button"
        disabled={disabled}
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:focus:ring-neutral-700"
        aria-label="Open date and time picker"
      >
        <Calendar class="h-4 w-4" />
      </DatePicker.Trigger>
    </div>

    <DatePicker.Portal>
      <DatePicker.Content
        class="z-[100] rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
      >
        <div class="flex flex-col sm:flex-row gap-4 items-stretch">
          <DatePicker.Calendar class="select-none flex-1">
            {#snippet children({ months, weekdays })}
              <DatePicker.Header class="flex items-center justify-between pb-3">
                <DatePicker.PrevButton
                  class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <ChevronLeft class="h-4 w-4" />
                </DatePicker.PrevButton>
                <DatePicker.Heading class="text-sm font-semibold text-neutral-800 dark:text-neutral-100" />
                <DatePicker.NextButton
                  class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <ChevronRight class="h-4 w-4" />
                </DatePicker.NextButton>
              </DatePicker.Header>
              {#each months as month (month.value.toString())}
                <DatePicker.Grid class="w-full border-collapse">
                  <DatePicker.GridHead>
                    <DatePicker.GridRow class="flex w-full mt-2 justify-between">
                      {#each weekdays as day (day)}
                        <DatePicker.HeadCell class="w-8 rounded-md text-[11px] font-medium text-neutral-400 dark:text-neutral-500 flex items-center justify-center">
                          {day}
                        </DatePicker.HeadCell>
                      {/each}
                    </DatePicker.GridRow>
                  </DatePicker.GridHead>
                  <DatePicker.GridBody class="mt-1">
                    {#each month.weeks as week, weekIndex (weekIndex)}
                      <DatePicker.GridRow class="flex w-full mt-1 justify-between">
                        {#each week as date (`${date.year}-${date.month}-${date.day}`)}
                          <DatePicker.Cell {date} month={month.value} class="relative p-0 text-center text-sm focus-within:relative focus-within:z-20">
                            <DatePicker.Day
                              class="h-8 w-8 rounded-md p-0 font-normal text-neutral-900 dark:text-neutral-100 transition-colors
                                     hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-300
                                     data-[selected]:bg-neutral-900 data-[selected]:text-white dark:data-[selected]:bg-neutral-100 dark:data-[selected]:!text-neutral-950
                                     data-[today]:border data-[today]:border-neutral-300 dark:data-[today]:border-neutral-600
                                     data-[outside-month]:text-neutral-300 dark:data-[outside-month]:text-neutral-600 data-[outside-month]:pointer-events-none
                                     data-[disabled]:text-neutral-300 dark:data-[disabled]:text-neutral-600 data-[disabled]:pointer-events-none"
                            >
                              {date.day}
                            </DatePicker.Day>
                          </DatePicker.Cell>
                        {/each}
                      </DatePicker.GridRow>
                    {/each}
                  </DatePicker.GridBody>
                </DatePicker.Grid>
              {/each}
            {/snippet}
          </DatePicker.Calendar>

          <div class="w-full sm:w-36 border-t sm:border-t-0 sm:border-l border-neutral-200 dark:border-neutral-700 pt-3 sm:pt-0 sm:pl-3 flex flex-col">
            <div class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2 px-2">Time</div>
            <div bind:this={timeContainerEl} role="listbox" aria-label="Select time" class="h-60 overflow-y-auto pr-1 space-y-1">
              {#each timeIntervals as time (time.label)}
                {@const isSelected = selectedTime?.hour === time.hour && selectedTime?.minute === time.minute}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  class="w-full rounded px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300
                         {isSelected
                           ? 'bg-neutral-900 text-white font-medium dark:bg-neutral-100 dark:!text-neutral-950'
                           : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
                  onclick={() => selectTime(time.hour, time.minute)}
                >
                  {time.label}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div class="mt-3 flex justify-end border-t border-neutral-200 pt-3 dark:border-neutral-700">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-200"
            onclick={() => (pickerOpen = false)}
          >
            Done
          </button>
        </div>
      </DatePicker.Content>
    </DatePicker.Portal>
  </DatePicker.Root>

  {#if resolvedLabel}
    <p class="text-xs text-neutral-600 dark:text-neutral-400">Resolves to {resolvedLabel}</p>
  {:else if showError}
    <p class="text-xs text-amber-700 dark:text-amber-500">couldn't read that date</p>
  {:else}
    <p class="text-xs text-neutral-400 dark:text-neutral-500">Type a date phrase.</p>
  {/if}

  {#if showPresets}
    <div class="flex flex-wrap gap-1.5" aria-label="date presets">
      {#each presets as preset, index (preset.phrase)}
        <button
          id={`${inputId}-preset-${index}`}
          type="button"
          disabled={disabled}
          class="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:focus:ring-neutral-700"
          onclick={() => choosePhrase(preset.phrase)}
          onkeydown={(event) => {
            if (event.key === "ArrowRight") movePresetFocus(event, index, 1);
            if (event.key === "ArrowLeft") movePresetFocus(event, index, -1);
          }}
        >
          {preset.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
