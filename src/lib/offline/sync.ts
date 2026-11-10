import { wasApplied, type SavedEntry, type UpsertEntryInput } from "@/lib/entries/rpc";
import { classifySaveError, SaveError } from "@/lib/entries/save-error";
import type { AppEvent } from "@/lib/external/schemas";
import {
  DEFAULT_POLICY,
  claimEntry,
  finishEntry,
  isDue,
  isPhotoDue,
  planNext,
  refreshClaim,
  releaseEntry,
  toStoredError,
  type BackoffPolicy,
  type SyncMode,
} from "./plan";
import { isStorageUnavailable } from "./errors";
import type { OfflineStore } from "./store";
import {
  isRetryableKind,
  type LocalEntry,
  type LocalPhoto,
  type StoredError,
  type SyncStatus,
  type TeamRef,
} from "./types";

/**
 * Every network side effect the sync performs, injected so the driver is
 * testable without Supabase. Every one must be IDEMPOTENT (see createSupabaseSyncDeps):
 * the driver may repeat any of them after a crash.
 */
export type SyncDeps = {
  /** Upsert the events row (FK target of scouting_entries). Throw on failure. */
  ensureEvent: (event: AppEvent) => Promise<void>;
  /** upsert_scouting_entry. Same id + same updatedAt must be a no-op. */
  upsertEntry: (input: UpsertEntryInput) => Promise<SavedEntry>;
  /** "Already exists" must resolve. */
  uploadPhoto: (storagePath: string, blob: Blob) => Promise<void>;
  /** A duplicate id must resolve. */
  insertPhotoRow: (row: {
    id: string;
    entryId: string;
    storagePath: string;
  }) => Promise<void>;
  /** Deleting a missing row must resolve. */
  deletePhotoRow: (id: string) => Promise<void>;
  /** Removing a missing object must resolve. */
  deletePhotoObject: (storagePath: string) => Promise<void>;
};

export type SyncOptions = {
  /** Defaults to Date.now. */
  now?: () => number;
  /** [0, 1). Defaults to Math.random. Used only for backoff jitter. */
  random?: () => number;
  /** Checked between steps. An aborted pass hands its current entry back as `pending` (attempts unchanged). */
  signal?: AbortSignal;
  mode?: SyncMode;
  policy?: Partial<BackoffPolicy>;
};

export type SyncPassOutcome =
  | "completed" // every due entry was handled (some may have failed; see `failed`)
  | "network-error" // a request could not reach the server: the rest of the pass was skipped
  | "paused-auth" // 401: queue paused until resumeAfterAuth()
  | "aborted" // the AbortSignal fired
  | "storage-error"; // this device's storage failed mid-pass (quota / unavailable)

export type SyncPassResult = {
  outcome: SyncPassOutcome;
  /** Entry keys fully synced by this pass. */
  synced: string[];
  /** Entry keys that ended `failed` (see their lastError / nextAttemptAt). */
  failed: string[];
  /** Entry keys that were picked up. */
  attempted: string[];
  error?: Error;
};

const inFlight = new WeakMap<OfflineStore, Promise<SyncPassResult>>();

/** Is a pass running for this store right now (e.g. to show a spinner)? */
export function isSyncRunning(store: OfflineStore): boolean {
  return inFlight.has(store);
}

/**
 * One sync pass: send everything that is due, oldest first, ONE entry at a time.
 *
 * Single-flight per store: if a pass is already running (focus + online +
 * manual all fired), this returns the SAME promise instead of starting a second
 * pass, so no entry is ever in two requests at once. A "Sync now" that lands on
 * a running automatic pass therefore joins it; call again after it settles if
 * the manual reset must apply.
 *
 * Per entry (every step idempotent; a crash after any of them is resumable):
 *   claim -> events row -> upsert RPC -> record result (+ re-point photos to the
 *   surviving id) -> upload each photo -> insert its row -> process removals ->
 *   finish (synced | failed | pending).
 *
 * Never throws for network/server problems; they are in the result. Rejects only
 * for programmer errors.
 */
export function runSyncPass(
  store: OfflineStore,
  deps: SyncDeps,
  options: SyncOptions = {},
): Promise<SyncPassResult> {
  const running = inFlight.get(store);
  if (running) return running;
  const pass: Promise<SyncPassResult> = doPass(store, deps, options).finally(
    () => {
      if (inFlight.get(store) === pass) inFlight.delete(store);
    },
  );
  inFlight.set(store, pass);
  return pass;
}

