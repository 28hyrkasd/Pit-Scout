import { describe, expect, it } from "vitest";
import type { SavedEntry } from "@/lib/entries/rpc";
import {
  OfflineUsageError,
  addPhotoLocally,
  clearSyncedEntries,
  getLocalEntry,
  getSyncCounts,
  listLocalEntries,
  listPending,
  removePhotoLocally,
  resetOfflineData,
  saveEntryLocally,
} from "./local";
import { EVENT, EMPTY_PAYLOAD, jpeg, makeEnv } from "./test-utils";

const SERVER_ENTRY: SavedEntry = {
  id: "99999999-0000-4000-8000-000000000001",
  eventKey: "2026casj",
  teamNumber: 254,
  answers: { a: 1 },
  rating: 4,
  notes: "server notes",
  scoutedBy: "Dana",
  createdAt: "2026-11-09T18:00:00.000Z",
  updatedAt: "2026-11-09T19:00:00+00:00",
};

describe("saveEntryLocally", () => {
  it("creates a pending entry with a client UUID, createdAt = updatedAt", async () => {
    const env = makeEnv();
    const e = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    expect(e).toMatchObject({
      key: "2026casj:254",
      id: "00000001-0000-4000-8000-000000000001",
      status: "pending",
      attempts: 0,
      nextAttemptAt: env.clock.now(),
      lastError: null,
      serverId: null,
      entryDirty: true,
      superseded: false,
      updatedAt: new Date(env.clock.now()).toISOString(),
      createdAt: new Date(env.clock.now()).toISOString(),
      event: EVENT,
    });
  });

  it("editing keeps the SAME local id and createdAt, moves updatedAt forward, bumps revision", async () => {
    const env = makeEnv();
    const first = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    env.clock.advance(5_000);
    const second = await saveEntryLocally(
      env.store,
      { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, notes: "edited" } },
      env.ops,
    );
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(new Date(env.clock.now()).toISOString());
    expect(second.revision).toBe(first.revision + 1);
    expect(second.payload.notes).toBe("edited");
    expect(await env.store.listEntries()).toHaveLength(1);
  });

  it("two saves in the same millisecond still move updatedAt forward (nextUpdatedAt)", async () => {
    const env = makeEnv();
    const a = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    const b = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    expect(new Date(b.updatedAt).getTime()).toBe(new Date(a.updatedAt).getTime() + 1);
  });

  it("starting from the server's version: reuses its id, and the edit lands AFTER it even if this clock is behind", async () => {
    const env = makeEnv();
    const aheadBase = { ...SERVER_ENTRY, updatedAt: new Date(env.clock.now() + 60_000).toISOString() };
    const e = await saveEntryLocally(
      env.store,
      { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD, base: aheadBase },
      env.ops,
    );
    expect(e.id).toBe(SERVER_ENTRY.id);
    expect(e.serverId).toBe(SERVER_ENTRY.id);
    expect(e.createdAt).toBe(SERVER_ENTRY.createdAt);
    expect(new Date(e.updatedAt).getTime()).toBe(env.clock.now() + 60_001);
  });

  it("an edit after a sync is later than the server's updatedAt from that sync", async () => {
    const env = makeEnv();
    const e = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "synced", serverId: "s1", serverUpdatedAt: new Date(env.clock.now() + 10_000).toISOString() } },
      result: undefined,
    }));
    const edited = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    expect(new Date(edited.updatedAt).getTime()).toBe(env.clock.now() + 10_001);
    expect(edited.id).toBe(e.id);
    expect(edited.serverId).toBe("s1");
    expect(edited.status).toBe("pending");
  });

  it("editing a failed entry (even a non-retryable one) makes it pending and due again", async () => {
    const env = makeEnv();
    const e = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: {
        entry: { ...entry!, status: "failed", attempts: 4, nextAttemptAt: null, lastError: { kind: "invalid", message: "bad" }, superseded: true },
      },
      result: undefined,
    }));
    env.clock.advance(1);
    const next = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    expect(next).toMatchObject({ status: "pending", attempts: 0, lastError: null, superseded: false, nextAttemptAt: env.clock.now() });
    expect(next.id).toBe(e.id);
  });

  it("while a sync is in flight: status/claim stay, revision moves and the entry is dirty again", async () => {
    const env = makeEnv();
    const e = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "syncing", entryDirty: false, claim: { revision: entry!.revision, claimedAt: env.clock.now() } } },
      result: undefined,
    }));
    env.clock.advance(1_000);
    const edited = await saveEntryLocally(
      env.store,
      { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, notes: "newer" } },
      env.ops,
    );
    expect(edited.status).toBe("syncing");
    expect(edited.claim?.revision).toBe(e.revision);
    expect(edited.revision).toBe(e.revision + 1);
    expect(edited.entryDirty).toBe(true);
  });
});

