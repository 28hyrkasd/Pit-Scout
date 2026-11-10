import { describe, expect, it } from "vitest";
import { MAX_EVENT_RESULTS, searchEvents } from "./event-search";
import type { AppEvent } from "./schemas";

const ev = (key: string, name: string, city: string | null = null, stateProv: string | null = null): AppEvent => ({
  key,
  name,
  year: 2026,
  startDate: null,
  endDate: null,
  city,
  stateProv,
  country: "USA",
});

const events = [
  ev("2026casj", "Silicon Valley Regional", "San Jose", "CA"),
  ev("2026cala", "Los Angeles Regional", "Los Angeles", "CA"),
  ev("2026txhou", "FIT District Houston Event", "Houston", "TX"),
  ev("2026orore", "PNW District Oregon City Event", "Oregon City", "OR"),
];

const keys = (list: AppEvent[]) => list.map((e) => e.key);

describe("searchEvents", () => {
  it("matches on name, case-insensitively", () => {
    expect(keys(searchEvents(events, "silicon"))).toEqual(["2026casj"]);
    expect(keys(searchEvents(events, "SILICON VALLEY"))).toEqual(["2026casj"]);
  });

  it("matches on event key", () => {
    expect(keys(searchEvents(events, "2026casj"))).toEqual(["2026casj"]);
    expect(keys(searchEvents(events, "casj"))).toEqual(["2026casj"]);
  });

  it("matches on city and state", () => {
    expect(keys(searchEvents(events, "houston"))).toEqual(["2026txhou"]);
    expect(keys(searchEvents(events, "ca"))).toContain("2026cala");
  });

  it("requires every word to match (AND), in any order", () => {
    expect(keys(searchEvents(events, "regional ca"))).toEqual(["2026casj", "2026cala"]);
    expect(keys(searchEvents(events, "regional tx"))).toEqual([]);
    expect(keys(searchEvents(events, "valley silicon"))).toEqual(["2026casj"]);
  });

  it("ignores extra whitespace", () => {
    expect(keys(searchEvents(events, "   silicon    valley  "))).toEqual(["2026casj"]);
  });

  it("returns everything (capped) for an empty or blank query, preserving order", () => {
    expect(keys(searchEvents(events, ""))).toEqual(keys(events));
    expect(keys(searchEvents(events, "   "))).toEqual(keys(events));
  });

  it("returns nothing when nothing matches", () => {
    expect(searchEvents(events, "zzzz")).toEqual([]);
  });

  it("caps the number of results", () => {
    const many = Array.from({ length: 100 }, (_, i) => ev(`2026x${i}`, `Event ${i}`));
    expect(searchEvents(many, "").length).toBe(MAX_EVENT_RESULTS);
    expect(searchEvents(many, "event").length).toBe(MAX_EVENT_RESULTS);
    expect(searchEvents(many, "event", 5).length).toBe(5);
  });

  it("copes with events that have null location fields", () => {
    expect(keys(searchEvents([ev("2026aaa", "Nowhere Event")], "nowhere"))).toEqual(["2026aaa"]);
  });
});
