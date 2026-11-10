import * as z from "zod";
import { FIELD_TYPES, SECTIONS, TONES } from "./types";

/**
 * The field editor form. Mirrors the database CHECK constraints so the user gets
 * a friendly inline message instead of a raw Postgres error.
 *
 * Values are what the user TYPED: thresholds are strings (an empty input is "",
 * which must mean "not set", never 0). toFieldInsert() converts them to the
 * database shape.
 */

const optionFormSchema = z.object({
  /** Empty for a brand-new option; assigned once on first save, then frozen. */
  value: z.string(),
  label: z.string().trim().min(1, { error: "Give every option a name" }).max(60, { error: "Keep option names under 60 characters" }),
  tone: z.enum(TONES),
});
export type OptionFormValue = z.infer<typeof optionFormSchema>;

/** A numeric text input: "" (unset) or a finite number. Rejects "1e999", "abc", "Infinity". */
const optionalNumberString = z
  .string()
  .trim()
  .refine((v) => v === "" || Number.isFinite(Number(v)), { error: "Enter a number" })
  .refine((v) => v === "" || Math.abs(Number(v)) < 1e9, { error: "That number is too large" });

export const fieldFormSchema = z
  .object({
    name: z.string().trim().min(1, { error: "Give the field a name" }).max(80, { error: "Keep the name under 80 characters" }),
    section: z.enum(SECTIONS),
    type: z.enum(FIELD_TYPES),
    // number
    higherIsBetter: z.boolean(),
    goodThreshold: optionalNumberString,
    badThreshold: optionalNumberString,
    // yes_no: "yes" | "no" | "neutral"
    goodAnswer: z.enum(["yes", "no", "neutral"]),
    // dropdown
    options: z.array(optionFormSchema),
  })
  .superRefine((form, ctx) => {
    if (form.type === "number") {
      const good = form.goodThreshold === "" ? null : Number(form.goodThreshold);
      const bad = form.badThreshold === "" ? null : Number(form.badThreshold);
      if (good !== null && bad !== null) {
        // Must match the field_thresholds_ordered CHECK, or the save would fail in Postgres.
        if (form.higherIsBetter && !(good > bad)) {
          ctx.addIssue({
            code: "custom",
            path: ["badThreshold"],
            message: "When higher is better, the red line must be lower than the green line",
          });
        }
        if (!form.higherIsBetter && !(good < bad)) {
          ctx.addIssue({
            code: "custom",
            path: ["badThreshold"],
            message: "When lower is better, the red line must be higher than the green line",
          });
        }
      }
    }

    if (form.type === "dropdown") {
      if (form.options.length === 0) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one option" });
      }
      // Duplicate LABELS would be indistinguishable to scouts picking one.
      const seen = new Map<string, number>();
      form.options.forEach((option, index) => {
        const key = option.label.trim().toLowerCase();
        if (key === "") return;
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["options", index, "label"],
            message: "Two options have the same name",
          });
        }
        seen.set(key, index);
      });
    }
  });

export type FieldFormValues = z.infer<typeof fieldFormSchema>;

export function emptyFieldForm(section: FieldFormValues["section"] = "specs"): FieldFormValues {
  return {
    name: "",
    section,
    type: "number",
    higherIsBetter: true,
    goodThreshold: "",
    badThreshold: "",
    goodAnswer: "yes",
    options: [],
  };
}
