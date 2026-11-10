import type { EntryPayload } from "@/lib/entries/payload";
import { nextUpdatedAt } from "@/lib/entries/clock";
import type { SavedEntry } from "@/lib/entries/rpc";
import { photoStoragePath } from "@/lib/entries/photo-path";
import type { AppEvent } from "@/lib/external/schemas";
import type { PhotoRecord } from "@/lib/photos/storage";
import { newUuid } from "@/lib/uuid";
import { latestKnownUpdatedAt, markLocalChange } from "./plan";
import type { OfflineStore, TeamWrite } from "./store";
import {
  entryKey,
  type LocalEntry,
  type LocalPhoto,
  type SyncStatus,
  type TeamRef,
} from "./types";

/** Clock and id source, injectable for tests (tests pass a fixed clock and id). Call from event handlers, never during render. */
export type LocalOps = { now?: () => number; makeId?: () => string };

/** Thrown for programmer errors (e.g. adding a photo to a team that has no entry and no `base`). */
export class OfflineUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineUsageError";
  }
}

function blankEntry(args: {
  event: AppEvent;
  teamNumber: number;
  id: string;
  payload: EntryPayload;
  createdAt: string;
  updatedAt: string;
  base: SavedEntry | null | undefined;
  nowMs: number;
  entryDirty: boolean;
}): LocalEntry {
  return {
    schemaVersion: 1,
    key: entryKey(args.event.key, args.teamNumber),
    id: args.id,
    eventKey: args.event.key,
    teamNumber: args.teamNumber,
    payload: args.payload,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    event: args.event,
    status: "pending",
    attempts: 0,
    nextAttemptAt: args.nowMs,
    lastError: null,
    serverId: args.base?.id ?? null,
    serverUpdatedAt: args.base?.updatedAt ?? null,
    entryDirty: args.entryDirty,
    superseded: false,
    clockAdjusted: false,
    revision: 1,
    claim: null,
    syncedAt: null,
  };
}

/**
 * Save (or re-save) the scout's version of an entry on this device, as `pending`.
 * The whole thing is one atomic transaction, so a crash or a full disk leaves the
 * previous version intact (and rejects with SaveError "quota").
 *
 *  - Same (event, team) edited again: keeps the SAME local id and createdAt.
 *  - updatedAt = nextUpdatedAt(now, newest time ever seen for the team): an edit
 *    never goes back in time relative to what this device has seen, including
 *    the server's version (`base`, or what the last sync reported).
 *  - If a sync of this entry is in flight, status/claim are kept but the entry
 *    is marked dirty again, so the in-flight result cannot overwrite the new
 *    edit (see finishEntry in plan.ts).
 *  - `base` is the server's current version, if the scout started from one and
 *    there is no local record yet; its id becomes the id to send.
 */
export async function saveEntryLocally(
  store: OfflineStore,
  input: {
    event: AppEvent;
    teamNumber: number;
    payload: EntryPayload;
    base?: SavedEntry | null;
  },
  ops: LocalOps = {},
): Promise<LocalEntry> {
  const nowMs = (ops.now ?? Date.now)();
  const makeId = ops.makeId ?? newUuid;
  return store.transact(
    { eventKey: input.event.key, teamNumber: input.teamNumber },
    ({ entry }) => {
      const updatedAt = nextUpdatedAt(
        nowMs,
        latestKnownUpdatedAt(
          entry?.updatedAt,
          entry?.serverUpdatedAt,
          input.base?.updatedAt,
        ),
      );
      const next: LocalEntry = entry
        ? {
            ...markLocalChange(entry, nowMs),
            payload: input.payload,
            updatedAt,
            event: input.event,
            entryDirty: true,
            superseded: false,
            clockAdjusted: false,
            // First time we learn of a server version for an entry created offline.
            serverId: entry.serverId ?? input.base?.id ?? null,
            serverUpdatedAt: entry.serverUpdatedAt ?? input.base?.updatedAt ?? null,
          }
        : blankEntry({
            event: input.event,
            teamNumber: input.teamNumber,
            id: input.base?.id ?? makeId(),
            payload: input.payload,
            createdAt: input.base?.createdAt ?? updatedAt,
            updatedAt,
            base: input.base,
            nowMs,
            entryDirty: true,
          });
      return { write: { entry: next }, result: next };
    },
  );
}

