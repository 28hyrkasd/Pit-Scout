import Link from "next/link";
import { CheckCircle2Icon, CircleDashedIcon, PencilIcon } from "lucide-react";
import { FieldIndicators } from "@/components/teams/field-indicators";
import { SyncBadgeView } from "@/components/teams/sync-badge-view";
import type { MergedEntry } from "@/lib/offline-ui/merge-entries";
import type { FieldDefinition } from "@/lib/fields/types";
import { formatEpa, formatTeamLocation } from "@/lib/teams/detail";
import type { TeamRow } from "@/lib/teams/filter-sort";
import { cn } from "@/lib/utils";

const FOCUS = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** "2 bad · 5 good · 1 okay", only the non-zero parts. */
function summarize(counts: TeamRow["counts"]): string {
  return [
    counts.bad > 0 ? `${counts.bad} bad` : null,
    counts.good > 0 ? `${counts.good} good` : null,
    counts.neutral > 0 ? `${counts.neutral} okay` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One team in the list. Two separate links (never nested): the main area opens the
 * team's detail page, and a 64px-wide button on the right opens the scouting form.
 */
export function TeamCard({
  row,
  fields,
  merged = null,
}: {
  row: TeamRow;
  fields: FieldDefinition[];
  /** This device's record for the team merged over the server's: carries the "Not synced yet" badge. */
  merged?: MergedEntry | null;
}) {
  const { team, scouted } = row;
  const location = formatTeamLocation(team);
  const summary = scouted ? summarize(row.counts) : "";

  return (
    <li className="flex items-stretch rounded-lg border bg-card text-card-foreground">
      <Link
        href={`/teams/${row.teamNumber}`}
        className={cn("flex min-h-16 min-w-0 flex-1 flex-col gap-1.5 rounded-l-lg p-3", FOCUS)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-base font-semibold tabular-nums">{row.teamNumber}</span>
          <span className="truncate font-medium">{team.name}</span>
        </span>

        {location ? <span className="truncate text-xs text-muted-foreground">{location}</span> : null}
        {!row.inEventList ? (
          <span className="text-xs text-muted-foreground">Not on this event&apos;s team list</span>
        ) : null}

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            Rank <span className="font-medium text-foreground tabular-nums">{team.rank ?? "–"}</span>
          </span>
          <span>
            EPA <span className="font-medium text-foreground tabular-nums">{formatEpa(team.epa)}</span>
          </span>
          {scouted && row.entry?.rating != null ? (
            <span>
              Rated <span className="font-medium text-foreground tabular-nums">{row.entry.rating}/5</span>
            </span>
          ) : null}
        </span>

        {scouted ? (
          <span className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                <CheckCircle2Icon className="size-3.5" aria-hidden /> Scouted
                {summary ? <span className="font-normal text-muted-foreground">· {summary}</span> : null}
              </span>
              {merged?.badge ? <SyncBadgeView badge={merged.badge} /> : null}
            </span>
            {merged?.superseded ? (
              <span className="text-xs text-muted-foreground">Another scout&apos;s newer version is shown.</span>
            ) : null}
            <FieldIndicators fields={fields} ratings={row.ratings} />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <CircleDashedIcon className="size-3.5" aria-hidden /> Not scouted yet
          </span>
        )}
      </Link>

      <Link
        href={`/teams/${row.teamNumber}/edit`}
        aria-label={`${scouted ? "Edit scouting for" : "Scout"} team ${row.teamNumber}`}
        className={cn(
          "flex min-h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-r-lg border-l text-xs font-medium hover:bg-muted",
          FOCUS,
        )}
      >
        <PencilIcon className="size-4" aria-hidden />
        {scouted ? "Edit" : "Scout"}
      </Link>
    </li>
  );
}
