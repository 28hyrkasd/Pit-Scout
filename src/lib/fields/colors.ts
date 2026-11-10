import type { AnswerValue, FieldDefinition, Rating } from "./types";

/**
 * Color rules, computed at render time from the CURRENT field definition and the
 * stored answer. Nothing here is ever saved on an entry, so changing a threshold
 * or an option's tone recolors old data immediately.
 *
 *   green (good)    - meets the "good" rule
 *   yellow (neutral)- answered, but neither good nor bad
 *   red (bad)       - meets the "bad" rule
 *   gray (none)     - no usable answer
 *
 * Defensive on purpose: answers are stored as JSON and outlive field edits, so a
 * stored value can be the wrong type for the field's current type, or reference
 * a dropdown option that was since removed. Those render as gray, never throw.
 */
export function rateAnswer(field: FieldDefinition, answer: AnswerValue | undefined): Rating {
  if (isEmpty(answer)) return "none";

  switch (field.type) {
    case "number": {
      const value = toFiniteNumber(answer);
      if (value === null) return "none";
      return rateNumber(value, field.higherIsBetter, field.goodThreshold, field.badThreshold);
    }

    case "yes_no": {
      if (typeof answer !== "boolean") return "none";
      if (field.goodAnswer === null) return "neutral";
      return answer === field.goodAnswer ? "good" : "bad";
    }

    case "dropdown": {
      if (typeof answer !== "string") return "none";
      const option = field.options.find((o) => o.value === answer);
      // An answer for an option that no longer exists has no meaningful color.
      return option ? option.tone : "none";
    }

    case "text":
      // Free text has no good/bad. It only distinguishes "filled in" from "empty".
      return typeof answer === "string" ? "neutral" : "none";
  }
}

/**
 * Thresholds are inclusive and independent: either may be null, meaning that
 * color is never produced.
 *
 *   higherIsBetter:  value >= good -> good,  value <= bad  -> bad
 *   lowerIsBetter :  value <= good -> good,  value >= bad  -> bad
 *
 * If a value somehow satisfies both (only possible for thresholds that were never
 * validated, e.g. good == bad), "bad" wins: for scouting it is safer to flag a
 * possible problem than to hide it.
 */
export function rateNumber(
  value: number,
  higherIsBetter: boolean,
  goodThreshold: number | null,
  badThreshold: number | null,
): Rating {
  const isGood =
    goodThreshold !== null && (higherIsBetter ? value >= goodThreshold : value <= goodThreshold);
  const isBad =
    badThreshold !== null && (higherIsBetter ? value <= badThreshold : value >= badThreshold);

  if (isBad) return "bad";
  if (isGood) return "good";
  return "neutral";
}

/** True for "no answer": null/undefined, blank text, NaN. NOT for 0 or false. */
export function isEmpty(answer: AnswerValue | undefined): boolean {
  if (answer === null || answer === undefined) return true;
  if (typeof answer === "string") return answer.trim() === "";
  if (typeof answer === "number") return Number.isNaN(answer);
  return false;
}

/** Accepts a number, or a numeric string (e.g. left over from a text input). */
function toFiniteNumber(answer: AnswerValue | undefined): number | null {
  if (typeof answer === "number") return Number.isFinite(answer) ? answer : null;
  if (typeof answer === "string") {
    const trimmed = answer.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
