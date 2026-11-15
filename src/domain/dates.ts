/**
 * Natural-language date parsing per Appendix H.8.2 / AC-048.
 *
 * Goal: convert short user phrases (CLI input or NL agent output) into
 * a UTC `Date` for storage in `timestamptz` columns. The phrase is
 * parsed in a target timezone (the host machine's local TZ by default,
 * or an explicit override either passed via options or expressed
 * inline in the phrase, e.g. "3pm EST Thursday").
 *
 * Scope (intentionally bounded so behavior is auditable):
 *   - ISO 8601 instants and date-times: "2026-04-26T15:00:00Z",
 *     "2026-04-26T15:00", "2026-04-26".
 *   - Relative day words: "today", "tomorrow", "yesterday".
 *   - Bare weekdays and "this/next <weekday>".
 *   - Explicit US-style numeric dates: "4/26", "4/26/2026", "04/26/2026".
 *   - Month-name dates: "June 27, 2026", "Jun 27 2026" (no comma),
 *     "June 27" (no year, rolls forward to the next future occurrence).
 *   - "in N days" / "in N weeks" / "in N hours".
 *   - Optional clock time appended via "at": "Thursday at 3pm",
 *     "tomorrow at 15:30", "today at noon".
 *   - Optional bare clock time: "3pm" -> today at 3pm.
 *   - Time keywords: noon, midnight, morning (09:00), afternoon (13:00),
 *     evening (18:00), end-of-day / EOD (17:00).
 *   - Inline TZ override: PST, PDT, EST, EDT, CST, CDT, MST, MDT,
 *     UTC, GMT, plus IANA names like "America/New_York".
 *
 * Out of scope (rejected with a clear error so the agent can ask the
 * user for clarification):
 *   - Vague phrases ("soon", "later", "next week" without a weekday).
 *
 * Default time when only a date is given: 17:00 local (end-of-day),
 * matching the "EOD" keyword. Documented and asserted in tests so
 * downstream callers can rely on it.
 *
 * Conventions for weekday handling:
 *   - Bare "Thursday" or "this Thursday": the next occurrence at-or-
 *     after today. If today IS Thursday, today.
 *   - "next Thursday": the Thursday in the FOLLOWING calendar week
 *     (i.e. always 7+ days from "this Thursday").
 *   - "last Thursday": the most recent past Thursday.
 *
 * Pure functions only. No DB calls, no I/O. The two clock reads
 * (Intl host TZ, current Date) are isolated to optional inputs so
 * tests can pin both. Tested by tests/domain/dates.test.ts.
 */

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export interface ParseDateOptions {
  /**
   * The "now" to resolve relative phrases against. Defaults to
   * `new Date()`. Tests pin this for determinism.
   */
  referenceTime?: Date;

  /**
   * Default IANA timezone if the phrase contains no inline TZ override.
   * Defaults to the host machine's resolved TZ via
   * `Intl.DateTimeFormat().resolvedOptions().timeZone`.
   */
  defaultTimeZone?: string;
}

export interface ParseDateOk {
  ok: true;
  /** UTC instant suitable for storing in a timestamptz column. */
  date: Date;
  /** The IANA TZ that was actually used to interpret the local time. */
  resolvedTimeZone: string;
  /** Diagnostic label for the matched parse strategy. */
  matchedPattern: string;
}

export interface ParseDateError {
  ok: false;
  reason: string;
}

export type ParseDateResult = ParseDateOk | ParseDateError;

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/** Default "end-of-day" hour (24h) when a date phrase has no time. */
const DEFAULT_TIME_HOUR = 17;
const DEFAULT_TIME_MINUTE = 0;

/**
 * Maps short TZ abbreviations to IANA names. We deliberately route
 * standard-time AND daylight-time abbreviations to the same IANA zone
 * because IANA handles DST transitions for us; the abbreviation only
 * tells us which zone the user means, not which fixed offset to apply.
 */
const TZ_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MST: "America/Denver",
  MDT: "America/Denver",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  EST: "America/New_York",
  EDT: "America/New_York",
  UTC: "UTC",
  GMT: "UTC", // Treat GMT as UTC for storage; close enough for productivity use.
});

