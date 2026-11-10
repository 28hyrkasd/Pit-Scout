import type { EntryPayload } from "@/lib/entries/payload";
import type { SavedEntry } from "@/lib/entries/rpc";
import { SaveError } from "@/lib/entries/save-error";
import type { AppEvent } from "@/lib/external/schemas";
import { isStorageUnavailable } from "@/lib/offline/errors";
import {
  addPhotoLocally,
  removePhotoLocally,
  saveEntryLocally,
  type LocalOps,
} from "@/lib/offline/local";
import type { OfflineStore } from "@/lib/offline/store";
import type { LocalEntry } from "@/lib/offline/types";
import type { PhotoRecord } from "@/lib/photos/storage";
import { SUPERSEDED_NOTICE } from "./merge-entries";

/** A compressed photo the scout added in this editing session. */
export type StagedPhotoInput = { id: string; blob: Blob };

/** A photo the scout removed. `serverPhoto` is required when it exists on the server (the device may have no record of it). */
export type PhotoRemovalInput = { id: string; serverPhoto?: PhotoRecord };

export type LocalSaveResult = {
  /** The saved entry record, or null when only photos changed. */
  entry: LocalEntry | null;
  addedPhotoIds: string[];
  removedPhotoIds: string[];
  /** Photo changes that could not be written to this device. The entry itself was saved. */
  photoFailures: { id: string; kind: "add" | "remove"; error: Error }[];
};

/**
 * The offline-first save: everything goes to this device's IndexedDB FIRST, in the only order
 * that makes sense (the entry, then photo adds, then removals). Nothing here touches the
 * network; a sync pass sends it afterwards.
 *
 *  - `writeEntry: false` is for "only photos changed": the entry is not re-saved, so the
 *    last-write-wins clock is not bumped and another scout's answers are not overwritten for nothing.
 *    Photo operations then need a local entry or `base` (the server's version).
 *  - If the entry write fails (device full), this REJECTS before any photo is written: nothing
 *    changed and the form stays as it is.
 *  - A photo that cannot be written is reported in `photoFailures`; the rest still go through.
 *
 * `ops` makes the clock and ids injectable for tests; call from an event handler, never during render.
 */
export async function saveScoutingLocally(
  store: OfflineStore,
  args: {
    event: AppEvent;
    teamNumber: number;
    payload: EntryPayload;
    /** The server's version when the scout started from one (not the local record). */
    base: SavedEntry | null;
    writeEntry: boolean;
    staged: readonly StagedPhotoInput[];
    removals: readonly PhotoRemovalInput[];
  },
  ops: LocalOps = {},
): Promise<LocalSaveResult> {
  const { event, teamNumber, base } = args;

  const entry = args.writeEntry
    ? await saveEntryLocally(store, { event, teamNumber, payload: args.payload, base }, ops)
    : null;

  const result: LocalSaveResult = { entry, addedPhotoIds: [], removedPhotoIds: [], photoFailures: [] };

  for (const photo of args.staged) {
    try {
      // The record gets the id the scout's thumbnail already has, so the tile does not change identity.
      await addPhotoLocally(store, { event, teamNumber, blob: photo.blob, base }, { ...ops, makeId: () => photo.id });
      result.addedPhotoIds.push(photo.id);
    } catch (error) {
      result.photoFailures.push({ id: photo.id, kind: "add", error: asError(error) });
    }
  }

  for (const removal of args.removals) {
    try {
      await removePhotoLocally(
        store,
        { event, teamNumber, photoId: removal.id, serverPhoto: removal.serverPhoto, base },
        ops,
      );
      result.removedPhotoIds.push(removal.id);
    } catch (error) {
      result.photoFailures.push({ id: removal.id, kind: "remove", error: asError(error) });
    }
  }
  return result;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** A sentence for a failed local save. Never includes stack traces or storage internals. */
export function describeLocalSaveError(error: unknown): string {
  if (error instanceof SaveError && error.kind === "quota")
    return "This device is out of storage space, so nothing was saved. Free up some space and try again.";
  if (isStorageUnavailable(error))
    return "Saving on this device isn't available in this browser right now. Nothing was saved.";
  return "Couldn't save on this device. Nothing was changed; please try again.";
}

/** The toast after a local save plus a sync attempt. Honest: "synced" only when the core says the entry is synced. */
export type SaveOutcome = {
  kind: "synced" | "superseded" | "waiting" | "failed" | "paused";
  message: string;
};

export function describeSaveOutcome(
  entry: Pick<LocalEntry, "status" | "superseded" | "lastError" | "nextAttemptAt"> | undefined,
  pausedForAuth: boolean,
  teamNumber: number,
): SaveOutcome {
  if (entry?.status === "synced") {
    return entry.superseded
      ? { kind: "superseded", message: `Team ${teamNumber}: ${SUPERSEDED_NOTICE}` }
      : { kind: "synced", message: `Team ${teamNumber} synced` };
  }
  if (pausedForAuth)
    return {
      kind: "paused",
      message: `Team ${teamNumber} saved on this device. Sign in again to sync it.`,
    };
  if (entry?.status === "failed" && entry.lastError && entry.lastError.kind !== "network")
    return {
      kind: "failed",
      message: `Team ${teamNumber} saved on this device, but syncing failed: ${entry.lastError.message}`,
    };
  return { kind: "waiting", message: `Team ${teamNumber} saved on this device. It will sync when you're online.` };
}