/** True when sign-in is needed before anything will sync. */
export async function isPausedForAuth(store: OfflineStore): Promise<boolean> {
  return (await store.getMeta("pausedForAuth")) === true;
}

/** Call after a successful sign-in, then trigger a pass. Data and statuses were never touched by the pause. */
export function resumeAfterAuth(store: OfflineStore): Promise<void> {
  return store.setMeta("pausedForAuth", false);
}

// ---------------------------------------------------------------------------

/** A dependency call failed; carries the classified error. Distinguishes network/server problems from local-storage ones. */
class DepFailure extends Error {
  constructor(readonly error: SaveError) {
    super(error.message);
  }
}

/** Unwinds out of syncEntry for the failures that end the whole pass. */
class StopPass extends Error {
  constructor(readonly reason: "network-error" | "paused-auth" | "aborted") {
    super(reason);
  }
}

type Ctx = {
  store: OfflineStore;
  deps: SyncDeps;
  now: () => number;
  random: () => number;
  signal: AbortSignal | undefined;
  mode: SyncMode;
  policy: BackoffPolicy;
  /** events rows already confirmed during this pass (saves a request per entry). */
  ensuredEvents: Set<string>;
};

async function call<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    throw new DepFailure(classifySaveError(error));
  }
}

async function doPass(
  store: OfflineStore,
  deps: SyncDeps,
  options: SyncOptions,
): Promise<SyncPassResult> {
  const ctx: Ctx = {
    store,
    deps,
    now: options.now ?? Date.now,
    random: options.random ?? Math.random,
    signal: options.signal,
    mode: options.mode ?? "auto",
    policy: { ...DEFAULT_POLICY, ...options.policy },
    ensuredEvents: new Set(),
  };
  const result: SyncPassResult = {
    outcome: "completed",
    synced: [],
    failed: [],
    attempted: [],
  };
  /** key -> revision it had when we last handled it; an entry edited since is eligible again. */
  const handled = new Map<string, number>();

  try {
    if (await isPausedForAuth(store)) return { ...result, outcome: "paused-auth" };

    for (;;) {
      if (ctx.signal?.aborted) return { ...result, outcome: "aborted" };
      const entries = await store.listEntries();
      const next = planNext(
        entries,
        ctx.now(),
        ctx.mode,
        ctx.policy,
        (e) => handled.get(e.key) === e.revision,
      );
      if (!next) break;

      const claimed = await claim(ctx, next);
      if (!claimed) {
        handled.set(next.key, next.revision); // lost a race (edited/removed); re-plan
        continue;
      }
      handled.set(claimed.key, claimed.revision);
      result.attempted.push(claimed.key);

      const outcome = await syncEntry(ctx, claimed);
      if (outcome.status === "synced") {
        result.synced.push(claimed.key);
        await store.setMeta("lastSyncAt", ctx.now());
      } else if (outcome.status === "failed") result.failed.push(claimed.key);
      if (outcome.stop) return { ...result, outcome: outcome.stop };
    }
    return result;
  } catch (error) {
    if (error instanceof SaveError || isStorageUnavailable(error))
      return { ...result, outcome: "storage-error", error };
    throw error;
  }
}

function teamOf(item: TeamRef): TeamRef {
  return { eventKey: item.eventKey, teamNumber: item.teamNumber };
}

/** Take ownership of the entry (or return null if it is no longer due). Also resets photo records a dead pass left in "uploading". */
async function claim(ctx: Ctx, planned: LocalEntry): Promise<LocalEntry | null> {
  const nowMs = ctx.now();
  return ctx.store.transact(teamOf(planned), ({ entry, photos }) => {
    if (!entry || !isDue(entry, nowMs, ctx.mode, ctx.policy))
      return { write: null, result: null };
    const claimed = claimEntry(entry, nowMs, ctx.policy);
    const reset = photos
      .filter((p) => p.status === "uploading")
      .map((p): LocalPhoto => ({ ...p, status: "pending" }));
    return { write: { entry: claimed, putPhotos: reset }, result: claimed };
  });
}

