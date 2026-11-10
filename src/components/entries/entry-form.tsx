"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  InfoIcon,
  Loader2Icon,
  PencilIcon,
} from "lucide-react";
import { toast } from "sonner";
import { FieldInput } from "@/components/entries/field-input";
import { PhotoSection } from "@/components/entries/photo-section";
import { ScoutNameDialog } from "@/components/entries/scout-name-dialog";
import { Segmented } from "@/components/entries/segmented";
import { usePhotoStaging } from "@/components/entries/use-photo-staging";
import { useOffline } from "@/components/offline/offline-provider";
import { useTeamEntry, useTeamPhotos } from "@/components/offline/use-merged-entries";
import { SyncBadgeView } from "@/components/teams/sync-badge-view";
import { Button } from "@/components/ui/button";
import {
  buildEntryFormSchema,
  entryToFormValues,
  MAX_NOTES_LENGTH,
  type EntryFormValues,
} from "@/lib/entries/form";
import { buildEntryPayload } from "@/lib/entries/payload";
import type { SavedEntry } from "@/lib/entries/rpc";
import type { AppEvent } from "@/lib/external/schemas";
import {
  SECTIONS,
  SECTION_LABELS,
  type FieldDefinition,
} from "@/lib/fields/types";
import { useScoutName } from "@/lib/local/use-scout-name";
import { getLocalEntry } from "@/lib/offline/local";
import { isPausedForAuth } from "@/lib/offline/sync";
import { SUPERSEDED_NOTICE } from "@/lib/offline-ui/merge-entries";
import {
  describeLocalSaveError,
  describeSaveOutcome,
  resolvePhotoRemovals,
  saveScoutingLocally,
} from "@/lib/offline-ui/local-save";
import { useUnsavedChangesGuard } from "@/lib/unsaved-guard";

type Props = {
  event: AppEvent;
  teamNumber: number;
  teamName: string | null;
  /** ACTIVE fields only, already in display order. */
  fields: FieldDefinition[];
  /**
   * The entry the form STARTS from: the device's own record when it has one, else the server's (or cached
   * server) version, else null. Only the first render's value matters; the form owns its state afterwards.
   */
  entry: SavedEntry | null;
};

const RATING_OPTIONS = ["1", "2", "3", "4", "5"].map((n) => ({
  value: n,
  label: n,
}));
/** Where the back link goes. After a save we show the team's detail page instead. */
const BACK_PATH = "/";

