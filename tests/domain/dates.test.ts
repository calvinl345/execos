import { describe, expect, it } from "vitest";
import {
  parseNaturalDate,
  getHostTimeZone,
  isValidTimeZone,
  resolveTimeZone,
  utcFromLocalInTimeZone,
  getTimeZoneOffsetMinutesAt,
  wallClockComponents,
  isWeekendInTz,
  addBusinessDaysInTz,
  DEFAULT_DUE_BUSINESS_DAYS,
} from "../../src/domain/dates.js";

// ---------------------------------------------------------------------------
// Reference times used across tests. Pinning these makes results
// deterministic regardless of when the test suite runs.
// ---------------------------------------------------------------------------

// Sunday, April 26, 2026 at 12:00:00 UTC.
//   - Sun in UTC, Sun in PST (05:00), Sun in EST (08:00).
const REF_2026_04_26_SUN_NOON_UTC = new Date("2026-04-26T12:00:00Z");

// Monday, March 9, 2026 at 17:00:00 UTC. Used for DST sensitivity.
//   - DST starts in US on Sun Mar 8, 2026, so PST -> PDT has happened.
const REF_2026_03_09_MON_AFTER_DST = new Date("2026-03-09T17:00:00Z");

// Wednesday, November 4, 2026 at 17:00:00 UTC. Used for DST sensitivity.
//   - DST ends in US on Sun Nov 1, 2026, so PDT -> PST has happened.
const REF_2026_11_04_WED_AFTER_DST = new Date("2026-11-04T17:00:00Z");

describe("domain/dates getHostTimeZone", () => {
  it("returns a non-empty IANA name", () => {
    const tz = getHostTimeZone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
    expect(isValidTimeZone(tz)).toBe(true);
  });
});

