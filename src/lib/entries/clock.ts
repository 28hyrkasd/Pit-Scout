/**
 * The `updated_at` for an edit made right now.
 *
 * Last-write-wins compares CLIENT clocks, and phones can be minutes off. If this
 * phone's clock is behind the time already stored on the entry (set by a scout
 * whose clock is ahead), a plain "now" would make the database silently ignore
 * this edit. A scout who opened an entry and then changed it has, by definition,
 * seen that stored version, so their edit must come after it: never go backwards.
 *
 * `nowMs` is passed in (read it in the event handler, never during render).
 */
export function nextUpdatedAt(
  nowMs: number,
  previousUpdatedAt: string | null,
): string {
  let ms = nowMs;
  if (previousUpdatedAt) {
    const previous = new Date(previousUpdatedAt).getTime();
    if (Number.isFinite(previous) && previous >= ms) ms = previous + 1;
  }
  return new Date(ms).toISOString();
}
