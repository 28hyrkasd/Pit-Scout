import { nextUpdatedAt } from "@/lib/entries/clock";
import type { SaveError } from "@/lib/entries/save-error";
import {
  isRetryableKind,
  type LocalEntry,
  type LocalPhoto,
  type StoredError,
} from "./types";

/*
 * The PURE half of the sync state machine: no I/O, no clock, no randomness.
 * Everything takes `nowMs` / `random` as arguments and returns new objects.
 * sync.ts is the thin driver that feeds these functions real state and applies
 * their results.
 */

export type BackoffPolicy = {
  /** Delay after the first failure. */
  baseMs: number;
  factor: number;
  /** No delay is ever longer than this. */
  capMs: number;
  /** 0..1: how much of each delay is randomized downward (0 = none, 1 = "full jitter"). */
  jitter: number;
  /**
   * After this many failed passes in a row (network errors excluded: a dead
   * network is not the entry's fault) the entry stops retrying by itself and
   * waits for a manual "Sync now". Data is NEVER discarded.
   */
  maxAttempts: number;
  /** A "syncing" claim not refreshed for this long belongs to a dead pass and may be taken over. */
  leaseMs: number;
  /** updatedAt further in the future than this (device clock set wrong?) is not trusted. */
  maxClockSkewMs: number;
};

export const DEFAULT_POLICY: BackoffPolicy = {
  baseMs: 2_000,
  factor: 2,
  capMs: 5 * 60_000,
  jitter: 0.5,
  maxAttempts: 8,
  leaseMs: 2 * 60_000,
  maxClockSkewMs: 24 * 60 * 60_000,
};

/**
 * auto:   timer / focus trigger. Respects nextAttemptAt; never retries a non-retryable failure.
 * online: connectivity just came back. Like auto, but entries that failed because of the NETWORK retry now.
 * manual: "Sync now". Everything not synced is due, including non-retryable failures, with attempts reset.
 */
export type SyncMode = "auto" | "online" | "manual";

/** failures = 1 -> ~baseMs, then x factor each time, capped, minus jitter. `random()` must return [0, 1). */
export function computeBackoffMs(
  failures: number,
  random: () => number,
  policy: BackoffPolicy = DEFAULT_POLICY,
): number {
  const exponent = Math.max(0, failures - 1);
  const raw = Math.min(
    policy.capMs,
    policy.baseMs * Math.pow(policy.factor, exponent),
  );
  const jittered = raw * (1 - policy.jitter * random());
  return Math.max(0, Math.min(policy.capMs, Math.round(jittered)));
}

export function toStoredError(error: SaveError): StoredError {
  return { kind: error.kind, message: error.message };
}

/** Is this entry allowed to be picked up right now? */
export function isDue(
  entry: LocalEntry,
  nowMs: number,
  mode: SyncMode,
  policy: BackoffPolicy = DEFAULT_POLICY,
): boolean {
  switch (entry.status) {
    case "synced":
      return false;
    case "syncing":
      // Only a dead pass leaves a stale claim behind.
      return (
        entry.claim === null || nowMs - entry.claim.claimedAt > policy.leaseMs
      );
    case "pending":
      return mode === "manual" || (entry.nextAttemptAt ?? 0) <= nowMs;
    case "failed":
      if (mode === "manual") return true;
      if (mode === "online" && entry.lastError?.kind === "network") return true;
      return entry.nextAttemptAt !== null && entry.nextAttemptAt <= nowMs;
  }
}

/**
 * The next entry to sync: oldest edit first, ONE at a time. `skip` lets the
 * driver exclude entries it already handled in this pass.
 */
export function planNext(
  entries: readonly LocalEntry[],
  nowMs: number,
  mode: SyncMode,
  policy: BackoffPolicy = DEFAULT_POLICY,
  skip: (entry: LocalEntry) => boolean = () => false,
): LocalEntry | undefined {
  return entries
    .filter((e) => isDue(e, nowMs, mode, policy) && !skip(e))
    .sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime() ||
        (a.key < b.key ? -1 : 1),
    )[0];
}

/** Should a photo record be attempted in this pass? (Its owner entry is already being synced.) */
export function isPhotoDue(photo: LocalPhoto, mode: SyncMode): boolean {
  if (photo.kind === "upload" && photo.status === "uploaded") return false;
  if (photo.status === "failed" && mode !== "manual") {
    // A photo the server refused (permission/invalid/quota) is not retried by itself.
    return photo.lastError === null || isRetryableKind(photo.lastError.kind);
  }
  return true; // pending, uploading (left by a dead pass), or manual
}

// ---------------------------------------------------------------------------
// Local edits
// ---------------------------------------------------------------------------

/**
 * Apply "the scout changed something" to an entry's sync state.
 *
 * Not syncing: back to pending, immediately due, failure history cleared.
 * Syncing (a pass is in flight): status and claim stay, so that pass's result
 * lands on a consistent record, but `revision` moves, and the finishing pass
 * sees that and puts the entry back to pending instead of "synced". That is how
 * a newer edit is never lost when an older version's result arrives.
 */
export function markLocalChange(
  entry: LocalEntry,
  nowMs: number,
  policy: BackoffPolicy = DEFAULT_POLICY,
): LocalEntry {
  const liveClaim =
    entry.status === "syncing" &&
    entry.claim !== null &&
    nowMs - entry.claim.claimedAt <= policy.leaseMs;
  const base = { ...entry, revision: entry.revision + 1 };
  if (liveClaim) return base;
  return {
    ...base,
    status: "pending",
    attempts: 0,
    nextAttemptAt: nowMs,
    lastError: null,
    claim: null,
  };
}

