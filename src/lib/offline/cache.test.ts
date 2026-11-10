import { describe, expect, it } from "vitest";
import * as z from "zod";
import { cacheDelete, cacheGet, cacheKeys, cachePut, cacheSchemas } from "./cache";
import { createMemoryStore } from "./memory-backend";
import { weight, canClimb, drivetrain, comments } from "@/lib/entries/fixtures";
import type { OfflineStore } from "./store";

const NOW = 1_800_000_000_000;
const numbers = z.array(z.number());

describe("cache keys", () => {
  it("are stable and versioned", () => {
    expect(cacheKeys.fields()).toBe("fields:v1");
    expect(cacheKeys.teams("2026casj")).toBe("teams:2026casj:v1");
    expect(cacheKeys.epa("2026casj")).toBe("epa:2026casj:v1");
    expect(cacheKeys.eventStatus("2026casj")).toBe("event-status:2026casj:v1");
  });

  it("reject event keys that could collide or inject", () => {
    expect(() => cacheKeys.teams("2026casj:evil")).toThrow();
    expect(() => cacheKeys.teams("")).toThrow();
    expect(() => cacheKeys.epa("../x")).toThrow();
  });
});

describe("cachePut / cacheGet", () => {
  it("round-trips a value with savedAt and stale=false when fresh", async () => {
    const store = createMemoryStore();
    expect(await cachePut(store, "k", [1, 2, 3], () => NOW)).toEqual({ ok: true });
    expect(await cacheGet(store, "k", numbers, { maxAgeMs: 1_000, now: () => NOW + 999 })).toEqual({
      value: [1, 2, 3],
      savedAt: NOW,
      stale: false,
    });
  });

  it("returns stale data flagged stale (still usable offline) once older than maxAgeMs", async () => {
    const store = createMemoryStore();
    await cachePut(store, "k", [1], () => NOW);
    const hit = await cacheGet(store, "k", numbers, { maxAgeMs: 1_000, now: () => NOW + 1_001 });
    expect(hit).toMatchObject({ value: [1], stale: true });
  });

  it("never stale without maxAgeMs", async () => {
    const store = createMemoryStore();
    await cachePut(store, "k", [1], () => NOW);
    expect((await cacheGet(store, "k", numbers, { now: () => NOW + 10 ** 12 }))?.stale).toBe(false);
  });

  it("a savedAt in the future (clock moved back) is treated as stale, not fresh forever", async () => {
    const store = createMemoryStore();
    await cachePut(store, "k", [1], () => NOW + 10 ** 9);
    expect((await cacheGet(store, "k", numbers, { maxAgeMs: 1_000, now: () => NOW }))?.stale).toBe(true);
  });

  it("missing key -> null", async () => {
    expect(await cacheGet(createMemoryStore(), "nope", numbers)).toBeNull();
  });

  it("schema mismatch (old app version) -> null AND the entry is discarded", async () => {
    const store = createMemoryStore();
    await cachePut(store, "k", { old: "shape" });
    expect(await cacheGet(store, "k", numbers)).toBeNull();
    expect(await store.getCacheRecord("k")).toBeUndefined();
  });

  it("a corrupt record (not even {value, savedAt}) -> null, no throw", async () => {
    const store = createMemoryStore();
    await store.memory.tx(["cache"], "readwrite", (tx) => tx.put("cache", "garbage", "k"));
    expect(await cacheGet(store, "k", numbers)).toBeNull();
  });

  it("a read failure is swallowed -> null", async () => {
    const store = createMemoryStore();
    const broken: OfflineStore = new Proxy(store, {
      get: (t, p, r) => (p === "getCacheRecord" ? () => Promise.reject(new Error("idb down")) : Reflect.get(t, p, r)),
    });
    expect(await cacheGet(broken, "k", numbers)).toBeNull();
  });

  it("a write that hits device quota is reported, never thrown, and keeps the older value", async () => {
    const store = createMemoryStore();
    await cachePut(store, "k", [1], () => NOW);
    store.memory.onWrite = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const result = await cachePut(store, "k", [2], () => NOW + 1);
    store.memory.onWrite = null;
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ kind: "quota" });
    expect((await cacheGet(store, "k", numbers))?.value).toEqual([1]);
  });

  it("cacheDelete removes, and swallows failures", async () => {
    const store = createMemoryStore();
    await cachePut(store, "k", [1]);
    await cacheDelete(store, "k");
    expect(await cacheGet(store, "k", numbers)).toBeNull();
  });
});

describe("app schemas", () => {
  it("fields: accepts real FieldDefinitions of every type", async () => {
    const store = createMemoryStore();
    const fields = [weight, canClimb, drivetrain, comments];
    await cachePut(store, cacheKeys.fields(), fields);
    expect((await cacheGet(store, cacheKeys.fields(), cacheSchemas.fields))?.value).toEqual(fields);
  });

  it("fields: a half-written / tampered list is discarded", async () => {
    const store = createMemoryStore();
    await cachePut(store, cacheKeys.fields(), [{ ...weight, higherIsBetter: "yes" }]);
    expect(await cacheGet(store, cacheKeys.fields(), cacheSchemas.fields)).toBeNull();
    await cachePut(store, cacheKeys.fields(), [{ ...drivetrain, options: [] }]);
    expect(await cacheGet(store, cacheKeys.fields(), cacheSchemas.fields)).toBeNull();
    await cachePut(store, cacheKeys.fields(), [{ ...weight, section: "nope" }]);
    expect(await cacheGet(store, cacheKeys.fields(), cacheSchemas.fields)).toBeNull();
  });

  it("teams / epa schemas validate AppTeam / AppEpa", async () => {
    const store = createMemoryStore();
    const team = { teamNumber: 254, name: "Cheesy Poofs", city: null, stateProv: null, country: null, rank: 1, record: { wins: 3, losses: 0, ties: 0 } };
    await cachePut(store, cacheKeys.teams("2026casj"), [team]);
    expect((await cacheGet(store, cacheKeys.teams("2026casj"), cacheSchemas.teams))?.value).toEqual([team]);
    await cachePut(store, cacheKeys.teams("2026casj"), [{ ...team, teamNumber: "254" }]);
    expect(await cacheGet(store, cacheKeys.teams("2026casj"), cacheSchemas.teams)).toBeNull();

    await cachePut(store, cacheKeys.epa("2026casj"), [{ teamNumber: 254, epa: 61.2, epaRank: 1 }]);
    expect((await cacheGet(store, cacheKeys.epa("2026casj"), cacheSchemas.epa))?.value).toHaveLength(1);
  });
});
