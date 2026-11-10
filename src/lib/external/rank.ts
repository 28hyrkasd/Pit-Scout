/**
 * Standard competition ranking ("1224"): highest value is rank 1, equal values
 * share a rank, and the next rank skips accordingly. Entries whose value is null
 * are not ranked (they map to null), and never push other teams down.
 */
export function rankDescending<K>(entries: { key: K; value: number | null }[]): Map<K, number | null> {
  const ranked = entries
    .filter((e): e is { key: K; value: number } => e.value !== null && Number.isFinite(e.value))
    .sort((a, b) => b.value - a.value);

  const result = new Map<K, number | null>();
  ranked.forEach((entry, index) => {
    const prev = ranked[index - 1];
    result.set(entry.key, prev && prev.value === entry.value ? result.get(prev.key)! : index + 1);
  });
  for (const e of entries) if (!result.has(e.key)) result.set(e.key, null);
  return result;
}
