/**
 * Client-side cleared-done watermark for the inbox (S20/A9).
 *
 * "Clear done tasks" is presentation-only: tasks are already `done` in the DB;
 * this module remembers WHEN the user last cleared, so done rows completed
 * before that instant stay hidden across reloads. Storage failures degrade to
 * an in-memory watermark for the session — warned, never silent, no fake
 * persistence (A22).
 *
 * No module-scope localStorage access: the page is SSR'd and this module is
 * imported during the server render. Callers read in onMount (the existing
 * prefs pattern in +page.svelte).
 */

export const CLEARED_DONE_AT_STORAGE_KEY = "execos.dashboard.clearedDoneAt";

let memoryClearedDoneAt: string | null = null;

function parseIso(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The stored watermark, or null when the user has never cleared. */
export function readClearedDoneAt(): Date | null {
  try {
    return parseIso(localStorage.getItem(CLEARED_DONE_AT_STORAGE_KEY) ?? memoryClearedDoneAt);
  } catch (error) {
    console.warn(
      "done-watermark: localStorage unavailable; using in-memory watermark for this session",
      error,
    );
    return parseIso(memoryClearedDoneAt);
  }
}

export function writeClearedDoneAt(at: Date): void {
  const iso = at.toISOString();
  memoryClearedDoneAt = iso;
  try {
    localStorage.setItem(CLEARED_DONE_AT_STORAGE_KEY, iso);
  } catch (error) {
    console.warn(
      "done-watermark: localStorage unavailable; watermark kept in memory for this session",
      error,
    );
  }
}
