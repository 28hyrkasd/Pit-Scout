import "server-only";
import * as z from "zod";
import { getJson, type FetchResult } from "./http";
import { rankDescending } from "./rank";
import { statboticsTeamEventUpstream, type AppEpa } from "./schemas";

const BASE = "https://api.statbotics.io/v3";

/** Statbotics updates after matches; 5 minutes is plenty for scouting. */
const EPA_TTL = 5 * 60;

/**
 * EPA for every team at an event, in ONE request.
 *
 * Statbotics exposes /team_events?event=KEY, which returns the whole event, so
 * we never make per-team calls (which would be ~40-60 requests per page view).
 * A future event returns an empty list, which is a normal state, not an error.
 *
 * Teams with no EPA are still returned (epa = null), and epaRank is computed
 * here over teams that have one, because "how strong is this robot compared to
 * the others at this event" is what scouts actually want.
 */
export async function getEventEpa(eventKey: string): Promise<FetchResult<AppEpa[]>> {
  const result = await getJson(
    `${BASE}/team_events?event=${encodeURIComponent(eventKey)}&limit=1000`,
    z.array(statboticsTeamEventUpstream),
    { revalidate: EPA_TTL, tags: ["statbotics", `statbotics-${eventKey}`] },
  );
  if (!result.ok) return result;

  const rows = result.data.map((r) => ({
    teamNumber: r.team,
    epa: r.epa?.total_points ?? null,
  }));

  const rankByTeam = rankDescending(rows.map((r) => ({ key: r.teamNumber, value: r.epa })));

  return {
    ok: true,
    data: rows
      .map((r) => ({ teamNumber: r.teamNumber, epa: r.epa, epaRank: rankByTeam.get(r.teamNumber) ?? null }))
      .sort((a, b) => a.teamNumber - b.teamNumber),
  };
}
