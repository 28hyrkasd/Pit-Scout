import type { AppEvent } from "./schemas";

export const MAX_EVENT_RESULTS = 25;

/**
 * Filter events by a free-text query against name, key, and location.
 *
 * Every whitespace-separated word must match somewhere (AND), case-insensitively,
 * so "silicon valley" and "casj 2026" both work. An empty query returns the
 * input unchanged (already sorted by start date), capped at MAX_EVENT_RESULTS to
 * keep payloads small on phones.
 */
export function searchEvents(events: AppEvent[], query: string, limit = MAX_EVENT_RESULTS): AppEvent[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return events.slice(0, limit);

  const matches: AppEvent[] = [];
  for (const event of events) {
    const haystack = [event.name, event.key, event.city, event.stateProv, event.country]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (words.every((w) => haystack.includes(w))) {
      matches.push(event);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
