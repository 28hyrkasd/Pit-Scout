import type { IDBPDatabase, OpenDBCallbacks } from "idb";
import { describe, expect, it, vi } from "vitest";
import { SaveError } from "@/lib/entries/save-error";
import { STORE_SPECS } from "./backend";
import { StorageUnavailableError } from "./errors";
import {
  IdbBackend,
  MIGRATIONS,
  migrateToV1,
  openOfflineStore,
  openOfflineStoreWithFallback,
  runMigrations,
  type UpgradeDb,
} from "./idb-backend";
import { addPhotoLocally, saveEntryLocally } from "./local";
import { BackendStore } from "./store";
import { EMPTY_PAYLOAD, EVENT, fakeClock, jpeg, uuidSequence } from "./test-utils";
import { DB_NAME, DB_VERSION } from "./types";

/*
 * There is no IndexedDB in Node and fake-indexeddb is not installed, so these
 * tests drive IdbBackend against a hand-written fake of the slice of the `idb`
 * API it uses. That proves the mapping (store names, index queries, key
 * handling, abort-on-error, lifecycle callbacks, migrations). It does NOT
 * prove real browser semantics; see README "Unverified".
 */

type Rec = Map<string, unknown>;

class FakeDb {
  stores = new Map<string, { keyPath: string | null; indexes: Record<string, string[]>; data: Rec }>();
  closed = false;
  aborted = 0;
  failPut: Error | null = null;
  /** Stores whose put() fails with a quota error. */
  quotaStores = new Set<string>();
  failTransaction: Error | null = null;
  objectStoreNames = { contains: (n: string) => this.stores.has(n) };

  createObjectStore(name: string, options?: { keyPath?: string }) {
    const entry = { keyPath: options?.keyPath ?? null, indexes: {} as Record<string, string[]>, data: new Map() };
    this.stores.set(name, entry);
    return {
      createIndex: (index: string, keyPath: string | string[]) => {
        entry.indexes[index] = Array.isArray(keyPath) ? keyPath : [keyPath];
      },
    };
  }

  close() {
    this.closed = true;
  }

  transaction(names: string[], mode: string) {
    if (this.failTransaction) {
      const error = this.failTransaction;
      this.failTransaction = null;
      throw error;
    }
    const snapshot = new Map([...this.stores].map(([n, s]) => [n, new Map(s.data)]));
    let aborted = false;
    const done = new Promise<void>((resolve, reject) => {
      setTimeout(() => (aborted ? reject(new DOMException("aborted", "AbortError")) : resolve()), 0);
    });
    done.catch(() => undefined);
    const store = (name: string) => {
      if (!names.includes(name)) throw new Error(`no store ${name} in tx`);
      const s = this.stores.get(name)!;
      return {
        get: async (key: string) => s.data.get(key),
        getAll: async (query?: unknown) => {
          const all = [...s.data.values()];
          return query === undefined ? all : all;
        },
        getAllKeys: async () => [...s.data.keys()],
        put: async (value: unknown, key?: string) => {
          if (mode !== "readwrite") throw new Error("readonly");
          if (this.failPut) throw this.failPut;
          if (this.quotaStores.has(name)) throw new DOMException("full", "QuotaExceededError");
          const k = s.keyPath ? (value as Record<string, string>)[s.keyPath] : key;
          if (k === undefined) throw new Error("no key");
          s.data.set(k, value);
        },
        delete: async (key: string) => void s.data.delete(key),
        clear: async () => void s.data.clear(),
        index: (index: string) => ({
          getAll: async (query: unknown[]) => {
            const fields = s.indexes[index];
            if (!fields) throw new Error(`no index ${index}`);
            return [...s.data.values()].filter((v) => fields.every((f, i) => (v as Record<string, unknown>)[f] === query[i]));
          },
        }),
      };
    };
    return {
      objectStore: store,
      done,
      abort: () => {
        aborted = true;
        this.aborted += 1;
        for (const [n, data] of snapshot) this.stores.get(n)!.data = data;
      },
    };
  }
}

