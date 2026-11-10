import type { AppEpa, AppTeam } from "@/lib/external/schemas";

/** A team at the selected event with every outside-data field attached. */
export type EventTeam = AppTeam & {
  /** Statbotics EPA, or null if Statbotics has none (or is unreachable). */
  epa: number | null;
  /** Rank by EPA within this event (1 = strongest), or null. */
  epaRank: number | null;
};

/**
 * Attach Statbotics EPA to the TBA team list.
 *
 * TBA is the source of truth for WHICH teams are at the event. Statbotics only
 * decorates them, so:
 *  - a team Statbotics has never heard of keeps epa = null (it is never dropped);
 *  - a team Statbotics lists but TBA does not is ignored (it is not at this event);
 *  - `epa` may be undefined/null as a whole (Statbotics failed or has no data yet),
 *    in which case every team simply has no EPA and the list still works.
 */
export function mergeTeamsWithEpa(teams: AppTeam[], epa: AppEpa[] | null | undefined): EventTeam[] {
  const byTeam = new Map<number, AppEpa>();
  for (const row of epa ?? []) byTeam.set(row.teamNumber, row);

  return teams.map((team) => {
    const stats = byTeam.get(team.teamNumber);
    return { ...team, epa: stats?.epa ?? null, epaRank: stats?.epaRank ?? null };
  });
}