/** Context needed when the team has no local entry yet (a photo added to an entry that only exists on the server). */
type EntryContext = { event: AppEvent; base?: SavedEntry | null };

function ensureEntry(
  entry: LocalEntry | undefined,
  team: TeamRef,
  ctx: EntryContext,
  nowMs: number,
): LocalEntry {
  if (entry) return markLocalChange(entry, nowMs);
  if (!ctx.base)
    throw new OfflineUsageError(
      `No local entry for ${team.eventKey}:${team.teamNumber}. Save the entry first, or pass the server's version as \`base\`.`,
    );
  // Entry exists on the server; only its photos change. entryDirty=false: no RPC is owed.
  return blankEntry({
    event: ctx.event,
    teamNumber: team.teamNumber,
    id: ctx.base.id,
    payload: {
      answers: ctx.base.answers,
      rating: ctx.base.rating,
      notes: ctx.base.notes,
      scoutedBy: ctx.base.scoutedBy,
    },
    createdAt: ctx.base.createdAt,
    updatedAt: ctx.base.updatedAt,
    base: ctx.base,
    nowMs,
    entryDirty: false,
  });
}

/**
 * Stage a compressed photo for upload. The record and the entry's "something
 * changed" marker are written in one transaction, so a photo can never exist
 * without its entry being scheduled. The photo points at the entry's server id
 * when it is known, else at the local id (re-pointed by the sync).
 */
export async function addPhotoLocally(
  store: OfflineStore,
  input: { event: AppEvent; teamNumber: number; blob: Blob; base?: SavedEntry | null },
  ops: LocalOps = {},
): Promise<LocalPhoto> {
  const nowMs = (ops.now ?? Date.now)();
  const id = (ops.makeId ?? newUuid)();
  const team = { eventKey: input.event.key, teamNumber: input.teamNumber };
  // Throws on a bad event key / team number before anything is written.
  const storagePath = photoStoragePath(team.eventKey, team.teamNumber, id);
  return store.transact(team, ({ entry }) => {
    const next = ensureEntry(entry, team, input, nowMs);
    const photo: LocalPhoto = {
      schemaVersion: 1,
      id,
      ...team,
      entryId: next.serverId ?? next.id,
      kind: "upload",
      status: "pending",
      blob: input.blob,
      storagePath,
      attempts: 0,
      lastError: null,
      createdAt: new Date(nowMs).toISOString(),
    };
    return { write: { entry: next, putPhotos: [photo] }, result: photo };
  });
}

export type RemovePhotoResult = "deleted-local" | "queued-removal" | "already-queued";

/**
 * The scout removed a photo.
 *  - Never left the device (pending / failed): the record and its blob are deleted. Nothing to sync.
 *  - Uploading now, or already on the server (uploaded, or `serverPhoto` for one this device never had):
 *    queue a removal (row first, then object). If an upload is in flight, the removal runs after it,
 *    so a photo can't reappear.
 */