function fakeIdb(initial: { version?: number; db?: FakeDb } = {}) {
  const db = initial.db ?? new FakeDb();
  let storedVersion = initial.version ?? 0;
  const opens: { name: string; version: number; callbacks: OpenDBCallbacks<unknown> }[] = [];
  const openDB = vi.fn(async (name: string, version: number, callbacks: OpenDBCallbacks<unknown>) => {
    opens.push({ name, version, callbacks });
    db.closed = false;
    if (storedVersion < version) {
      callbacks.upgrade?.(db as never, storedVersion, version, null as never, null as never);
      storedVersion = version;
    }
    return db as unknown as IDBPDatabase<unknown>;
  });
  return { db, openDB, opens, getVersion: () => storedVersion };
}

describe("migrations", () => {
  function recordingDb() {
    const created: string[] = [];
    const indexes: string[] = [];
    const existing = new Set<string>();
    const db: UpgradeDb = {
      objectStoreNames: { contains: (n) => existing.has(n) },
      createObjectStore: (name, options) => {
        created.push(`${name}:${options?.keyPath ?? "-"}`);
        existing.add(name);
        return { createIndex: (n, kp) => void indexes.push(`${name}.${n}=${[kp].flat().join("+")}`) };
      },
    };
    return { db, created, indexes, existing };
  }

  it("v1 creates every store (with key paths) and the team index", () => {
    const { db, created, indexes } = recordingDb();
    runMigrations(db, 0, 1);
    expect(created.sort()).toEqual(["cache:-", "entries:key", "meta:-", "photos:id"]);
    expect(indexes).toEqual(["photos.byTeam=eventKey+teamNumber"]);
    expect(Object.keys(STORE_SPECS).sort()).toEqual(["cache", "entries", "meta", "photos"]);
  });

  it("is safe to re-run on a database that already has some stores", () => {
    const { db, created, existing } = recordingDb();
    existing.add("entries");
    migrateToV1(db);
    expect(created).not.toContain("entries:key");
    expect(created).toHaveLength(3);
  });

  it("applies only the missing steps, in order (v1 -> v3)", () => {
    const order: string[] = [];
    const migrations = [() => order.push("1"), () => order.push("2"), () => order.push("3")];
    runMigrations({} as UpgradeDb, 1, 3, migrations);
    expect(order).toEqual(["2", "3"]);
  });

  it("an upgrade does nothing when already current, and throws when a step is missing", () => {
    const order: string[] = [];
    runMigrations({} as UpgradeDb, 2, 2, [() => order.push("x")]);
    expect(order).toEqual([]);
    expect(() => runMigrations({} as UpgradeDb, 0, 2, [() => undefined])).toThrow(/No migration from version 1 to 2/);
  });

  it("DB_VERSION matches the number of migrations", () => {
    expect(MIGRATIONS).toHaveLength(DB_VERSION);
  });

  it("a v2 migration upgrades an existing v1 database and keeps its data", async () => {
    const fake = fakeIdb();
    const v1 = new IdbBackend({ openDB: fake.openDB, hasIndexedDB: () => true, version: 1, migrations: [migrateToV1] });
    const store1 = new BackendStore(v1);
    await store1.putCacheRecord("k", { value: 1, savedAt: 1 });
    v1.close();

    const v2 = new IdbBackend({
      openDB: fake.openDB,
      hasIndexedDB: () => true,
      version: 2,
      migrations: [migrateToV1, (db) => void db.createObjectStore("extra")],
    });
    const store2 = new BackendStore(v2);
    expect(await store2.getCacheRecord("k")).toEqual({ value: 1, savedAt: 1 });
    expect(fake.db.stores.has("extra")).toBe(true);
    expect(fake.getVersion()).toBe(2);
  });
});

