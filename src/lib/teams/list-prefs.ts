import * as z from "zod";
import {
  DEFAULT_OPTIONS,
  ANY_RED,
  sortKeyFieldId,
  type ListOptions,
  type SortKey,
} from "./filter-sort";

/**
 * The team list's search/sort/filter choices, kept in sessionStorage so they
 * survive opening a team and coming back (the list unmounts on navigation).
 * Everything read back is validated: storage can hold anything (old versions,
 * hand edits), and a bad value must fall back to the defaults, never crash.
 */
export const LIST_PREFS_STORAGE_KEY = "pit-scout:team-list:v1";

const sortKeySchema = z.union([
  z.enum(["teamNumber", "rank", "epa", "rating"]),
  z.string().regex(/^field:.+$/),
]);

const prefsSchema = z.object({
  query: z.string().max(100).catch(DEFAULT_OPTIONS.query),
  sort: sortKeySchema.catch(DEFAULT_OPTIONS.sort),
  direction: z.enum(["asc", "desc"]).catch(DEFAULT_OPTIONS.direction),
  redFilter: z.string().min(1).nullable().catch(null),
  unscoutedOnly: z.boolean().catch(false),
});

/** Raw storage string -> options. Anything unreadable gives the defaults. */
export function parseListPrefs(raw: string | null): ListOptions {
  if (raw === null) return DEFAULT_OPTIONS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return DEFAULT_OPTIONS;
  }
  const parsed = prefsSchema.safeParse(json);
  if (!parsed.success) return DEFAULT_OPTIONS;
  return { ...parsed.data, sort: parsed.data.sort as SortKey };
}

export function serializeListPrefs(options: ListOptions): string {
  return JSON.stringify(options);
}

/**
 * Drop references to fields that no longer exist or are archived (a sort or red
 * filter on a deleted field would otherwise sit invisible in the saved state).
 */
export function sanitizeListPrefs(options: ListOptions, activeFieldIds: ReadonlySet<string>): ListOptions {
  const sortFieldId = sortKeyFieldId(options.sort);
  const sortGone = sortFieldId !== null && !activeFieldIds.has(sortFieldId);
  const redGone = options.redFilter !== null && options.redFilter !== ANY_RED && !activeFieldIds.has(options.redFilter);
  if (!sortGone && !redGone) return options;
  return {
    ...options,
    sort: sortGone ? DEFAULT_OPTIONS.sort : options.sort,
    direction: sortGone ? DEFAULT_OPTIONS.direction : options.direction,
    redFilter: redGone ? null : options.redFilter,
  };
}