const WEEKDAY_INDEX: Readonly<Record<string, number>> = Object.freeze({
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  weds: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
});

/**
 * Maps full month names AND 3-letter abbreviations to a 1-based month
 * index (january/jan -> 1 ... december/dec -> 12). 1-based to match the
 * rest of this file (WallClockComponents.month, utcFromLocalInTimeZone's
 * monthOneBased). Lookups are case-insensitive: callers lowercase first.
 */
const MONTH_NAME_INDEX: Readonly<Record<string, number>> = Object.freeze({
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
});

const TIME_KEYWORDS: Readonly<Record<string, { hour: number; minute: number }>> =
  Object.freeze({
    noon: { hour: 12, minute: 0 },
    midnight: { hour: 0, minute: 0 },
    morning: { hour: 9, minute: 0 },
    afternoon: { hour: 13, minute: 0 },
    evening: { hour: 18, minute: 0 },
    eod: { hour: 17, minute: 0 },
    "end-of-day": { hour: 17, minute: 0 },
    "end of day": { hour: 17, minute: 0 },
  });

// ---------------------------------------------------------------------------
// Public helpers.
// ---------------------------------------------------------------------------

/**
 * Returns the host machine's resolved IANA timezone. Wraps the
 * Intl call so callers can stub it in tests without touching globals.
 */
export function getHostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Validates that a TZ string is recognized by the runtime. Returns
 * true for IANA names and the abbreviations in TZ_ABBREVIATIONS.
 */
export function isValidTimeZone(tz: string): boolean {
  if (TZ_ABBREVIATIONS[tz.toUpperCase()] !== undefined) return true;
  try {
    // The Intl constructor throws on unknown IANA names.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves an abbreviation or IANA name to a canonical IANA name.
 * Returns null if not recognized.
 */
export function resolveTimeZone(tz: string): string | null {
  const upper = tz.toUpperCase();
  if (TZ_ABBREVIATIONS[upper] !== undefined) return TZ_ABBREVIATIONS[upper];
  if (isValidTimeZone(tz)) return tz;
  return null;
}

// ---------------------------------------------------------------------------
// Local-time -> UTC conversion in an arbitrary IANA timezone (DST-safe).
// ---------------------------------------------------------------------------

/**
 * Given a wall-clock local time (year/month/day/hour/minute) in IANA
 * timezone `tz`, returns the corresponding UTC instant.
 *
 * Implementation:
 *   1. Make an initial guess: treat the local components as if they
 *      were UTC (Date.UTC(...)). This is wrong by the TZ offset.
 *   2. Compute the offset of `tz` AT THAT GUESS by formatting the
 *      guessed instant in `tz` and comparing to the local components.
 *   3. Subtract the offset from the guess. One refinement pass is
 *      enough for any non-pathological case (DST forward/back jumps
 *      of 1 hour). For correctness across DST boundaries we run a
 *      second pass to confirm.
 *
 * Edge cases:
 *   - DST "spring forward" (a non-existent local time like 02:30):
 *     the function returns a defined instant near the gap. Callers
 *     who care should validate the round-trip.
 *   - DST "fall back" (an ambiguous local time like 01:30): the
 *     function returns the LATER (post-transition) interpretation.
 *     This is consistent with most user intent for due-dates.
 */
export function utcFromLocalInTimeZone(
  year: number,
  monthOneBased: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guessUtc = Date.UTC(year, monthOneBased - 1, day, hour, minute, 0, 0);
  let utcMs = guessUtc;

  for (let pass = 0; pass < 2; pass++) {
    const offsetMin = getTimeZoneOffsetMinutesAt(new Date(utcMs), tz);
    const target = guessUtc - offsetMin * 60_000;
    if (target === utcMs) break;
    utcMs = target;
  }

  return new Date(utcMs);
}

/**
 * Returns the signed offset in minutes between `tz` local time and
 * UTC at the given instant. Positive = east of UTC.
 *
 * Uses Intl.DateTimeFormat.formatToParts to read the wall-clock
 * components in `tz` for the given UTC instant, then differences
 * against the same instant interpreted as UTC. This is the standard
 * portable approach in plain Node / browsers without TZ libraries.
 */
export function getTimeZoneOffsetMinutesAt(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  let h = get("hour");
  const mi = get("minute");
  const s = get("second");
  // hour12:false in some locales emits "24" for midnight; normalize.
  if (h === 24) h = 0;
  const asUtcMs = Date.UTC(y, m - 1, d, h, mi, s);
  return Math.round((asUtcMs - at.getTime()) / 60_000);
}

// ---------------------------------------------------------------------------
// Phrase parsing.
// ---------------------------------------------------------------------------

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})?)?$/;

