/**
 * Offline-first core (Phase 8). Framework-free: no React, no Next, no `window`
 * access at import time. See README.md for the data model, state diagram and
 * how to wire it into the UI.
 *
 * Typical wiring:
 *   const { store, persistent } = await openOfflineStoreWithFallback();
 *   const deps = createSupabaseSyncDeps(createClient());
 *   const monitor = new ConnectivityMonitor({ fetch: (u, i) => fetch(u, i), ...browserTargets });
 *   // on save:           await saveEntryLocally(...); void runSyncPass(store, deps)
 *   // on status->online: void runSyncPass(store, deps, { mode: "online" })
 *   // "Sync now":        void runSyncPass(store, deps, { mode: "manual" })
 */

// Data model
export {
  DB_NAME,
  DB_VERSION,
  entryKey,
  isRetryableKind,
  type CacheRecord,
  type LocalEntry,
  type LocalPhoto,
  type PhotoKind,
  type PhotoStatus,
  type StoredError,
  type SyncStatus,
  type TeamRef,
} from "./types";

// Errors
export {
  StorageUnavailableError,
  deviceQuotaError,
  isQuotaError,
  isStorageUnavailable,
  normalizeStorageError,
} from "./errors";

// Storage
export type { OfflineStore, TeamView, TeamWrite } from "./store";
export { BackendStore } from "./store";
export type { StorageBackend } from "./backend";
export { MemoryBackend, createMemoryStore } from "./memory-backend";
export {
  IdbBackend,
  MIGRATIONS,
  openOfflineStore,
  openOfflineStoreWithFallback,
  runMigrations,
  type OpenStoreOptions,
} from "./idb-backend";

// Local operations (what the UI calls)
export {
  OfflineUsageError,
  addPhotoLocally,
  clearSyncedEntries,
  getLocalEntry,
  getSyncCounts,
  listLocalEntries,
  listLocalPhotos,
  listPending,
  removePhotoLocally,
  resetOfflineData,
  saveEntryLocally,
  type LocalOps,
  type RemovePhotoResult,
  type SyncCounts,
} from "./local";

// Sync
export {
  DEFAULT_POLICY,
  computeBackoffMs,
  isDue,
  planNext,
  type BackoffPolicy,
  type SyncMode,
} from "./plan";
export {
  isPausedForAuth,
  isSyncRunning,
  resumeAfterAuth,
  runSyncPass,
  type SyncDeps,
  type SyncOptions,
  type SyncPassOutcome,
  type SyncPassResult,
} from "./sync";
export { createSupabaseSyncDeps, upsertEventRow } from "./supabase-deps";

// Connectivity
export {
  ConnectivityMonitor,
  nextConnectivity,
  type ConnectivityMonitorOptions,
  type ConnectivityStatus,
} from "./connectivity";

// Cache
export {
  cacheDelete,
  cacheGet,
  cacheKeys,
  cachePut,
  cacheSchemas,
  type CacheHit,
  type CachePutResult,
} from "./cache";
