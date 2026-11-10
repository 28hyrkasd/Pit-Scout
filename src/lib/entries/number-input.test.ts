import { describe, expect, it } from "vitest";
import { parseNumberInput } from "./number-input";

describe("parseNumberInput", () => {
  it("treats blank input as empty, not zero", () => {
    expect(parseNumberInput("")).toEqual({ kind: "empty" });
    expect(parseNumberInput("   ")).toEqual({ kind: "empty" });
  });

  it("keeps zero as a real answer", () => {
    expect(parseNumberInput("0")).toEqual({ kind: "ok", value: 0 });
    expect(parseNumberInput("0.0")).toEqual({ kind: "ok", value: 0 });
    expect(parseNumberInput("-0")).toEqual({ kind: "ok", value: 0 });
    expect(
      Object.is((parseNumberInput("-0") as { value: number }).value, -0),
    ).toBe(false);
  });

  it("parses integers, decimals and negatives", () => {
    expect(parseNumberInput("12")).toEqual({ kind: "ok", value: 12 });
    expect(parseNumberInput(" 7.5 ")).toEqual({ kind: "ok", value: 7.5 });
    expect(parseNumberInput(".5")).toEqual({ kind: "ok", value: 0.5 });
    expect(parseNumberInput("5.")).toEqual({ kind: "ok", value: 5 });
    expect(parseNumberInput("-3")).toEqual({ kind: "ok", value: -3 });
  });

  it("accepts a decimal comma (phone keyboards)", () => {
    expect(parseNumberInput("7,5")).toEqual({ kind: "ok", value: 7.5 });
  });

  it.each([
    "abc",
    "1e5",
    "1e999",
    "Infinity",
    "NaN",
    "0x10",
    "1,2,3",
    "1,234.5",
    "--1",
    "1.2.3",
    "12abc",
    "1 2",
    "-",
    ".",
  ])("rejects %j", (text) => {
    expect(parseNumberInput(text)).toEqual({ kind: "invalid" });
  });

  it("rejects absurdly large numbers (a typo, not a measurement)", () => {
    expect(parseNumberInput("1000000000")).toEqual({ kind: "invalid" });
    expect(parseNumberInput("999999999")).toEqual({
      kind: "ok",
      value: 999999999,
    });
  });
});
