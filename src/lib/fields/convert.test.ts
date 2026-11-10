import { describe, expect, it } from "vitest";
import { editWarnings, toFieldColumns, toFormValues } from "./convert";
import { emptyFieldForm, fieldFormSchema, type FieldFormValues } from "./form-schema";
import type { DropdownField, NumberField, YesNoField } from "./types";

const form = (over: Partial<FieldFormValues> = {}): FieldFormValues => ({ ...emptyFieldForm(), name: "Weight", ...over });

describe("toFieldColumns", () => {
  it("number: converts thresholds, empty string means null (never 0)", () => {
    const cols = toFieldColumns(form({ type: "number", higherIsBetter: false, goodThreshold: "110", badThreshold: "" }));
    expect(cols).toMatchObject({ type: "number", higher_is_better: false, good_threshold: 110, bad_threshold: null });
  });

  it("number: a threshold of '0' is kept as 0", () => {
    const cols = toFieldColumns(form({ goodThreshold: "0", badThreshold: "-3" }));
    expect(cols.good_threshold).toBe(0);
    expect(cols.bad_threshold).toBe(-3);
  });

  it("number: accepts decimals and surrounding whitespace", () => {
    expect(toFieldColumns(form({ goodThreshold: " 7.5 " })).good_threshold).toBe(7.5);
  });

  it("text: nulls every number/yes-no/dropdown column", () => {
    const cols = toFieldColumns(form({ type: "text", goodThreshold: "10", badThreshold: "2", goodAnswer: "yes" }));
    expect(cols).toMatchObject({
      type: "text",
      options: null,
      higher_is_better: null,
      good_threshold: null,
      bad_threshold: null,
      good_answer: null,
    });
  });

  it("yes_no: maps yes/no/neutral to true/false/null", () => {
    expect(toFieldColumns(form({ type: "yes_no", goodAnswer: "yes" })).good_answer).toBe(true);
    expect(toFieldColumns(form({ type: "yes_no", goodAnswer: "no" })).good_answer).toBe(false);
    expect(toFieldColumns(form({ type: "yes_no", goodAnswer: "neutral" })).good_answer).toBeNull();
  });

  it("yes_no: does not carry number columns left over from the form", () => {
    const cols = toFieldColumns(form({ type: "yes_no", goodThreshold: "10", badThreshold: "2" }));
    expect(cols).toMatchObject({ higher_is_better: null, good_threshold: null, bad_threshold: null, options: null });
  });

  it("dropdown: assigns values to new options and keeps existing values", () => {
    const cols = toFieldColumns(
      form({
        type: "dropdown",
        options: [
          { value: "swerve", label: "Swerve (renamed)", tone: "good" },
          { value: "", label: "Tank", tone: "neutral" },
        ],
      }),
    );
    expect(cols.options).toEqual([
      { value: "swerve", label: "Swerve (renamed)", tone: "good" }, // value frozen, label changed
      { value: "tank", label: "Tank", tone: "neutral" },
    ]);
    expect(cols).toMatchObject({ higher_is_better: null, good_threshold: null, good_answer: null });
  });

  it("dropdown: a new option never collides with a kept option's value", () => {
    const cols = toFieldColumns(
      form({
        type: "dropdown",
        options: [
          { value: "tank", label: "Old tank", tone: "neutral" },
          { value: "", label: "Tank", tone: "bad" }, // slugifies to "tank", already taken
        ],
      }),
    );
    const values = (cols.options as { value: string }[]).map((o) => o.value);
    expect(values).toEqual(["tank", "tank-2"]);
  });

  it("dropdown: two new options with the same slug get distinct values", () => {
    const cols = toFieldColumns(
      form({
        type: "dropdown",
        options: [
          { value: "", label: "Mid!", tone: "good" },
          { value: "", label: "Mid?", tone: "bad" },
        ],
      }),
    );
    expect((cols.options as { value: string }[]).map((o) => o.value)).toEqual(["mid", "mid-2"]);
  });

  it("trims the name and labels", () => {
    const cols = toFieldColumns(form({ name: "  Weight  ", type: "dropdown", options: [{ value: "", label: "  A  ", tone: "good" }] }));
    expect(cols.name).toBe("Weight");
    expect((cols.options as { label: string }[])[0].label).toBe("A");
  });
});

