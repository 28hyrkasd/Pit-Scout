/**
 * The smallest transactional key-value surface the offline store needs.
 * Two implementations: IndexedDB (idb-backend.ts) and in-memory (memory-backend.ts,
 * used by tests and as an explicit fallback). All real logic lives in store.ts on
 * top of this interface, so it is tested once against the memory backend.
 */

export type StoreName = "entries" | "photos" | "cache" | "meta";

/** Object stores and their indexes. Shared by both backends so they cannot disagree. */
export const STORE_SPECS: Record<
  StoreName,
  { keyPath: string | null; indexes: Record<string, string[]> }
> = {
  entries: { keyPath: "key", indexes: {} },
  photos: { keyPath: "id", indexes: { byTeam: ["eventKey", "teamNumber"] } },
  cache: { keyPath: null, indexes: {} },
  meta: { keyPath: null, indexes: {} },
};

export const STORE_NAMES = Object.keys(STORE_SPECS) as StoreName[];

export type IndexQuery = { index: string; key: (string | number)[] };

/**
 * One transaction. Contract (matches IndexedDB): only await these methods inside
 * the callback. Awaiting anything else (fetch, timers) lets a real IndexedDB
 * transaction auto-commit before the next call.
 */
export interface BackendTx {
  get(store: StoreName, key: string): Promise<unknown>;
  getAll(store: StoreName, query?: IndexQuery): Promise<unknown[]>;
  getAllKeys(store: StoreName): Promise<string[]>;
  /** `key` is required for stores without a keyPath (cache, meta). */
  put(store: StoreName, value: unknown, key?: string): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

export interface StorageBackend {
  /**
   * Run `fn` atomically: if it (or any write) throws, nothing it wrote is kept.
   * Read-write transactions on the same stores run one at a time.
   */
  tx<T>(
    stores: readonly StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: BackendTx) => Promise<T>,
  ): Promise<T>;
  close(): void;
}
