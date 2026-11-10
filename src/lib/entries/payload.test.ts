import { describe, expect, it } from "vitest";
import {
  ACTIVE_FIELDS,
  archivedField,
  canClimb,
  comments,
  drivetrain,
  weight,
} from "./fixtures";
import type { EntryFormValues } from "./form";
import {
  buildEntryPayload,
  normalizeScoutName,
  toAnswerValue,
} from "./payload";

function form(
  answers: EntryFormValues["answers"],
  extra: Partial<EntryFormValues> = {},
): EntryFormValues {
  return { answers, rating: null, notes: "", ...extra };
}

describe("toAnswerValue", () => {
  it("turns empty strings into null", () => {
    expect(toAnswerValue(weight, "")).toBeNull();
    expect(toAnswerValue(weight, "   ")).toBeNull();
    expect(toAnswerValue(comments, "")).toBeNull();
    expect(toAnswerValue(comments, "   \n ")).toBeNull();
    expect(toAnswerValue(drivetrain, "")).toBeNull();
  });

  it("keeps 0 for a number field", () => {
    expect(toAnswerValue(weight, "0")).toBe(0);
  });

  it("keeps false for a yes/no field, and null means unanswered", () => {
    expect(toAnswerValue(canClimb, false)).toBe(false);
    expect(toAnswerValue(canClimb, true)).toBe(true);
    expect(toAnswerValue(canClimb, null)).toBeNull();
    expect(toAnswerValue(canClimb, undefined)).toBeNull();
  });

  it("stores the option's value, not its label, and ignores unknown options", () => {
    expect(toAnswerValue(drivetrain, "swerve")).toBe("swerve");
    expect(toAnswerValue(drivetrain, "Swerve")).toBeNull();
    expect(toAnswerValue(drivetrain, "ghost")).toBeNull();
  });

  it("parses numbers (decimal comma too) and trims text", () => {
    expect(toAnswerValue(weight, "115.5")).toBe(115.5);
    expect(toAnswerValue(weight, "7,5")).toBe(7.5);
    expect(toAnswerValue(comments, "  scores 3 pieces ")).toBe(
      "scores 3 pieces",
    );
  });

  it("never stores a guess for unparseable numbers", () => {
    expect(toAnswerValue(weight, "abc")).toBeNull();
  });

  it("ignores a value of the wrong type for the field", () => {
    expect(toAnswerValue(weight, true)).toBeNull();
    expect(toAnswerValue(canClimb, "yes")).toBeNull();
  });
});

describe("buildEntryPayload", () => {
  it("keys answers by field id and keeps every falsy-but-real answer", () => {
    const payload = buildEntryPayload(
      form(
        {
          [weight.id]: "0",
          [canClimb.id]: false,
          [drivetrain.id]: "",
          [comments.id]: "",
        },
        { rating: 3, notes: "  good robot " },
      ),
      ACTIVE_FIELDS,
      { scoutedBy: "Dana" },
    );
    expect(payload.answers).toEqual({
      [weight.id]: 0,
      [canClimb.id]: false,
      [drivetrain.id]: null,
      [comments.id]: null,
    });
    expect(payload.rating).toBe(3);
    expect(payload.notes).toBe("good robot");
    expect(payload.scoutedBy).toBe("Dana");
  });

  it("writes an explicit null for an active field that was never touched", () => {
    const payload = buildEntryPayload(form({}), ACTIVE_FIELDS, {
      scoutedBy: null,
    });
    expect(Object.keys(payload.answers).sort()).toEqual(
      ACTIVE_FIELDS.map((f) => f.id).sort(),
    );
    expect(Object.values(payload.answers).every((v) => v === null)).toBe(true);
  });

  it("turns blank notes and blank names into null", () => {
    const payload = buildEntryPayload(
      form({}, { notes: "  \n " }),
      ACTIVE_FIELDS,
      { scoutedBy: "   " },
    );
    expect(payload.notes).toBeNull();
    expect(payload.scoutedBy).toBeNull();
    expect(payload.rating).toBeNull();
  });

  it("preserves answers for archived or unknown fields instead of wiping them", () => {
    const payload = buildEntryPayload(form({ [weight.id]: "100" }), [weight], {
      scoutedBy: null,
      existingAnswers: {
        [archivedField.id]: 42,
        "deleted-long-ago": "x",
        [weight.id]: 90,
      },
    });
    expect(payload.answers[archivedField.id]).toBe(42);
    expect(payload.answers["deleted-long-ago"]).toBe("x");
    // ...but an active field takes the NEW value.
    expect(payload.answers[weight.id]).toBe(100);
  });

  it("lets the scout clear an answer that used to be set", () => {
    const payload = buildEntryPayload(form({ [weight.id]: "" }), [weight], {
      scoutedBy: null,
      existingAnswers: { [weight.id]: 90 },
    });
    expect(payload.answers[weight.id]).toBeNull();
  });
});

describe("normalizeScoutName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeScoutName("  Dana   Lee ")).toBe("Dana Lee");
  });

  it("returns null for blank or missing", () => {
    expect(normalizeScoutName("")).toBeNull();
    expect(normalizeScoutName("   ")).toBeNull();
    expect(normalizeScoutName(null)).toBeNull();
    expect(normalizeScoutName(undefined)).toBeNull();
  });

  it("caps at 80 characters without splitting an emoji", () => {
    expect(normalizeScoutName("a".repeat(200))).toHaveLength(80);
    const name = normalizeScoutName("😀".repeat(100)) ?? "";
    expect(Array.from(name)).toHaveLength(80);
    expect(name.isWellFormed()).toBe(true);
  });
});
