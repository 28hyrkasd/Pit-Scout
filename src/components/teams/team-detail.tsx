"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeftIcon, CalendarSearchIcon, ClipboardPenIcon, CloudOffIcon, InfoIcon, PencilIcon } from "lucide-react";
import { ColorChip } from "@/components/fields/color-chip";
import { CachedDataNotice } from "@/components/offline/cached-data-notice";
import { useTeamEntry, useTeamPhotos } from "@/components/offline/use-merged-entries";
import { SyncBadgeView } from "@/components/teams/sync-badge-view";
import { TeamPhotos } from "@/components/teams/team-photos";
import { Button } from "@/components/ui/button";
import { useEventEpa, useEventTeams } from "@/lib/api/queries";
import { useRedirectOnUnauthorized } from "@/lib/api/use-unauthorized-redirect";
import type { SavedEntry } from "@/lib/entries/rpc";
import { classifySaveError } from "@/lib/entries/save-error";
import { activeFields, useFields } from "@/lib/fields/api";
import { useSelectedEvent } from "@/lib/local/use-selected-event";
import { SUPERSEDED_NOTICE, type MergedEntry } from "@/lib/offline-ui/merge-entries";
import { oldestCachedAt } from "@/lib/offline-ui/sync-status";
import {
  buildDetailSections,
  formatEpa,
  formatRecord,
  formatTeamLocation,
  formatTimestamp,
  type DetailItem,
} from "@/lib/teams/detail";
import { sortFieldsForDisplay } from "@/lib/teams/filter-sort";
import { mergeTeamsWithEpa } from "@/lib/teams/merge";

const TEAM_NUMBER = /^[1-9][0-9]{0,4}$/;

// False on the server and during hydration, true afterwards: the selected event is in
// localStorage, so "no event selected" must not flash before it can be read.
const subscribeNever = () => () => {};
function useHydrated() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export function TeamDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading team">
      <div className="h-6 w-56 animate-pulse rounded bg-muted" />
      <div className="h-20 animate-pulse rounded-lg bg-muted" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
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

/** The URL segment arrives as a string; anything that is not a plausible team number gets a friendly message. */
export function TeamDetail({ rawTeamNumber }: { rawTeamNumber: string }) {
  if (!TEAM_NUMBER.test(rawTeamNumber)) {
    return (
      <Notice title="That is not a valid team number">
        <Button render={<Link href="/" />} variant="outline" className="h-11">
          Back to teams
        </Button>
      </Notice>
    );
  }
  return <LoadedTeamDetail teamNumber={Number(rawTeamNumber)} />;
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="border-b pb-1 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function AnswerRow({ item }: { item: DetailItem }) {
  const isLongText = item.field.type === "text" && item.text !== null;
  return (
    <li className="flex flex-col gap-1.5 border-b py-2.5 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-sm font-medium">{item.field.name}</span>
      {isLongText ? (
        <span className="flex min-w-0 items-start gap-2 sm:max-w-[60%]">
          <ColorChip rating={item.rating} className="mt-0.5 shrink-0" />
          <span className="min-w-0 text-sm break-words whitespace-pre-wrap">{item.text}</span>
        </span>
      ) : (
        <ColorChip rating={item.rating} className="h-auto w-fit max-w-full whitespace-normal">
          <span className="break-words">{item.text ?? (item.stale ? "Option no longer exists" : "No data")}</span>
        </ColorChip>
      )}
    </li>
  );
}

function ScoutedBody({
  merged,
  sections,
  photos,
}: {
  merged: MergedEntry;
  sections: ReturnType<typeof buildDetailSections>;
  photos: ReturnType<typeof useTeamPhotos>;
}) {
  const entry: SavedEntry = merged.entry;
  const updated = formatTimestamp(entry.updatedAt);
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            Scouted by <span className="font-medium text-foreground">{entry.scoutedBy ?? "unknown"}</span>
            {updated ? <> · updated {updated}</> : null}
          </span>
          {merged.badge ? <SyncBadgeView badge={merged.badge} /> : null}
        </p>
        {merged.superseded ? (
          <p role="status" className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {SUPERSEDED_NOTICE}
          </p>
        ) : null}
      </div>

      <Section id="detail-overall" title="Overall rating">
        {entry.rating === null ? (
          <p className="text-sm text-muted-foreground">Not rated.</p>
        ) : (
          <p className="text-2xl font-semibold tabular-nums">
            {entry.rating}
            <span className="text-base font-normal text-muted-foreground"> / 5</span>
          </p>
        )}
      </Section>

      <Section id="detail-photos" title="Photos">
        <TeamPhotos state={photos} />
      </Section>

      {sections.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">There are no scouting fields set up.</p>
      ) : (
        sections.map((section) => (
          <Section key={section.section} id={`detail-${section.section}`} title={section.label}>
            <ul>
              {section.items.map((item) => (
                <AnswerRow key={item.field.id} item={item} />
              ))}
            </ul>
          </Section>
        ))
      )}

      <Section id="detail-notes" title="Notes">
        {entry.notes?.trim() ? (
          <p className="text-sm break-words whitespace-pre-wrap">{entry.notes}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No notes.</p>
        )}
      </Section>
    </>
  );
}

