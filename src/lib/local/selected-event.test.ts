import { describe, expect, it } from "vitest";
import type { AppEvent } from "@/lib/external/schemas";
import { parseSelectedEvent, serializeSelectedEvent } from "./selected-event";

const event: AppEvent = {
  key: "2026casj",
  name: "Silicon Valley Regional",
  year: 2026,
  startDate: "2026-03-05",
  endDate: "2026-03-08",
  city: "San Jose",
  stateProv: "CA",
  country: "USA",
};

describe("selected event storage", () => {
  it("round-trips an event", () => {
    expect(parseSelectedEvent(serializeSelectedEvent(event))).toEqual(event);
  });

  it("round-trips an event with null fields", () => {
    const sparse: AppEvent = { ...event, startDate: null, endDate: null, city: null, stateProv: null, country: null };
    expect(parseSelectedEvent(serializeSelectedEvent(sparse))).toEqual(sparse);
  });

  it("returns null for missing values", () => {
    expect(parseSelectedEvent(null)).toBeNull();
    expect(parseSelectedEvent("")).toBeNull();
  });

  it("returns null (never throws) for corrupted or malicious values", () => {
    for (const raw of [
      "not json",
      "{",
      "null",
      "42",
      '"a string"',
      "[]",
      "{}",
      '{"version":1}',
      '{"version":1,"event":null}',
      '{"version":1,"event":{"key":"2026casj"}}', // missing required fields
      JSON.stringify({ version: 1, event: { ...event, year: "2026" } }), // wrong type
      JSON.stringify({ version: 1, event: { ...event, name: 7 } }),
    ]) {
      expect(() => parseSelectedEvent(raw), raw).not.toThrow();
      expect(parseSelectedEvent(raw), raw).toBeNull();
    }
  });

  it("rejects an unknown future version instead of misreading it", () => {
    expect(parseSelectedEvent(JSON.stringify({ version: 2, event }))).toBeNull();
  });

  it("drops unexpected extra properties", () => {
    const withExtra = JSON.stringify({ version: 1, event: { ...event, evil: "<script>" } });
    expect(parseSelectedEvent(withExtra)).toEqual(event);
  });
});
