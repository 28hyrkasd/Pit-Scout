"use client";

import { useEffect, useMemo, useState } from "react";
import { CloudOffIcon, SearchXIcon } from "lucide-react";
import { CachedDataNotice } from "@/components/offline/cached-data-notice";
import { useMergedEventEntries } from "@/components/offline/use-merged-entries";
import { TeamCard } from "@/components/teams/team-card";
import { TeamListControls } from "@/components/teams/team-list-controls";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { useEventEpa, useEventTeams } from "@/lib/api/queries";
import { useRedirectOnUnauthorized } from "@/lib/api/use-unauthorized-redirect";
import { activeFields, useFields } from "@/lib/fields/api";
import {
  applyListOptions,
  buildTeamRows,
  DEFAULT_OPTIONS,
  sortFieldsForDisplay,
  type ListOptions,
} from "@/lib/teams/filter-sort";
import { LIST_PREFS_STORAGE_KEY, parseListPrefs, sanitizeListPrefs, serializeListPrefs } from "@/lib/teams/list-prefs";
import { oldestCachedAt } from "@/lib/offline-ui/sync-status";
import { mergeTeamsWithEpa } from "@/lib/teams/merge";

/**
 * Only called from a component that mounts after hydration (the selected event
 * lives in localStorage, so the home page renders no list on the server), which
 * is why reading storage in a state initializer cannot cause a hydration mismatch.
 */
function loadPrefs(): ListOptions {
  try {
    return parseListPrefs(window.sessionStorage.getItem(LIST_PREFS_STORAGE_KEY));
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-label="Loading teams" aria-busy>
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
      ))}
    </ul>
  );
}

function Alert({ message, onRetry, children }: { message: string; onRetry: () => void; children?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
      <CloudOffIcon className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm">{message}</p>
      {children}
      <Button type="button" variant="outline" className="h-11" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The home page team list: every team at the event with its scouting status, searchable, filterable, sortable. */
export function EventTeamList({ eventKey }: { eventKey: string }) {
  const teams = useEventTeams(eventKey);
  const epa = useEventEpa(eventKey);
  // Scouting entries: this device's own records (including ones not synced yet) merged over the server's.
  const entries = useMergedEventEntries(eventKey);
  const fieldsQuery = useFields();

  useRedirectOnUnauthorized(teams.error);
  useRedirectOnUnauthorized(epa.error);
  useRedirectOnUnauthorized(entries.error);
  useRedirectOnUnauthorized(fieldsQuery.error);

  const [stored, setStored] = useState<ListOptions>(loadPrefs);

  const fields = useMemo(() => sortFieldsForDisplay(activeFields(fieldsQuery.data?.fields ?? [])), [fieldsQuery.data]);

  // A saved sort/filter may name a field that was since removed or archived.
  const options = useMemo(
    () => (fieldsQuery.data ? sanitizeListPrefs(stored, new Set(fields.map((f) => f.id))) : stored),
    [stored, fields, fieldsQuery.data],
  );

  useEffect(() => {
    try {
      window.sessionStorage.setItem(LIST_PREFS_STORAGE_KEY, serializeListPrefs(options));
    } catch {
      // Storage full or blocked (private mode): the choices just do not survive navigation.
    }
  }, [options]);

  const merged = useMemo(
    () => (teams.data ? mergeTeamsWithEpa(teams.data.data, epa.data?.data) : []),
    [teams.data, epa.data],
  );
  const rows = useMemo(() => buildTeamRows(merged, entries.entries, fields), [merged, entries.entries, fields]);
  const visible = useMemo(() => applyListOptions(rows, fields, options), [rows, fields, options]);

  // Without field definitions the list would show wrong statuses, so it is not shown. (The server's entries
  // being unreachable is different: the list still works from this device's records, with a notice below.)
  if (fieldsQuery.isError && !fieldsQuery.data) {
    return (
      <Alert
        message={fieldsQuery.error instanceof Error ? fieldsQuery.error.message : "Could not load the scouting fields."}
        onRetry={() => void fieldsQuery.refetch()}
      />
    );
  }

  if ((teams.isPending && !teams.data) || entries.loading || fieldsQuery.isPending) return <ListSkeleton />;

  const teamsUnavailable = teams.isError && !teams.data;
  const cachedAt = oldestCachedAt(teams.data?.cachedAt, epa.data?.cachedAt, fieldsQuery.data?.cachedAt, entries.cachedAt);
  // Statbotics is optional. Say so quietly instead of failing the whole list.
  const epaUnavailable = epa.isError && !epa.data;
  const epaEmpty = !epa.isError && !epa.isPending && (epa.data?.data.length ?? 0) === 0;
  const notes = [
    epaUnavailable ? "EPA unavailable right now" : epaEmpty ? "No EPA yet (event hasn't started)" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <CachedDataNotice cachedAt={cachedAt} />
      {entries.serverUnavailable ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p>
            Other scouts&apos; entries aren&apos;t loaded (no connection and nothing saved yet). Teams marked &quot;Not
            scouted yet&quot; may already have notes. Entries saved on this device are shown.
          </p>
          <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => void entries.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {teamsUnavailable ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p>
            {teams.error instanceof ApiError ? teams.error.message : "Could not load the team list."} Showing only teams
            that have been scouted.
          </p>
          <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => void teams.refetch()}>
            Reload team list
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {teamsUnavailable
            ? "Nothing has been scouted at this event yet."
            : "No teams are listed for this event yet. TBA usually publishes the team list a few weeks before the event."}
        </p>
      ) : (
        <>
          <TeamListControls
            options={options}
            onChange={setStored}
            fields={fields}
            shown={visible.length}
            total={rows.length}
          />
          {notes.length > 0 ? <p className="text-xs text-muted-foreground">{notes.join(" · ")}</p> : null}

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
              <SearchXIcon className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm">No teams match your search and filters.</p>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setStored({ ...DEFAULT_OPTIONS, sort: options.sort, direction: options.direction })}
              >
                Clear search and filters
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Teams">
              {visible.map((row) => (
                <TeamCard key={row.teamNumber} row={row} fields={fields} merged={entries.byTeam.get(row.teamNumber) ?? null} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