const US_NUMERIC_DATE_RE =
  /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;

/**
 * Month-name dates: "June 27, 2026", "June 27 2026" (no comma),
 * "Jun 27 2026" (abbrev), and "June 27" (no year). Tolerant of an
 * optional comma and extra whitespace between tokens. The month word is
 * validated against MONTH_NAME_INDEX (unknown words fall through to the
 * final reject). Day/year ranges are validated in the branch.
 */
const MONTH_NAME_DATE_RE =
  /^([a-z]+)\s+(\d{1,2})(?:\s*,\s*|\s+)?(\d{4})?$/;

const TIME_RE =
  /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM|a\.m\.|p\.m\.)?$/;

/**
 * Main entry. Parses `phrase` into a UTC Date, returning a tagged
 * result. Never throws on bad input; returns ParseDateError instead.
 */
export function parseNaturalDate(
  phrase: string,
  options: ParseDateOptions = {},
): ParseDateResult {
  const reference = options.referenceTime ?? new Date();
  const defaultTz = options.defaultTimeZone ?? getHostTimeZone();
  const trimmed = phrase.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "phrase is empty" };
  }

  // 1. Detect inline TZ override and strip it from the phrase.
  const { phrase: phraseNoTz, timeZone: inlineTz } = extractInlineTimeZone(
    trimmed,
  );
  const tz = inlineTz ?? defaultTz;
  const resolvedTz = resolveTimeZone(tz);
  if (resolvedTz === null) {
    return { ok: false, reason: `unknown timezone: '${tz}'` };
  }

  // 2. Try ISO 8601 first: it carries its own offset semantics and is
  //    the most unambiguous. If the phrase has an offset suffix (Z or
  //    +HH:MM), that wins over the resolved TZ.
  const iso = tryParseIso(phraseNoTz);
  if (iso) {
    if (!iso.hadOffset) {
      const localUtc = utcFromLocalInTimeZone(
        iso.year,
        iso.month,
        iso.day,
        iso.hour,
        iso.minute,
        resolvedTz,
      );
      return {
        ok: true,
        date: new Date(localUtc.getTime() + iso.second * 1000),
        resolvedTimeZone: resolvedTz,
        matchedPattern: "iso8601_local",
      };
    }

    return {
      ok: true,
      date: iso.date,
      resolvedTimeZone: "UTC",
      matchedPattern: "iso8601_with_offset",
    };
  }

  // 3. Split on " at " to separate date-part from time-part. This
  //    handles "Thursday at 3pm", "tomorrow at 15:30", "today at noon".
  //    Phrases without " at " get split heuristically: bare time only,
  //    bare date only, or combined (e.g. "3pm Thursday").
  const split = splitDateAndTime(phraseNoTz);

  // 4. Parse the date portion.
  const dateRes = parseDatePart(split.dateText, reference, resolvedTz);
  if (!dateRes.ok) return dateRes;

  // 5. Parse the time portion (or use default).
  const timeRes = parseTimePart(split.timeText);
  if (!timeRes.ok) return timeRes;

  const utc = utcFromLocalInTimeZone(
    dateRes.year,
    dateRes.month,
    dateRes.day,
    timeRes.hour,
    timeRes.minute,
    resolvedTz,
  );

  return {
    ok: true,
    date: utc,
    resolvedTimeZone: resolvedTz,
    matchedPattern: `${dateRes.pattern}+${timeRes.pattern}`,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Looks for an inline TZ token in the phrase and returns the phrase
 * with the token removed. Recognizes both abbreviations and IANA names.
 *
 * Strategy: scan whitespace-separated tokens for an exact-match
 * abbreviation OR an IANA-shaped name (Continent/City). Remove the
 * first match. We do not attempt to disambiguate multiple TZ tokens
 * in one phrase; the first wins and the rest fail downstream.
 */
function extractInlineTimeZone(phrase: string): {
  phrase: string;
  timeZone: string | null;
} {
  // IANA names contain a "/" and have at least one slash-separated
  // alphabetic chunk. We match conservatively: Letter+_/Letter+ with
  // optional leading underscore tolerance.
  const ianaRe = /\b([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z_]+)?)\b/;
  const ianaMatch = phrase.match(ianaRe);
  if (ianaMatch && isValidTimeZone(ianaMatch[1])) {
    const stripped = (
      phrase.slice(0, ianaMatch.index) +
      phrase.slice((ianaMatch.index ?? 0) + ianaMatch[1].length)
    ).replace(/\s+/g, " ").trim();
    return { phrase: stripped, timeZone: ianaMatch[1] };
  }

  // Abbreviation: must be a stand-alone token, all caps, length 3-4.
  const tokens = phrase.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^[A-Z]{3,4}$/.test(tok) && TZ_ABBREVIATIONS[tok] !== undefined) {
      const remaining = [...tokens.slice(0, i), ...tokens.slice(i + 1)]
        .join(" ")
        .trim();
      return { phrase: remaining, timeZone: tok };
    }
  }
  return { phrase, timeZone: null };
}