describe("domain/dates isValidTimeZone + resolveTimeZone", () => {
  it("accepts common abbreviations", () => {
    for (const abbr of [
      "PST", "PDT", "EST", "EDT", "CST", "CDT", "MST", "MDT", "UTC", "GMT",
    ]) {
      expect(isValidTimeZone(abbr)).toBe(true);
    }
  });

  it("accepts IANA names", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects nonsense", () => {
    expect(isValidTimeZone("XYZ")).toBe(false);
    expect(isValidTimeZone("America/NoSuchPlace")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("resolveTimeZone returns canonical IANA for abbreviations", () => {
    expect(resolveTimeZone("PST")).toBe("America/Los_Angeles");
    expect(resolveTimeZone("PDT")).toBe("America/Los_Angeles");
    expect(resolveTimeZone("EST")).toBe("America/New_York");
    expect(resolveTimeZone("UTC")).toBe("UTC");
    expect(resolveTimeZone("GMT")).toBe("UTC");
  });

  it("resolveTimeZone passes IANA names through", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("resolveTimeZone returns null for unknown", () => {
    expect(resolveTimeZone("XYZ")).toBeNull();
    expect(resolveTimeZone("Mars/OlympusMons")).toBeNull();
  });
});

describe("domain/dates utcFromLocalInTimeZone (DST-safe local -> UTC)", () => {
  it("converts UTC local exactly", () => {
    const d = utcFromLocalInTimeZone(2026, 4, 26, 15, 0, "UTC");
    expect(d.toISOString()).toBe("2026-04-26T15:00:00.000Z");
  });

  it("converts PST (winter) local at -08:00", () => {
    // January 15 2026 (PST, no DST). 15:00 PST -> 23:00 UTC.
    const d = utcFromLocalInTimeZone(
      2026, 1, 15, 15, 0, "America/Los_Angeles",
    );
    expect(d.toISOString()).toBe("2026-01-15T23:00:00.000Z");
  });

  it("converts PDT (summer) local at -07:00", () => {
    // June 15 2026 (PDT, DST active). 15:00 PDT -> 22:00 UTC.
    const d = utcFromLocalInTimeZone(
      2026, 6, 15, 15, 0, "America/Los_Angeles",
    );
    expect(d.toISOString()).toBe("2026-06-15T22:00:00.000Z");
  });

  it("converts EST (winter) local at -05:00", () => {
    const d = utcFromLocalInTimeZone(
      2026, 1, 15, 15, 0, "America/New_York",
    );
    expect(d.toISOString()).toBe("2026-01-15T20:00:00.000Z");
  });

  it("converts EDT (summer) local at -04:00", () => {
    const d = utcFromLocalInTimeZone(
      2026, 6, 15, 15, 0, "America/New_York",
    );
    expect(d.toISOString()).toBe("2026-06-15T19:00:00.000Z");
  });

  it("handles Tokyo (no DST, +09:00)", () => {
    const d = utcFromLocalInTimeZone(2026, 4, 26, 9, 0, "Asia/Tokyo");
    expect(d.toISOString()).toBe("2026-04-26T00:00:00.000Z");
  });
});

describe("domain/dates getTimeZoneOffsetMinutesAt", () => {
  it("returns 0 for UTC at any instant", () => {
    expect(getTimeZoneOffsetMinutesAt(REF_2026_04_26_SUN_NOON_UTC, "UTC")).toBe(
      0,
    );
  });

  it("returns -480 for PST in winter", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(
      getTimeZoneOffsetMinutesAt(winter, "America/Los_Angeles"),
    ).toBe(-480);
  });

  it("returns -420 for PDT in summer", () => {
    const summer = new Date("2026-06-15T12:00:00Z");
    expect(
      getTimeZoneOffsetMinutesAt(summer, "America/Los_Angeles"),
    ).toBe(-420);
  });

  it("returns -300 for EST in winter and -240 for EDT in summer", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    const summer = new Date("2026-06-15T12:00:00Z");
    expect(getTimeZoneOffsetMinutesAt(winter, "America/New_York")).toBe(-300);
    expect(getTimeZoneOffsetMinutesAt(summer, "America/New_York")).toBe(-240);
  });

  it("returns +540 for Tokyo (no DST)", () => {
    expect(
      getTimeZoneOffsetMinutesAt(REF_2026_04_26_SUN_NOON_UTC, "Asia/Tokyo"),
    ).toBe(540);
  });
});

describe("domain/dates wallClockComponents", () => {
  it("reads UTC components correctly", () => {
    const wc = wallClockComponents(REF_2026_04_26_SUN_NOON_UTC, "UTC");
    expect(wc).toEqual({ year: 2026, month: 4, day: 26, weekday: 0 });
  });

  it("reads PDT components correctly (5am Sunday)", () => {
    const wc = wallClockComponents(
      REF_2026_04_26_SUN_NOON_UTC,
      "America/Los_Angeles",
    );
    expect(wc).toEqual({ year: 2026, month: 4, day: 26, weekday: 0 });
  });

  it("reads Tokyo components correctly (Sunday 9pm)", () => {
    const wc = wallClockComponents(REF_2026_04_26_SUN_NOON_UTC, "Asia/Tokyo");
    expect(wc).toEqual({ year: 2026, month: 4, day: 26, weekday: 0 });
  });
});

// ---------------------------------------------------------------------------
// parseNaturalDate happy paths.
// ---------------------------------------------------------------------------

describe("domain/dates parseNaturalDate ISO 8601", () => {
  it("parses ISO with Z", () => {
    const r = parseNaturalDate("2026-04-26T15:00:00Z", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T15:00:00.000Z");
    expect(r.matchedPattern).toBe("iso8601_with_offset");
  });

  it("parses ISO with explicit offset", () => {
    const r = parseNaturalDate("2026-04-26T15:00:00-04:00", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T19:00:00.000Z");
  });

  it("parses date-only ISO as local end-of-day in the default TZ", () => {
    const r = parseNaturalDate("2026-04-26", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Denver",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T23:00:00.000Z");
    expect(r.matchedPattern).toBe("iso8601_local");
    expect(r.resolvedTimeZone).toBe("America/Denver");
  });

  it("parses offsetless ISO datetime as local wall-clock in the default TZ", () => {
    const r = parseNaturalDate("2026-04-26T15:00", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Denver",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T21:00:00.000Z");
    expect(r.matchedPattern).toBe("iso8601_local");
    expect(r.resolvedTimeZone).toBe("America/Denver");
  });
});

describe("domain/dates parseNaturalDate relative day words", () => {
  it("parses 'today' to end-of-day in target TZ", () => {
    const r = parseNaturalDate("today", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Los_Angeles",
    });
    if (!r.ok) throw new Error(r.reason);
    // 17:00 PDT (Apr 26 in PDT) = 00:00 UTC Apr 27.
    expect(r.date.toISOString()).toBe("2026-04-27T00:00:00.000Z");
    expect(r.matchedPattern).toBe("today+default_eod");
    expect(r.resolvedTimeZone).toBe("America/Los_Angeles");
  });

  it("parses 'tomorrow' to end-of-day next day", () => {
    const r = parseNaturalDate("tomorrow", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-27T17:00:00.000Z");
  });

  it("parses 'yesterday' to end-of-day previous day", () => {
    const r = parseNaturalDate("yesterday", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-25T17:00:00.000Z");
  });
});

describe("domain/dates parseNaturalDate weekdays", () => {
  it("parses bare 'Thursday' as the next Thursday at-or-after today", () => {
    // Reference: Sun Apr 26 2026. Next Thursday: Thu Apr 30 2026.
    const r = parseNaturalDate("Thursday", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-30T17:00:00.000Z");
    expect(r.matchedPattern).toBe("weekday_this+default_eod");
  });

  it("parses 'this Friday' as the upcoming Friday", () => {
    const r = parseNaturalDate("this Friday", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-05-01T17:00:00.000Z");
  });

  it("parses 'next Thursday' as the Thursday in the following week", () => {
    // Reference: Sun Apr 26 2026.
    // "this Thursday" = Apr 30. "next Thursday" = May 7.
    const r = parseNaturalDate("next Thursday", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-05-07T17:00:00.000Z");
  });

  it("parses 'last Sunday' as the previous Sunday (not today)", () => {
    // Reference is itself a Sunday; "last Sunday" must go back 7 days.
    const r = parseNaturalDate("last Sunday", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-19T17:00:00.000Z");
  });

  it("parses weekday + 'at <time>' combinations", () => {
    const r = parseNaturalDate("Thursday at 3pm", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-30T15:00:00.000Z");
  });

  it("parses 'tomorrow at noon' as 12:00 next day local", () => {
    const r = parseNaturalDate("tomorrow at noon", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-27T12:00:00.000Z");
  });

  it("parses 'today at end-of-day'", () => {
    const r = parseNaturalDate("today at end-of-day", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T17:00:00.000Z");
  });

  it("parses 'next Tuesday end-of-day'", () => {
    // Sun Apr 26 -> Tue Apr 28 is "this Tuesday"; "next Tuesday" = May 5.
    const r = parseNaturalDate("next Tuesday end-of-day", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-05-05T17:00:00.000Z");
  });

  it("parses 'tomorrow at 15:30' (24h time)", () => {
    const r = parseNaturalDate("tomorrow at 15:30", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-27T15:30:00.000Z");
  });
});

describe("domain/dates parseNaturalDate 'in N units'", () => {
  it("parses 'in 3 days'", () => {
    const r = parseNaturalDate("in 3 days", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-29T17:00:00.000Z");
  });

  it("parses 'in 2 weeks'", () => {
    const r = parseNaturalDate("in 2 weeks", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-05-10T17:00:00.000Z");
  });

  it("parses 'in 1 day'", () => {
    const r = parseNaturalDate("in 1 day", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-27T17:00:00.000Z");
  });
});

describe("domain/dates parseNaturalDate numeric M/D[/YYYY]", () => {
  it("parses '4/30/2026'", () => {
    const r = parseNaturalDate("4/30/2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-30T17:00:00.000Z");
  });

  it("parses '4/30' as current year", () => {
    const r = parseNaturalDate("4/30", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-30T17:00:00.000Z");
  });

  it("does NOT roll 'M/D' forward when within 6 months of reference", () => {
    // Reference: Apr 26 2026. '1/15' (Jan 15) is about 3 months back,
    // inside the 6-month threshold so it stays in 2026 (the intent is
    // "I forgot to log this" should resolve to the recent past, not
    // jump to the distant future).
    const r1 = parseNaturalDate("1/15", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r1.ok) throw new Error(r1.reason);
    expect(r1.date.getUTCFullYear()).toBe(2026);

    // '10/15' (Oct 15) is about 6 months ahead; stays in 2026.
    const r2 = parseNaturalDate("10/15", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.date.getUTCFullYear()).toBe(2026);
  });

  it("DOES roll 'M/D' forward when more than 6 months in the past", () => {
    // Reference: Sep 15 2026. Phrase '1/15' resolves first to Jan 15
    // 2026 (~243 days back, > 180-day threshold) so it rolls to
    // Jan 15 2027.
    const refSep15 = new Date("2026-09-15T17:00:00Z");
    const r = parseNaturalDate("1/15", {
      referenceTime: refSep15,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.getUTCFullYear()).toBe(2027);
    expect(r.date.toISOString()).toBe("2027-01-15T17:00:00.000Z");
  });
});

describe("domain/dates parseNaturalDate month-name dates (ISS-004)", () => {
  it("parses full month name with comma 'June 27, 2026'", () => {
    const r = parseNaturalDate("June 27, 2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-06-27T17:00:00.000Z");
    expect(r.matchedPattern).toBe("month_name+default_eod");
  });

  it("parses 3-letter abbreviation 'Jun 27 2026'", () => {
    const r = parseNaturalDate("Jun 27 2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-06-27T17:00:00.000Z");
  });

  it("parses lowercase 'june 27, 2026'", () => {
    const r = parseNaturalDate("june 27, 2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-06-27T17:00:00.000Z");
  });

  it("parses no-comma form 'June 27 2026'", () => {
    const r = parseNaturalDate("June 27 2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-06-27T17:00:00.000Z");
  });

  it("tolerates extra whitespace 'June   27 ,  2026'", () => {
    const r = parseNaturalDate("June   27 ,  2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-06-27T17:00:00.000Z");
  });

  it("parses no-year 'June 27' as the upcoming June 27 (stays this year)", () => {
    // Reference: Apr 26 2026. June 27 2026 is in the future, so no roll.
    const r = parseNaturalDate("June 27", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-06-27T17:00:00.000Z");
    expect(r.matchedPattern).toBe("month_name+default_eod");
  });

  it("rolls no-year 'January 15' forward when more than 6 months past", () => {
    // Reference: Sep 15 2026. Jan 15 2026 is ~243 days back (> 180-day
    // threshold) so it rolls forward to Jan 15 2027, matching the
    // numeric M/D branch behavior.
    const refSep15 = new Date("2026-09-15T17:00:00Z");
    const r = parseNaturalDate("January 15", {
      referenceTime: refSep15,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.getUTCFullYear()).toBe(2027);
    expect(r.date.toISOString()).toBe("2027-01-15T17:00:00.000Z");
  });

  it("does NOT roll no-year 'February 1' forward when within 6 months past", () => {
    // Reference: Apr 26 2026. Feb 1 2026 is ~84 days back (< 180-day
    // threshold) so it stays in 2026.
    const r = parseNaturalDate("February 1", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.getUTCFullYear()).toBe(2026);
    expect(r.date.toISOString()).toBe("2026-02-01T17:00:00.000Z");
  });

  it("honors the resolved timezone for month-name dates", () => {
    // June 27 2026 at default end-of-day (17:00) in Denver (MDT, -06:00)
    // = 23:00 UTC.
    const r = parseNaturalDate("June 27, 2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Denver",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-06-27T23:00:00.000Z");
    expect(r.resolvedTimeZone).toBe("America/Denver");
  });

  it("honors an inline TZ override on a month-name date", () => {
    // June 27 2026 17:00 EDT (-04:00) = 21:00 UTC.
    const r = parseNaturalDate("June 27, 2026 EST", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.resolvedTimeZone).toBe("America/New_York");
    expect(r.date.toISOString()).toBe("2026-06-27T21:00:00.000Z");
  });

  it("rejects an unknown month word 'Smarch 5 2026'", () => {
    const r = parseNaturalDate("Smarch 5 2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/could not parse date phrase/);
  });

  it("rejects an out-of-range day 'June 45, 2026'", () => {
    const r = parseNaturalDate("June 45, 2026", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid month-name date/);
  });
});

// ---------------------------------------------------------------------------
// THE CRITICAL TZ-OVERRIDE TESTS (per Appendix H.8.2 acceptance).
// ---------------------------------------------------------------------------

describe("domain/dates parseNaturalDate inline TZ override (per H.8.2)", () => {
  it("'Thursday at 3pm' yields different UTC under PST vs EST default TZs", () => {
    const pst = parseNaturalDate("Thursday at 3pm", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Los_Angeles",
    });
    const est = parseNaturalDate("Thursday at 3pm", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/New_York",
    });
    if (!pst.ok) throw new Error(pst.reason);
    if (!est.ok) throw new Error(est.reason);
    // April 30 2026 is in PDT (-07:00) and EDT (-04:00).
    expect(pst.date.toISOString()).toBe("2026-04-30T22:00:00.000Z");
    expect(est.date.toISOString()).toBe("2026-04-30T19:00:00.000Z");
    // Three-hour delta between Pacific and Eastern.
    expect(pst.date.getTime() - est.date.getTime()).toBe(3 * 3_600_000);
  });

  it("'3pm EST Thursday' overrides default TZ", () => {
    // Default is PST but inline EST should win.
    const r = parseNaturalDate("3pm EST Thursday", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Los_Angeles",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.resolvedTimeZone).toBe("America/New_York");
    expect(r.date.toISOString()).toBe("2026-04-30T19:00:00.000Z");
  });

  it("'Thursday at 3pm America/New_York' uses inline IANA name", () => {
    const r = parseNaturalDate("Thursday at 3pm America/New_York", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Los_Angeles",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.resolvedTimeZone).toBe("America/New_York");
    expect(r.date.toISOString()).toBe("2026-04-30T19:00:00.000Z");
  });

  it("'tomorrow at 9am UTC' explicitly forces UTC", () => {
    const r = parseNaturalDate("tomorrow at 9am UTC", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "America/Los_Angeles",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.resolvedTimeZone).toBe("UTC");
    expect(r.date.toISOString()).toBe("2026-04-27T09:00:00.000Z");
  });

  it("DST-aware: 'Monday at 3pm PST' on a date when DST is active uses -07:00", () => {
    // Reference: Mon Mar 9 2026 (after DST forward). "Monday at 3pm" is
    // today (Mon) at 15:00 PDT = 22:00 UTC.
    const r = parseNaturalDate("Monday at 3pm PST", {
      referenceTime: REF_2026_03_09_MON_AFTER_DST,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-03-09T22:00:00.000Z");
  });

  it("DST-aware: 'Wednesday at 3pm PST' after DST ends uses -08:00", () => {
    // Reference: Wed Nov 4 2026 (after DST back). "Wednesday at 3pm" is
    // today (Wed) at 15:00 PST = 23:00 UTC.
    const r = parseNaturalDate("Wednesday at 3pm PST", {
      referenceTime: REF_2026_11_04_WED_AFTER_DST,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-11-04T23:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Bare time and time keywords.
// ---------------------------------------------------------------------------

describe("domain/dates parseNaturalDate bare time", () => {
  it("'3pm' alone resolves to today at 15:00 in default TZ", () => {
    const r = parseNaturalDate("3pm", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T15:00:00.000Z");
  });

  it("'noon' alone resolves to today at 12:00", () => {
    const r = parseNaturalDate("noon", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T12:00:00.000Z");
  });

  it("'15:30' alone resolves to today at 15:30", () => {
    const r = parseNaturalDate("15:30", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.date.toISOString()).toBe("2026-04-26T15:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

describe("domain/dates parseNaturalDate errors", () => {
  it("rejects empty phrase", () => {
    const r = parseNaturalDate("", { defaultTimeZone: "UTC" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
  });

  it("rejects whitespace-only phrase", () => {
    const r = parseNaturalDate("   \t  ", { defaultTimeZone: "UTC" });
    expect(r.ok).toBe(false);
  });

  it("rejects gibberish", () => {
    const r = parseNaturalDate("foobar quux", { defaultTimeZone: "UTC" });
    expect(r.ok).toBe(false);
  });

  it("rejects bad time component", () => {
    const r = parseNaturalDate("Thursday at 25pm", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown inline TZ abbreviation gracefully", () => {
    // "XYZ" looks like an abbreviation token but is not in the map;
    // it gets treated as a date-text token and fails at date parse.
    const r = parseNaturalDate("Thursday at 3pm XYZ", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "UTC",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown explicit defaultTimeZone", () => {
    const r = parseNaturalDate("Thursday at 3pm Mars/Olympus", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
      defaultTimeZone: "Mars/OlympusMons",
    });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default-TZ-from-host behavior.
// ---------------------------------------------------------------------------

describe("domain/dates parseNaturalDate default TZ behavior", () => {
  it("falls back to host TZ when defaultTimeZone is omitted", () => {
    const r = parseNaturalDate("tomorrow at noon", {
      referenceTime: REF_2026_04_26_SUN_NOON_UTC,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.resolvedTimeZone).toBe(getHostTimeZone());
  });
});

// ---------------------------------------------------------------------------
// Business-day math (ISS-008): weekend detection + default due-date helper.
// Calendar anchor: 2026-04-26 is a Sunday, so 04-27 Mon ... 05-03 Sun.
// ---------------------------------------------------------------------------

describe("domain/dates isWeekendInTz", () => {
  it("returns true for Saturday and Sunday, false for weekdays", () => {
    expect(isWeekendInTz(new Date("2026-04-25T12:00:00Z"), "UTC")).toBe(true); // Sat
    expect(isWeekendInTz(new Date("2026-04-26T12:00:00Z"), "UTC")).toBe(true); // Sun
    expect(isWeekendInTz(new Date("2026-04-27T12:00:00Z"), "UTC")).toBe(false); // Mon
    expect(isWeekendInTz(new Date("2026-05-01T12:00:00Z"), "UTC")).toBe(false); // Fri
  });

  it("is timezone-sensitive at the day boundary", () => {
    // 02:00Z Monday is still Sunday 22:00 in New York (EDT, -04:00).
    const instant = new Date("2026-04-27T02:00:00Z");
    expect(isWeekendInTz(instant, "UTC")).toBe(false); // Monday in UTC
    expect(isWeekendInTz(instant, "America/New_York")).toBe(true); // Sunday in NY
  });
});

describe("domain/dates addBusinessDaysInTz", () => {
  it("defaults to 3 business days", () => {
    expect(DEFAULT_DUE_BUSINESS_DAYS).toBe(3);
  });

  it("+3 business days from a Monday lands on Thursday at 17:00 local (UTC)", () => {
    const result = addBusinessDaysInTz(new Date("2026-04-27T09:00:00Z"), 3, "UTC");
    expect(result.toISOString()).toBe("2026-04-30T17:00:00.000Z");
  });

  it("+3 business days from a Friday skips the weekend to Wednesday", () => {
    const result = addBusinessDaysInTz(new Date("2026-05-01T09:00:00Z"), 3, "UTC");
    expect(result.toISOString()).toBe("2026-05-06T17:00:00.000Z");
  });

  it("+3 business days from a Saturday lands on the following Wednesday", () => {
    const result = addBusinessDaysInTz(new Date("2026-05-02T09:00:00Z"), 3, "UTC");
    expect(result.toISOString()).toBe("2026-05-06T17:00:00.000Z");
  });

  it("+1 business day from a Friday rolls to Monday", () => {
    const result = addBusinessDaysInTz(new Date("2026-05-01T09:00:00Z"), 1, "UTC");
    expect(result.toISOString()).toBe("2026-05-04T17:00:00.000Z");
  });

  it("never returns a weekend, regardless of the starting weekday", () => {
    for (let d = 27; d <= 31; d++) {
      const ref = new Date(`2026-04-${d}T09:00:00Z`);
      const result = addBusinessDaysInTz(ref, 3, "UTC");
      expect(isWeekendInTz(result, "UTC")).toBe(false);
    }
    for (const day of ["2026-05-02", "2026-05-03"]) {
      const result = addBusinessDaysInTz(new Date(`${day}T09:00:00Z`), 3, "UTC");
      expect(isWeekendInTz(result, "UTC")).toBe(false);
    }
  });

  it("anchors to 17:00 in the target timezone (America/New_York)", () => {
    const result = addBusinessDaysInTz(
      new Date("2026-04-27T09:00:00Z"),
      3,
      "America/New_York",
    );
    // Thursday Apr 30 at 17:00 EDT (-04:00) = 21:00 UTC.
    expect(result.toISOString()).toBe("2026-04-30T21:00:00.000Z");
    const wc = wallClockComponents(result, "America/New_York");
    expect({ year: wc.year, month: wc.month, day: wc.day }).toEqual({
      year: 2026,
      month: 4,
      day: 30,
    });
    expect(isWeekendInTz(result, "America/New_York")).toBe(false);
  });
});
