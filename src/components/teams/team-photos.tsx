"use client";

import { useState } from "react";
import { CloudUploadIcon, ChevronLeftIcon, ChevronRightIcon, ImageOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CachedDataNotice } from "@/components/offline/cached-data-notice";
import type { useTeamPhotos } from "@/components/offline/use-merged-entries";
import { describePhotoTile } from "@/lib/offline-ui/merge-photos";

const TILE = "relative size-28 shrink-0 overflow-hidden rounded-lg border bg-muted";

type TeamPhotosState = ReturnType<typeof useTeamPhotos>;

/**
 * Photo tiles for a team: the server's (signed URLs) plus photos still only on this device (shown from the
 * local copy, labelled "Uploads when online"). Tap one to view it larger; arrows step through the rest.
 */
export function TeamPhotos({ state }: { state: TeamPhotosState }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { photos } = state;
  const current = openIndex === null ? undefined : photos[openIndex];

  if (state.loading && photos.length === 0) {
    return (
      <div className="flex gap-2" aria-busy aria-label="Loading photos">
        <div className="size-28 animate-pulse rounded-lg bg-muted" />
        <div className="size-28 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const errorRow = state.error ? (
    <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <span>Could not load the saved photos.</span>
      <Button type="button" variant="outline" className="h-11" onClick={() => void state.refetch()}>
        Retry
      </Button>
    </div>
  ) : null;

  if (photos.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {errorRow ?? <p className="text-sm text-muted-foreground">No photos yet.</p>}
      </div>
    );
  }

  const step = (delta: number) =>
    setOpenIndex((i) => (i === null ? null : (i + delta + photos.length) % photos.length));

  return (
    <>
      <div className="flex flex-col gap-2">
        {errorRow}
        <CachedDataNotice cachedAt={state.cachedAt} />
        <ul aria-label="Photos" className="flex flex-wrap gap-2">
          {photos.map((photo, index) => {
            const words = describePhotoTile(photo);
            return (
              <li key={photo.id} className={TILE}>
                {photo.url ? (
                  <button
                    type="button"
                    aria-label={`View photo ${index + 1} of ${photos.length} larger`}
                    onClick={() => setOpenIndex(index)}
                    className="size-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {/* Signed URLs / blob URLs are not an allow-listed next/image host. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt={`Robot photo ${index + 1}`} className="size-full object-cover" loading="lazy" />
                  </button>
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
                    <ImageOffIcon className="size-5" aria-hidden />
                    {words.placeholder}
                  </div>
                )}
                {words.status ? (
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/90 px-1 py-0.5 text-center text-xs font-medium">
                    <CloudUploadIcon className="size-3 shrink-0" aria-hidden />
                    {words.status}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog open={current !== undefined} onOpenChange={(open) => !open && setOpenIndex(null)}>
        <DialogContent showCloseButton={false} className="max-h-[95dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Photo {(openIndex ?? 0) + 1} of {photos.length}
            </DialogTitle>
          </DialogHeader>
          {current?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.url}
              alt={`Robot photo ${(openIndex ?? 0) + 1}`}
              className="max-h-[70dvh] w-full rounded-lg bg-muted object-contain"
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {current ? describePhotoTile(current).placeholder : "Photo unavailable"}
            </p>
          )}
          <div className="flex justify-between gap-2">
            {photos.length > 1 ? (
              <Button type="button" variant="outline" className="h-11 gap-1 px-4" onClick={() => step(-1)}>
                <ChevronLeftIcon aria-hidden /> Previous
              </Button>
            ) : null}
            <DialogClose render={<Button type="button" variant="secondary" className="h-11 px-4" />}>Close</DialogClose>
            {photos.length > 1 ? (
              <Button type="button" variant="outline" className="h-11 gap-1 px-4" onClick={() => step(1)}>
                Next <ChevronRightIcon aria-hidden />
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