function LoadedTeamDetail({ teamNumber }: { teamNumber: number }) {
  const hydrated = useHydrated();
  const { event } = useSelectedEvent();
  const eventKey = event?.key ?? null;

  const fieldsQuery = useFields();
  const teamEntry = useTeamEntry(eventKey, teamNumber);
  const photos = useTeamPhotos(eventKey, teamNumber, teamEntry.merged);
  // TBA and Statbotics only decorate the page. Their failure never blocks the scouting data.
  const teamsQuery = useEventTeams(eventKey);
  const epaQuery = useEventEpa(eventKey);

  useRedirectOnUnauthorized(fieldsQuery.error);
  useRedirectOnUnauthorized(teamEntry.serverError);
  useRedirectOnUnauthorized(teamsQuery.error);
  useRedirectOnUnauthorized(epaQuery.error);

  const fields = useMemo(() => sortFieldsForDisplay(activeFields(fieldsQuery.data?.fields ?? [])), [fieldsQuery.data]);
  const merged = teamEntry.merged;
  const entry = merged?.entry ?? null;
  const sections = useMemo(() => buildDetailSections(fields, entry?.answers ?? {}), [fields, entry]);
  const eventTeam = useMemo(
    () => (teamsQuery.data ? mergeTeamsWithEpa(teamsQuery.data.data, epaQuery.data?.data) : []).find((t) => t.teamNumber === teamNumber),
    [teamsQuery.data, epaQuery.data, teamNumber],
  );

  if (!hydrated) return <TeamDetailSkeleton />;

  if (!event) {
    return (
      <Notice title="Pick an event first">
        <CalendarSearchIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Choose the event you are at to see a team&apos;s scouting.</p>
        <Button render={<Link href="/" />} className="h-11">
          Go to teams
        </Button>
      </Notice>
    );
  }

  // Without field definitions the page cannot be laid out. Without the server's entry it can still show this
  // device's own record, so only "we know nothing about this team" is an error.
  const entryUnknown = teamEntry.serverUnknown && merged === null;
  if ((fieldsQuery.isError && !fieldsQuery.data) || entryUnknown) {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <CloudOffIcon className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">
          {entryUnknown
            ? teamEntry.serverUnreachable
              ? "Can't reach the server, and nothing is saved on this device for this team yet."
              : classifySaveError(teamEntry.serverError).message
            : fieldsQuery.error instanceof Error
              ? fieldsQuery.error.message
              : "Could not load the scouting fields."}
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
        {entryUnknown && teamEntry.serverUnreachable ? (
          <Button render={<Link href={`/teams/${teamNumber}/edit`} />} className="h-11 gap-2 px-4">
            <PencilIcon aria-hidden /> Scout this team anyway
          </Button>
        ) : null}
      </div>
    );
  }

  if (fieldsQuery.isPending || teamEntry.loading) return <TeamDetailSkeleton />;

  const editHref = `/teams/${teamNumber}/edit`;
  const location = eventTeam ? formatTeamLocation(eventTeam) : null;
  const record = eventTeam ? formatRecord(eventTeam.record) : null;

  // Quiet notes about the optional outside data.
  const outsideNotes: string[] = [];
  if (teamsQuery.isError && !teamsQuery.data) outsideNotes.push("TBA data (name, rank, record) is unavailable right now.");
  else if (teamsQuery.data && !eventTeam) outsideNotes.push("This team is not on the event's TBA team list.");
  if (epaQuery.isError && !epaQuery.data) outsideNotes.push("Statbotics EPA is unavailable right now.");
  const cachedAt = oldestCachedAt(
    teamsQuery.data?.cachedAt,
    epaQuery.data?.cachedAt,
    fieldsQuery.data?.cachedAt,
    teamEntry.cachedAt,
  );

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/"
          className="-ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon className="size-4" aria-hidden /> Teams
        </Link>
        <h1 className="text-xl font-semibold">
          <span className="tabular-nums">Team {teamNumber}</span>
          {eventTeam ? <span className="font-normal text-muted-foreground"> · {eventTeam.name}</span> : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[location, event.name].filter(Boolean).join(" · ")}
        </p>

        {eventTeam || (teamsQuery.isPending && !teamsQuery.data) ? (
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <Stat label="Rank" value={teamsQuery.isPending ? "…" : (eventTeam?.rank?.toString() ?? "–")} />
            <Stat label="Record" value={teamsQuery.isPending ? "…" : (record ?? "–")} />
            <Stat
              label="EPA"
              value={epaQuery.isPending ? "…" : formatEpa(eventTeam?.epa)}
              hint={eventTeam?.epaRank != null ? `#${eventTeam.epaRank}` : undefined}
            />
          </dl>
        ) : null}
        {outsideNotes.length > 0 ? <p className="text-xs text-muted-foreground">{outsideNotes.join(" ")}</p> : null}
        <CachedDataNotice cachedAt={cachedAt} />
      </div>

      {entry && merged ? (
        <>
          <Button render={<Link href={editHref} />} variant="outline" className="h-11 w-fit gap-2 px-4">
            <PencilIcon aria-hidden /> Edit scouting
          </Button>
          <ScoutedBody merged={merged} sections={sections} photos={photos} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
          <ClipboardPenIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold">Nobody has scouted this team yet</h2>
          <p className="text-sm text-muted-foreground">
            Add the robot&apos;s specs, photos and a rating so the whole team can see them here.
          </p>
          <Button render={<Link href={editHref} />} className="h-12 gap-2 px-6 text-base">
            <PencilIcon aria-hidden /> Scout this team
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">
        {value}
        {hint ? <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}
