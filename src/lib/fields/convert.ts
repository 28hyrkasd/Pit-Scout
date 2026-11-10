import type { Database, Json } from "@/lib/database.types";
import type { FieldFormValues } from "./form-schema";
import { nextOptionValue } from "./option-value";
import type { FieldDefinition } from "./types";

export type FieldInsert = Database["public"]["Tables"]["field_definitions"]["Insert"];
export type FieldUpdate = Database["public"]["Tables"]["field_definitions"]["Update"];

/**
 * Form values -> the columns to write.
 *
 * Every type-specific column is set explicitly (null when it does not apply), so
 * the result always satisfies the CHECK constraints: a text field never carries
 * thresholds, only yes/no carries good_answer, only dropdown carries options.
 * This also matters when CHANGING a field's type: the old type's columns are
 * nulled out instead of being left behind.
 *
 * Option values: existing options keep their stored `value` (answers reference
 * it); new options get one generated from the label. That is what lets you
 * rename "Tank" to "West Coast" without orphaning every answer.
 */
export function toFieldColumns(form: FieldFormValues): Omit<FieldInsert, "id" | "sort_order" | "archived"> {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  return {
    name: form.name.trim(),
    section: form.section,
    type: form.type,
    options: form.type === "dropdown" ? (assignOptionValues(form.options) as unknown as Json) : null,
    higher_is_better: form.type === "number" ? form.higherIsBetter : null,
    good_threshold: form.type === "number" ? num(form.goodThreshold) : null,
    bad_threshold: form.type === "number" ? num(form.badThreshold) : null,
    good_answer: form.type === "yes_no" ? (form.goodAnswer === "neutral" ? null : form.goodAnswer === "yes") : null,
  };
}

function assignOptionValues(options: FieldFormValues["options"]) {
  // Values already in use (kept from saved options) must not be reused by new ones.
  const taken = new Set(options.map((o) => o.value).filter((v) => v !== ""));
  return options.map((option) => {
    if (option.value !== "") return { value: option.value, label: option.label.trim(), tone: option.tone };
    const value = nextOptionValue(option.label, taken);
    taken.add(value);
    return { value, label: option.label.trim(), tone: option.tone };
  });
}

/** An existing field -> form values for editing. */
export function toFormValues(field: FieldDefinition): FieldFormValues {
  return {
    name: field.name,
    section: field.section,
    type: field.type,
    higherIsBetter: field.type === "number" ? field.higherIsBetter : true,
    goodThreshold: field.type === "number" && field.goodThreshold !== null ? String(field.goodThreshold) : "",
    badThreshold: field.type === "number" && field.badThreshold !== null ? String(field.badThreshold) : "",
    goodAnswer: field.type === "yes_no" ? (field.goodAnswer === null ? "neutral" : field.goodAnswer ? "yes" : "no") : "yes",
    options: field.type === "dropdown" ? field.options.map((o) => ({ value: o.value, label: o.label, tone: o.tone })) : [],
  };
}

/**
 * What a user should be warned about before saving an edit to a field that
 * already has scouting data. Pure so it can be tested without a database.
 *
 * Changing a threshold or a tone only recolors, which is safe and expected.
 * Changing the TYPE, or removing a dropdown option, strands stored answers: they
 * stay in the database but render as gray ("no data") until put back.
 */
export function editWarnings(before: FieldDefinition, after: FieldFormValues): string[] {
  const warnings: string[] = [];

  if (before.type !== after.type) {
    warnings.push(
      `Changing the type from ${before.type.replace("_", "/")} to ${after.type.replace("_", "/")} means existing answers can no longer be shown for this field. They are kept, but appear as "no data".`,
    );
  }

  if (before.type === "dropdown" && after.type === "dropdown") {
    const keptValues = new Set(after.options.map((o) => o.value));
    const removed = before.options.filter((o) => !keptValues.has(o.value));
    if (removed.length > 0) {
      warnings.push(
        `Removing ${removed.map((o) => `"${o.label}"`).join(", ")} means scouts' existing answers of that choice will show as "no data".`,
      );
    }
  }

  return warnings;
}
