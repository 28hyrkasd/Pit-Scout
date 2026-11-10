import type { FieldDefinition, Section } from "./types";

const STEP = 10;

/**
 * sort_order for a NEW field: the end of its section.
 * Steps by 10 so a field can later be slotted in between without renumbering.
 */
export function nextSortOrder(fields: Pick<FieldDefinition, "section" | "sortOrder">[], section: Section): number {
  const inSection = fields.filter((f) => f.section === section);
  if (inSection.length === 0) return STEP;
  return Math.max(...inSection.map((f) => f.sortOrder)) + STEP;
}

/**
 * Move one field up or down within its section, returning the renumbering to save.
 *
 * Returns ONLY the rows whose sort_order changed (usually two), to keep writes
 * minimal on bad wifi. The section's fields are first renumbered 10, 20, 30...
 * so that fields which shared a sort_order (ties are possible) still end up in a
 * well-defined order, and the move itself is unambiguous.
 *
 * `fields` must be the section's fields in their current DISPLAY order.
 * Returns [] when the move is impossible (already first/last, or id not found).
 */
export function moveWithinSection(
  fieldsInDisplayOrder: Pick<FieldDefinition, "id" | "sortOrder">[],
  id: string,
  direction: "up" | "down",
): { id: string; sortOrder: number }[] {
  const index = fieldsInDisplayOrder.findIndex((f) => f.id === id);
  if (index === -1) return [];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= fieldsInDisplayOrder.length) return [];

  const reordered = [...fieldsInDisplayOrder];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  const changes: { id: string; sortOrder: number }[] = [];
  reordered.forEach((field, i) => {
    const sortOrder = (i + 1) * STEP;
    if (field.sortOrder !== sortOrder) changes.push({ id: field.id, sortOrder });
  });
  return changes;
}