describe("fieldFormSchema", () => {
  const ok = (v: FieldFormValues) => fieldFormSchema.safeParse(v);
  const firstError = (v: FieldFormValues) => {
    const r = ok(v);
    return r.success ? null : r.error.issues[0];
  };

  it("accepts a valid number field", () => {
    expect(ok(form({ higherIsBetter: false, goodThreshold: "110", badThreshold: "125" })).success).toBe(true);
  });

  it("requires a name", () => {
    expect(firstError(form({ name: "" }))?.message).toBe("Give the field a name");
    expect(firstError(form({ name: "   " }))?.message).toBe("Give the field a name");
  });

  it("limits the name length to match the database CHECK", () => {
    expect(ok(form({ name: "a".repeat(80) })).success).toBe(true);
    expect(ok(form({ name: "a".repeat(81) })).success).toBe(false);
  });

  describe("threshold ordering matches the field_thresholds_ordered constraint", () => {
    it("higher is better: good must be above bad", () => {
      expect(ok(form({ higherIsBetter: true, goodThreshold: "10", badThreshold: "2" })).success).toBe(true);
      expect(ok(form({ higherIsBetter: true, goodThreshold: "2", badThreshold: "10" })).success).toBe(false);
      expect(ok(form({ higherIsBetter: true, goodThreshold: "5", badThreshold: "5" })).success).toBe(false);
    });

    it("lower is better: good must be below bad", () => {
      expect(ok(form({ higherIsBetter: false, goodThreshold: "110", badThreshold: "125" })).success).toBe(true);
      expect(ok(form({ higherIsBetter: false, goodThreshold: "125", badThreshold: "110" })).success).toBe(false);
      expect(ok(form({ higherIsBetter: false, goodThreshold: "5", badThreshold: "5" })).success).toBe(false);
    });

    it("reports the problem on the bad-threshold input", () => {
      expect(firstError(form({ goodThreshold: "2", badThreshold: "10" }))?.path).toEqual(["badThreshold"]);
    });

    it("allows either threshold to be left empty", () => {
      expect(ok(form({ goodThreshold: "10", badThreshold: "" })).success).toBe(true);
      expect(ok(form({ goodThreshold: "", badThreshold: "2" })).success).toBe(true);
      expect(ok(form({ goodThreshold: "", badThreshold: "" })).success).toBe(true);
    });

    it("does not compare thresholds on non-number fields", () => {
      expect(ok(form({ type: "text", goodThreshold: "1", badThreshold: "9" })).success).toBe(true);
    });
  });

  describe("numeric input hardening", () => {
    it.each(["abc", "1e999", "Infinity", "-Infinity", "NaN", "1,5", "--3", "5e12"])("rejects %j", (bad) => {
      expect(ok(form({ goodThreshold: bad })).success).toBe(false);
    });

    it.each(["0", "-3", "7.5", "100", "1e3", ".5"])("accepts %j", (good) => {
      expect(ok(form({ goodThreshold: good, badThreshold: "" })).success).toBe(true);
    });
  });

  describe("dropdown options", () => {
    const dd = (options: FieldFormValues["options"]) => form({ type: "dropdown", options });

    it("requires at least one option", () => {
      expect(firstError(dd([]))?.message).toBe("Add at least one option");
    });

    it("rejects an option with a blank label", () => {
      expect(ok(dd([{ value: "", label: "  ", tone: "good" }])).success).toBe(false);
    });

    it("rejects duplicate labels (case-insensitive) and points at the second one", () => {
      const issue = firstError(
        dd([
          { value: "", label: "Swerve", tone: "good" },
          { value: "", label: "swerve ", tone: "bad" },
        ]),
      );
      expect(issue?.path).toEqual(["options", 1, "label"]);
    });

    it("accepts valid options", () => {
      expect(
        ok(
          dd([
            { value: "", label: "Swerve", tone: "good" },
            { value: "", label: "Tank", tone: "neutral" },
          ]),
        ).success,
      ).toBe(true);
    });

    it("rejects an invalid tone", () => {
      expect(ok(dd([{ value: "", label: "A", tone: "purple" as never }])).success).toBe(false);
    });
  });
});