describe("addPhotoLocally", () => {
  it("stages a pending photo pointing at the local entry id and schedules the entry", async () => {
    const env = makeEnv();
    const entry = await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    const photo = await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    expect(photo).toMatchObject({
      kind: "upload",
      status: "pending",
      entryId: entry.id,
      storagePath: `2026casj/254/${photo.id}.jpg`,
      attempts: 0,
    });
    expect((await getLocalEntry(env.store, "2026casj", 254))?.revision).toBe(entry.revision + 1);
  });

  it("points at the SERVER id once known", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: { entry: { ...entry!, serverId: "surviving" } },
      result: undefined,
    }));
    const photo = await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    expect(photo.entryId).toBe("surviving");
  });

  it("re-schedules a synced entry (entryDirty stays false: only photos are owed)", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "synced", entryDirty: false, serverId: "s" } },
      result: undefined,
    }));
    await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    expect(await getLocalEntry(env.store, "2026casj", 254)).toMatchObject({ status: "pending", entryDirty: false });
  });

  it("photo on a server-only entry: creates a local entry from `base` with no entry upsert owed", async () => {
    const env = makeEnv();
    const photo = await addPhotoLocally(
      env.store,
      { event: EVENT, teamNumber: 254, blob: jpeg(), base: SERVER_ENTRY },
      env.ops,
    );
    expect(photo.entryId).toBe(SERVER_ENTRY.id);
    expect(await getLocalEntry(env.store, "2026casj", 254)).toMatchObject({
      id: SERVER_ENTRY.id,
      serverId: SERVER_ENTRY.id,
      entryDirty: false,
      status: "pending",
      payload: { notes: "server notes", rating: 4 },
    });
  });

  it("without an entry or a base it is a usage error and writes nothing", async () => {
    const env = makeEnv();
    await expect(
      addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops),
    ).rejects.toBeInstanceOf(OfflineUsageError);
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("rejects an invalid team number before writing anything", async () => {
    const env = makeEnv();
    await expect(
      addPhotoLocally(env.store, { event: EVENT, teamNumber: 0, blob: jpeg(), base: SERVER_ENTRY }, env.ops),
    ).rejects.toThrow(/team number/i);
    expect(await env.store.listEntries()).toEqual([]);
  });
});

describe("removePhotoLocally", () => {
  async function seeded() {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 254, payload: EMPTY_PAYLOAD }, env.ops);
    const photo = await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    return { env, photo };
  }
  const input = (photoId: string) => ({ event: EVENT, teamNumber: 254, photoId });

  it("a staged photo is deleted outright (blob freed), nothing queued", async () => {
    const { env, photo } = await seeded();
    expect(await removePhotoLocally(env.store, input(photo.id), env.ops)).toBe("deleted-local");
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("a failed (never uploaded) photo is also just deleted", async () => {
    const { env, photo } = await seeded();
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ photos }) => ({
      write: { putPhotos: [{ ...photos[0], status: "failed" }] },
      result: undefined,
    }));
    expect(await removePhotoLocally(env.store, input(photo.id), env.ops)).toBe("deleted-local");
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("an uploaded photo becomes a queued removal (blob dropped, entry rescheduled)", async () => {
    const { env, photo } = await seeded();
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry, photos }) => ({
      write: {
        entry: { ...entry!, status: "synced" },
        putPhotos: [{ ...photos[0], status: "uploaded", blob: null }],
      },
      result: undefined,
    }));
    expect(await removePhotoLocally(env.store, input(photo.id), env.ops)).toBe("queued-removal");
    const [rec] = await env.store.listPhotos();
    expect(rec).toMatchObject({ id: photo.id, kind: "removal", status: "pending", blob: null, storagePath: photo.storagePath });
    expect((await getLocalEntry(env.store, "2026casj", 254))?.status).toBe("pending");
  });

  it("a photo that is uploading right now becomes a removal (so it can't reappear)", async () => {
    const { env, photo } = await seeded();
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ photos }) => ({
      write: { putPhotos: [{ ...photos[0], status: "uploading" }] },
      result: undefined,
    }));
    expect(await removePhotoLocally(env.store, input(photo.id), env.ops)).toBe("queued-removal");
    expect((await env.store.getPhoto(photo.id))?.kind).toBe("removal");
  });

  it("a server photo this device never had is queued from `serverPhoto`", async () => {
    const env = makeEnv();
    const result = await removePhotoLocally(
      env.store,
      {
        event: EVENT,
        teamNumber: 254,
        photoId: "aaaaaaaa-0000-4000-8000-000000000001",
        serverPhoto: { id: "aaaaaaaa-0000-4000-8000-000000000001", entryId: SERVER_ENTRY.id, storagePath: "2026casj/254/aaaaaaaa-0000-4000-8000-000000000001.jpg" },
        base: SERVER_ENTRY,
      },
      env.ops,
    );
    expect(result).toBe("queued-removal");
    expect(await env.store.listPhotos()).toMatchObject([{ kind: "removal", entryId: SERVER_ENTRY.id }]);
    expect(await getLocalEntry(env.store, "2026casj", 254)).toMatchObject({ entryDirty: false, status: "pending" });
  });

  it("removing twice is a no-op; an unknown photo without serverPhoto is a usage error", async () => {
    const { env, photo } = await seeded();
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ photos }) => ({
      write: { putPhotos: [{ ...photos[0], status: "uploaded", blob: null }] },
      result: undefined,
    }));
    await removePhotoLocally(env.store, input(photo.id), env.ops);
    expect(await removePhotoLocally(env.store, input(photo.id), env.ops)).toBe("already-queued");
    await expect(removePhotoLocally(env.store, input("unknown-id"), env.ops)).rejects.toBeInstanceOf(OfflineUsageError);
  });
});

