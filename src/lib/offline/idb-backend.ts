import { openDB, type IDBPDatabase, type OpenDBCallbacks } from "idb";
import {
  STORE_SPECS,
  type BackendTx,
  type IndexQuery,
  type StorageBackend,
  type StoreName,
} from "./backend";
import { StorageUnavailableError } from "./errors";
import { BackendStore, type BackendStoreOptions, type OfflineStore } from "./store";
import { createMemoryStore } from "./memory-backend";
import { DB_NAME, DB_VERSION } from "./types";

// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------

/** The slice of IDBDatabase an upgrade needs. Structural, so tests can fake it. */
export type UpgradeDb = {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(
    name: string,
    options?: { keyPath?: string },
  ): { createIndex(name: string, keyPath: string | string[]): unknown };
};

/**
 * MIGRATIONS[i] upgrades the database from version i to i + 1, and must be safe
 * to run on a database that is missing stores (idempotent creation). To change
 * the schema: append a function here and bump DB_VERSION in types.ts. Existing
 * data in untouched stores survives an upgrade.
 */
export type Migration = (db: UpgradeDb) => void;

/** v0 -> v1: create every store and index from STORE_SPECS. */
export const migrateToV1: Migration = (db) => {
  for (const [name, spec] of Object.entries(STORE_SPECS)) {
    if (db.objectStoreNames.contains(name)) continue;
    const store = db.createObjectStore(
      name,
      spec.keyPath ? { keyPath: spec.keyPath } : undefined,
    );
    for (const [index, fields] of Object.entries(spec.indexes))
      store.createIndex(index, fields);
  }
};

export const MIGRATIONS: Migration[] = [migrateToV1];

