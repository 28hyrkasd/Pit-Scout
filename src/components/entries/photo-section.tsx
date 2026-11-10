"use client";

import { useRef } from "react";
import {
  CameraIcon,
  ImageIcon,
  ImageOffIcon,
  Loader2Icon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StagedPhotoView } from "@/components/entries/use-photo-staging";
import { describePhotoTile, type DisplayPhoto } from "@/lib/offline-ui/merge-photos";
import { MAX_PHOTOS_PER_TEAM } from "@/components/entries/use-photo-staging";
import { cn } from "@/lib/utils";

type Props = {
  /** Server photos plus photos still only on this device (merged by the caller). */
  saved: DisplayPhoto[];
  savedLoading: boolean;
  savedError: boolean;
  onRetrySaved: () => void;
  staged: StagedPhotoView[];
  removedIds: ReadonlySet<string>;
  processing: number;
  disabled?: boolean;
  onAddFiles: (files: FileList) => void;
  onRemoveStaged: (id: string) => void;
  onToggleRemoved: (id: string) => void;
};

const TILE =
  "relative size-28 shrink-0 overflow-hidden rounded-lg border bg-muted";

export function PhotoSection({
  saved,
  savedLoading,
  savedError,
  onRetrySaved,
  staged,
  removedIds,
  processing,
  disabled,
  onAddFiles,
  onRemoveStaged,
  onToggleRemoved,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const total = saved.length - removedIds.size + staged.length;

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) onAddFiles(files);
    // Clear the input so choosing the SAME photo again still fires onChange.
    event.target.value = "";
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {/* capture="environment" opens the rear camera on phones; on desktop it is a normal file picker. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Take photos with the camera"
          onChange={handleFiles}
          disabled={disabled}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose photos from the library"
          onChange={handleFiles}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1 gap-2 px-4 text-base"
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || total >= MAX_PHOTOS_PER_TEAM}
        >
          <CameraIcon aria-hidden /> Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1 gap-2 px-4 text-base"
          onClick={() => libraryRef.current?.click()}
          disabled={disabled || total >= MAX_PHOTOS_PER_TEAM}
        >
          <ImageIcon aria-hidden /> Choose photos
        </Button>
      </div>

      {processing > 0 ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2Icon className="size-4 animate-spin" aria-hidden /> Preparing{" "}
          {processing} photo{processing === 1 ? "" : "s"}…
        </p>
      ) : null}

      {savedLoading ? (
        <div className="flex gap-2" aria-busy aria-label="Loading photos">
          <div className="size-28 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : null}

      {savedError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
        >
          <span>Could not load the saved photos.</span>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={onRetrySaved}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {saved.length + staged.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Photos">
          {saved.map((photo) => {
            const removed = removedIds.has(photo.id);
            const words = describePhotoTile(photo);
            return (
              <li key={photo.id} className={cn(TILE, removed && "opacity-60")}>
                {photo.url ? (
                  // Signed URLs / blob URLs are not an allow-listed next/image host.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt="Robot"
                    className={cn(
                      "size-full object-cover",
                      removed && "grayscale",
                    )}
                    loading="lazy"
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
                    <ImageOffIcon className="size-5" aria-hidden />
                    {words.placeholder}
                  </div>
                )}
                <TileButton
                  label={removed ? "Keep this photo" : "Remove this photo"}
                  onClick={() => onToggleRemoved(photo.id)}
                  disabled={disabled}
                  restore={removed}
                />
                {removed ? (
                  <span className="absolute inset-x-0 bottom-0 bg-background/90 px-1 py-0.5 text-center text-xs font-medium">
                    Removed on save
                  </span>
                ) : words.status ? (
                  <span className="absolute inset-x-0 bottom-0 bg-background/90 px-1 py-0.5 text-center text-xs font-medium">
                    {words.status}
                  </span>
                ) : null}
              </li>
            );
          })}
          {staged.map((photo) => (
            <li key={photo.id} className={TILE}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt="New robot photo"
                className="size-full object-cover"
              />
              <TileButton
                label="Remove this photo"
                onClick={() => onRemoveStaged(photo.id)}
                disabled={disabled}
              />
              <span className="absolute inset-x-0 bottom-0 bg-background/90 px-1 py-0.5 text-center text-xs font-medium">
                Saves with this entry
              </span>
            </li>
          ))}
        </ul>
      ) : !savedLoading ? (
        <p className="text-sm text-muted-foreground">No photos yet.</p>
      ) : null}
    </div>
  );
}

/** A 44px corner button on a photo tile (the visible icon is smaller than its tap target). */
function TileButton({
  label,
  onClick,
  disabled,
  restore,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  restore?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="absolute top-0 right-0 flex size-11 items-start justify-end p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-background/90 shadow ring-1 ring-foreground/20">
        {restore ? (
          <RotateCcwIcon className="size-4" aria-hidden />
        ) : (
          <XIcon className="size-4" aria-hidden />
        )}
      </span>
    </button>
  );
}
