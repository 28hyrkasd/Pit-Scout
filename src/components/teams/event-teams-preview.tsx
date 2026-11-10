"use client";

import { useEffect, useMemo } from "react";
import { CloudOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { handleUnauthorized, useEventEpa, useEventTeams } from "@/lib/api/queries";
import { mergeTeamsWithEpa } from "@/lib/teams/merge";

/**
 * Phase 4 placeholder for the team list: proves the event + TBA + Statbotics data
 * flows end to end. Phase 7 replaces it with the sortable/filterable list, which
 * builds on the same hooks and mergeTeamsWithEpa().
 */
export function EventTeamsPreview({ eventKey }: { eventKey: string }) {
  const teams = useEventTeams(eventKey);
  const epa = useEventEpa(eventKey);

  useEffect(() => {
    handleUnauthorized(teams.error);
    handleUnauthorized(epa.error);
  }, [teams.error, epa.error]);

  const merged = useMemo(
    () => (teams.data ? mergeTeamsWithEpa(teams.data.data, epa.data?.data) : []),
    [teams.data, epa.data],
  );

  if (teams.isPending) {
    return (
      <ul className="flex flex-col gap-2" aria-label="Loading teams" aria-busy>
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
        ))}
      </ul>
    );
  }

  if (teams.isError && !teams.data) {
    const offline = teams.error instanceof ApiError && teams.error.kind === "network";
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <CloudOffIcon className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">{teams.error instanceof ApiError ? teams.error.message : "Could not load teams."}</p>
        {offline ? (
          <p className="text-xs text-muted-foreground">
            Teams you have already loaded will be available offline in a later update.
          </p>
        ) : null}
        <Button type="button" variant="outline" className="h-11" onClick={() => teams.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (merged.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        No teams are listed for this event yet. TBA usually publishes the team list a few weeks before the event.
      </p>
    );
  }

  // Statbotics is optional. Say so quietly instead of failing the whole list.
  const epaUnavailable = epa.isError;
  const epaEmpty = !epa.isError && !epa.isPending && (epa.data?.data.length ?? 0) === 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {merged.length} teams
        {epaUnavailable ? " · EPA unavailable right now" : epaEmpty ? " · no EPA yet (event hasn't started)" : ""}
      </p>
      <ul className="flex flex-col gap-2">
        {merged.map((team) => (
          <li key={team.teamNumber} className="flex min-h-16 items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">
                <span className="tabular-nums">{team.teamNumber}</span> · {team.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[team.city, team.stateProv].filter(Boolean).join(", ") || "\u00A0"}
              </p>
            </div>
            <dl className="flex shrink-0 gap-4 text-right text-xs">
              <div>
                <dt className="text-muted-foreground">Rank</dt>
                <dd className="font-medium tabular-nums">{team.rank ?? "–"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">EPA</dt>
                <dd className="font-medium tabular-nums">{team.epa === null ? "–" : team.epa.toFixed(1)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