describe("IdbBackend with a BackendStore on top", () => {
  async function open() {
    const fake = fakeIdb();
    const store = await openOfflineStore({ openDB: fake.openDB, hasIndexedDB: () => true });
    return { fake, store };
  }

  it("opens 'pit-scout' at the current version and cleans up its write probe", async () => {
    const { fake } = await open();
    expect(fake.opens[0]).toMatchObject({ name: DB_NAME, version: DB_VERSION });
    expect(fake.db.stores.get("meta")!.data.size).toBe(0);
  });

  it("stores entries and photos (with blob) and finds a team's photos through the index", async () => {
    const { store } = await open();
    const clock = fakeClock();
    const ops = { now: clock.now, makeId: uuidSequence(1) };
    const entry = await saveEntryLocally(store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, ops);
    await addPhotoLocally(store, { event: EVENT, teamNumber: 254, blob: jpeg("a") }, ops);
    await saveEntryLocally(store, { event: EVENT, teamNumber: 971, payload: EMPTY_PAYLOAD }, ops);
    await addPhotoLocally(store, { event: EVENT, teamNumber: 971, blob: jpeg("b") }, ops);

    expect(await store.getEntry(entry.key)).toEqual({ ...entry, revision: 2 }); // the photo bumped it
    expect(await store.listEntries()).toHaveLength(2);
    const photos = await store.listPhotos({ eventKey: EVENT.key, teamNumber: 971 });
    expect(photos).toHaveLength(1);
    expect(await photos[0].blob?.text()).toBe("b");
  });

  it("cache and meta use explicit keys", async () => {
    const { store } = await open();
    await store.putCacheRecord("fields:v1", { value: [1], savedAt: 5 });
    await store.setMeta("pausedForAuth", true);
    expect(await store.getCacheRecord("fields:v1")).toEqual({ value: [1], savedAt: 5 });
    expect(await store.listCacheKeys()).toEqual(["fields:v1"]);
    expect(await store.getMeta("pausedForAuth")).toBe(true);
    await store.clearAll();
    expect(await store.listCacheKeys()).toEqual([]);
  });

  it("a failed write (device quota) aborts the transaction: earlier writes in it are rolled back, error is kind 'quota'", async () => {
    const { fake, store } = await open();
    const clock = fakeClock();
    const ops = { now: clock.now, makeId: uuidSequence(1) };
    const first = await saveEntryLocally(store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, ops);
    // Only the ENTRY put fails, after the photo put already happened in the same transaction.
    fake.db.quotaStores.add("entries");

    const error = await addPhotoLocally(store, { event: EVENT, teamNumber: 254, blob: jpeg() }, ops).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SaveError);
    expect((error as SaveError).kind).toBe("quota");
    expect(fake.db.aborted).toBeGreaterThan(0);
    fake.db.quotaStores.clear();
    expect(await store.listPhotos()).toEqual([]); // the photo put was rolled back
    expect(await store.getEntry(first.key)).toEqual(first);
  });

  it("reopens once if the connection was closed under us (InvalidStateError)", async () => {
    const { fake, store } = await open();
    fake.db.failTransaction = new DOMException("closing", "InvalidStateError");
    await store.setMeta("pausedForAuth", true);
    expect(await store.getMeta("pausedForAuth")).toBe(true);
    expect(fake.openDB).toHaveBeenCalledTimes(2);
  });

  it("other transaction errors are not swallowed", async () => {
    const { fake, store } = await open();
    fake.db.failTransaction = new RangeError("weird");
    await expect(store.setMeta("pausedForAuth", true)).rejects.toMatchObject({ kind: "unknown" });
  });
});

