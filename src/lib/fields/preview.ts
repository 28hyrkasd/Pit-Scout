import type { FieldFormValues } from "./form-schema";

/**
 * Sample values to color in the editor's live preview, so the editor can see what
 * their thresholds actually do before saving (the best protection against
 * accidentally flipped green/red lines).
 *
 * Returns up to 5 distinct numbers spanning "clearly bad" through "clearly good"
 * around whichever thresholds are set. Empty when nothing is set (nothing to preview).
 */
export function sampleNumbers(form: Pick<FieldFormValues, "higherIsBetter" | "goodThreshold" | "badThreshold">): number[] {
  const parse = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
  const good = parse(form.goodThreshold);
  const bad = parse(form.badThreshold);
  if (good === null && bad === null) return [];

  const points = new Set<number>();
  const add = (n: number) => points.add(Number(n.toPrecision(10)));

  const anchors = [good, bad].filter((n): n is number => n !== null);
  const lo = Math.min(...anchors);
  const hi = Math.max(...anchors);
  // Spread proportional to the gap between thresholds, or a sensible default.
  const gap = anchors.length === 2 ? hi - lo : Math.max(Math.abs(anchors[0]) * 0.25, 1);
  const pad = Math.max(gap / 2, 0.5);

  add(lo - pad);
  add(lo);
  if (anchors.length === 2) add((lo + hi) / 2);
  add(hi);
  add(hi + pad);

  return [...points].sort((a, b) => a - b);
}
