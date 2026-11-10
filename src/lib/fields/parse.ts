import * as z from "zod";
import type { Database } from "@/lib/database.types";
import { FIELD_TYPES, SECTIONS, optionSchema, type FieldDefinition } from "./types";

export type FieldRow = Database["public"]["Tables"]["field_definitions"]["Row"];

const optionsSchema = z.array(optionSchema).min(1);

/** Shared by every field type. Section/type are plain strings in the DB row. */
const baseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  section: z.enum(SECTIONS),
  sort_order: z.number().int(),
  archived: z.boolean(),
});

export type ParsedField = { ok: true; field: FieldDefinition } | { ok: false; id: string; name: string; reason: string };

/**
 * Convert one database row into a strict FieldDefinition.
 *
 * Returns a result instead of throwing: one corrupt row (e.g. hand-edited
 * options JSON) must not take down the whole field list, because a scout in the
 * middle of an event cannot fix the database. Callers skip failures and surface
 * them (the Settings page shows them).
 */
export function parseFieldRow(row: FieldRow): ParsedField {
  const fail = (reason: string): ParsedField => ({ ok: false, id: row.id, name: row.name, reason });

  const base = baseSchema.safeParse(row);
  if (!base.success) return fail(`invalid field data (${base.error.issues[0]?.path.join(".") || "row"})`);
  const common = {
    id: base.data.id,
    name: base.data.name,
    section: base.data.section,
    sortOrder: base.data.sort_order,
    archived: base.data.archived,
  };

  const type = FIELD_TYPES.find((t) => t === row.type);
  if (!type) return fail(`unknown field type "${row.type}"`);

  switch (type) {
    case "number":
      return {
        ok: true,
        field: {
          ...common,
          type,
          // A number field with no direction set defaults to "higher is better".
          higherIsBetter: row.higher_is_better ?? true,
          goodThreshold: row.good_threshold,
          badThreshold: row.bad_threshold,
        },
      };

    case "yes_no":
      return { ok: true, field: { ...common, type, goodAnswer: row.good_answer } };

    case "dropdown": {
      const options = optionsSchema.safeParse(row.options);
      if (!options.success) return fail("dropdown options are missing or malformed");
      // Duplicate values would make answers ambiguous: reject rather than guess.
      const values = options.data.map((o) => o.value);
      if (new Set(values).size !== values.length) return fail("dropdown has duplicate option values");
      return { ok: true, field: { ...common, type, options: options.data } };
    }

    case "text":
      return { ok: true, field: { ...common, type } };
  }
}

/** Parse many rows, returning the good fields (sorted) and the rows that failed. */
export function parseFieldRows(rows: FieldRow[]) {
  const fields: FieldDefinition[] = [];
  const invalid: { id: string; name: string; reason: string }[] = [];
  for (const row of rows) {
    const parsed = parseFieldRow(row);
    if (parsed.ok) fields.push(parsed.field);
    else invalid.push({ id: parsed.id, name: parsed.name, reason: parsed.reason });
  }
  return { fields: sortFields(fields), invalid };
}

const SECTION_INDEX = new Map(SECTIONS.map((s, i) => [s, i] as const));

/** Stable display order: section, then sort_order, then name (so ties are deterministic). */
export function sortFields<T extends Pick<FieldDefinition, "section" | "sortOrder" | "name" | "id">>(fields: T[]): T[] {
  return [...fields].sort(
    (a, b) =>
      (SECTION_INDEX.get(a.section) ?? 99) - (SECTION_INDEX.get(b.section) ?? 99) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