describe("IndexedDB unavailable", () => {
  it("no indexedDB at all -> StorageUnavailableError (clear message, typed)", async () => {
    const error = await openOfflineStore({ hasIndexedDB: () => false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect((error as StorageUnavailableError).kind).toBe("unavailable");
    expect((error as Error).message).toMatch(/offline storage/i);
  });

  it("openDB rejects (Safari private mode / blocked) -> StorageUnavailableError with the cause", async () => {
    const cause = new DOMException("denied", "SecurityError");
    const error = await openOfflineStore({
      hasIndexedDB: () => true,
      openDB: () => Promise.reject(cause),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect((error as Error).cause).toBe(cause);
  });

  it("opens fine but every write fails with a quota error (old Safari private mode) -> unavailable, not 'device full'", async () => {
    const fake = fakeIdb();
    fake.db.failPut = new DOMException("quota 0", "QuotaExceededError");
    const error = await openOfflineStore({ openDB: fake.openDB, hasIndexedDB: () => true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageUnavailableError);
  });

  it("openOfflineStoreWithFallback gives an in-memory store flagged non-persistent, with the reason", async () => {
    const result = await openOfflineStoreWithFallback({ hasIndexedDB: () => false });
    expect(result.persistent).toBe(false);
    expect(result.reason).toBeInstanceOf(StorageUnavailableError);
    const ops = { now: fakeClock().now, makeId: uuidSequence(1) };
    await saveEntryLocally(result.store, { event: EVENT, teamNumber: 1, payload: EMPTY_PAYLOAD }, ops);
    expect(await result.store.listEntries()).toHaveLength(1);
  });

  it("openOfflineStoreWithFallback is persistent when IndexedDB works", async () => {
    const fake = fakeIdb();
    const result = await openOfflineStoreWithFallback({ openDB: fake.openDB, hasIndexedDB: () => true });
    expect(result.persistent).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("a failed open is not cached: the next operation tries again", async () => {
    const fake = fakeIdb();
    let fail = true;
    const backend = new IdbBackend({
      hasIndexedDB: () => true,
      openDB: (...args) => (fail ? Promise.reject(new Error("nope")) : fake.openDB(...args)),
    });
    await expect(backend.open()).rejects.toBeInstanceOf(StorageUnavailableError);
    fail = false;
    await expect(backend.open()).resolves.toBeUndefined();
  });
});

describe("connection lifecycle callbacks", () => {
  it("`blocked` is surfaced so the UI can ask to close other tabs", async () => {
    const fake = fakeIdb();
    const onBlocked = vi.fn();
    const backend = new IdbBackend({ openDB: fake.openDB, hasIndexedDB: () => true, onBlocked });
    await backend.open();
    fake.opens[0].callbacks.blocked?.(1, 2, null as never);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it("`blocking` (another tab upgrading) closes our connection; the next operation reopens", async () => {
    const fake = fakeIdb();
    const backend = new IdbBackend({ openDB: fake.openDB, hasIndexedDB: () => true });
    const store = new BackendStore(backend);
    await store.setMeta("pausedForAuth", true);
    fake.opens[0].callbacks.blocking?.(1, 2, null as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.db.closed).toBe(true);
    expect(await store.getMeta("pausedForAuth")).toBe(true); // reopened, data intact
    expect(fake.openDB).toHaveBeenCalledTimes(2);
    expect(fake.db.closed).toBe(false);
  });

  it("`terminated` notifies and the next operation reopens", async () => {
    const fake = fakeIdb();
    const onTerminated = vi.fn();
    const backend = new IdbBackend({ openDB: fake.openDB, hasIndexedDB: () => true, onTerminated });
    const store = new BackendStore(backend);
    await store.setMeta("pausedForAuth", true);
    fake.opens[0].callbacks.terminated?.();
    expect(onTerminated).toHaveBeenCalledTimes(1);
    await store.setMeta("pausedForAuth", false);
    expect(fake.openDB).toHaveBeenCalledTimes(2);
  });

  it("close() closes the connection", async () => {
    const fake = fakeIdb();
    const backend = new IdbBackend({ openDB: fake.openDB, hasIndexedDB: () => true });
    await backend.open();
    backend.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.db.closed).toBe(true);
  });
});