describe("reading and counting", () => {
  it("listPending excludes synced, oldest first; counts by status are correct", async () => {
    const env = makeEnv();
    for (const t of [3, 1, 2]) {
      await saveEntryLocally(env.store, { event: EVENT, teamNumber: t, payload: EMPTY_PAYLOAD }, env.ops);
      env.clock.advance(1_000);
    }
    await env.store.transact({ eventKey: "2026casj", teamNumber: 1 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "synced" } },
      result: undefined,
    }));
    await env.store.transact({ eventKey: "2026casj", teamNumber: 2 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "failed", nextAttemptAt: null, superseded: true } },
      result: undefined,
    }));
    await addPhotoLocally(env.store, { event: EVENT, teamNumber: 3, blob: jpeg() }, env.ops);

    expect((await listPending(env.store)).map((e) => e.teamNumber)).toEqual([3, 2]);
    expect((await listLocalEntries(env.store)).map((e) => e.teamNumber)).toEqual([2, 1, 3]);
    expect(await getSyncCounts(env.store)).toMatchObject({
      pending: 1,
      syncing: 0,
      synced: 1,
      failed: 1,
      total: 3,
      unsynced: 2,
      photosPending: 1,
      needsManualRetry: 1,
      superseded: 1,
    });
  });

  it("listLocalEntries filters by event", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 1, payload: EMPTY_PAYLOAD }, env.ops);
    await saveEntryLocally(env.store, { event: { ...EVENT, key: "2026cada" }, teamNumber: 1, payload: EMPTY_PAYLOAD }, env.ops);
    expect(await listLocalEntries(env.store, "2026cada")).toHaveLength(1);
    expect(await listLocalEntries(env.store)).toHaveLength(2);
  });
});

describe("clear / reset", () => {
  it("clearSyncedEntries removes only synced entries (with leftover photo records)", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 1, payload: EMPTY_PAYLOAD }, env.ops);
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 2, payload: EMPTY_PAYLOAD }, env.ops);
    await addPhotoLocally(env.store, { event: EVENT, teamNumber: 1, blob: jpeg() }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 1 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "synced", syncedAt: env.clock.now() } },
      result: undefined,
    }));
    expect(await clearSyncedEntries(env.store)).toBe(1);
    expect((await env.store.listEntries()).map((e) => e.teamNumber)).toEqual([2]);
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("clearSyncedEntries with an age keeps recently synced entries", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 1, payload: EMPTY_PAYLOAD }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 1 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "synced", syncedAt: env.clock.now() - 1_000 } },
      result: undefined,
    }));
    expect(await clearSyncedEntries(env.store, { nowMs: env.clock.now(), ageMs: 60_000 })).toBe(0);
    expect(await clearSyncedEntries(env.store, { nowMs: env.clock.now(), ageMs: 500 })).toBe(1);
  });

  it("resetOfflineData wipes everything", async () => {
    const env = makeEnv();
    await saveEntryLocally(env.store, { event: EVENT, teamNumber: 1, payload: EMPTY_PAYLOAD }, env.ops);
    await resetOfflineData(env.store);
    expect(await env.store.listEntries()).toEqual([]);
  });
});
