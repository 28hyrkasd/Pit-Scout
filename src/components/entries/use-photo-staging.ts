"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { compressPhoto, PhotoError } from "@/lib/photos/compress";
import { newUuid } from "@/lib/uuid";

export const MAX_PHOTOS_PER_TEAM = 12;

/** A compressed photo the scout added in this editing session. */
export type StagedPhoto = { id: string; blob: Blob };

export type StagedPhotoView = StagedPhoto & { previewUrl: string };

/**
 * Photos the scout has added (or marked for removal) but not saved yet.
 *
 * Added photos are compressed immediately and kept as blobs in memory, with an
 * object URL for the thumbnail. The Save button writes them to this device's
 * IndexedDB (they upload later, when there is a connection); until then they only
 * live here, which is why the unsaved-changes guard covers them.
 */
export function usePhotoStaging(savedCount: number) {
  const [staged, setStaged] = useState<StagedPhotoView[]>([]);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [processing, setProcessing] = useState(0);

  // Latest staged list for cleanup on unmount (object URLs are not garbage collected).
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  useEffect(() => {
    return () => {
      for (const photo of stagedRef.current)
        URL.revokeObjectURL(photo.previewUrl);
    };
  }, []);

  // The cap is checked inside the handler against the freshest numbers.
  const countRef = useRef(0);
  useEffect(() => {
    countRef.current = savedCount - removedIds.size + staged.length;
  }, [savedCount, removedIds, staged]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const room = MAX_PHOTOS_PER_TEAM - countRef.current;
    if (room <= 0) {
      toast.error(
        `A team can have up to ${MAX_PHOTOS_PER_TEAM} photos. Remove one to add another.`,
      );
      return;
    }
    const accepted = list.slice(0, room);
    if (accepted.length < list.length) {
      toast.warning(
        `Only ${accepted.length} of ${list.length} photos were added (limit ${MAX_PHOTOS_PER_TEAM} per team).`,
      );
    }

    setProcessing((n) => n + accepted.length);
    for (const file of accepted) {
      try {
        const blob = await compressPhoto(file);
        const photo: StagedPhotoView = {
          id: newUuid(),
          blob,
          previewUrl: URL.createObjectURL(blob),
        };
        countRef.current += 1;
        setStaged((current) => [...current, photo]);
      } catch (error) {
        toast.error(
          error instanceof PhotoError
            ? error.message
            : "Could not add that photo.",
        );
      } finally {
        setProcessing((n) => n - 1);
      }
    }
  }, []);

  const removeStaged = useCallback((id: string) => {
    setStaged((current) => {
      const gone = current.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return current.filter((p) => p.id !== id);
    });
  }, []);

  const toggleRemoved = useCallback((id: string) => {
    setRemovedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** After a save: drop the photos now stored on the device and the removals that were recorded. */
  const settle = useCallback(
    (storedIds: string[], removedDoneIds: string[]) => {
      const uploaded = new Set(storedIds);
      setStaged((current) => {
        for (const photo of current)
          if (uploaded.has(photo.id)) URL.revokeObjectURL(photo.previewUrl);
        return current.filter((p) => !uploaded.has(p.id));
      });
      const done = new Set(removedDoneIds);
      setRemovedIds(
        (current) => new Set([...current].filter((id) => !done.has(id))),
      );
    },
    [],
  );

  return {
    staged,
    removedIds,
    processing,
    addFiles,
    removeStaged,
    toggleRemoved,
    settle,
  };
}
