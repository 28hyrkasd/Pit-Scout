import { describe, expect, it } from "vitest";
import { SaveError } from "@/lib/entries/save-error";
import type { SavedEntry } from "@/lib/entries/rpc";
import { StorageUnavailableError } from "@/lib/offline/errors";
import { getLocalEntry, listLocalPhotos } from "@/lib/offline/local";
import { EMPTY_PAYLOAD, EVENT, jpeg, makeEnv } from "@/lib/offline/test-utils";
import { describeLocalSaveError, describeSaveOutcome, resolvePhotoRemovals, saveScoutingLocally } from "./local-save";

const BASE: SavedEntry = {
  id: "99999999-0000-4000-8000-000000000001",
  eventKey: "2026casj",
  teamNumber: 254,
  answers: { a: 1 },
  rating: 4,
  notes: "server",
  scoutedBy: "Dana",
  createdAt: "2026-11-09T18:00:00.000Z",
  updatedAt: "2026-11-09T19:00:00+00:00",
};

const args = (over: Partial<Parameters<typeof saveScoutingLocally>[1]> = {}) => ({
  event: EVENT,
  teamNumber: 254,
  payload: { ...EMPTY_PAYLOAD, notes: "mine" },
  base: null,
  writeEntry: true,
  staged: [],
  removals: [],
  ...over,
});

