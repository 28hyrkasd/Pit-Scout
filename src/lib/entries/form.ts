import * as z from "zod";
import type { Answers, AnswerValue, FieldDefinition } from "@/lib/fields/types";
import { parseNumberInput } from "./number-input";

/**
 * The scouting entry form, as the scout sees it.
 *
 * What an input holds while typing (so "" means "nothing entered" and is never
 * confused with 0 or false):
 *   number   -> string  ("" | "7.5")
 *   yes_no   -> boolean | null   (null = not answered; false is a real answer)
 *   dropdown -> string  ("" = not answered, otherwise the option's frozen `value`)
 *   text     -> string
 */
export type AnswerInput = string | boolean | null;

export type EntryFormValues = {
  /** Keyed by FIELD UUID, like scouting_entries.answers. */
  answers: Record<string, AnswerInput>;
  /** 1-5, or null for "no rating". */
  rating: number | null;
  notes: string;
};

export const MAX_NOTES_LENGTH = 5000;
export const MAX_TEXT_ANSWER_LENGTH = 2000;
export const MAX_SCOUT_NAME_LENGTH = 80;

/** Validation for one answer input, by field type. Messages are shown inline. */
function answerSchema(field: FieldDefinition): z.ZodType<AnswerInput> {
  switch (field.type) {
    case "number":
      return z.string().superRefine((text, ctx) => {
        if (parseNumberInput(text).kind === "invalid") {
          ctx.addIssue({
            code: "custom",
            message: "Enter a number, like 12 or 7.5",
          });
        }
      });
    case "yes_no":
      return z.boolean().nullable();
    case "dropdown": {
      const values = new Set(field.options.map((o) => o.value));
      return z
        .string()
        .refine((v) => v === "" || values.has(v), {
          error: "Pick one of the options",
        });
    }
    case "text":
      return z
        .string()
        .max(MAX_TEXT_ANSWER_LENGTH, {
          error: `Keep it under ${MAX_TEXT_ANSWER_LENGTH} characters`,
        });
  }
}

/**
 * zod schema for the whole form, built from the ACTIVE field definitions.
 * Only active fields are validated: archived fields are not on the form, so they
 * can never produce an error the scout has no way to fix.
 *
 * A missing key (a field added while the form was open) is fine: it means "no answer".
 */
export function buildEntryFormSchema(
  activeFields: FieldDefinition[],
): z.ZodType<EntryFormValues, EntryFormValues> {
  // The keys are field UUIDs known only at runtime, so TypeScript cannot infer the
  // shape; the declared return type is what the form (and its resolver) rely on.
  const shape: Record<string, z.ZodType<AnswerInput | undefined>> = {};
  for (const field of activeFields) shape[field.id] = answerSchema(field).optional();

  return z.object({
    answers: z.object(shape) as unknown as z.ZodType<Record<string, AnswerInput>, Record<string, AnswerInput>>,
    rating: z
      .number()
      .int()
      .min(1, { error: "Rating is 1 to 5" })
      .max(5, { error: "Rating is 1 to 5" })
      .nullable(),
    notes: z
      .string()
      .max(MAX_NOTES_LENGTH, {
        error: `Keep notes under ${MAX_NOTES_LENGTH} characters`,
      }),
  });
}

/** A blank form for the given fields. Every active field gets an explicit "no answer". */
export function emptyEntryForm(
  activeFields: FieldDefinition[],
): EntryFormValues {
  const answers: Record<string, AnswerInput> = {};
  for (const field of activeFields)
    answers[field.id] = field.type === "yes_no" ? null : "";
  return { answers, rating: null, notes: "" };
}

/**
 * Stored entry -> form values. Defensive in the same way rateAnswer() is: stored
 * JSON outlives field edits, so a value of the wrong type (or an option that has
 * since been removed) becomes "no answer" instead of crashing the form.
 */
export function entryToFormValues(
  activeFields: FieldDefinition[],
  entry: {
    answers: Answers;
    rating: number | null;
    notes: string | null;
  } | null,
): EntryFormValues {
  const form = emptyEntryForm(activeFields);
  if (!entry) return form;

  for (const field of activeFields) {
    const stored: AnswerValue | undefined = entry.answers[field.id];
    switch (field.type) {
      case "number":
        if (typeof stored === "number" && Number.isFinite(stored))
          form.answers[field.id] = String(stored);
        break;
      case "yes_no":
        if (typeof stored === "boolean") form.answers[field.id] = stored;
        break;
      case "dropdown":
        if (
          typeof stored === "string" &&
          field.options.some((o) => o.value === stored)
        )
          form.answers[field.id] = stored;
        break;
      case "text":
        if (typeof stored === "string") form.answers[field.id] = stored;
        break;
    }
  }

  form.rating =
    entry.rating !== null &&
    Number.isInteger(entry.rating) &&
    entry.rating >= 1 &&
    entry.rating <= 5
      ? entry.rating
      : null;
  form.notes = entry.notes ?? "";
  return form;
}