interface DatePartResult {
  ok: true;
  year: number;
  month: number;
  day: number;
  pattern: string;
}
function dateOk(
  year: number,
  month: number,
  day: number,
  pattern: string,
): DatePartResult {
  return { ok: true, year, month, day, pattern };
}

function parseDatePart(
  text: string,
  reference: Date,
  tz: string,
): DatePartResult | ParseDateError {
  const t = text.trim().toLowerCase();
  if (t.length === 0) {
    // No date text means the time-only path applies; we use today
    // in the target TZ.
    const today = wallClockComponents(reference, tz);
    return dateOk(today.year, today.month, today.day, "implicit_today");
  }

  // "today" / "tomorrow" / "yesterday"
  if (t === "today") {
    const today = wallClockComponents(reference, tz);
    return dateOk(today.year, today.month, today.day, "today");
  }
  if (t === "tomorrow" || t === "tmrw") {
    const target = addDaysInTz(reference, tz, 1);
    return dateOk(target.year, target.month, target.day, "tomorrow");
  }
  if (t === "yesterday") {
    const target = addDaysInTz(reference, tz, -1);
    return dateOk(target.year, target.month, target.day, "yesterday");
  }

  // "in N days|weeks|hours" (hours treated as a 0-day delta plus a
  // delta-hour clamp; we encode hours by computing the new day).
  const inMatch = t.match(/^in\s+(\d+)\s+(day|days|week|weeks|hour|hours)$/);
  if (inMatch) {
    const n = Number(inMatch[1]);
    const unit = inMatch[2];
    if (unit.startsWith("day")) {
      const target = addDaysInTz(reference, tz, n);
      return dateOk(target.year, target.month, target.day, "in_n_days");
    }
    if (unit.startsWith("week")) {
      const target = addDaysInTz(reference, tz, n * 7);
      return dateOk(target.year, target.month, target.day, "in_n_weeks");
    }
    if (unit.startsWith("hour")) {
      // Add hours to the reference instant directly, then read the
      // resulting wall-clock day in tz. The time portion of the
      // ultimate parse is whatever the time-text resolves to (or
      // default), so "in 5 hours" alone uses default-time on the
      // target day. This is a documented limitation; for sub-day
      // precision the agent should output an ISO instant.
      const shifted = new Date(reference.getTime() + n * 3_600_000);
      const wc = wallClockComponents(shifted, tz);
      return dateOk(wc.year, wc.month, wc.day, "in_n_hours");
    }
  }

  // Weekday phrases: "monday", "next thursday", "this fri", "last sunday"
  const weekdayRe = /^(this\s+|next\s+|last\s+)?([a-z]+)$/;
  const weekdayMatch = t.match(weekdayRe);
  if (weekdayMatch) {
    const modifier = (weekdayMatch[1] ?? "").trim();
    const wd = WEEKDAY_INDEX[weekdayMatch[2]];
    if (wd !== undefined) {
      const target = resolveWeekday(reference, tz, wd, modifier);
      return dateOk(target.year, target.month, target.day, `weekday_${modifier || "this"}`);
    }
  }

  // US numeric date "M/D" or "M/D/YYYY"
  const numMatch = t.match(US_NUMERIC_DATE_RE);
  if (numMatch) {
    const month = Number(numMatch[1]);
    const day = Number(numMatch[2]);
    let year: number;
    if (numMatch[3] === undefined) {
      // No year: use the current year in tz, but if the resulting
      // date is more than ~6 months in the past relative to the
      // reference, roll forward to next year (matches typical
      // "due 11/3" intent in early January).
      const wc = wallClockComponents(reference, tz);
      year = wc.year;
      const candidate = utcFromLocalInTimeZone(
        year,
        month,
        day,
        DEFAULT_TIME_HOUR,
        DEFAULT_TIME_MINUTE,
        tz,
      );
      if (candidate.getTime() < reference.getTime() - 1000 * 60 * 60 * 24 * 180) {
        year += 1;
      }
    } else {
      const raw = numMatch[3];
      year = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
    }
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      year < 1970 ||
      year > 2999
    ) {
      return { ok: false, reason: `invalid numeric date: '${text}'` };
    }
    return dateOk(year, month, day, "numeric_md");
  }

  // Month-name date "Month DD[, YYYY]" / "Mon DD YYYY" / "Month DD".
  // Reuses the same no-year roll-forward and timezone-aware construction
  // as the numeric M/D branch above.
  const monthNameMatch = t.match(MONTH_NAME_DATE_RE);
  if (monthNameMatch) {
    const month = MONTH_NAME_INDEX[monthNameMatch[1]];
    // Unknown month word (e.g. "smarch") falls through to the final
    // reject rather than throwing differently.
    if (month !== undefined) {
      const day = Number(monthNameMatch[2]);
      let year: number;
      if (monthNameMatch[3] === undefined) {
        // No year: use the current year in tz, rolling forward to next
        // year when the resulting date is more than ~6 months in the
        // past, identical to the numeric M/D branch.
        const wc = wallClockComponents(reference, tz);
        year = wc.year;
        const candidate = utcFromLocalInTimeZone(
          year,
          month,
          day,
          DEFAULT_TIME_HOUR,
          DEFAULT_TIME_MINUTE,
          tz,
        );
        if (
          candidate.getTime() <
          reference.getTime() - 1000 * 60 * 60 * 24 * 180
        ) {
          year += 1;
        }
      } else {
        year = Number(monthNameMatch[3]);
      }
      if (
        day < 1 ||
        day > 31 ||
        year < 1970 ||
        year > 2999
      ) {
        return { ok: false, reason: `invalid month-name date: '${text}'` };
      }
      return dateOk(year, month, day, "month_name");
    }
  }

  return { ok: false, reason: `could not parse date phrase: '${text}'` };
}

