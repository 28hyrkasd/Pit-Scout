import "server-only";
import * as z from "zod";
import { getServerEnv } from "@/lib/env.server";
import { getJson, type FetchResult } from "./http";
import {
  tbaEventUpstream,
  tbaRankingsUpstream,
  tbaTeamStatusUpstream,
  tbaTeamUpstream,
  type AppEvent,
  type AppTeam,
} from "./schemas";

const BASE = "https://www.thebluealliance.com/api/v3";

// Cache windows (seconds). TBA itself says 61s; these are deliberately longer
// for data that barely changes, to stay well inside rate limits.
const HOUR = 60 * 60;
const TTL = {
  events: HOUR,
  teams: HOUR,
  rankings: 2 * 60,
  status: 2 * 60,
} as const;

function tbaHeaders() {
  return { "X-TBA-Auth-Key": getServerEnv().TBA_API_KEY };
}

function toAppEvent(e: z.infer<typeof tbaEventUpstream>): AppEvent {
  return {
    key: e.key,
    name: e.name,
    year: e.year,
    startDate: e.start_date ?? null,
    endDate: e.end_date ?? null,
    city: e.city ?? null,
    stateProv: e.state_prov ?? null,
    country: e.country ?? null,
  };
}

/** All events in a year, soonest first. Cached for an hour. */
export async function getEventsForYear(year: number): Promise<FetchResult<AppEvent[]>> {
  const result = await getJson(`${BASE}/events/${year}/simple`, z.array(tbaEventUpstream), {
    headers: tbaHeaders(),
    revalidate: TTL.events,
    tags: ["tba", `tba-events-${year}`],
  });
  if (!result.ok) return result;

  const events = result.data
    .map(toAppEvent)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.name.localeCompare(b.name));
  return { ok: true, data: events };
}


/** One event by key. */
export async function getEvent(eventKey: string): Promise<FetchResult<AppEvent>> {
  const result = await getJson(`${BASE}/event/${eventKey}/simple`, tbaEventUpstream, {
    headers: tbaHeaders(),
    revalidate: TTL.events,
    tags: ["tba", `tba-event-${eventKey}`],
  });
  if (!result.ok) return result;
  return { ok: true, data: toAppEvent(result.data) };
}

/**
 * Teams at an event, with qualification rank/record merged in when available.
 *
 * The team list is the essential data; rankings are a bonus. If the rankings
 * call fails (or the event has none yet), teams are still returned with
 * rank = null instead of failing the whole request.
 */
export async function getEventTeams(eventKey: string): Promise<FetchResult<AppTeam[]>> {
  const [teamsRes, rankingsRes] = await Promise.all([
    getJson(`${BASE}/event/${eventKey}/teams/simple`, z.array(tbaTeamUpstream), {
      headers: tbaHeaders(),
      revalidate: TTL.teams,
      tags: ["tba", `tba-teams-${eventKey}`],
    }),
    getJson(`${BASE}/event/${eventKey}/rankings`, tbaRankingsUpstream, {
      headers: tbaHeaders(),
      revalidate: TTL.rankings,
      tags: ["tba", `tba-rankings-${eventKey}`],
    }),
  ]);

  if (!teamsRes.ok) return teamsRes;

  const byTeam = new Map<string, { rank: number; record: AppTeam["record"] }>();
  if (rankingsRes.ok && rankingsRes.data) {
    for (const r of rankingsRes.data.rankings) {
      byTeam.set(r.team_key, {
        rank: r.rank,
        record: r.record ? { wins: r.record.wins, losses: r.record.losses, ties: r.record.ties } : null,
      });
    }
  }

  const teams: AppTeam[] = teamsRes.data
    .map((t) => {
      const ranking = byTeam.get(t.key);
      return {
        teamNumber: t.team_number,
        name: cleanName(t.nickname) ?? `Team ${t.team_number}`,
        city: t.city ?? null,
        stateProv: t.state_prov ?? null,
        country: t.country ?? null,
        rank: ranking?.rank ?? null,
        record: ranking?.record ?? null,
      };
    })
    .sort((a, b) => a.teamNumber - b.teamNumber);

  return { ok: true, data: teams };
}

export type TeamEventStatus = {
  rank: number | null;
  numTeams: number | null;
  record: { wins: number; losses: number; ties: number } | null;
  matchesPlayed: number | null;
  /** TBA's human summary, e.g. "Team 254 is 5-2-0 and ranked 3rd". HTML-stripped. */
  summary: string | null;
  pitLocation: string | null;
};

/** Rank/record/pit for one team at one event. data is null if TBA has no status yet. */
export async function getTeamEventStatus(
  teamNumber: number,
  eventKey: string,
): Promise<FetchResult<TeamEventStatus | null>> {
  const result = await getJson(`${BASE}/team/frc${teamNumber}/event/${eventKey}/status`, tbaTeamStatusUpstream, {
    headers: tbaHeaders(),
    revalidate: TTL.status,
    tags: ["tba", `tba-status-${eventKey}-${teamNumber}`],
  });
  if (!result.ok) return result;
  if (!result.data) return { ok: true, data: null };

  const ranking = result.data.qual?.ranking;
  return {
    ok: true,
    data: {
      rank: ranking?.rank ?? null,
      numTeams: result.data.qual?.num_teams ?? null,
      record: ranking?.record
        ? { wins: ranking.record.wins, losses: ranking.record.losses, ties: ranking.record.ties }
        : null,
      matchesPlayed: ranking?.matches_played ?? null,
      summary: stripHtml(result.data.overall_status_str),
      pitLocation: result.data.pit_location ?? null,
    },
  };
}

/** TBA nicknames are user-entered; trim and drop empty/junk values like "\n". */
function cleanName(name: string | null | undefined): string | null {
  const trimmed = name?.replace(/\\n|\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

/** TBA status strings contain HTML (<b>…</b>). We render plain text only. */
function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return text || null;
}