/** Run every migration between the stored version and the target, in order. */
export function runMigrations(
  db: UpgradeDb,
  oldVersion: number,
  newVersion: number,
  migrations: Migration[] = MIGRATIONS,
): void {
  for (let v = oldVersion; v < newVersion; v++) {
    const migrate = migrations[v];
    if (!migrate) throw new Error(`No migration from version ${v} to ${v + 1}`);
    migrate(db);
  }
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export type IdbBackendOptions = {
  name?: string;
  version?: number;
  /** Injected for tests; defaults to idb's openDB. */
  openDB?: (
    name: string,
    version: number,
    callbacks: OpenDBCallbacks<unknown>,
  ) => Promise<IDBPDatabase<unknown>>;
  /** Defaults to `typeof indexedDB !== "undefined"`. */
  hasIndexedDB?: () => boolean;
  migrations?: Migration[];
  /** Another tab holds an older connection open and is blocking our upgrade. Tell the scout to close other tabs. */
  onBlocked?: () => void;
  /** The browser killed the connection (storage cleared, eviction). The next operation reopens. */
  onTerminated?: () => void;
};

/** The slice of an idb transaction used below (idb's generics collapse to "possibly undefined" for an untyped schema). */
type LooseStore = {
  get(key: string): Promise<unknown>;
  getAll(query?: unknown): Promise<unknown[]>;
  getAllKeys(): Promise<unknown[]>;
  put(value: unknown, key?: string): Promise<unknown>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  index(name: string): { getAll(query: unknown): Promise<unknown[]> };
};
type LooseTx = {
  objectStore(name: string): LooseStore;
  done: Promise<void>;
  abort(): void;
};

/**
 * IndexedDB StorageBackend: deliberately thin, every method maps 1:1 onto idb.
 * Connection lifecycle:
 *  - opened lazily and shared;
 *  - `blocking` (a newer tab wants to upgrade): close our connection so it can,
 *    and reopen on the next operation;
 *  - `terminated` / a closing connection: forget the handle and reopen next time.
 */
export class IdbBackend implements StorageBackend {
  private dbPromise: Promise<IDBPDatabase<unknown>> | null = null;
  private readonly name: string;
  private readonly version: number;

  constructor(private readonly options: IdbBackendOptions = {}) {
    this.name = options.name ?? DB_NAME;
    this.version = options.version ?? DB_VERSION;
  }

  /** Open the connection now (throws StorageUnavailableError if impossible). */
  async open(): Promise<void> {
    await this.db();
  }

  private db(): Promise<IDBPDatabase<unknown>> {
    if (this.dbPromise) return this.dbPromise;
    const has =
      this.options.hasIndexedDB ?? (() => typeof indexedDB !== "undefined");
    if (!has())
      return Promise.reject(
        new StorageUnavailableError(
          "This browser does not support offline storage.",
        ),
      );
    const open = this.options.openDB ?? openDB;
    const pending: Promise<IDBPDatabase<unknown>> = open(this.name, this.version, {
      upgrade: (db, oldVersion, newVersion) =>
        runMigrations(
          db as unknown as UpgradeDb,
          oldVersion,
          newVersion ?? this.version,
          this.options.migrations,
        ),
      blocked: () => this.options.onBlocked?.(),
      blocking: () => {
        // Let the other tab upgrade; we reopen (at the new version) when next used.
        void pending.then((db) => db.close()).catch(() => undefined);
        this.dbPromise = null;
      },
      terminated: () => {
        this.dbPromise = null;
        this.options.onTerminated?.();
      },
    }).catch((cause: unknown) => {
      if (this.dbPromise === pending) this.dbPromise = null;
      // Safari private mode, blocked storage, newer schema than this code knows...
      throw new StorageUnavailableError(undefined, { cause });
    });
    this.dbPromise = pending;
    return pending;
  }

  private async begin(
    stores: readonly StoreName[],
    mode: "readonly" | "readwrite",
  ) {
    const start = async () =>
      (await this.db()).transaction([...stores], mode);
    try {
      return await start();
    } catch (error) {
      // The connection was closed under us (InvalidStateError): reopen once.
      if ((error as { name?: string } | null)?.name !== "InvalidStateError")
        throw error;
      this.dbPromise = null;
      return await start();
    }
  }

  async tx<T>(
    stores: readonly StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: BackendTx) => Promise<T>,
  ): Promise<T> {
    const tx = (await this.begin(stores, mode)) as unknown as LooseTx;
    const wrapper: BackendTx = {
      get: (store, key) => tx.objectStore(store).get(key),
      getAll: (store, query?: IndexQuery) =>
        query
          ? tx.objectStore(store).index(query.index).getAll(query.key)
          : tx.objectStore(store).getAll(),
      getAllKeys: async (store) =>
        (await tx.objectStore(store).getAllKeys()).map(String),
      put: async (store, value, key) => {
        if (key === undefined) await tx.objectStore(store).put(value);
        else await tx.objectStore(store).put(value, key);
      },
      delete: (store, key) => tx.objectStore(store).delete(key),
      clear: (store) => tx.objectStore(store).clear(),
    };
    try {
      const [result] = await Promise.all([fn(wrapper), tx.done]);
      return result;
    } catch (error) {
      // Roll back anything the callback already wrote.
      try {
        tx.abort();
      } catch {
        // already finished or aborted
      }
      throw error;
    }
  }

  close(): void {
    const pending = this.dbPromise;
    this.dbPromise = null;
    void pending?.then((db) => db.close()).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Opening the store
// ---------------------------------------------------------------------------

export type OpenStoreOptions = IdbBackendOptions &
  BackendStoreOptions & {
    /**
     * How long opening (and probing) the database may take. indexedDB.open() never fails when another tab keeps an
     * older connection open during a version upgrade: it just waits, so without a limit the app would sit on
     * "still getting this device ready" forever. Default 10s.
     */
    openTimeoutMs?: number;
  };

export const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

const BLOCKED_MESSAGE =
  "Offline storage is busy because Pit-Scout is open in another tab or window. Close the other tabs and reload.";
const TIMEOUT_MESSAGE =
  "Offline storage took too long to open. Close other Pit-Scout tabs or windows and reload.";

/**
 * Open the IndexedDB-backed store, and PROVE it works by writing and deleting a
 * probe record. Some browsers (old Safari private mode) open the database fine
 * and then fail every write with a quota error; that must read as "unavailable",
 * not "device full". Rejects with StorageUnavailableError, including when the
 * open does not finish within `openTimeoutMs` (usually another tab blocking an upgrade).
 */
export async function openOfflineStore(
  options: OpenStoreOptions = {},
): Promise<OfflineStore> {
  let blocked = false;
  const backend = new IdbBackend({
    ...options,
    onBlocked: () => {
      blocked = true;
      options.onBlocked?.();
    },
  });
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const opening = (async () => {
      await backend.open();
      // After a timeout the backend was closed: probing now would just open a second, leaked connection.
      if (abandoned) return;
      await backend.tx(["meta"], "readwrite", async (tx) => {
        await tx.put("meta", 1, "__probe");
        await tx.delete("meta", "__probe");
      });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abandoned = true;
        reject(
          new StorageUnavailableError(blocked ? BLOCKED_MESSAGE : TIMEOUT_MESSAGE),
        );
      }, options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
    });
    // The loser of the race must not surface as an unhandled rejection.
    opening.catch(() => undefined);
    await Promise.race([opening, timeout]);
  } catch (cause) {
    abandoned = true;
    backend.close();
    if (cause instanceof StorageUnavailableError) throw cause;
    throw new StorageUnavailableError(undefined, { cause });
  } finally {
    clearTimeout(timer);
  }
  return new BackendStore(backend, { onCorrupt: options.onCorrupt });
}

/**
 * Like openOfflineStore, but when IndexedDB is unavailable returns an in-memory
 * store with `persistent: false`. The app keeps working this session, but
 * NOTHING survives a reload: the UI must say so ("Offline saving isn't
 * available in this browser").
 */
export async function openOfflineStoreWithFallback(
  options: OpenStoreOptions = {},
): Promise<{ store: OfflineStore; persistent: boolean; reason?: Error }> {
  try {
    return { store: await openOfflineStore(options), persistent: true };
  } catch (error) {
    return {
      store: createMemoryStore(),
      persistent: false,
      reason: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
