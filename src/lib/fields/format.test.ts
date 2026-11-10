import { describe, expect, it } from "vitest";
import { formatAnswer } from "./format";
import type { DropdownField, FieldDefinition, NumberField, TextField, YesNoField } from "./types";

const base = { id: "f", name: "F", section: "specs" as const, sortOrder: 0, archived: false };
const number: NumberField = { ...base, type: "number", higherIsBetter: true, goodThreshold: null, badThreshold: null };
const yesNo: YesNoField = { ...base, type: "yes_no", goodAnswer: true };
const dropdown: DropdownField = {
  ...base,
  type: "dropdown",
  options: [{ value: "swerve", label: "Swerve", tone: "good" }],
};
const text: TextField = { ...base, type: "text" };

describe("formatAnswer", () => {
  it("formats numbers without trailing zeros or float noise", () => {
    expect(formatAnswer(number, 115)).toBe("115");
    expect(formatAnswer(number, 7.5)).toBe("7.5");
    expect(formatAnswer(number, 0.1 + 0.2)).toBe("0.3");
    expect(formatAnswer(number, -3)).toBe("-3");
  });

  it("shows 0 (a real answer) as '0'", () => {
    expect(formatAnswer(number, 0)).toBe("0");
  });

  it("understands numeric strings but not junk", () => {
    expect(formatAnswer(number, " 12 ")).toBe("12");
    expect(formatAnswer(number, "lots")).toBeNull();
    expect(formatAnswer(number, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("formats yes/no, including `false`", () => {
    expect(formatAnswer(yesNo, true)).toBe("Yes");
    expect(formatAnswer(yesNo, false)).toBe("No");
  });

  it("shows a dropdown's CURRENT label, so renames update old data", () => {
    expect(formatAnswer(dropdown, "swerve")).toBe("Swerve");
    const renamed: DropdownField = { ...dropdown, options: [{ value: "swerve", label: "Swerve Drive", tone: "good" }] };
    expect(formatAnswer(renamed, "swerve")).toBe("Swerve Drive");
  });

  it("returns null for a dropdown answer whose option was removed", () => {
    expect(formatAnswer(dropdown, "gone")).toBeNull();
  });

  it("trims text", () => {
    expect(formatAnswer(text, "  two motors  ")).toBe("two motors");
  });

  it("returns null for no answer, for every type", () => {
    for (const f of [number, yesNo, dropdown, text] as FieldDefinition[]) {
      for (const empty of [undefined, null, "", "  ", Number.NaN]) {
        expect(formatAnswer(f, empty as never), `${f.type}:${String(empty)}`).toBeNull();
      }
    }
  });

  it("returns null (never throws) for a value of the wrong type", () => {
    expect(formatAnswer(yesNo, "yes")).toBeNull();
    expect(formatAnswer(yesNo, 1)).toBeNull();
    expect(formatAnswer(dropdown, 3)).toBeNull();
    expect(formatAnswer(text, 3)).toBeNull();
    expect(formatAnswer(text, true)).toBeNull();
  });
});
