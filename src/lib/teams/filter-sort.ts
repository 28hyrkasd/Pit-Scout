import type { SavedEntry } from "@/lib/entries/rpc";
import { rateAnswer } from "@/lib/fields/colors";
import {
  SECTIONS,
  type AnswerValue,
  type FieldDefinition,
  type Rating,
} from "@/lib/fields/types";
import type { EventTeam } from "./merge";

/*
 * Pure logic behind the team list: join teams + entries + fields into rows,
 * search them, filter them, sort them. No React, no clock, no I/O, so all of it
 * is unit-tested and stays fast with thousands of fields (the work is one pass
 * over teams x fields to rate answers, then cheap array operations).
 *
 * Ratings are ALWAYS computed here from the current field definitions (via
 * rateAnswer), never stored, so editing a threshold recolors the list at once.
 */

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type RatingCounts = Record<Rating, number>;

export type TeamRow = {
  teamNumber: number;
  team: EventTeam;
  /** false for a team that has an entry but is not on the (TBA) event list. */
  inEventList: boolean;
  entry: SavedEntry | null;
  scouted: boolean;
  /** One rating per field, aligned with the `fields` array passed to buildTeamRows. */
  ratings: Rating[];
  counts: RatingCounts;
};

/** Fields in the order scouts see them: section order, then sort_order, then name. */
export function sortFieldsForDisplay(fields: FieldDefinition[]): FieldDefinition[] {
  const sectionIndex = (f: FieldDefinition) => SECTIONS.indexOf(f.section);
  return [...fields].sort(
    (a, b) =>
      sectionIndex(a) - sectionIndex(b) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

function instant(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function placeholderTeam(teamNumber: number): EventTeam {
  return {
    teamNumber,
    name: `Team ${teamNumber}`,
    city: null,
    stateProv: null,
    country: null,
    rank: null,
    record: null,
    epa: null,
    epaRank: null,
  };
}

function emptyCounts(): RatingCounts {
  return { good: 0, neutral: 0, bad: 0, none: 0 };
}

function makeRow(team: EventTeam, entry: SavedEntry | null, fields: FieldDefinition[], inEventList: boolean): TeamRow {
  const counts = emptyCounts();
  const ratings: Rating[] = new Array<Rating>(fields.length);
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const answer: AnswerValue | undefined = entry ? entry.answers[field.id] : undefined;
    const rating = entry ? rateAnswer(field, answer) : "none";
    ratings[i] = rating;
    counts[rating]++;
  }
  return { teamNumber: team.teamNumber, team, inEventList, entry, scouted: entry !== null, ratings, counts };
}

/**
 * One row per team.
 *
 *  - A team with no entry is a row with `entry: null` and every rating "none".
 *  - Duplicate team numbers (in the team list OR the entries) collapse to one row.
 *    For entries the most recently updated one wins; for teams the first wins.
 *  - Answers keyed by a field that no longer exists (or is not in `fields`) are
 *    ignored; answers for a removed dropdown option rate "none" via rateAnswer.
 *  - An entry for a team that is not in the team list (TBA unreachable, or a team
 *    scouted by number) still gets a row so scouted data is never hidden.
 *
 * `fields` should be the ACTIVE fields in display order.
 */
export function buildTeamRows(teams: EventTeam[], entries: SavedEntry[], fields: FieldDefinition[]): TeamRow[] {
  const entryByTeam = new Map<number, SavedEntry>();
  for (const entry of entries) {
    const existing = entryByTeam.get(entry.teamNumber);
    if (!existing || instant(entry.updatedAt) > instant(existing.updatedAt)) {
      entryByTeam.set(entry.teamNumber, entry);
    }
  }

  const rows: TeamRow[] = [];
  const seen = new Set<number>();
  for (const team of teams) {
    if (seen.has(team.teamNumber)) continue;
    seen.add(team.teamNumber);
    rows.push(makeRow(team, entryByTeam.get(team.teamNumber) ?? null, fields, true));
  }
  for (const [teamNumber, entry] of entryByTeam) {
    if (seen.has(teamNumber)) continue;
    rows.push(makeRow(placeholderTeam(teamNumber), entry, fields, false));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lowercase, accent-free, whitespace-collapsed. "Café  Robotics" -> "cafe robotics". */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A query matches a team when:
 *  - it is empty (after trimming): everything matches;
 *  - it is a number ("254", "#254", "frc254") and the team number STARTS with it; or
 *  - it appears anywhere in the team name (case- and accent-insensitive).
 *
 * Numbers are prefix-matched, not contained, so typing "25" narrows to 25, 254,
 * 2543... instead of also surfacing 1025.
 */
export function matchesQuery(team: Pick<EventTeam, "teamNumber" | "name">, query: string): boolean {
  const q = normalizeText(query);
  if (q === "") return true;

  const numeric = /^(?:frc|#)?\s*(\d+)$/.exec(q);
  if (numeric && String(team.teamNumber).startsWith(numeric[1])) return true;

  return normalizeText(team.name).includes(q);
}

// ---------------------------------------------------------------------------
// Sorting + filtering
// ---------------------------------------------------------------------------

export type SortKey = "teamNumber" | "rank" | "epa" | "rating" | `field:${string}`;
export type SortDirection = "asc" | "desc";

/** `redFilter` value meaning "a bad (red) answer in ANY field". Otherwise a field id, or null for off. */
export const ANY_RED = "__any__";

export type ListOptions = {
  query: string;
  sort: SortKey;
  direction: SortDirection;
  /** null = off, ANY_RED = any field, otherwise only teams with a red in that field id. */
  redFilter: string | null;
  unscoutedOnly: boolean;
};

export const DEFAULT_OPTIONS: ListOptions = {
  query: "",
  sort: "teamNumber",
  direction: "asc",
  redFilter: null,
  unscoutedOnly: false,
};

export function fieldSortKey(fieldId: string): SortKey {
  return `field:${fieldId}`;
}

/** The field id a sort key refers to, or null for the built-in keys. */
export function sortKeyFieldId(key: SortKey): string | null {
  return key.startsWith("field:") ? key.slice("field:".length) : null;
}

/** The direction that puts the most interesting teams first for this key. */
export function defaultDirection(key: SortKey): SortDirection {
  return key === "teamNumber" || key === "rank" ? "asc" : "desc";
}

/** Words for the direction toggle: what the CURRENT direction means for this key. */
export function directionLabel(key: SortKey, direction: SortDirection): string {
  if (key === "teamNumber") return direction === "asc" ? "Low to high" : "High to low";
  if (key === "rank") return direction === "asc" ? "Best rank first" : "Worst rank first";
  if (key === "epa" || key === "rating") return direction === "desc" ? "Highest first" : "Lowest first";
  return direction === "desc" ? "Best first" : "Worst first";
}

/** worse = smaller. "none" has no severity: it is a null, which always sorts last. */
const SEVERITY: Record<Rating, number | null> = { bad: 0, neutral: 1, good: 2, none: null };

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function numericAnswer(answer: AnswerValue | undefined): number | null {
  if (typeof answer === "number") return finite(answer);
  if (typeof answer === "string" && answer.trim() !== "") return finite(Number(answer.trim()));
  return null;
}

type SortValues = (number | null)[];

/**
 * What to compare a row by. Each entry is one comparison level; null = "no value",
 * which sorts after every real value in BOTH directions.
 *
 * A field sorts by its rating severity (bad < okay < good) and, within one rating,
 * by the number itself for number fields (so two "good" weights order by weight,
 * respecting higherIsBetter: a bigger "goodness" is always better).
 */
function sortValuesFor(row: TeamRow, key: SortKey, fieldIndex: number, field: FieldDefinition | undefined): SortValues {
  switch (key) {
    case "teamNumber":
      return [row.teamNumber];
    case "rank":
      return [finite(row.team.rank)];
    case "epa":
      return [finite(row.team.epa)];
    case "rating":
      return [finite(row.entry?.rating)];
    default: {
      if (!field || fieldIndex < 0) return [null];
      const severity = SEVERITY[row.ratings[fieldIndex] ?? "none"];
      if (severity === null) return [null, null];
      let goodness: number | null = null;
      if (field.type === "number") {
        const value = numericAnswer(row.entry?.answers[field.id]);
        if (value !== null) goodness = field.higherIsBetter ? value : -value;
      }
      return [severity, goodness];
    }
  }
}

function compareLevel(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last, whichever way we sort
  if (b === null) return -1;
  if (a === b) return 0;
  const cmp = a < b ? -1 : 1;
  return direction === "asc" ? cmp : -cmp;
}

/** Does this row have a bad (red) answer in the given field (or any field)? */
function hasRed(row: TeamRow, redFilter: string, fieldIndexById: Map<string, number>): boolean {
  if (redFilter === ANY_RED) return row.counts.bad > 0;
  const index = fieldIndexById.get(redFilter);
  if (index === undefined) return true; // unknown/removed field: the filter cannot apply, so do not hide anyone
  return row.ratings[index] === "bad";
}

/**
 * Search, filter, then sort. Does not mutate `rows`.
 *
 * Sorting rules:
 *  - rows with no value for the sort key (no entry, no rank, no EPA, "no data")
 *    are ALWAYS last, ascending or descending;
 *  - ties (and rows that both lack a value) are broken by team number, ascending
 *    in both directions, so the order is fully deterministic;
 *  - a sort or red filter that names a field that is not in `fields` (removed or
 *    archived since the preference was saved) falls back to team-number order /
 *    no red filter instead of showing nothing.
 *
 * `fields` must be the same array (same order) that was given to buildTeamRows.
 */
export function applyListOptions(rows: TeamRow[], fields: FieldDefinition[], options: ListOptions): TeamRow[] {
  const fieldIndexById = new Map<string, number>();
  fields.forEach((f, i) => fieldIndexById.set(f.id, i));

  const filtered = rows.filter((row) => {
    if (options.unscoutedOnly && row.scouted) return false;
    if (options.redFilter !== null && !hasRed(row, options.redFilter, fieldIndexById)) return false;
    return matchesQuery(row.team, options.query);
  });

  const sortFieldId = sortKeyFieldId(options.sort);
  const sortFieldIndex = sortFieldId === null ? -1 : (fieldIndexById.get(sortFieldId) ?? -1);
  const sortField = sortFieldIndex >= 0 ? fields[sortFieldIndex] : undefined;
  const { direction } = options;

  // Decorate once: computing keys inside the comparator would repeat the work n log n times.
  // A sort field that no longer exists gives every row [null], so the tie-break (team number) decides.
  const decorated = filtered.map((row) => ({ row, values: sortValuesFor(row, options.sort, sortFieldIndex, sortField) }));
  decorated.sort((a, b) => {
    const levels = Math.max(a.values.length, b.values.length);
    for (let i = 0; i < levels; i++) {
      const cmp = compareLevel(a.values[i] ?? null, b.values[i] ?? null, direction);
      if (cmp !== 0) return cmp;
    }
    return a.row.teamNumber - b.row.teamNumber;
  });
  return decorated.map((d) => d.row);
}
