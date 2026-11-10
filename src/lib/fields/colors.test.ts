import { describe, expect, it } from "vitest";
import { isEmpty, rateAnswer, rateNumber } from "./colors";
import type { DropdownField, FieldDefinition, NumberField, TextField, YesNoField } from "./types";

const base = { id: "f1", name: "Field", section: "specs" as const, sortOrder: 0, archived: false };

const number = (over: Partial<NumberField> = {}): NumberField => ({
  ...base,
  type: "number",
  higherIsBetter: true,
  goodThreshold: 10,
  badThreshold: 2,
  ...over,
});
const yesNo = (goodAnswer: boolean | null): YesNoField => ({ ...base, type: "yes_no", goodAnswer });
const dropdown = (): DropdownField => ({
  ...base,
  type: "dropdown",
  options: [
    { value: "swerve", label: "Swerve", tone: "good" },
    { value: "tank", label: "Tank", tone: "neutral" },
    { value: "mecanum", label: "Mecanum", tone: "bad" },
  ],
});
const text = (): TextField => ({ ...base, type: "text" });

describe("number fields, higher is better (good >= 10, bad <= 2)", () => {
  const f = number();
  it.each([
    [10, "good"], // exactly on the good threshold: inclusive
    [11, "good"],
    [100, "good"],
    [9.99, "neutral"],
    [5, "neutral"],
    [2.01, "neutral"],
    [2, "bad"], // exactly on the bad threshold: inclusive
    [1, "bad"],
    [-5, "bad"],
  ])("%s -> %s", (value, expected) => {
    expect(rateAnswer(f, value)).toBe(expected);
  });
});

describe("number fields, lower is better (good <= 110, bad >= 125)", () => {
  const f = number({ higherIsBetter: false, goodThreshold: 110, badThreshold: 125 });
  it.each([
    [90, "good"],
    [110, "good"], // inclusive
    [110.5, "neutral"],
    [120, "neutral"],
    [124.9, "neutral"],
    [125, "bad"], // inclusive
    [140, "bad"],
  ])("%s -> %s", (value, expected) => {
    expect(rateAnswer(f, value)).toBe(expected);
  });
});

describe("number fields with only one threshold", () => {
  it("only a good threshold: never red", () => {
    const f = number({ goodThreshold: 10, badThreshold: null });
    expect(rateAnswer(f, 50)).toBe("good");
    expect(rateAnswer(f, 5)).toBe("neutral");
    expect(rateAnswer(f, -1000)).toBe("neutral");
  });

  it("only a bad threshold: never green", () => {
    const f = number({ goodThreshold: null, badThreshold: 2 });
    expect(rateAnswer(f, 1)).toBe("bad");
    expect(rateAnswer(f, 3)).toBe("neutral");
    expect(rateAnswer(f, 1000)).toBe("neutral");
  });

  it("no thresholds at all: any number is neutral (still shows data, never colored)", () => {
    const f = number({ goodThreshold: null, badThreshold: null });
    expect(rateAnswer(f, 0)).toBe("neutral");
    expect(rateAnswer(f, 999)).toBe("neutral");
  });

  it("only a good threshold, lower is better", () => {
    const f = number({ higherIsBetter: false, goodThreshold: 8, badThreshold: null });
    expect(rateAnswer(f, 8)).toBe("good");
    expect(rateAnswer(f, 20)).toBe("neutral");
  });
});

describe("zero and negative numbers are real answers, not 'no data'", () => {
  it("0 is rated, not gray", () => {
    expect(rateAnswer(number({ goodThreshold: 10, badThreshold: 2 }), 0)).toBe("bad");
    expect(rateAnswer(number({ higherIsBetter: false, goodThreshold: 0, badThreshold: 5 }), 0)).toBe("good");
    expect(rateAnswer(number({ goodThreshold: null, badThreshold: null }), 0)).toBe("neutral");
  });

  it("negative values are rated", () => {
    expect(rateAnswer(number({ goodThreshold: null, badThreshold: -1 }), -3)).toBe("bad");
  });
});

describe("thresholds recolor existing data (colors are never stored)", () => {
  it("the same stored answer changes color when the thresholds change", () => {
    const stored = 8;
    expect(rateAnswer(number({ goodThreshold: 10, badThreshold: 2 }), stored)).toBe("neutral");
    expect(rateAnswer(number({ goodThreshold: 7, badThreshold: 2 }), stored)).toBe("good");
    expect(rateAnswer(number({ goodThreshold: 20, badThreshold: 9 }), stored)).toBe("bad");
  });

  it("flipping higherIsBetter flips the meaning of the same thresholds", () => {
    expect(rateNumber(12, true, 10, 2)).toBe("good");
    expect(rateNumber(12, false, 2, 10)).toBe("bad");
  });
});

