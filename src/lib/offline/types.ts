import type { EntryPayload } from "@/lib/entries/payload";
import type { SaveErrorKind } from "@/lib/entries/save-error";
import type { AppEvent } from "@/lib/external/schemas";

export const DB_NAME = "pit-scout";
/** Bump together with a new entry in MIGRATIONS (idb-backend.ts). */
export const DB_VERSION = 1;

/** pending: waiting. syncing: a pass owns it. synced: server has everything. failed: needs a retry (see nextAttemptAt). */
export type SyncStatus = "pending" | "syncing" | "synced" | "failed";
export type PhotoStatus = "pending" | "uploading" | "uploaded" | "failed";
/** upload: a new photo to send. removal: a photo that exists on the server and was removed offline. */
export type PhotoKind = "upload" | "removal";

/** The slice of a SaveError that is safe to persist (no stack, no class). */
export type StoredError = { kind: SaveErrorKind; message: string };

/** The one logical entry per (event, team). Key: `${eventKey}:${teamNumber}`. */
export type LocalEntry = {
  schemaVersion: 1;
  key: string;
  /** Client-generated id. Stable across edits. NOT necessarily the id on the server (see serverId). */
  id: string;
  eventKey: string;
  teamNumber: number;
  payload: EntryPayload;
  createdAt: string;
  /** Last-write-wins clock sent to the RPC. */
  updatedAt: string;
  /** Snapshot needed to upsert the events row (FK target) before the entry. */
  event: AppEvent;

  status: SyncStatus;
  /** Failed passes since the last success (or manual reset). Drives the backoff. */
  attempts: number;
  /** ms epoch. null on a failed entry = no automatic retry (needs manual "Sync now"). */
  nextAttemptAt: number | null;
  lastError: StoredError | null;

  /** The id the row has on the server after a sync. Differs from `id` when another scout created the team first. */
  serverId: string | null;
  /** updated_at the server reported on the last sync. Edits never go earlier than this. */
  serverUpdatedAt: string | null;
  /** true: the entry upsert (RPC) is still owed. false: only photos may be outstanding. */
  entryDirty: boolean;
  /** The server already had a NEWER version, so this device's version was not applied. Cleared by the next edit. */
  superseded: boolean;
  /** updatedAt was rewritten because the device clock was far in the future. */
  clockAdjusted: boolean;
  /** Bumped by every local change (edit, photo add/remove). Lets a finishing pass notice edits made while it ran. */
  revision: number;
  /** Present while status === "syncing". */
  claim: { revision: number; claimedAt: number } | null;
  /** ms epoch of the last time everything was confirmed on the server. */
  syncedAt: number | null;
};

export type LocalPhoto = {
  schemaVersion: 1;
  id: string;
  eventKey: string;
  teamNumber: number;
  /** The CURRENT id of the entry row on the server (or the local id until the entry is synced). Re-pointed after sync. */
  entryId: string;
  kind: PhotoKind;
  status: PhotoStatus;
  /** Compressed JPEG. null once uploaded (frees device storage) and for removals. */
  blob: Blob | null;
  /** Deterministic: {eventKey}/{teamNumber}/{id}.jpg */
  storagePath: string;
  attempts: number;
  lastError: StoredError | null;
  createdAt: string;
};

export type CacheRecord = { value: unknown; savedAt: number };

export type TeamRef = { eventKey: string; teamNumber: number };

export function entryKey(eventKey: string, teamNumber: number): string {
  return `${eventKey}:${teamNumber}`;
}

/** Retryable without the user changing anything (matches SaveError.retryable). */
export function isRetryableKind(kind: SaveErrorKind): boolean {
  return kind === "network" || kind === "unknown";
}
