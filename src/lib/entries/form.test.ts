import { describe, expect, it } from "vitest";
import {
  ACTIVE_FIELDS,
  canClimb,
  comments,
  drivetrain,
  weight,
} from "./fixtures";
import {
  buildEntryFormSchema,
  emptyEntryForm,
  entryToFormValues,
  MAX_NOTES_LENGTH,
  MAX_TEXT_ANSWER_LENGTH,
} from "./form";

const schema = buildEntryFormSchema(ACTIVE_FIELDS);

function check(
  answers: Record<string, string | boolean | null>,
  extra: { rating?: number | null; notes?: string } = {},
) {
  return schema.safeParse({
    answers,
    rating: extra.rating ?? null,
    notes: extra.notes ?? "",
  });
}

function issuePaths(result: ReturnType<typeof check>) {
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("answer validation per field type", () => {
  it("accepts a blank form (every answer is optional)", () => {
    expect(check(emptyEntryForm(ACTIVE_FIELDS).answers).success).toBe(true);
    expect(check({}).success).toBe(true);
  });

  it("number: accepts empty, zero, decimals; rejects text and non-finite", () => {
    for (const ok of ["", "0", "115", "7.5", "7,5", "-2"]) {
      expect(check({ [weight.id]: ok }).success, `"${ok}"`).toBe(true);
    }
    for (const bad of ["abc", "1e999", "Infinity", "12 lbs"]) {
      expect(issuePaths(check({ [weight.id]: bad })), `"${bad}"`).toEqual([
        `answers.${weight.id}`,
      ]);
    }
  });

  it("yes/no: accepts true, false and null; rejects strings", () => {
    for (const ok of [true, false, null])
      expect(check({ [canClimb.id]: ok }).success).toBe(true);
    expect(check({ [canClimb.id]: "yes" }).success).toBe(false);
  });

  it("dropdown: accepts '' and real option values; rejects labels and unknown values", () => {
    expect(check({ [drivetrain.id]: "" }).success).toBe(true);
    expect(check({ [drivetrain.id]: "swerve" }).success).toBe(true);
    expect(check({ [drivetrain.id]: "Swerve" }).success).toBe(false);
    expect(check({ [drivetrain.id]: "hovercraft" }).success).toBe(false);
  });

  it("text: accepts up to the limit, rejects beyond it", () => {
    expect(
      check({ [comments.id]: "x".repeat(MAX_TEXT_ANSWER_LENGTH) }).success,
    ).toBe(true);
    expect(
      check({ [comments.id]: "x".repeat(MAX_TEXT_ANSWER_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("rating: 1-5 integers or null only", () => {
    for (const ok of [1, 3, 5, null])
      expect(check({}, { rating: ok }).success).toBe(true);
    for (const bad of [0, 6, 2.5, -1])
      expect(check({}, { rating: bad }).success, String(bad)).toBe(false);
  });

  it("notes: capped", () => {
    expect(check({}, { notes: "n".repeat(MAX_NOTES_LENGTH) }).success).toBe(
      true,
    );
    expect(check({}, { notes: "n".repeat(MAX_NOTES_LENGTH + 1) }).success).toBe(
      false,
    );
  });

  it("does not validate fields that are not on the form (archived)", () => {
    // 'stale' is not an active field, so garbage under that key is not the scout's problem.
    const result = schema.safeParse({
      answers: { stale: "garbage" },
      rating: null,
      notes: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("emptyEntryForm", () => {
  it("has an explicit empty value per field, with yes/no as null (not false)", () => {
    const form = emptyEntryForm(ACTIVE_FIELDS);
    expect(form.answers[weight.id]).toBe("");
    expect(form.answers[canClimb.id]).toBeNull();
    expect(form.answers[drivetrain.id]).toBe("");
    expect(form.answers[comments.id]).toBe("");
    expect(form.rating).toBeNull();
    expect(form.notes).toBe("");
  });
});

describe("entryToFormValues", () => {
  it("round-trips stored answers, including 0 and false", () => {
    const form = entryToFormValues(ACTIVE_FIELDS, {
      answers: {
        [weight.id]: 0,
        [canClimb.id]: false,
        [drivetrain.id]: "tank",
        [comments.id]: "fast",
      },
      rating: 4,
      notes: "hi",
    });
    expect(form.answers).toEqual({
      [weight.id]: "0",
      [canClimb.id]: false,
      [drivetrain.id]: "tank",
      [comments.id]: "fast",
    });
    expect(form.rating).toBe(4);
    expect(form.notes).toBe("hi");
  });

  it("returns a blank form when there is no entry", () => {
    expect(entryToFormValues(ACTIVE_FIELDS, null)).toEqual(
      emptyEntryForm(ACTIVE_FIELDS),
    );
  });

  it("survives wrong-typed or orphaned stored values instead of crashing", () => {
    const form = entryToFormValues(ACTIVE_FIELDS, {
      answers: {
        [weight.id]: "not a number" as never,
        [canClimb.id]: "yes" as never,
        [drivetrain.id]: "removed-option",
        [comments.id]: 5 as never,
      },
      rating: 99,
      notes: null,
    });
    expect(form).toEqual(emptyEntryForm(ACTIVE_FIELDS));
  });
});
