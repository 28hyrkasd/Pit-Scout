/**
 * Turn an option label into a stable machine value ("High / Traversal" ->
 * "high-traversal").
 *
 * Why this matters: answers are stored as the option VALUE, not the label, so
 * scouts can rename a label later without orphaning data. The value is generated
 * once when the option is created and then frozen (see nextOptionValue).
 */
export function slugifyOption(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents: "Café" -> "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug;
}

/**
 * A unique value for a NEW option, given the values already taken in this field.
 * Falls back to "option" for labels that slugify to nothing (e.g. emoji, "???"),
 * and appends -2, -3, ... on collisions.
 */
export function nextOptionValue(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugifyOption(label) || "option";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