interface TimePartOk {
  ok: true;
  hour: number;
  minute: number;
  pattern: string;
}
function timeOk(hour: number, minute: number, pattern: string): TimePartOk {
  return { ok: true, hour, minute, pattern };
}

function parseTimePart(text: string): TimePartOk | ParseDateError {
  const t = text.trim().toLowerCase();
  if (t.length === 0) {
    return timeOk(DEFAULT_TIME_HOUR, DEFAULT_TIME_MINUTE, "default_eod");
  }
  if (TIME_KEYWORDS[t] !== undefined) {
    const kw = TIME_KEYWORDS[t];
    return timeOk(kw.hour, kw.minute, `keyword_${t.replace(/\s+/g, "_")}`);
  }
  const m = t.replace(/\s+/g, "").match(TIME_RE);
  if (m) {
    let hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    const ampmRaw = (m[3] ?? "").replace(/\./g, "").toLowerCase();
    if (ampmRaw === "pm" && hour < 12) hour += 12;
    if (ampmRaw === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return { ok: false, reason: `invalid time: '${text}'` };
    }
    return timeOk(hour, minute, ampmRaw ? "time_12h" : "time_24h");
  }
  return { ok: false, reason: `could not parse time phrase: '${text}'` };
}

type IsoParseOk =
  | {
      hadOffset: true;
      date: Date;
    }
  | {
      hadOffset: false;
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
    };