describe("saveScoutingLocally", () => {
  it("writes the entry as pending on this device without any network", async () => {
    const env = makeEnv();
    const out = await saveScoutingLocally(env.store, args(), env.ops);
    expect(out.entry).toMatchObject({ status: "pending", entryDirty: true });
    expect((await getLocalEntry(env.store, "2026casj", 254))?.payload.notes).toBe("mine");
    expect(env.server.log).toEqual([]);
  });

  it("stores staged photos under the id the thumbnail already has", async () => {
    const env = makeEnv();
    const out = await saveScoutingLocally(
      env.store,
      args({ staged: [{ id: "11111111-1111-4111-8111-111111111111", blob: jpeg("a") }] }),
      env.ops,
    );
    expect(out.addedPhotoIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    const photos = await listLocalPhotos(env.store, { eventKey: "2026casj", teamNumber: 254 });
    expect(photos.map((p) => [p.id, p.kind, p.status])).toEqual([["11111111-1111-4111-8111-111111111111", "upload", "pending"]]);
  });

  it("photo-only change (writeEntry:false) does not re-save the entry: no RPC owed, clock untouched", async () => {
    const env = makeEnv();
    const out = await saveScoutingLocally(
      env.store,
      args({ writeEntry: false, base: BASE, staged: [{ id: "22222222-2222-4222-8222-222222222222", blob: jpeg() }] }),
      env.ops,
    );
    expect(out.entry).toBeNull();
    const local = await getLocalEntry(env.store, "2026casj", 254);
    expect(local).toMatchObject({ entryDirty: false, updatedAt: BASE.updatedAt, serverId: BASE.id });
  });

  it("removing a staged-on-device photo that never uploaded deletes it; removing a server photo queues a removal", async () => {
    const env = makeEnv();
    await saveScoutingLocally(env.store, args({ staged: [{ id: "33333333-3333-4333-8333-333333333333", blob: jpeg() }] }), env.ops);
    const out = await saveScoutingLocally(
      env.store,
      args({
        writeEntry: false,
        base: BASE,
        removals: [
          { id: "33333333-3333-4333-8333-333333333333" },
          { id: "44444444-4444-4444-8444-444444444444", serverPhoto: { id: "44444444-4444-4444-8444-444444444444", entryId: BASE.id, storagePath: "2026casj/254/44444444-4444-4444-8444-444444444444.jpg" } },
        ],
      }),
      env.ops,
    );
    expect(out.removedPhotoIds).toHaveLength(2);
    const photos = await listLocalPhotos(env.store, { eventKey: "2026casj", teamNumber: 254 });
    expect(photos.map((p) => [p.id, p.kind])).toEqual([["44444444-4444-4444-8444-444444444444", "removal"]]);
  });

  it("an entry write that fails rejects BEFORE any photo is written", async () => {
    const env = makeEnv();
    const failing = new Proxy(env.store, {
      get(target, prop, receiver) {
        if (prop === "transact")
          return async () => {
            throw new SaveError("quota", "This device is out of storage space.");
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(
      saveScoutingLocally(failing, args({ staged: [{ id: "55555555-5555-4555-8555-555555555555", blob: jpeg() }] }), env.ops),
    ).rejects.toMatchObject({ kind: "quota" });
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("a photo that cannot be written is reported, the others still go through", async () => {
    const env = makeEnv();
    const out = await saveScoutingLocally(
      env.store,
      args({
        staged: [
          { id: "not-a-uuid", blob: jpeg("bad") }, // photoStoragePath rejects it
          { id: "66666666-6666-4666-8666-666666666666", blob: jpeg("ok") },
        ],
      }),
      env.ops,
    );
    expect(out.addedPhotoIds).toEqual(["66666666-6666-4666-8666-666666666666"]);
    expect(out.photoFailures).toHaveLength(1);
    expect(out.photoFailures[0]).toMatchObject({ id: "not-a-uuid", kind: "add" });
  });
});

describe("describeLocalSaveError", () => {
  it("explains a full device and unavailable storage without internals", () => {
    expect(describeLocalSaveError(new SaveError("quota", "x"))).toMatch(/out of storage space/);
    expect(describeLocalSaveError(new StorageUnavailableError("idb boom"))).toMatch(/isn't available/);
    expect(describeLocalSaveError(new Error("secret stack detail"))).not.toMatch(/secret/);
  });
});

describe("describeSaveOutcome (the toast after a sync attempt)", () => {
  const e = (over = {}) => ({ status: "pending" as const, superseded: false, lastError: null, nextAttemptAt: 0 as number | null, ...over });

  it("says 'synced' ONLY when the core marked the entry synced", () => {
    expect(describeSaveOutcome(e({ status: "synced" }), false, 254)).toEqual({ kind: "synced", message: "Team 254 synced" });
    for (const status of ["pending", "syncing", "failed"] as const)
      expect(describeSaveOutcome(e({ status }), false, 254).message).not.toMatch(/ synced$/);
    expect(describeSaveOutcome(undefined, false, 254).kind).toBe("waiting");
  });

  it("synced but superseded is the non-alarming 'newer version' notice, not 'synced'", () => {
    const out = describeSaveOutcome(e({ status: "synced", superseded: true }), false, 254);
    expect(out.kind).toBe("superseded");
    expect(out.message).toMatch(/newer version/);
  });

  it("paused for sign-in says so and does not claim sync", () => {
    const out = describeSaveOutcome(e(), true, 254);
    expect(out.kind).toBe("paused");
    expect(out.message).toMatch(/Sign in again/);
  });

  it("a non-network failure is surfaced with its reason; a network failure is just 'will sync when online'", () => {
    const failed = describeSaveOutcome(
      e({ status: "failed", lastError: { kind: "permission", message: "You don't have permission to save this." } }),
      false,
      254,
    );
    expect(failed).toMatchObject({ kind: "failed" });
    expect(failed.message).toMatch(/permission/);
    const net = describeSaveOutcome(e({ status: "failed", lastError: { kind: "network", message: "Can't reach the server." } }), false, 254);
    expect(net.kind).toBe("waiting");
  });
});

describe("resolvePhotoRemovals", () => {
  const serverPhotos = [{ id: "s1", storagePath: "e/s1.jpg" }];
  const base = {
    saved: [
      { id: "s1", source: "server" as const },
      { id: "l1", source: "local" as const },
    ],
    serverPhotos,
    serverEntryId: "entry-1",
  };

  it("a device photo needs only its id; a server photo carries its record", () => {
    expect(resolvePhotoRemovals({ ...base, removedIds: ["l1", "s1"] })).toEqual({
      removals: [{ id: "l1" }, { id: "s1", serverPhoto: { id: "s1", entryId: "entry-1", storagePath: "e/s1.jpg" } }],
      alreadyGone: [],
      unresolved: [],
    });
  });

  it("a server photo without its record or entry id is reported, never dropped silently", () => {
    expect(resolvePhotoRemovals({ ...base, removedIds: ["s1"], serverPhotos: [] }).unresolved).toEqual(["s1"]);
    expect(resolvePhotoRemovals({ ...base, removedIds: ["s1"], serverEntryId: null }).unresolved).toEqual(["s1"]);
  });

  it("a photo that is no longer listed has nothing to remove", () => {
    expect(resolvePhotoRemovals({ ...base, removedIds: ["gone"] })).toEqual({
      removals: [],
      alreadyGone: ["gone"],
      unresolved: [],
    });
  });
});
