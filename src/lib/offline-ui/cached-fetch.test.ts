import * as z from "zod";
import { describe, expect, it, vi } from "vitest";
import { cachePut } from "@/lib/offline/cache";
import { createMemoryStore } from "@/lib/offline/memory-backend";
import { readThrough } from "./cached-fetch";
import { entriesCacheKeys, findTeamEntry, photoRecordListSchema, savedEntryListSchema } from "./entries-cache";

const schema = z.array(z.number());
const offline = (e: unknown) => e instanceof TypeError;

function setup() {
  const store = createMemoryStore();
  return { store, getStore: async () => store };
}

describe("readThrough", () => {
  it("returns fresh data (cachedAt null) and writes it through to the cache", async () => {
    const { store, getStore } = setup();
    const out = await readThrough({ getStore, key: "k", schema, fetch: async () => [1, 2], shouldFallback: offline, now: () => 111 });
    expect(out).toEqual({ value: [1, 2], cachedAt: null });
    expect(await store.getCacheRecord("k")).toEqual({ value: [1, 2], savedAt: 111 });
  });

  it("serves the cached copy, with its save time, when the failure is a reachability one", async () => {
    const { store, getStore } = setup();
    await cachePut(store, "k", [9], () => 555);
    const out = await readThrough({
      getStore,
      key: "k",
      schema,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      shouldFallback: offline,
    });
    expect(out).toEqual({ value: [9], cachedAt: 555 });
  });

  it("preferCache: a known-offline read answers from the cache without touching the network", async () => {
    const { store, getStore } = setup();
    await cachePut(store, "k", [9], () => 555);
    const fetch = vi.fn(async () => [1]);
    const out = await readThrough({ getStore, key: "k", schema, fetch, shouldFallback: offline, preferCache: () => true });
    expect(out).toEqual({ value: [9], cachedAt: 555 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preferCache with nothing cached still tries the network (a wrong 'offline' must not hide data)", async () => {
    const { getStore } = setup();
    const out = await readThrough({
      getStore,
      key: "k",
      schema,
      fetch: async () => [1],
      shouldFallback: offline,
      preferCache: () => true,
      now: () => 1,
    });
    expect(out).toEqual({ value: [1], cachedAt: null });
  });

  it("preferCache false behaves as before: network first", async () => {
    const { store, getStore } = setup();
    await cachePut(store, "k", [9], () => 555);
    const out = await readThrough({ getStore, key: "k", schema, fetch: async () => [1], shouldFallback: offline, preferCache: () => false, now: () => 2 });
    expect(out.cachedAt).toBeNull();
    expect(out.value).toEqual([1]);
  });

  it("rethrows the original error when there is no cache", async () => {
    const { getStore } = setup();
    const error = new TypeError("Failed to fetch");
    await expect(
      readThrough({ getStore, key: "k", schema, fetch: async () => Promise.reject(error), shouldFallback: offline }),
    ).rejects.toBe(error);
  });

  it("does NOT fall back for errors that are not about reachability (e.g. signed out)", async () => {
    const { store, getStore } = setup();
    await cachePut(store, "k", [9]);
    const error = new Error("unauthorized");
    await expect(
      readThrough({ getStore, key: "k", schema, fetch: async () => Promise.reject(error), shouldFallback: offline }),
    ).rejects.toBe(error);
  });

  it("discards a cache entry of the wrong shape and rethrows", async () => {
    const { store, getStore } = setup();
    await cachePut(store, "k", { not: "an array" });
    const error = new TypeError("Failed to fetch");
    await expect(
      readThrough({ getStore, key: "k", schema, fetch: async () => Promise.reject(error), shouldFallback: offline }),
    ).rejects.toBe(error);
    expect(await store.getCacheRecord("k")).toBeUndefined();
  });

  it("a failing cache write never fails a successful fetch", async () => {
    const out = await readThrough({
      getStore: async () => {
        throw new Error("indexeddb exploded");
      },
      key: "k",
      schema,
      fetch: async () => [3],
      shouldFallback: offline,
    });
    expect(out.value).toEqual([3]);
  });

  it("does not ask for the store when the fetch succeeded before it opened (network call never waits on IndexedDB)", async () => {
    const getStore = vi.fn(async () => createMemoryStore());
    let fetchStarted = false;
    const promise = readThrough({
      getStore,
      key: "k",
      schema,
      fetch: async () => {
        fetchStarted = true;
        expect(getStore).not.toHaveBeenCalled();
        return [1];
      },
      shouldFallback: offline,
    });
    await promise;
    expect(fetchStarted).toBe(true);
  });
});

describe("entries cache helpers", () => {
  const entry = (teamNumber: number, updatedAt: string, id = `id${teamNumber}`) => ({
    id,
    eventKey: "2026casj",
    teamNumber,
    answers: { a: 1 },
    rating: null,
    notes: null,
    scoutedBy: null,
    createdAt: updatedAt,
    updatedAt,
  });

  it("keys validate their inputs (no key injection)", () => {
    expect(entriesCacheKeys.eventEntries("2026casj")).toBe("entries:2026casj:v1");
    expect(() => entriesCacheKeys.eventEntries("../x")).toThrow();
    expect(() => entriesCacheKeys.entryPhotos("a b")).toThrow();
    expect(entriesCacheKeys.entryPhotos("abcdef12-0000-4000-8000-000000000001")).toContain("photos:");
  });

  it("schemas accept real data and reject junk", () => {
    expect(savedEntryListSchema.safeParse([entry(254, "2026-11-09T20:00:00Z")]).success).toBe(true);
    expect(savedEntryListSchema.safeParse([{ id: 1 }]).success).toBe(false);
    expect(photoRecordListSchema.safeParse([{ id: "a", storagePath: "p" }]).success).toBe(true);
    expect(photoRecordListSchema.safeParse([{ id: "a" }]).success).toBe(false);
  });

  it("findTeamEntry picks the team's newest row, or null", () => {
    const list = [entry(254, "2026-11-09T10:00:00Z", "old"), entry(254, "2026-11-09T11:00:00Z", "new"), entry(1678, "2026-11-09T09:00:00Z")];
    expect(findTeamEntry(list as never, 254)?.id).toBe("new");
    expect(findTeamEntry(list as never, 999)).toBeNull();
  });
});