/** Extend the lease so a long upload on slow wifi is not mistaken for a dead pass. */
async function heartbeat(ctx: Ctx, entry: LocalEntry): Promise<void> {
  if (ctx.signal?.aborted) throw new StopPass("aborted");
  const nowMs = ctx.now();
  await ctx.store.transact(teamOf(entry), ({ entry: current }) =>
    current && current.status === "syncing"
      ? { write: { entry: refreshClaim(current, nowMs) }, result: undefined }
      : { write: null, result: undefined },
  );
}

type EntryOutcome = {
  status: SyncStatus | "released";
  stop?: "network-error" | "paused-auth" | "aborted";
};

async function syncEntry(ctx: Ctx, claimed: LocalEntry): Promise<EntryOutcome> {
  const baseAttempts = ctx.mode === "manual" ? 0 : claimed.attempts;
  let entryFailure: StoredError | null = null;
  let stop: EntryOutcome["stop"];

  try {
    if (claimed.entryDirty) await pushEntry(ctx, claimed);
    await pushPhotos(ctx, claimed);
    await pushRemovals(ctx, claimed);
  } catch (error) {
    if (error instanceof StopPass) {
      stop = error.reason;
    } else if (error instanceof DepFailure) {
      entryFailure = toStoredError(error.error);
      if (error.error.kind === "unauthorized") stop = "paused-auth";
      else if (error.error.kind === "network") stop = "network-error";
    } else {
      throw error;
    }
  }

  if (stop === "paused-auth" || stop === "aborted") {
    // Not the entry's fault: hand it back exactly as it was (attempts untouched).
    await release(ctx, claimed);
    if (stop === "paused-auth") await ctx.store.setMeta("pausedForAuth", true);
    return { status: "released", stop };
  }

  const nowMs = ctx.now();
  const status = await ctx.store.transact(teamOf(claimed), ({ entry, photos }) => {
    if (!entry) return { write: null, result: "released" as const };
    const finished = finishEntry(
      entry,
      {
        baseAttempts,
        claimRevision: claimed.claim?.revision ?? claimed.revision,
        entryFailure,
        photos,
      },
      nowMs,
      ctx.random,
      ctx.policy,
    );
    return {
      write: { entry: finished.entry, deletePhotoIds: finished.prunePhotoIds },
      result: finished.entry.status,
    };
  });
  return { status, stop };
}

async function release(ctx: Ctx, claimed: LocalEntry): Promise<void> {
  await ctx.store.transact(teamOf(claimed), ({ entry, photos }) => ({
    write: entry
      ? {
          entry: releaseEntry(entry),
          putPhotos: photos
            .filter((p) => p.status === "uploading")
            .map((p): LocalPhoto => ({ ...p, status: "pending" })),
        }
      : null,
    result: undefined,
  }));
}

/** events row -> RPC -> record what the server kept (and re-point photos if its id differs). */
async function pushEntry(ctx: Ctx, claimed: LocalEntry): Promise<void> {
  if (!ctx.ensuredEvents.has(claimed.eventKey)) {
    await heartbeat(ctx, claimed);
    await call(() => ctx.deps.ensureEvent(claimed.event));
    ctx.ensuredEvents.add(claimed.eventKey);
  }
  await heartbeat(ctx, claimed);
  const saved = await call(() =>
    ctx.deps.upsertEntry({
      // The server's id once known, so a re-send is a plain update of the same row.
      id: claimed.serverId ?? claimed.id,
      eventKey: claimed.eventKey,
      teamNumber: claimed.teamNumber,
      payload: claimed.payload,
      createdAt: claimed.createdAt,
      updatedAt: claimed.updatedAt,
    }),
  );
  const applied = wasApplied(saved, claimed.updatedAt);

  // One transaction: remember the surviving id AND move every photo to it, so a
  // photo added at this very moment can't be left pointing at an id that doesn't exist.
  await ctx.store.transact(teamOf(claimed), ({ entry, photos }) => {
    if (!entry) return { write: null, result: undefined };
    const unchanged = entry.updatedAt === claimed.updatedAt;
    return {
      write: {
        entry: {
          ...entry,
          serverId: saved.id,
          serverUpdatedAt: saved.updatedAt,
          // Edited while the RPC was in flight: the newer edit is still owed.
          entryDirty: !unchanged,
          superseded: unchanged ? !applied : entry.superseded,
        },
        putPhotos: photos
          .filter((p) => p.entryId !== saved.id)
          .map((p): LocalPhoto => ({ ...p, entryId: saved.id })),
      },
      result: undefined,
    };
  });
}