export function EntryForm({
  event,
  teamNumber,
  teamName,
  fields,
  entry,
}: Props) {
  const router = useRouter();
  const scout = useScoutName();
  const offline = useOffline();

  const schema = useMemo(() => buildEntryFormSchema(fields), [fields]);
  // Only the first render's values matter: the form owns the state after that.
  const [defaultValues] = useState(() => entryToFormValues(fields, entry));
  const form = useForm<EntryFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { control, register, handleSubmit, reset, formState } = form;
  const { errors, isDirty } = formState;

  // Live view of what exists for this team: the device's record merged over the server's. After a save the
  // device's record shows up here by itself (the offline provider refreshes it).
  const teamEntry = useTeamEntry(event.key, teamNumber);
  const { merged, serverEntry } = teamEntry;
  const current = merged?.entry ?? null;

  const photoState = useTeamPhotos(event.key, teamNumber, merged);
  const savedPhotos = photoState.photos;
  const photos = usePhotoStaging(savedPhotos.length);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);

  const dirty =
    isDirty || photos.staged.length > 0 || photos.removedIds.size > 0;
  useUnsavedChangesGuard(dirty);

  const busy = saving || photos.processing > 0;

  /** Removals for the core: a server photo needs its record (the device may never have seen it); a device photo needs only its id. */
  function collectRemovals() {
    return resolvePhotoRemovals({
      removedIds: photos.removedIds,
      saved: savedPhotos,
      serverPhotos: photoState.serverPhotos,
      serverEntryId: photoState.serverEntryId,
    });
  }

  async function onSubmit(values: EntryFormValues) {
    setSaveError(null);
    const store = offline.store;
    if (!store) {
      // IndexedDB (or the in-memory fallback) is still opening; that takes a moment at app start.
      setSaveError("Still getting this device ready to save. Try again in a moment.");
      return;
    }

    const resolved = collectRemovals();
    if (resolved.unresolved.length > 0) {
      // Never save while a removal could be silently dropped: the tile would disappear but the photo would stay.
      setSaveError(
        "Can't remove a photo yet because the saved photos haven't finished loading. Nothing was saved. Try again in a moment.",
      );
      return;
    }

    const photoChanges = photos.staged.length > 0 || photos.removedIds.size > 0;
    // Re-saving an unchanged form would only bump the last-write-wins clock (and could override another
    // scout's newer answers for nothing), so a photo-only change leaves the entry alone. A team nobody has
    // scouted yet is always created, even from a blank form.
    const writeEntry = merged === null || isDirty;
    if (!writeEntry && !photoChanges) {
      toast.info("No changes to save.");
      router.push(`/teams/${teamNumber}`);
      return;
    }

    setSaving(true);
    let result;
    try {
      // The clock and the new id are read inside the local save, in this handler: they must never run during render.
      result = await saveScoutingLocally(store, {
        event,
        teamNumber,
        payload: buildEntryPayload(values, fields, {
          scoutedBy: scout.name ?? current?.scoutedBy ?? null,
          existingAnswers: current?.answers,
        }),
        base: serverEntry,
        writeEntry,
        staged: photos.staged.map(({ id, blob }) => ({ id, blob })),
        removals: resolved.removals,
      });
    } catch (error) {
      // Nothing was written. Everything the scout entered stays on screen so they can retry.
      const message = describeLocalSaveError(error);
      setSaveError(message);
      toast.error(message);
      setSaving(false);
      return;
    }

    photos.settle(result.addedPhotoIds, [...result.removedPhotoIds, ...resolved.alreadyGone]);
    // Send what was just saved (non-blocking). It also refreshes the sync counters and this team's merged view.
    const syncAttempt = offline.notifyLocalChange();

    if (result.photoFailures.length > 0) {
      const n = result.photoFailures.length;
      const message = `Saved on this device, but ${n} photo change${n === 1 ? "" : "s"} could not be saved. Press Save to try again.`;
      setSaveError(message);
      toast.error(message);
      setSaving(false);
      return;
    }

    reset(values); // saved: the form is clean again, so leaving does not prompt
    // Honest wording: at this point the entry is only on THIS device. The toast is upgraded to "synced"
    // only if the sync pass that just ran says the entry really is synced.
    const toastId = toast.success(`Team ${teamNumber} saved on this device`, {
      description:
        offline.connectivity === "offline"
          ? "It will sync when you're back online."
          : "Syncing…",
    });
    void syncAttempt.then(async () => {
      const local = await getLocalEntry(store, event.key, teamNumber);
      const outcome = describeSaveOutcome(local, await isPausedForAuth(store), teamNumber);
      const options = { id: toastId, description: undefined };
      if (outcome.kind === "synced") toast.success(outcome.message, options);
      else if (outcome.kind === "failed") toast.error(outcome.message, options);
      else if (outcome.kind === "superseded") toast.warning(outcome.message, options);
      else toast.info(outcome.message, options);
    });

    router.push(`/teams/${teamNumber}`);
  }

  function onInvalid() {
    toast.error("Some answers need fixing. They are marked in red.");
  }

  const errorFor = (fieldId: string) => {
    const message = errors.answers?.[fieldId]?.message;
    return typeof message === "string" ? message : undefined;
  };

  return (
    <>
      <form
        onSubmit={handleSubmit(onSubmit, onInvalid)}
        noValidate
        className="flex flex-col gap-6 pb-24"
      >
        <div className="flex flex-col gap-1">
          <Link
            href={BACK_PATH}
            className="-ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeftIcon className="size-4" aria-hidden /> Teams
          </Link>
          <h1 className="text-xl font-semibold">
            <span className="tabular-nums">Team {teamNumber}</span>
            {teamName ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {teamName}
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {merged ? "Editing your scouting notes" : "New scouting entry"} ·{" "}
            {event.name}
          </p>
          {merged?.badge ? (
            <div>
              <SyncBadgeView badge={merged.badge} />
            </div>
          ) : null}
          {merged?.superseded ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {SUPERSEDED_NOTICE}
            </p>
          ) : null}
          {teamEntry.serverUnknown && merged === null ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              Couldn&apos;t check whether another scout already scouted this team (no connection). If someone did, your
              answers will replace theirs when this syncs.
            </p>
          ) : null}
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span>Scouting as {scout.name ?? "nobody (no name set)"}</span>
            <Button
              type="button"
              variant="ghost"
              className="h-11 gap-1 px-2"
              onClick={() => setNameDialogOpen(true)}
            >
              <PencilIcon className="size-3.5" aria-hidden />{" "}
              {scout.name ? "Change" : "Add name"}
            </Button>
          </div>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            There are no scouting fields yet. You can still add a rating, notes
            and photos, or{" "}
            <Link href="/settings" className="underline underline-offset-2">
              set up fields
            </Link>
            .
          </p>
        ) : null}

        {SECTIONS.map((section) => {
          const inSection = fields.filter((f) => f.section === section);
          if (inSection.length === 0) return null;
          return (
            <section
              key={section}
              aria-labelledby={`section-${section}`}
              className="flex flex-col gap-4"
            >
              <h2
                id={`section-${section}`}
                className="border-b pb-1 text-base font-semibold"
              >
                {SECTION_LABELS[section]}
              </h2>
              {inSection.map((field) => (
                <FieldInput
                  key={field.id}
                  field={field}
                  control={control}
                  error={errorFor(field.id)}
                  disabled={saving}
                />
              ))}
            </section>
          );
        })}

        <section
          aria-labelledby="section-photos"
          className="flex flex-col gap-3"
        >
          <h2
            id="section-photos"
            className="border-b pb-1 text-base font-semibold"
          >
            Photos
          </h2>
          <PhotoSection
            saved={savedPhotos}
            savedLoading={photoState.loading && savedPhotos.length === 0}
            savedError={photoState.error !== null}
            onRetrySaved={() => void photoState.refetch()}
            staged={photos.staged}
            removedIds={photos.removedIds}
            processing={photos.processing}
            disabled={saving}
            onAddFiles={(files) => void photos.addFiles(files)}
            onRemoveStaged={photos.removeStaged}
            onToggleRemoved={photos.toggleRemoved}
          />
        </section>

        <section
          aria-labelledby="section-overall"
          className="flex flex-col gap-4"
        >
          <h2
            id="section-overall"
            className="border-b pb-1 text-base font-semibold"
          >
            Overall
          </h2>
          <div className="flex flex-col gap-2">
            <span id="rating-label" className="text-sm font-medium">
              Overall rating (1 = weak, 5 = excellent)
            </span>
            <Controller
              control={control}
              name="rating"
              render={({ field }) => (
                <Segmented
                  labelledBy="rating-label"
                  options={RATING_OPTIONS}
                  value={field.value === null ? null : String(field.value)}
                  onChange={(next) =>
                    field.onChange(next === null ? null : Number(next))
                  }
                  disabled={saving}
                  invalid={Boolean(errors.rating)}
                />
              )}
            />
            {errors.rating ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.rating.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="notes" className="text-sm font-medium">
              Notes
            </label>
            <textarea
              id="notes"
              rows={4}
              maxLength={MAX_NOTES_LENGTH}
              disabled={saving}
              aria-invalid={errors.notes ? true : undefined}
              className="min-h-24 w-full rounded-lg border border-input bg-transparent p-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50 dark:bg-input/30"
              placeholder="Anything else worth knowing about this robot or team"
              {...register("notes")}
            />
            {errors.notes ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.notes.message}
              </p>
            ) : null}
          </div>
        </section>

        {saveError ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <p className="flex items-start gap-2 font-medium">
              <AlertTriangleIcon
                className="mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              {saveError}
            </p>
          </div>
        ) : null}

        {/* Sits just above the bottom navigation, so it is always one thumb-tap away. */}
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button
            type="submit"
            className="h-12 w-full gap-2 text-base"
            disabled={busy}
          >
            {saving ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : null}
            {saving
              ? "Saving…"
              : photos.processing > 0
                ? "Preparing photos…"
                : dirty
                  ? "Save"
                  : "Save (no changes)"}
          </Button>
        </div>
      </form>
      {/* Outside the <form>: React events bubble through portals, so the dialog's own
        form submit would otherwise also submit this one. */}
      <ScoutNameDialog open={nameDialogOpen} onOpenChange={setNameDialogOpen} />
    </>
  );
}
