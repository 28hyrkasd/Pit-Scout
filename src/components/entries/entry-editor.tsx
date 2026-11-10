"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarSearchIcon, CloudOffIcon } from "lucide-react";
import { EntryForm } from "@/components/entries/entry-form";
import { CachedDataNotice } from "@/components/offline/cached-data-notice";
import { useTeamEntry } from "@/components/offline/use-merged-entries";
import { Button } from "@/components/ui/button";
import { useEventTeams } from "@/lib/api/queries";
import { useRedirectOnUnauthorized } from "@/lib/api/use-unauthorized-redirect";
import { classifySaveError } from "@/lib/entries/save-error";
import { activeFields, useFields } from "@/lib/fields/api";
import { useSelectedEvent } from "@/lib/local/use-selected-event";
import { oldestCachedAt } from "@/lib/offline-ui/sync-status";

const TEAM_NUMBER = /^[1-9][0-9]{0,4}$/;

// False on the server and during hydration, true afterwards. localStorage (the
// selected event) is unreadable before that, and "no event selected" must not flash.
const subscribeNever = () => () => {};
function useHydrated() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading">
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </div>
  );
}

/** Loads everything the form needs, then renders it. The URL segment arrives as a string. */
export function EntryEditor({ rawTeamNumber }: { rawTeamNumber: string }) {
  if (!TEAM_NUMBER.test(rawTeamNumber)) {
    return (
      <Notice title="That is not a valid team number">
        <Button render={<Link href="/" />} variant="outline" className="h-11">
          Back to teams
        </Button>
      </Notice>
    );
  }
  return <LoadedEditor teamNumber={Number(rawTeamNumber)} />;
}

function LoadedEditor({ teamNumber }: { teamNumber: number }) {
  const hydrated = useHydrated();
  const { event } = useSelectedEvent();
  const fieldsQuery = useFields();
  // The device's own record wins over the server's when it is newer or not synced yet; with neither
  // available the form still opens (blank), so scouting works with no connection at all.
  const teamEntry = useTeamEntry(event?.key ?? null, teamNumber);
  // The team's name comes from the cached team list. It is a nicety: never block on it.
  const teamsQuery = useEventTeams(event?.key ?? null);

  const fields = useMemo(() => activeFields(fieldsQuery.data?.fields ?? []), [fieldsQuery.data]);
  const teamName = teamsQuery.data?.data.find((t) => t.teamNumber === teamNumber)?.name ?? null;

  // Expired session while LOADING (nothing on screen yet): go sign in. Once the form shows, a failed background
  // refetch must never replace it, and a form with unsaved edits blocks the redirect (see loginRedirectUrl).
  useRedirectOnUnauthorized(fieldsQuery.data ? null : fieldsQuery.error);
  useRedirectOnUnauthorized(teamEntry.merged ? null : teamEntry.serverError);

  if (!hydrated) return <EditorSkeleton />;

  if (!event) {
    return (
      <Notice title="Pick an event first">
        <CalendarSearchIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Choose the event you are at, then open a team to scout it.</p>
        <Button render={<Link href="/" />} className="h-11">
          Go to teams
        </Button>
      </Notice>
    );
  }

  // Not being able to reach the server about THIS TEAM is not blocking (the form opens from the device's record
  // or blank, with a notice). Failing for any other reason (e.g. no permission) is, and so are missing fields.
  const entryBlocked = teamEntry.serverUnknown && !teamEntry.serverUnreachable && teamEntry.merged === null;
  if ((fieldsQuery.isError && !fieldsQuery.data) || entryBlocked) {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <CloudOffIcon className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">
          {fieldsQuery.isError && !fieldsQuery.data
            ? fieldsQuery.error instanceof Error
              ? fieldsQuery.error.message
              : "Could not load the scouting fields."
            : classifySaveError(teamEntry.serverError).message}
        </p>
        <p className="text-xs text-muted-foreground">
          Tip: the scouting fields are saved on this device the first time they load, so this works offline afterwards.
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => {
            if (fieldsQuery.isError) void fieldsQuery.refetch();
            void teamEntry.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (fieldsQuery.isPending || teamEntry.loading) return <EditorSkeleton />;

  const hiddenInvalid = fieldsQuery.data.invalid.length;

  return (
    <div className="flex flex-col gap-4">
      <CachedDataNotice cachedAt={oldestCachedAt(fieldsQuery.data.cachedAt, teamEntry.cachedAt)} />
      {hiddenInvalid > 0 ? (
        <p role="status" className="rounded-lg border p-3 text-sm text-muted-foreground">
          {hiddenInvalid} field{hiddenInvalid === 1 ? " has" : "s have"} a broken setup and {hiddenInvalid === 1 ? "is" : "are"} hidden.
          Fix {hiddenInvalid === 1 ? "it" : "them"} in Fields.
        </p>
      ) : null}
      {/* Keyed by event+team only: the form keeps its own state across saves and refetches. */}
      <EntryForm
        key={`${event.key}:${teamNumber}`}
        event={event}
        teamNumber={teamNumber}
        teamName={teamName}
        fields={fields}
        entry={teamEntry.merged?.entry ?? null}
      />
    </div>
  );
}
