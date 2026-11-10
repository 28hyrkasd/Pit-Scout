import { describe, expect, it } from "vitest";
import { rateNumber } from "./colors";
import { sampleNumbers } from "./preview";

const f = (higherIsBetter: boolean, goodThreshold: string, badThreshold: string) => ({ higherIsBetter, goodThreshold, badThreshold });

describe("sampleNumbers", () => {
  it("is empty when no thresholds are set (nothing to preview)", () => {
    expect(sampleNumbers(f(true, "", ""))).toEqual([]);
    expect(sampleNumbers(f(true, "  ", ""))).toEqual([]);
  });

  it("ignores unparseable thresholds instead of throwing", () => {
    expect(sampleNumbers(f(true, "abc", ""))).toEqual([]);
    expect(sampleNumbers(f(true, "abc", "5")).length).toBeGreaterThan(0);
  });

  it("includes both thresholds themselves, so inclusive edges are visible", () => {
    const s = sampleNumbers(f(true, "10", "2"));
    expect(s).toContain(10);
    expect(s).toContain(2);
  });

  it("is sorted ascending with no duplicates", () => {
    for (const args of [f(true, "10", "2"), f(false, "110", "125"), f(true, "5", ""), f(false, "", "3")]) {
      const s = sampleNumbers(args);
      expect(s).toEqual([...s].sort((a, b) => a - b));
      expect(new Set(s).size).toBe(s.length);
    }
  });

  it("covers every rating when both thresholds are set (higher is better)", () => {
    const ratings = new Set(sampleNumbers(f(true, "10", "2")).map((n) => rateNumber(n, true, 10, 2)));
    expect(ratings).toEqual(new Set(["good", "neutral", "bad"]));
  });

  it("covers every rating when both thresholds are set (lower is better)", () => {
    const ratings = new Set(sampleNumbers(f(false, "110", "125")).map((n) => rateNumber(n, false, 110, 125)));
    expect(ratings).toEqual(new Set(["good", "neutral", "bad"]));
  });

  it("shows a green and a not-green sample with only a good threshold", () => {
    const ratings = new Set(sampleNumbers(f(true, "10", "")).map((n) => rateNumber(n, true, 10, null)));
    expect(ratings.has("good")).toBe(true);
    expect(ratings.has("neutral")).toBe(true);
  });

  it("shows a red and a not-red sample with only a bad threshold", () => {
    const ratings = new Set(sampleNumbers(f(true, "", "2")).map((n) => rateNumber(n, true, null, 2)));
    expect(ratings.has("bad")).toBe(true);
    expect(ratings.has("neutral")).toBe(true);
  });

  it("works for a single threshold of 0 and for negatives", () => {
    expect(sampleNumbers(f(true, "0", "")).length).toBeGreaterThan(1);
    expect(sampleNumbers(f(false, "", "-4")).length).toBeGreaterThan(1);
  });

  it("does not produce float noise", () => {
    for (const n of sampleNumbers(f(true, "0.3", "0.1"))) expect(String(n).length).toBeLessThan(12);
  });
});