function tryParseIso(text: string): IsoParseOk | null {
  const m = text.match(ISO_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] === undefined ? DEFAULT_TIME_HOUR : Number(m[4]);
  const minute = m[5] === undefined ? DEFAULT_TIME_MINUTE : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const offsetTok = m[8];

  if (offsetTok !== undefined) {
    // Phrase carried explicit offset: trust it and bypass TZ logic.
    const isoNorm = `${m[1]}-${m[2]}-${m[3]}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${normalizeOffset(offsetTok)}`;
    const d = new Date(isoNorm);
    if (Number.isNaN(d.getTime())) return null;
    return { date: d, hadOffset: true };
  }

  // No offset: caller reinterprets the structured components in the
  // resolved target TZ instead of treating them as UTC wall-clock.
  return { hadOffset: false, year, month, day, hour, minute, second };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function normalizeOffset(off: string): string {
  if (off === "Z" || off === "z") return "Z";
  // Accept +HHMM and +HH:MM; normalize to +HH:MM.
  if (/^[+-]\d{4}$/.test(off)) {
    return `${off.slice(0, 3)}:${off.slice(3)}`;
  }
  return off;
}

interface SplitResult {
  dateText: string;
  timeText: string;
}

/**
 * Split a phrase into (date-text, time-text) on the strongest signal
 * available:
 *   1. Explicit " at ": "Thursday at 3pm" -> "Thursday", "3pm".
 *   2. Bare time keyword or HH:MM token at start: "3pm Thursday" ->
 *      "Thursday", "3pm".
 *   3. Bare time keyword/token at end: "Thursday 3pm" ->
 *      "Thursday", "3pm".
 *   4. No time signal: whole phrase is dateText, timeText is empty.
 */
function splitDateAndTime(phrase: string): SplitResult {
  const lower = phrase.toLowerCase().trim();

  // 1. Explicit " at " separator.
  const atIdx = lower.search(/\s+at\s+/);
  if (atIdx >= 0) {
    const before = phrase.slice(0, atIdx).trim();
    const after = phrase.slice(atIdx).replace(/^\s*at\s+/i, "").trim();
    return { dateText: before, timeText: after };
  }

  // 2. Time keyword anywhere -> peel it off.
  const tokens = phrase.trim().split(/\s+/);

  // Prefer matching the full lowercased phrase to multi-word keywords
  // ("end of day", "end-of-day"). These are typically at the end.
  for (const kw of Object.keys(TIME_KEYWORDS)) {
    const kwRe = new RegExp(`(^|\\s)${escapeRe(kw)}(\\s|$)`, "i");
    if (kwRe.test(phrase)) {
      const dateText = phrase.replace(kwRe, " ").replace(/\s+/g, " ").trim();
      return { dateText, timeText: kw };
    }
  }

  // 3. Bare HH(:MM)(am|pm) token: scan tokens.
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\d{1,2}(:\d{2})?(am|pm|AM|PM)?$/.test(tok) && /[apAP]/.test(tok)) {
      // 12h tokens: highly likely a time. (Bare "3" is too ambiguous to
      // treat as a time without am/pm or colon.)
      const dateText = [...tokens.slice(0, i), ...tokens.slice(i + 1)]
        .join(" ")
        .trim();
      return { dateText, timeText: tok };
    }
    if (/^\d{1,2}:\d{2}$/.test(tok)) {
      // 24h HH:MM token
      const dateText = [...tokens.slice(0, i), ...tokens.slice(i + 1)]
        .join(" ")
        .trim();
      return { dateText, timeText: tok };
    }
  }

  // 4. Whole phrase IS a bare time token (e.g. "3pm" alone).
  if (/^\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)$/.test(phrase.trim())) {
    return { dateText: "", timeText: phrase.trim() };
  }
  if (/^\d{1,2}:\d{2}$/.test(phrase.trim())) {
    return { dateText: "", timeText: phrase.trim() };
  }
  if (TIME_KEYWORDS[lower] !== undefined) {
    return { dateText: "", timeText: lower };
  }

  return { dateText: phrase.trim(), timeText: "" };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface WallClockComponents {
  year: number;
  month: number; // 1-based
  day: number;
  weekday: number; // 0=Sunday
}