/** Never earlier than anything this device has seen for the team (see nextUpdatedAt). */
export function latestKnownUpdatedAt(
  ...candidates: (string | null | undefined)[]
): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const ms = new Date(c).getTime();
    if (Number.isFinite(ms) && ms > bestMs) {
      best = c;
      bestMs = ms;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Sync transitions
// ---------------------------------------------------------------------------

/**
 * A pass takes ownership of the entry. Also the defensive clock check: an
 * updatedAt more than `maxClockSkewMs` ahead of this device's clock (the clock
 * was wrong when the scout saved, and has since been corrected) would win
 * last-write-wins against every other scout until the real time catches up. It
 * is rewritten to "now, but not before the last version the server showed us".
 * It is only ever lowered, and the entry is flagged `clockAdjusted`.
 */
export function claimEntry(
  entry: LocalEntry,
  nowMs: number,
  policy: BackoffPolicy = DEFAULT_POLICY,
): LocalEntry {
  let next: LocalEntry = {
    ...entry,
    status: "syncing",
    claim: { revision: entry.revision, claimedAt: nowMs },
  };
  const updatedMs = new Date(entry.updatedAt).getTime();
  if (updatedMs > nowMs + policy.maxClockSkewMs) {
    const corrected = nextUpdatedAt(nowMs, entry.serverUpdatedAt);
    if (new Date(corrected).getTime() < updatedMs) {
      next = {
        ...next,
        updatedAt: corrected,
        createdAt:
          new Date(entry.createdAt).getTime() > new Date(corrected).getTime()
            ? corrected
            : entry.createdAt,
        clockAdjusted: true,
      };
    }
  }
  return next;
}

/** Keep the lease alive between steps of a long pass. */
export function refreshClaim(entry: LocalEntry, nowMs: number): LocalEntry {
  if (entry.status !== "syncing" || !entry.claim) return entry;
  return { ...entry, claim: { ...entry.claim, claimedAt: nowMs } };
}

/** The pass stopped for a reason that is not the entry's fault (signed out, aborted): give it back untouched. */
export function releaseEntry(entry: LocalEntry): LocalEntry {
  if (entry.status !== "syncing") return entry;
  return { ...entry, status: "pending", claim: null };
}

export type FinishInput = {
  /** What the pass attempted from: attempts is reset to 0 in manual mode. */
  baseAttempts: number;
  claimRevision: number;
  /** The entry-level failure (event/RPC), if any. Photo failures are read from the photo records. */
  entryFailure: StoredError | null;
  photos: readonly LocalPhoto[];
};

export type FinishResult = {
  entry: LocalEntry;
  /** Uploaded photo records that can be dropped now that the entry is fully synced. */
  prunePhotoIds: string[];
};

/** Photo records that still owe the server something. */
export function outstandingPhotos(photos: readonly LocalPhoto[]): LocalPhoto[] {
  return photos.filter((p) => !(p.kind === "upload" && p.status === "uploaded"));
}

/**
 * The end of a pass for one entry: synced / failed / pending-again.
 *
 *  - Edited while the pass ran (revision moved): pending, due now. Failure
 *    bookkeeping is kept only when the failure was retryable.
 *  - Nothing left to do and no failure: synced.
 *  - Otherwise failed. Retryable -> nextAttemptAt from the backoff; not retryable,
 *    or out of attempts -> nextAttemptAt null (manual "Sync now" only).
 *
 * `attempts` counts every failed pass; the maxAttempts cut-off ignores network
 * errors.
 */
export function finishEntry(
  entry: LocalEntry,
  input: FinishInput,
  nowMs: number,
  random: () => number,
  policy: BackoffPolicy = DEFAULT_POLICY,
): FinishResult {
  const outstanding = outstandingPhotos(input.photos);
  const failures: StoredError[] = [
    ...(input.entryFailure ? [input.entryFailure] : []),
    ...outstanding.flatMap((p) => (p.lastError ? [p.lastError] : [])),
  ];
  const representative =
    failures.find((f) => isRetryableKind(f.kind)) ?? failures[0] ?? null;
  const retryable = representative ? isRetryableKind(representative.kind) : false;
  const attempts = input.baseAttempts + 1;
  const outOfAttempts =
    representative !== null &&
    representative.kind !== "network" &&
    attempts >= policy.maxAttempts;
  const nextFailureAt =
    retryable && !outOfAttempts
      ? nowMs + computeBackoffMs(attempts, random, policy)
      : null;

  const edited = entry.revision !== input.claimRevision;
  if (edited) {
    return {
      entry: {
        ...entry,
        status: "pending",
        claim: null,
        attempts: retryable ? attempts : 0,
        nextAttemptAt: retryable ? nextFailureAt : nowMs,
        lastError: retryable ? representative : null,
      },
      prunePhotoIds: [],
    };
  }

  if (failures.length === 0 && !entry.entryDirty && outstanding.length === 0) {
    return {
      entry: {
        ...entry,
        status: "synced",
        claim: null,
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        syncedAt: nowMs,
      },
      prunePhotoIds: input.photos.map((p) => p.id),
    };
  }

  if (failures.length === 0) {
    // Work remains but nothing failed (a pass stopped early). Try again soon.
    return {
      entry: { ...entry, status: "pending", claim: null, nextAttemptAt: nowMs },
      prunePhotoIds: [],
    };
  }

  return {
    entry: {
      ...entry,
      status: "failed",
      claim: null,
      attempts,
      nextAttemptAt: nextFailureAt,
      lastError: representative,
    },
    prunePhotoIds: [],
  };
}
