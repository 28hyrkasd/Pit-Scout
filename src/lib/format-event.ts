import type { AppEvent } from "@/lib/external/schemas";

/** "San Jose, CA, USA" from whatever location parts exist. Empty string if none. */
export function formatEventLocation(event: Pick<AppEvent, "city" | "stateProv" | "country">): string {
  return [event.city, event.stateProv, event.country].filter(Boolean).join(", ");
}

/**
 * "Mar 5-8, 2026", "Feb 28 - Mar 2, 2026", or "Mar 5, 2026". Parses the
 * yyyy-mm-dd strings by hand instead of `new Date(str)`, which would treat them
 * as UTC midnight and show the previous day in US timezones.
 */
export function formatEventDates(event: Pick<AppEvent, "startDate" | "endDate">): string {
  const start = parseYmd(event.startDate);
  const end = parseYmd(event.endDate);
  if (!start) return "";
  const month = (m: number) => MONTHS[m - 1];
  if (!end || (end.y === start.y && end.m === start.m && end.d === start.d)) {
    return `${month(start.m)} ${start.d}, ${start.y}`;
  }
  if (end.y === start.y && end.m === start.m) {
    return `${month(start.m)} ${start.d}-${end.d}, ${start.y}`;
  }
  if (end.y === start.y) {
    return `${month(start.m)} ${start.d} - ${month(end.m)} ${end.d}, ${start.y}`;
  }
  return `${month(start.m)} ${start.d}, ${start.y} - ${month(end.m)} ${end.d}, ${end.y}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseYmd(value: string | null | undefined) {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}