function photosOf(ctx: Ctx, entry: LocalEntry, kind: LocalPhoto["kind"]) {
  return ctx.store.listPhotos(teamOf(entry)).then((all) =>
    all
      .filter((p) => p.kind === kind && isPhotoDue(p, ctx.mode))
      .sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : 1),
      ),
  );
}

/** Record a photo-level failure on the photo itself (never on the entry, never losing the blob). */
async function failPhoto(ctx: Ctx, photo: LocalPhoto, error: SaveError) {
  await ctx.store.transact(teamOf(photo), ({ photos }) => {
    const current = photos.find((p) => p.id === photo.id);
    return current
      ? {
          write: {
            putPhotos: [
              {
                ...current,
                status: "failed" as const,
                attempts: current.attempts + 1,
                lastError: toStoredError(error),
              },
            ],
          },
          result: undefined,
        }
      : { write: null, result: undefined };
  });
}

/**
 * Upload the object, THEN insert the row (a row never points at nothing). One
 * photo failing does not stop the others, except: 401 pauses the queue and a
 * network error ends the pass, since the rest would fail the same way.
 */
async function pushPhotos(ctx: Ctx, entry: LocalEntry): Promise<void> {
  for (const photo of await photosOf(ctx, entry, "upload")) {
    await heartbeat(ctx, entry);
    const started = await ctx.store.transact(teamOf(photo), ({ photos }) => {
      const current = photos.find((p) => p.id === photo.id);
      if (!current || current.kind !== "upload" || current.status === "uploaded")
        return { write: null, result: null };
      return {
        write: { putPhotos: [{ ...current, status: "uploading" as const }] },
        result: current,
      };
    });
    if (!started) continue;

    try {
      if (!started.blob)
        throw new DepFailure(new SaveError("invalid", "This photo's data is missing from the device."));
      await call(() => ctx.deps.uploadPhoto(started.storagePath, started.blob as Blob));

      // The scout may have removed the photo while it was uploading: don't create a row for it.
      const latest = await ctx.store.getPhoto(started.id);
      if (!latest || latest.kind !== "upload") continue;

      await call(() =>
        ctx.deps.insertPhotoRow({
          id: latest.id,
          entryId: latest.entryId,
          storagePath: latest.storagePath,
        }),
      );
      await ctx.store.transact(teamOf(photo), ({ photos }) => {
        const current = photos.find((p) => p.id === photo.id);
        return current && current.kind === "upload"
          ? {
              write: {
                putPhotos: [
                  { ...current, status: "uploaded" as const, blob: null, lastError: null },
                ],
              },
              result: undefined,
            }
          : { write: null, result: undefined };
      });
    } catch (error) {
      if (!(error instanceof DepFailure)) throw error;
      if (error.error.kind === "unauthorized") throw error;
      await failPhoto(ctx, photo, error.error);
      if (error.error.kind === "network") throw new StopPass("network-error");
    }
  }
}

/** Row first, then object: a failed object delete leaves only an unreferenced file, never a row pointing at nothing. */
async function pushRemovals(ctx: Ctx, entry: LocalEntry): Promise<void> {
  for (const removal of await photosOf(ctx, entry, "removal")) {
    await heartbeat(ctx, entry);
    try {
      await call(() => ctx.deps.deletePhotoRow(removal.id));
      try {
        await call(() => ctx.deps.deletePhotoObject(removal.storagePath));
      } catch (error) {
        // A leftover object in the private bucket is harmless, but a dead
        // network / expired session must keep the removal queued so it is finished later.
        if (
          error instanceof DepFailure &&
          (error.error.kind === "unauthorized" || isRetryableKind(error.error.kind))
        )
          throw error;
      }
      await ctx.store.transact(teamOf(removal), () => ({
        write: { deletePhotoIds: [removal.id] },
        result: undefined,
      }));
    } catch (error) {
      if (!(error instanceof DepFailure)) throw error;
      if (error.error.kind === "unauthorized") throw error;
      await failPhoto(ctx, removal, error.error);
      if (error.error.kind === "network") throw new StopPass("network-error");
    }
  }
}
