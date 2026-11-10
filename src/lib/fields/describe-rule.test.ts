import { describe, expect, it } from "vitest";
import { describeRule } from "@/components/fields/field-row";
import type { DropdownField, NumberField, TextField, YesNoField } from "./types";

const base = { id: "f", name: "F", section: "specs" as const, sortOrder: 0, archived: false };
const num = (over: Partial<NumberField>): NumberField => ({ ...base, type: "number", higherIsBetter: true, goodThreshold: null, badThreshold: null, ...over });

describe("describeRule", () => {
  it("describes higher-is-better thresholds with the right comparison signs", () => {
    expect(describeRule(num({ goodThreshold: 10, badThreshold: 2 }))).toBe("higher is better · green ≥ 10, red ≤ 2");
  });

  it("describes lower-is-better thresholds with the right comparison signs", () => {
    expect(describeRule(num({ higherIsBetter: false, goodThreshold: 110, badThreshold: 125 }))).toBe(
      "lower is better · green ≤ 110, red ≥ 125",
    );
  });

  it("describes a single threshold", () => {
    expect(describeRule(num({ goodThreshold: 10 }))).toBe("higher is better · green ≥ 10");
    expect(describeRule(num({ badThreshold: 2 }))).toBe("higher is better · red ≤ 2");
  });

  it("shows a threshold of 0 (does not treat it as unset)", () => {
    expect(describeRule(num({ goodThreshold: 0 }))).toBe("higher is better · green ≥ 0");
  });

  it("says 'Not colored' when no thresholds are set", () => {
    expect(describeRule(num({}))).toBe("Not colored");
  });

  it("describes yes/no", () => {
    const f = (goodAnswer: boolean | null): YesNoField => ({ ...base, type: "yes_no", goodAnswer });
    expect(describeRule(f(true))).toBe("Yes is good");
    expect(describeRule(f(false))).toBe("No is good");
    expect(describeRule(f(null))).toBe("Not colored");
  });

  it("summarizes dropdown tones", () => {
    const f: DropdownField = {
      ...base,
      type: "dropdown",
      options: [
        { value: "a", label: "A", tone: "good" },
        { value: "b", label: "B", tone: "good" },
        { value: "c", label: "C", tone: "neutral" },
        { value: "d", label: "D", tone: "bad" },
      ],
    };
    expect(describeRule(f)).toBe("4 choices · 2 good, 1 okay, 1 bad");
  });

  it("describes text", () => {
    const f: TextField = { ...base, type: "text" };
    expect(describeRule(f)).toBe("Free text");
  });
});
