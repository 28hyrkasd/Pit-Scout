import { describe, expect, it } from "vitest";
import { formatEventDates, formatEventLocation } from "./format-event";

describe("formatEventDates", () => {
  it("formats a range within one month", () => {
    expect(formatEventDates({ startDate: "2026-03-05", endDate: "2026-03-08" })).toBe("Mar 5-8, 2026");
  });

  it("formats a range across months", () => {
    expect(formatEventDates({ startDate: "2026-02-28", endDate: "2026-03-02" })).toBe("Feb 28 - Mar 2, 2026");
  });

  it("formats a range across years", () => {
    expect(formatEventDates({ startDate: "2026-12-30", endDate: "2027-01-02" })).toBe("Dec 30, 2026 - Jan 2, 2027");
  });

  it("formats a single-day event, with or without an end date", () => {
    expect(formatEventDates({ startDate: "2026-03-05", endDate: "2026-03-05" })).toBe("Mar 5, 2026");
    expect(formatEventDates({ startDate: "2026-03-05", endDate: null })).toBe("Mar 5, 2026");
  });

  // Guards against `new Date("2026-03-01")`, which is UTC midnight and so reads as
  // Feb 28 in US timezones. Node fixes TZ at startup, so this only proves anything
  // when run under a non-UTC zone: use `npm run test:tz` (CI-safe, deterministic).
  it("does not shift the day by timezone (no Date parsing of yyyy-mm-dd)", () => {
    expect(formatEventDates({ startDate: "2026-03-01", endDate: "2026-03-01" })).toBe("Mar 1, 2026");
    expect(formatEventDates({ startDate: "2026-03-01", endDate: "2026-03-03" })).toBe("Mar 1-3, 2026");
  });

  it("returns an empty string for missing or malformed dates", () => {
    expect(formatEventDates({ startDate: null, endDate: null })).toBe("");
    expect(formatEventDates({ startDate: "soon", endDate: null })).toBe("");
    expect(formatEventDates({ startDate: "2026-13-40", endDate: null })).toBe("");
  });
});

describe("formatEventLocation", () => {
  it("joins the parts that exist", () => {
    expect(formatEventLocation({ city: "San Jose", stateProv: "CA", country: "USA" })).toBe("San Jose, CA, USA");
    expect(formatEventLocation({ city: null, stateProv: "CA", country: "USA" })).toBe("CA, USA");
    expect(formatEventLocation({ city: null, stateProv: null, country: null })).toBe("");
  });
});
