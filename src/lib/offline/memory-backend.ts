import {
  STORE_NAMES,
  STORE_SPECS,
  type BackendTx,
  type IndexQuery,
  type StorageBackend,
  type StoreName,
} from "./backend";
import { BackendStore, type BackendStoreOptions } from "./store";

type Data = Record<StoreName, Map<string, unknown>>;

/** Structured clone, like IndexedDB does on every put/get, so tests can't rely on shared references. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyData(): Data {
  return Object.fromEntries(STORE_NAMES.map((n) => [n, new Map()])) as Data;
}

/**
 * In-memory StorageBackend with IndexedDB's transaction semantics that matter here:
 * values are cloned in and out, read-write transactions are serialized, and a
 * transaction that throws is rolled back completely.
 *
 * `onWrite` is a fault-injection hook: throw from it to simulate a failing write
 * (e.g. a QuotaExceededError). Because the whole transaction rolls back, a test
 * can prove a failed write leaves earlier data untouched.
 */
export class MemoryBackend implements StorageBackend {
  private data: Data = emptyData();
  private queue: Promise<unknown> = Promise.resolve();
  onWrite: ((store: StoreName, key: string, value: unknown) => void) | null =
    null;

  tx<T>(
    stores: readonly StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: BackendTx) => Promise<T>,
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const snapshot: Data | null =
        mode === "readwrite" ? this.snapshot() : null;
      try {
        return await fn(this.makeTx(stores, mode));
      } catch (error) {
        if (snapshot) this.data = snapshot;
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  close(): void {}

  private snapshot(): Data {
    // Stored values are never mutated in place (put clones, get clones), so
    // copying the Maps is enough.
    return Object.fromEntries(
      STORE_NAMES.map((n) => [n, new Map(this.data[n])]),
    ) as Data;
  }

  private makeTx(
    allowed: readonly StoreName[],
    mode: "readonly" | "readwrite",
  ): BackendTx {
    const check = (store: StoreName, write: boolean) => {
      if (!allowed.includes(store))
        throw new Error(`store "${store}" is not part of this transaction`);
      if (write && mode !== "readwrite")
        throw new Error("write in a readonly transaction");
    };
    const keyOf = (store: StoreName, value: unknown, key?: string): string => {
      const keyPath = STORE_SPECS[store].keyPath;
      if (keyPath === null) {
        if (key === undefined) throw new Error(`"${store}" needs an explicit key`);
        return key;
      }
      const k = (value as Record<string, unknown>)[keyPath];
      if (typeof k !== "string") throw new Error(`missing key "${keyPath}"`);
      return k;
    };
    return {
      get: async (store, key) => {
        check(store, false);
        const v = this.data[store].get(key);
        return v === undefined ? undefined : clone(v);
      },
      getAll: async (store, query?: IndexQuery) => {
        check(store, false);
        let values = [...this.data[store].values()];
        if (query) {
          const fields = STORE_SPECS[store].indexes[query.index];
          if (!fields) throw new Error(`unknown index ${query.index}`);
          values = values.filter((v) =>
            fields.every(
              (f, i) => (v as Record<string, unknown>)[f] === query.key[i],
            ),
          );
        }
        return values.map(clone);
      },
      getAllKeys: async (store) => {
        check(store, false);
        return [...this.data[store].keys()];
      },
      put: async (store, value, key) => {
        check(store, true);
        const k = keyOf(store, value, key);
        this.onWrite?.(store, k, value);
        this.data[store].set(k, clone(value));
      },
      delete: async (store, key) => {
        check(store, true);
        this.data[store].delete(key);
      },
      clear: async (store) => {
        check(store, true);
        this.data[store].clear();
      },
    };
  }
}

/**
 * An OfflineStore that lives in memory only. For tests, and the explicit
 * "IndexedDB unavailable" fallback. `memory` exposes the backend for fault injection.
 */
export function createMemoryStore(
  options: BackendStoreOptions = {},
): BackendStore & { memory: MemoryBackend } {
  const memory = new MemoryBackend();
  return Object.assign(new BackendStore(memory, options), { memory });
}