describe("toFormValues <-> toFieldColumns round trip", () => {
  const base = { id: "f", name: "X", section: "specs" as const, sortOrder: 1, archived: false };

  it("number", () => {
    const field: NumberField = { ...base, type: "number", higherIsBetter: false, goodThreshold: 110, badThreshold: 0 };
    const cols = toFieldColumns(toFormValues(field));
    expect(cols).toMatchObject({ higher_is_better: false, good_threshold: 110, bad_threshold: 0 }); // 0 survives
  });

  it("number with unset thresholds stays unset", () => {
    const field: NumberField = { ...base, type: "number", higherIsBetter: true, goodThreshold: null, badThreshold: null };
    expect(toFieldColumns(toFormValues(field))).toMatchObject({ good_threshold: null, bad_threshold: null });
  });

  it.each([true, false, null] as const)("yes/no good answer %s", (goodAnswer) => {
    const field: YesNoField = { ...base, type: "yes_no", goodAnswer };
    expect(toFieldColumns(toFormValues(field)).good_answer).toBe(goodAnswer);
  });

  it("dropdown keeps existing option values", () => {
    const field: DropdownField = {
      ...base,
      type: "dropdown",
      options: [
        { value: "weird_value_1", label: "Has an odd stored value", tone: "good" },
        { value: "tank", label: "Tank", tone: "neutral" },
      ],
    };
    const cols = toFieldColumns(toFormValues(field));
    expect(cols.options).toEqual(field.options);
  });
});

describe("editWarnings", () => {
  const base = { id: "f", name: "X", section: "specs" as const, sortOrder: 1, archived: false };
  const dropdown: DropdownField = {
    ...base,
    type: "dropdown",
    options: [
      { value: "swerve", label: "Swerve", tone: "good" },
      { value: "tank", label: "Tank", tone: "neutral" },
    ],
  };
  const number: NumberField = { ...base, type: "number", higherIsBetter: true, goodThreshold: 10, badThreshold: 2 };

  it("does not warn for threshold or tone changes (they only recolor)", () => {
    expect(editWarnings(number, { ...toFormValues(number), goodThreshold: "20" })).toEqual([]);
    const retoned = { ...toFormValues(dropdown), options: toFormValues(dropdown).options.map((o) => ({ ...o, tone: "bad" as const })) };
    expect(editWarnings(dropdown, retoned)).toEqual([]);
  });

  it("does not warn when an option is only renamed (its value is kept)", () => {
    const renamed = { ...toFormValues(dropdown), options: toFormValues(dropdown).options.map((o) => ({ ...o, label: o.label + " v2" })) };
    expect(editWarnings(dropdown, renamed)).toEqual([]);
  });

  it("warns when the type changes", () => {
    const warnings = editWarnings(number, { ...toFormValues(number), type: "text" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/type/i);
  });

  it("warns, naming the option, when a dropdown option is removed", () => {
    const form = toFormValues(dropdown);
    const warnings = editWarnings(dropdown, { ...form, options: form.options.filter((o) => o.value !== "tank") });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Tank"');
  });

  it("does not warn when a new option is added", () => {
    const form = toFormValues(dropdown);
    expect(editWarnings(dropdown, { ...form, options: [...form.options, { value: "", label: "Mecanum", tone: "bad" }] })).toEqual([]);
  });
});
