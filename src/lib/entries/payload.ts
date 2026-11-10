import type { Answers, AnswerValue, FieldDefinition } from "@/lib/fields/types";
import {
  MAX_SCOUT_NAME_LENGTH,
  type AnswerInput,
  type EntryFormValues,
} from "./form";
import { parseNumberInput } from "./number-input";

/** What gets written to scouting_entries (minus ids and timestamps). */
export type EntryPayload = {
  answers: Answers;
  rating: number | null;
  notes: string | null;
  scoutedBy: string | null;
};

/** One typed input -> the value stored in `answers`. null means "no answer". */
export function toAnswerValue(
  field: FieldDefinition,
  input: AnswerInput | undefined,
): AnswerValue {
  switch (field.type) {
    case "number": {
      if (typeof input !== "string") return null;
      const parsed = parseNumberInput(input);
      // "" -> null, but "0" -> 0. Invalid text is rejected by validation before
      // this runs; if it somehow arrives anyway, store nothing rather than a guess.
      return parsed.kind === "ok" ? parsed.value : null;
    }
    case "yes_no":
      // false is a real answer ("No"); only null/undefined mean "not answered".
      return typeof input === "boolean" ? input : null;
    case "dropdown": {
      if (typeof input !== "string" || input === "") return null;
      return field.options.some((o) => o.value === input) ? input : null;
    }
    case "text": {
      if (typeof input !== "string") return null;
      const trimmed = input.trim();
      return trimmed === "" ? null : trimmed;
    }
  }
}

/**
 * Form values -> the payload to save.
 *
 * `existingAnswers` matters: archived fields are hidden from the form, but their
 * saved answers must survive an edit (archiving is reversible, so un-archiving
 * should bring the data back). Anything in `existingAnswers` that is not an
 * active field is carried over untouched.
 */
export function buildEntryPayload(
  values: EntryFormValues,
  activeFields: FieldDefinition[],
  options: { scoutedBy: string | null; existingAnswers?: Answers },
): EntryPayload {
  const answers: Answers = { ...options.existingAnswers };
  for (const field of activeFields)
    answers[field.id] = toAnswerValue(field, values.answers[field.id]);

  const notes = values.notes.trim();
  return {
    answers,
    rating: values.rating,
    notes: notes === "" ? null : notes,
    scoutedBy: normalizeScoutName(options.scoutedBy),
  };
}

/** "  Dana   Lee " -> "Dana Lee". Blank -> null. Capped to the column's CHECK limit. */
export function normalizeScoutName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  // Array.from splits by code point, so an emoji is never cut in half (a lone
  // surrogate is invalid in JSON/UTF-8 and would fail the save).
  const name = Array.from(raw.replace(/\s+/g, " ").trim())
    .slice(0, MAX_SCOUT_NAME_LENGTH)
    .join("")
    .trim();
  return name === "" ? null : name;
}
