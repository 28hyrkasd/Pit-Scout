import { isEmpty } from "./colors";
import type { AnswerValue, FieldDefinition } from "./types";

/**
 * A stored answer as display text for a field, or null when there is nothing to
 * show (the caller renders a gray "no data" chip).
 *
 *   number   -> "115"  (no trailing zeros: 7.50 -> "7.5")
 *   yes_no   -> "Yes" / "No"
 *   dropdown -> the option's CURRENT label (so renaming a label updates old data);
 *               an answer whose option was removed -> null
 *   text     -> the trimmed text
 *
 * Mismatched stored values (wrong type for the field) -> null, never throws.
 */
export function formatAnswer(field: FieldDefinition, answer: AnswerValue | undefined): string | null {
  if (isEmpty(answer)) return null;

  switch (field.type) {
    case "number": {
      const n = typeof answer === "number" ? answer : typeof answer === "string" ? Number(answer.trim()) : NaN;
      if (!Number.isFinite(n)) return null;
      // Avoid float noise like 0.30000000000000004 while keeping real precision.
      return String(Number(n.toPrecision(12)));
    }
    case "yes_no":
      return typeof answer === "boolean" ? (answer ? "Yes" : "No") : null;
    case "dropdown": {
      if (typeof answer !== "string") return null;
      return field.options.find((o) => o.value === answer)?.label ?? null;
    }
    case "text":
      return typeof answer === "string" ? answer.trim() : null;
  }
}