export async function removePhotoLocally(
  store: OfflineStore,
  input: {
    event: AppEvent;
    teamNumber: number;
    photoId: string;
    /** Required when the photo is on the server and this device has no local record of it. */
    serverPhoto?: PhotoRecord;
    base?: SavedEntry | null;
  },
  ops: LocalOps = {},
): Promise<RemovePhotoResult> {
  const nowMs = (ops.now ?? Date.now)();
  const team = { eventKey: input.event.key, teamNumber: input.teamNumber };
  return store.transact(team, ({ entry, photos }): {
    write: TeamWrite | null;
    result: RemovePhotoResult;
  } => {
    const existing = photos.find((p) => p.id === input.photoId);

    if (existing?.kind === "removal")
      return { write: null, result: "already-queued" };

    if (existing && (existing.status === "pending" || existing.status === "failed")) {
      return { write: { deletePhotoIds: [existing.id] }, result: "deleted-local" };
    }

    const storagePath = existing?.storagePath ?? input.serverPhoto?.storagePath;
    const entryId = existing?.entryId ?? input.serverPhoto?.entryId;
    if (!storagePath || !entryId)
      throw new OfflineUsageError(
        "Removing a photo that is not stored on this device needs `serverPhoto`.",
      );

    const next = ensureEntry(entry, team, input, nowMs);
    const removal: LocalPhoto = {
      schemaVersion: 1,
      id: input.photoId,
      ...team,
      entryId,
      kind: "removal",
      status: "pending",
      blob: null,
      storagePath,
      attempts: 0,
      lastError: null,
      createdAt: existing?.createdAt ?? new Date(nowMs).toISOString(),
    };
    return {
      write: { entry: next, putPhotos: [removal] },
      result: "queued-removal",
    };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function getLocalEntry(
  store: OfflineStore,
  eventKey: string,
  teamNumber: number,
): Promise<LocalEntry | undefined> {
  return store.getEntry(entryKey(eventKey, teamNumber));
}

/** All local entries, optionally for one event, newest edit first. */
export async function listLocalEntries(
  store: OfflineStore,
  eventKey?: string,
): Promise<LocalEntry[]> {
  const all = await store.listEntries();
  return all
    .filter((e) => eventKey === undefined || e.eventKey === eventKey)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listLocalPhotos(
  store: OfflineStore,
  team: TeamRef,
): Promise<LocalPhoto[]> {
  return store.listPhotos(team);
}

/** Entries that are not safely on the server yet (pending, syncing or failed), oldest first. */
export async function listPending(store: OfflineStore): Promise<LocalEntry[]> {
  const all = await store.listEntries();
  return all
    .filter((e) => e.status !== "synced")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export type SyncCounts = Record<SyncStatus, number> & {
  total: number;
  /** pending + syncing + failed: the number for a "3 not synced" badge. */
  unsynced: number;
  /** Photos waiting to upload / that failed / removals waiting. */
  photosPending: number;
  photosFailed: number;
  removalsPending: number;
  /** Entries that will not retry by themselves (failed with nextAttemptAt null). Show a "Sync now" button. */
  needsManualRetry: number;
  superseded: number;
};

export async function getSyncCounts(store: OfflineStore): Promise<SyncCounts> {
  const [entries, photos] = await Promise.all([
    store.listEntries(),
    store.listPhotos(),
  ]);
  const counts: SyncCounts = {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    total: entries.length,
    unsynced: 0,
    photosPending: 0,
    photosFailed: 0,
    removalsPending: 0,
    needsManualRetry: 0,
    superseded: 0,
  };
  for (const e of entries) {
    counts[e.status] += 1;
    if (e.status !== "synced") counts.unsynced += 1;
    if (e.status === "failed" && e.nextAttemptAt === null)
      counts.needsManualRetry += 1;
    if (e.superseded) counts.superseded += 1;
  }
  for (const p of photos) {
    if (p.kind === "removal") counts.removalsPending += 1;
    else if (p.status === "failed") counts.photosFailed += 1;
    else if (p.status !== "uploaded") counts.photosPending += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Clear / reset
// ---------------------------------------------------------------------------

/** Drop entries that are fully synced (and their leftover photo records). Unsynced data is never touched. */
export async function clearSyncedEntries(
  store: OfflineStore,
  olderThanMs?: { nowMs: number; ageMs: number },
): Promise<number> {
  const entries = await store.listEntries();
  let removed = 0;
  for (const e of entries) {
    if (e.status !== "synced") continue;
    if (olderThanMs && olderThanMs.nowMs - (e.syncedAt ?? 0) < olderThanMs.ageMs)
      continue;
    const done = await store.transact(
      { eventKey: e.eventKey, teamNumber: e.teamNumber },
      ({ entry, photos }) =>
        entry && entry.status === "synced" && entry.revision === e.revision
          ? {
              write: { entry: null, deletePhotoIds: photos.map((p) => p.id) },
              result: true,
            }
          : { write: null, result: false },
    );
    if (done) removed += 1;
  }
  return removed;
}

/**
 * Wipe EVERYTHING (entries, photos, cache, meta). Unsynced scouting data is
 * lost. Only call after the scout confirmed, and warn when
 * getSyncCounts().unsynced > 0.
 */
export function resetOfflineData(store: OfflineStore): Promise<void> {
  return store.clearAll();
}
