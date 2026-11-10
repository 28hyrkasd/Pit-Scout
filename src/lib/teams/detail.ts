import { isEmpty, rateAnswer } from "@/lib/fields/colors";
import { formatAnswer } from "@/lib/fields/format";
import {
  SECTIONS,
  SECTION_LABELS,
  type Answers,
  type FieldDefinition,
  type Rating,
  type Section,
} from "@/lib/fields/types";
import type { AppTeam } from "@/lib/external/schemas";

/** One field on the team detail page: its rating and the text to show next to it. */
export type DetailItem = {
  field: FieldDefinition;
  rating: Rating;
  /** Formatted answer, or null when there is nothing to show. */
  text: string | null;
  /** An answer exists but cannot be shown (wrong type, or its dropdown option was removed). */
  stale: boolean;
};

export type DetailSection = { section: Section; label: string; items: DetailItem[] };

/**
 * Active fields grouped into the same sections, in the same order, as the entry
 * form. Sections with no fields are omitted. Answers keyed by a removed field are
 * never looked at, so they cannot show up.
 *
 * `fields` keeps its given order within a section (callers pass display order).
 */
export function buildDetailSections(fields: FieldDefinition[], answers: Answers): DetailSection[] {
  const active = fields.filter((f) => !f.archived);
  return SECTIONS.flatMap((section) => {
    const items = active
      .filter((f) => f.section === section)
      .map((field): DetailItem => {
        const answer = answers[field.id];
        const text = formatAnswer(field, answer);
        return { field, rating: rateAnswer(field, answer), text, stale: text === null && !isEmpty(answer) };
      });
    return items.length === 0 ? [] : [{ section, label: SECTION_LABELS[section], items }];
  });
}

/**
 * "Nov 9, 2026, 9:03 PM" in the viewer's time zone, from an ISO string. Returns
 * null for an unparseable value. Takes the string (never reads the clock), so it
 * is safe in render; it must only run in client-rendered output because the
 * server's time zone may differ from the browser's.
 */
export function formatTimestamp(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** "5-3-0", or null if there is no record. */
export function formatRecord(record: AppTeam["record"]): string | null {
  return record ? `${record.wins}-${record.losses}-${record.ties}` : null;
}

/** "Santa Clara, CA, USA" from whatever parts exist, or null. */
export function formatTeamLocation(team: Pick<AppTeam, "city" | "stateProv" | "country">): string | null {
  const text = [team.city, team.stateProv, team.country].filter(Boolean).join(", ");
  return text === "" ? null : text;
}

/** One decimal place, or "–" when there is no number. */
export function formatEpa(epa: number | null | undefined): string {
  return typeof epa === "number" && Number.isFinite(epa) ? epa.toFixed(1) : "–";
}