/**
 * Reads the wall-clock components of `at` in `tz`. Used for relative
 * date math ("today" in a target TZ, "next Thursday" relative to the
 * reference time interpreted in tz).
 */
export function wallClockComponents(at: Date, tz: string): WallClockComponents {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const weekdayShort = get("weekday").toLowerCase();
  const weekday = WEEKDAY_INDEX[weekdayShort] ?? 0;
  return { year, month, day, weekday };
}

function addDaysInTz(
  reference: Date,
  tz: string,
  delta: number,
): WallClockComponents {
  const wc = wallClockComponents(reference, tz);
  // Construct a UTC date for the local noon on the reference day in tz,
  // add delta days, then read the resulting wall-clock day. Using noon
  // sidesteps DST 1-hour shifts that could nudge across midnight.
  const noonUtc = utcFromLocalInTimeZone(wc.year, wc.month, wc.day, 12, 0, tz);
  const shifted = new Date(noonUtc.getTime() + delta * 86_400_000);
  return wallClockComponents(shifted, tz);
}

function resolveWeekday(
  reference: Date,
  tz: string,
  targetWeekday: number,
  modifier: string,
): WallClockComponents {
  const today = wallClockComponents(reference, tz);
  let daysAhead = (targetWeekday - today.weekday + 7) % 7;

  if (modifier === "next") {
    // "next <weekday>": always at least 7 days ahead. If today is the
    // target weekday, daysAhead is 0 -> bump to 7. If it is later this
    // week (e.g. today Mon, "next Thu"): convention varies; we pick
    // "the Thu in next ISO week" = +7 from "this Thu".
    daysAhead = daysAhead === 0 ? 7 : daysAhead + 7;
  } else if (modifier === "last") {
    // Most recent past occurrence. If today is the target weekday,
    // go back 7 days (last week's instance, not today).
    daysAhead = daysAhead === 0 ? -7 : daysAhead - 7;
  }
  // bare or "this": use daysAhead as-is (0 means today).

  return addDaysInTz(reference, tz, daysAhead);
}

// ---------------------------------------------------------------------------
// Business-day math (weekend-aware), for default due-date computation.
// ---------------------------------------------------------------------------

/**
 * Business days a CLI-defaulted due date lands ahead of creation when the
 * user gave no due signal (batch-009 ISS-008). Counts Mon-Fri only.
 */
export const DEFAULT_DUE_BUSINESS_DAYS = 3;

/** True when `at` falls on Saturday or Sunday in `tz`. */
export function isWeekendInTz(at: Date, tz: string): boolean {
  const { weekday } = wallClockComponents(at, tz);
  return weekday === 0 || weekday === 6;
}

/**
 * Advances `businessDays` business days (Mon-Fri) forward from `reference`
 * in `tz`, skipping weekends, and returns the UTC instant for that day at
 * the default end-of-day time (17:00 local). The result always lands on a
 * weekday, so callers get a weekend-avoiding due date by construction.
 *
 * `businessDays` must be >= 1. Each step advances one calendar day via
 * the DST-safe `addDaysInTz` (which pivots on local noon), counting the
 * day only when it is a weekday.
 */
export function addBusinessDaysInTz(
  reference: Date,
  businessDays: number,
  tz: string,
): Date {
  let added = 0;
  let cursor = reference;
  while (added < businessDays) {
    const next = addDaysInTz(cursor, tz, 1);
    cursor = utcFromLocalInTimeZone(next.year, next.month, next.day, 12, 0, tz);
    if (!isWeekendInTz(cursor, tz)) {
      added += 1;
    }
  }
  const wc = wallClockComponents(cursor, tz);
  return utcFromLocalInTimeZone(
    wc.year,
    wc.month,
    wc.day,
    DEFAULT_TIME_HOUR,
    DEFAULT_TIME_MINUTE,
    tz,
  );
}
