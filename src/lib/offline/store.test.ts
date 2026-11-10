import { describe, expect, it, vi } from "vitest";
import { SaveError } from "@/lib/entries/save-error";
import { StorageUnavailableError, normalizeStorageError } from "./errors";
import { createMemoryStore } from "./memory-backend";
import { addPhotoLocally, saveEntryLocally } from "./local";
import { EVENT, EMPTY_PAYLOAD, jpeg, makeEnv } from "./test-utils";
import type { LocalEntry } from "./types";

const quota = () => new DOMException("full", "QuotaExceededError");

describe("BackendStore.transact", () => {
  it("is atomic: a failing write rolls back the entry AND photo changes together", async () => {
    const env = makeEnv();
    const entry = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);

    // Fail on the photo write, which happens before the entry write inside the same transaction.
    env.store.memory.onWrite = (store) => {
      if (store === "entries") throw quota();
    };
    await expect(
      addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops),
    ).rejects.toMatchObject({ kind: "quota" });
    env.store.memory.onWrite = null;

    expect(await env.store.listPhotos()).toEqual([]); // the photo put was rolled back
    expect(await env.store.getEntry(entry.key)).toEqual(entry); // entry untouched
  });

  it("gives apply a COPY: mutating the view does not change the store", async () => {
    const env = makeEnv();
    const entry = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry: e }) => {
      (e as LocalEntry).status = "failed";
      return { write: null, result: undefined };
    });
    expect((await env.store.getEntry(entry.key))?.status).toBe("pending");
  });

  it("serializes overlapping transactions (no lost update)", async () => {
    const env = makeEnv();
    const entry = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    const bump = () =>
      env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry: e }) => ({
        write: { entry: { ...(e as LocalEntry), attempts: (e as LocalEntry).attempts + 1 } },
        result: undefined,
      }));
    await Promise.all(Array.from({ length: 20 }, bump));
    expect((await env.store.getEntry(entry.key))?.attempts).toBe(20);
  });

  it("an error thrown by the caller's apply() propagates unchanged and writes nothing", async () => {
    const env = makeEnv();
    const boom = new Error("bug in caller");
    await expect(
      env.store.transact({ eventKey: "2026casj", teamNumber: 1 }, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("entry: null deletes the entry; deletePhotoIds deletes photos", async () => {
    const env = makeEnv();
    const entry = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    const photo = await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, () => ({
      write: { entry: null, deletePhotoIds: [photo.id] },
      result: undefined,
    }));
    expect(await env.store.getEntry(entry.key)).toBeUndefined();
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("listPhotos(team) only returns that team's photos", async () => {
    const env = makeEnv();
    for (const team of [254, 971]) {
      await saveEntryLocally(env.store, { event: EVENT, teamNumber: team, payload: EMPTY_PAYLOAD }, env.ops);
      await addPhotoLocally(env.store, { event: EVENT, teamNumber: team, blob: jpeg() }, env.ops);
    }
    const mine = await env.store.listPhotos({ eventKey: "2026casj", teamNumber: 971 });
    expect(mine).toHaveLength(1);
    expect(mine[0].teamNumber).toBe(971);
  });

  it("preserves photo blobs through the store", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    const photo = await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg("hello") }, env.ops);
    const stored = await env.store.getPhoto(photo.id);
    expect(stored?.blob).toBeInstanceOf(Blob);
    expect(await stored?.blob?.text()).toBe("hello");
  });
});

describe("corrupt records", () => {
  it("skips (and reports) an invalid entry instead of throwing or trusting it", async () => {
    const onCorrupt = vi.fn();
    const store = createMemoryStore({ onCorrupt });
    const env = makeEnv();
    await store.memory.tx(["entries"], "readwrite", (tx) =>
      tx.put("entries", { key: "2026casj:1", id: "x", status: "weird" }),
    );
    await saveEntryLocally(store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    const entries = await store.listEntries();
    expect(entries.map((e) => e.key)).toEqual(["2026casj:254"]);
    expect(onCorrupt).toHaveBeenCalledWith("entries", "2026casj:1");
    expect(await store.getEntry("2026casj:1")).toBeUndefined();
  });

  it("skips an invalid photo record", async () => {
    const store = createMemoryStore();
    await store.memory.tx(["photos"], "readwrite", (tx) =>
      tx.put("photos", { id: "p", eventKey: "2026casj", teamNumber: 254, status: "???" }),
    );
    expect(await store.listPhotos()).toEqual([]);
  });
});

describe("meta", () => {
  it("round-trips typed values and ignores corrupt ones", async () => {
    const store = createMemoryStore();
    expect(await store.getMeta("pausedForAuth")).toBeUndefined();
    await store.setMeta("pausedForAuth", true);
    expect(await store.getMeta("pausedForAuth")).toBe(true);
    await store.memory.tx(["meta"], "readwrite", (tx) => tx.put("meta", "not a number", "lastSyncAt"));
    expect(await store.getMeta("lastSyncAt")).toBeUndefined();
  });
});

describe("clearing", () => {
  it("clearAll wipes entries, photos, cache and meta; clearEntriesAndPhotos keeps cache/meta", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    await env.store.putCacheRecord("k", { value: 1, savedAt: 1 });
    await env.store.setMeta("pausedForAuth", true);

    await env.store.clearEntriesAndPhotos();
    expect(await env.store.listEntries()).toEqual([]);
    expect(await env.store.listPhotos()).toEqual([]);
    expect(await env.store.getCacheRecord("k")).toBeDefined();
    expect(await env.store.getMeta("pausedForAuth")).toBe(true);

    await env.store.clearAll();
    expect(await env.store.getCacheRecord("k")).toBeUndefined();
    expect(await env.store.getMeta("pausedForAuth")).toBeUndefined();
  });
});

describe("normalizeStorageError", () => {
  it("maps every quota spelling to SaveError('quota')", () => {
    for (const e of [
      new DOMException("x", "QuotaExceededError"),
      { name: "NS_ERROR_DOM_QUOTA_REACHED" },
      { code: 22 },
      new Error("The quota has been exceeded."),
    ]) {
      const n = normalizeStorageError(e);
      expect(n).toBeInstanceOf(SaveError);
      expect((n as SaveError).kind).toBe("quota");
    }
  });

  it("maps blocked / closed storage to StorageUnavailableError", () => {
    for (const name of ["SecurityError", "InvalidStateError", "UnknownError", "AbortError"]) {
      expect(normalizeStorageError(new DOMException("x", name))).toBeInstanceOf(StorageUnavailableError);
    }
  });

  it("passes typed errors through and wraps the rest as unknown", () => {
    const typed = new StorageUnavailableError();
    expect(normalizeStorageError(typed)).toBe(typed);
    const other = normalizeStorageError(new RangeError("?"));
    expect((other as SaveError).kind).toBe("unknown");
  });
});

describe("device quota", () => {
  it("a store write that hits quota rejects with kind 'quota' and leaves existing data intact", async () => {
    const env = makeEnv();
    const first = await saveEntryLocally(
      env.store,
      { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, notes: "v1" } },
      env.ops,
    );
    env.store.memory.onWrite = () => {
      throw quota();
    };
    const error = await saveEntryLocally(
      env.store,
      { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, notes: "v2" } },
      env.ops,
    ).catch((e: unknown) => e);
    env.store.memory.onWrite = null;

    expect(error).toBeInstanceOf(SaveError);
    expect((error as SaveError).kind).toBe("quota");
    expect((error as SaveError).retryable).toBe(false);
    expect(await env.store.getEntry(first.key)).toEqual(first);
  });
});
