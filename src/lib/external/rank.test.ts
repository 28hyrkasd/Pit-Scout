import { describe, expect, it } from "vitest";
import { rankDescending } from "./rank";

// Look ranks up by key in INPUT order (as real callers do). Map iteration order
// is insertion order, which is rank order, so it must not be used for assertions.
const ranks = (values: (number | null)[]) => {
  const result = rankDescending(values.map((value, key) => ({ key, value })));
  return values.map((_, key) => result.get(key));
};

describe("rankDescending", () => {
  it("ranks highest value as 1", () => {
    expect(ranks([10, 30, 20])).toEqual([3, 1, 2]);
  });

  it("gives ties the same rank and skips the next (1224)", () => {
    expect(ranks([50, 40, 40, 30])).toEqual([1, 2, 2, 4]);
  });

  it("handles a three-way tie at the top", () => {
    expect(ranks([9, 9, 9, 1])).toEqual([1, 1, 1, 4]);
  });

  it("leaves null values unranked and does not let them shift others", () => {
    expect(ranks([null, 20, null, 10])).toEqual([null, 1, null, 2]);
  });

  it("returns an empty map for no entries and all-null for no data", () => {
    expect(rankDescending([]).size).toBe(0);
    expect(ranks([null, null])).toEqual([null, null]);
  });

  it("treats negative EPA correctly (lower is worse)", () => {
    expect(ranks([-1, 5, -10])).toEqual([2, 1, 3]);
  });

  it("ignores NaN/Infinity instead of ranking them", () => {
    expect(ranks([Number.NaN, 4, Number.POSITIVE_INFINITY, 2])).toEqual([null, 1, null, 2]);
  });
});