describe("overlapping thresholds (should be prevented by validation, but must not mislead)", () => {
  it("bad wins when a value satisfies both", () => {
    expect(rateNumber(5, true, 5, 5)).toBe("bad");
    expect(rateNumber(5, false, 5, 5)).toBe("bad");
  });
});

describe("yes/no fields", () => {
  it("'yes is good'", () => {
    expect(rateAnswer(yesNo(true), true)).toBe("good");
    expect(rateAnswer(yesNo(true), false)).toBe("bad");
  });

  it("'no is good' (e.g. 'needs repairs')", () => {
    expect(rateAnswer(yesNo(false), false)).toBe("good");
    expect(rateAnswer(yesNo(false), true)).toBe("bad");
  });

  it("no configured good answer: both answers are neutral", () => {
    expect(rateAnswer(yesNo(null), true)).toBe("neutral");
    expect(rateAnswer(yesNo(null), false)).toBe("neutral");
  });

  it("`false` is a real answer, not 'no data'", () => {
    expect(rateAnswer(yesNo(true), false)).not.toBe("none");
    expect(rateAnswer(yesNo(null), false)).not.toBe("none");
  });

  it("changing which answer is good recolors the same stored answer", () => {
    expect(rateAnswer(yesNo(true), true)).toBe("good");
    expect(rateAnswer(yesNo(false), true)).toBe("bad");
  });
});

describe("dropdown fields", () => {
  const f = dropdown();
  it("uses the tone of the selected option", () => {
    expect(rateAnswer(f, "swerve")).toBe("good");
    expect(rateAnswer(f, "tank")).toBe("neutral");
    expect(rateAnswer(f, "mecanum")).toBe("bad");
  });

  it("an option that no longer exists is gray, not a crash", () => {
    expect(rateAnswer(f, "removed-option")).toBe("none");
  });

  it("matches the stored value, not the label", () => {
    expect(rateAnswer(f, "Swerve")).toBe("none"); // label, wrong case/identity
  });

  it("re-tagging an option recolors existing data", () => {
    const retagged: DropdownField = {
      ...f,
      options: f.options.map((o) => (o.value === "tank" ? { ...o, tone: "bad" as const } : o)),
    };
    expect(rateAnswer(f, "tank")).toBe("neutral");
    expect(rateAnswer(retagged, "tank")).toBe("bad");
  });
});

describe("text fields", () => {
  it("are neutral when filled in and gray when empty; never good or bad", () => {
    expect(rateAnswer(text(), "Pneumatic intake, 2 motors")).toBe("neutral");
    expect(rateAnswer(text(), "")).toBe("none");
    expect(rateAnswer(text(), "   ")).toBe("none");
  });
});

describe("no data is gray for every field type", () => {
  const fields: FieldDefinition[] = [number(), yesNo(true), dropdown(), text()];
  it.each([undefined, null, "", "   ", Number.NaN])("%p", (empty) => {
    for (const f of fields) expect(rateAnswer(f, empty as never), f.type).toBe("none");
  });
});

describe("stale or mismatched stored values degrade to gray instead of throwing", () => {
  it("a string/boolean stored in a number field (type was changed later)", () => {
    expect(rateAnswer(number(), "lots")).toBe("none");
    expect(rateAnswer(number(), true)).toBe("none");
  });

  it("a numeric string in a number field is still understood", () => {
    expect(rateAnswer(number(), "12")).toBe("good");
    expect(rateAnswer(number(), " 1 ")).toBe("bad");
  });

  it("Infinity is not a usable number", () => {
    expect(rateAnswer(number(), Number.POSITIVE_INFINITY)).toBe("none");
  });

  it("a number or string stored in a yes/no field", () => {
    expect(rateAnswer(yesNo(true), 1)).toBe("none");
    expect(rateAnswer(yesNo(true), "yes")).toBe("none");
  });

  it("a number or boolean stored in a dropdown field", () => {
    expect(rateAnswer(dropdown(), 3)).toBe("none");
    expect(rateAnswer(dropdown(), true)).toBe("none");
  });

  it("a number or boolean stored in a text field", () => {
    expect(rateAnswer(text(), 3)).toBe("none");
    expect(rateAnswer(text(), true)).toBe("none");
  });
});

describe("isEmpty", () => {
  it("treats 0 and false as answers", () => {
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
    expect(isEmpty(-1)).toBe(false);
  });
  it("treats null, undefined, blank strings and NaN as empty", () => {
    for (const v of [null, undefined, "", " \n\t ", Number.NaN]) expect(isEmpty(v as never)).toBe(true);
  });
});
