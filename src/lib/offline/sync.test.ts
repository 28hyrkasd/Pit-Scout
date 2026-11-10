import { describe, expect, it } from "vitest";
import { addPhotoLocally, removePhotoLocally, saveEntryLocally } from "./local";
import {
  isPausedForAuth,
  isSyncRunning,
  resumeAfterAuth,
  runSyncPass,
  type SyncOptions,
  type SyncPassResult,
} from "./sync";
import {
  EMPTY_PAYLOAD,
  EVENT,
  authError,
  invalidError,
  jpeg,
  makeEnv,
  networkError,
  noJitter,
  permissionError,
  queueEntry,
  serverQuotaError,
  unknownError,
  type Env,
} from "./test-utils";
import type { LocalEntry } from "./types";

const pass = (env: Env, options: Partial<SyncOptions> = {}): Promise<SyncPassResult> =>
  runSyncPass(env.store, env.server.deps(), {
    now: env.clock.now,
    random: noJitter,
    ...options,
  });

const entryOf = async (env: Env, team: number) =>
  (await env.store.getEntry(`2026casj:${team}`)) as LocalEntry;

describe("happy path", () => {
  it("events row -> RPC -> upload -> photo row, per photo, then synced and cleaned up", async () => {
    const env = makeEnv();
    const queued = await queueEntry(env, 254, { photos: 2, answers: { q: 1 } });
    const photos = await env.store.listPhotos();

    const result = await pass(env);

    expect(result).toMatchObject({ outcome: "completed", synced: ["2026casj:254"], failed: [] });
    expect(env.server.log).toEqual([
      "event:2026casj",
      `upsert:2026casj:254:${queued.id}`,
      `upload:${photos[0].storagePath}`,
      `row:${photos[0].id}->${queued.id}`,
      `upload:${photos[1].storagePath}`,
      `row:${photos[1].id}->${queued.id}`,
    ]);
    expect(env.server.entryFor("2026casj", 254)?.payload.answers).toEqual({ q: 1 });
    const done = await entryOf(env, 254);
    expect(done).toMatchObject({
      status: "synced",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      claim: null,
      entryDirty: false,
      superseded: false,
      serverId: queued.id,
      syncedAt: env.clock.now(),
    });
    expect(await env.store.listPhotos()).toEqual([]); // uploaded records pruned
    expect(await env.store.getMeta("lastSyncAt")).toBe(env.clock.now());
  });

  it("an empty queue does nothing", async () => {
    const env = makeEnv();
    expect(await pass(env)).toMatchObject({ outcome: "completed", attempted: [] });
    expect(env.server.log).toEqual([]);
  });

  it("processes oldest edit first and strictly ONE entry at a time", async () => {
    const env = makeEnv();
    for (const team of [30, 10, 20]) {
      await queueEntry(env, team);
      env.clock.advance(1_000);
    }
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];
    const deps = env.server.deps();
    const slow = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      try {
        return await fn(...a);
      } finally {
        inFlight -= 1;
      }
    };
    const result = await runSyncPass(
      env.store,
      {
        ...deps,
        ensureEvent: slow(deps.ensureEvent),
        upsertEntry: slow(async (input) => {
          order.push(input.teamNumber);
          return deps.upsertEntry(input);
        }),
      },
      { now: env.clock.now, random: noJitter },
    );
    expect(order).toEqual([30, 10, 20]);
    expect(result.synced).toHaveLength(3);
    expect(maxInFlight).toBe(1);
  });

  it("confirms the events row once per event per pass, not once per entry", async () => {
    const env = makeEnv();
    for (const team of [1, 2, 3]) await queueEntry(env, team);
    await pass(env);
    expect(env.server.count("event:")).toBe(1);
    expect(env.server.count("upsert:")).toBe(3);
  });

  it("skips entries that are not due yet", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: { entry: { ...entry!, nextAttemptAt: env.clock.now() + 5_000 } },
      result: undefined,
    }));
    expect((await pass(env)).attempted).toEqual([]);
    env.clock.advance(5_000);
    expect((await pass(env)).synced).toEqual(["2026casj:254"]);
  });

  it("a photo-only change (entry already on the server) sends no events/RPC, just the photo", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    await pass(env);
    env.server.log.length = 0;
    env.clock.advance(1_000);
    await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    await pass(env);
    expect(env.server.log.map((l) => l.split(":")[0])).toEqual(["upload", "row"]);
    expect((await entryOf(env, 254)).status).toBe("synced");
  });
});

describe("idempotent re-send", () => {
  it("running the same pass twice changes nothing the second time", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 2 });
    await pass(env);
    const after = env.server.snapshot();
    const logLength = env.server.log.length;
    expect(await pass(env)).toMatchObject({ outcome: "completed", attempted: [] });
    expect(env.server.log).toHaveLength(logLength);
    expect(env.server.snapshot()).toEqual(after);
  });

  it("re-sending an entry the server already has (same id, same updatedAt) is a no-op", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    await pass(env);
    const after = env.server.snapshot();

    // Simulate "we never heard back": local state says everything is still owed.
    const photo = await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, env.ops);
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: { entry: { ...entry!, entryDirty: true, status: "pending" } },
      result: undefined,
    }));
    await pass(env);

    expect(env.server.count("upsert:")).toBe(2); // sent again...
    const snap = env.server.snapshot();
    expect(snap.entries).toEqual(after.entries); // ...but nothing changed
    expect(snap.photoRows.map((r) => r.id)).toContain(photo.id);
    expect(snap.photoRows).toHaveLength(2);
    expect((await entryOf(env, 254)).superseded).toBe(false); // equal updatedAt = ours
  });

  it("a duplicate photo row / already-existing object counts as success", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    const [photo] = await env.store.listPhotos();
    // A previous attempt already did both.
    env.server.objects.set(photo.storagePath, jpeg());
    await pass(env);
    expect((await entryOf(env, 254)).status).toBe("synced");
    expect(env.server.photoRows.size).toBe(1);
  });
});

describe("retry and backoff", () => {
  it("network error: failed, backoff 2s -> 4s -> 8s ..., never earlier than scheduled", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", networkError(), { times: 3 });

    await pass(env);
    let e = await entryOf(env, 254);
    expect(e).toMatchObject({ status: "failed", attempts: 1, lastError: { kind: "network" } });
    expect(e.nextAttemptAt).toBe(env.clock.now() + 2_000);

    env.clock.advance(1_999);
    expect((await pass(env)).attempted).toEqual([]); // too early

    env.clock.advance(1);
    await pass(env);
    e = await entryOf(env, 254);
    expect(e).toMatchObject({ attempts: 2 });
    expect(e.nextAttemptAt).toBe(env.clock.now() + 4_000);

    env.clock.advance(4_000);
    await pass(env);
    e = await entryOf(env, 254);
    expect(e.nextAttemptAt).toBe(env.clock.now() + 8_000);
  });

  it("uses the injected random() for jitter, deterministically", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", networkError());
    await pass(env, { random: () => 0.5 }); // 2000 * (1 - 0.5 * 0.5)
    expect((await entryOf(env, 254)).nextAttemptAt).toBe(env.clock.now() + 1_500);
  });

  it("the delay is capped at 5 minutes", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", networkError(), { times: 100 });
    for (let i = 0; i < 12; i++) {
      await pass(env);
      const e = await entryOf(env, 254);
      env.clock.set(e.nextAttemptAt as number);
    }
    const e = await entryOf(env, 254);
    expect(e.attempts).toBe(12);
    expect(e.nextAttemptAt).toBe(env.clock.now()); // due exactly at its schedule
    await pass(env);
    expect((await entryOf(env, 254)).nextAttemptAt).toBe(env.clock.now() + 300_000);
  });

  it("success resets the attempt count and clears the error", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", unknownError(), { times: 2 });
    await pass(env);
    env.clock.advance(60_000);
    await pass(env);
    expect((await entryOf(env, 254)).attempts).toBe(2);
    env.clock.advance(60_000);
    await pass(env);
    expect(await entryOf(env, 254)).toMatchObject({ status: "synced", attempts: 0, lastError: null, nextAttemptAt: null });
  });

  it("after maxAttempts it stops retrying by itself but KEEPS the data; manual Sync now retries and resets the schedule", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    env.server.failNext("upsertEntry", unknownError(), { times: 3 });
    const policy = { maxAttempts: 3 };
    for (let i = 0; i < 3; i++) {
      await pass(env, { policy });
      env.clock.advance(10 * 60_000);
    }
    let e = await entryOf(env, 254);
    expect(e).toMatchObject({ status: "failed", attempts: 3, nextAttemptAt: null });
    expect(await env.store.listPhotos()).toHaveLength(1); // nothing discarded

    // Automatic passes (even much later) do nothing.
    env.clock.advance(24 * 3_600_000);
    expect((await pass(env, { policy })).attempted).toEqual([]);

    // Manual retries now. It fails once more: schedule restarts from attempt 1 (not 4).
    env.server.failNext("upsertEntry", unknownError());
    await pass(env, { policy, mode: "manual" });
    e = await entryOf(env, 254);
    expect(e).toMatchObject({ status: "failed", attempts: 1 });
    expect(e.nextAttemptAt).toBe(env.clock.now() + 2_000);

    // And a manual pass that works finishes the job.
    await pass(env, { policy, mode: "manual" });
    expect((await entryOf(env, 254)).status).toBe("synced");
    expect(env.server.photoRows.size).toBe(1);
  });

  it("manual mode retries a not-yet-due backoff immediately", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", networkError());
    await pass(env);
    expect((await pass(env)).attempted).toEqual([]);
    expect((await pass(env, { mode: "manual" })).synced).toEqual(["2026casj:254"]);
  });

  it("'online' mode retries network failures now, but not other failures", async () => {
    const env2 = makeEnv();
    await queueEntry(env2, 1);
    env2.server.failNext("upsertEntry", networkError());
    await pass(env2);
    expect((await pass(env2)).attempted).toEqual([]);
    expect((await pass(env2, { mode: "online" })).synced).toEqual(["2026casj:1"]);
  });

  it("a non-retryable error (permission) is failed with its message and is NOT retried automatically; manual retries once", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", permissionError(), { times: 2 });
    await pass(env);
    let e = await entryOf(env, 254);
    expect(e).toMatchObject({ status: "failed", nextAttemptAt: null, lastError: { kind: "permission", message: "You don't have permission to save this." } });

    env.clock.advance(24 * 3_600_000);
    expect((await pass(env)).attempted).toEqual([]);
    expect(env.server.count("upsert:")).toBe(0); // the fault threw before the server saw it

    await pass(env, { mode: "manual" });
    e = await entryOf(env, 254);
    expect(e).toMatchObject({ status: "failed", nextAttemptAt: null, attempts: 1 }); // retried once, still refused
    await pass(env, { mode: "manual" }); // second fault consumed above; now the server accepts
    expect((await entryOf(env, 254)).status).toBe("synced");
  });

  it("an invalid-data failure keeps the pass going for OTHER entries", async () => {
    const env = makeEnv();
    await queueEntry(env, 1);
    env.clock.advance(1);
    await queueEntry(env, 2);
    env.server.failNext("upsertEntry", invalidError(), { when: (i) => (i as { teamNumber: number }).teamNumber === 1 });
    const result = await pass(env);
    expect(result).toMatchObject({ outcome: "completed", failed: ["2026casj:1"], synced: ["2026casj:2"] });
  });

  it("an entry that fails permanently does not attempt its photos (FK order)", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 2 });
    env.server.failNext("upsertEntry", invalidError());
    await pass(env);
    expect(env.server.count("upload:")).toBe(0);
    expect(await env.store.listPhotos()).toHaveLength(2);
  });
});

describe("network error aborts the rest of the pass", () => {
  it("does not hammer a dead network with every entry", async () => {
    const env = makeEnv();
    for (const team of [1, 2, 3]) {
      await queueEntry(env, team);
      env.clock.advance(1);
    }
    env.server.failNext("upsertEntry", networkError(), { times: 10 });
    let upsertCalls = 0;
    const deps = env.server.deps();
    const result = await runSyncPass(
      env.store,
      { ...deps, upsertEntry: (i) => (upsertCalls++, deps.upsertEntry(i)) },
      { now: env.clock.now, random: noJitter },
    );
    expect(result.outcome).toBe("network-error");
    expect(upsertCalls).toBe(1);
    expect(result.attempted).toEqual(["2026casj:1"]);
    for (const team of [2, 3]) {
      expect(await entryOf(env, team)).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    }
  });

  it("a network error while uploading a photo also ends the pass (and the entry is failed/retryable)", async () => {
    const env = makeEnv();
    await queueEntry(env, 1, { photos: 3 });
    env.clock.advance(1);
    await queueEntry(env, 2);
    env.server.failNext("uploadPhoto", networkError());
    const result = await pass(env);
    expect(result.outcome).toBe("network-error");
    expect(result.attempted).toEqual(["2026casj:1"]);
    expect(env.server.count("upload:")).toBe(0); // photo 1 failed; 2 and 3 were not attempted
    const e = await entryOf(env, 1);
    expect(e).toMatchObject({ status: "failed", lastError: { kind: "network" } });
    expect(e.nextAttemptAt).toBe(env.clock.now() + 2_000);
    expect((await entryOf(env, 2)).status).toBe("pending");
  });
});

describe("401: pause the whole queue", () => {
  it("leaves data and attempt counts intact, pauses, and resumes after sign-in", async () => {
    const env = makeEnv();
    await queueEntry(env, 1, { photos: 1 });
    env.clock.advance(1);
    await queueEntry(env, 2);
    // team 1 has failed twice before
    await env.store.transact({ eventKey: "2026casj", teamNumber: 1 }, ({ entry }) => ({
      write: { entry: { ...entry!, status: "failed", attempts: 2, nextAttemptAt: env.clock.now(), lastError: { kind: "unknown", message: "earlier" } } },
      result: undefined,
    }));
    const before1 = await entryOf(env, 1);
    const before2 = await entryOf(env, 2);
    const photosBefore = await env.store.listPhotos();

    env.server.failNext("upsertEntry", authError());
    const result = await pass(env);

    expect(result).toMatchObject({ outcome: "paused-auth", attempted: ["2026casj:1"], failed: [], synced: [] });
    expect(await isPausedForAuth(env.store)).toBe(true);
    const after1 = await entryOf(env, 1);
    expect(after1).toMatchObject({
      status: "pending", // given back, NOT failed
      attempts: 2, // not incremented
      lastError: before1.lastError,
      claim: null,
      payload: before1.payload,
      entryDirty: true,
    });
    expect(await entryOf(env, 2)).toEqual(before2); // never touched
    expect(await env.store.listPhotos()).toEqual(photosBefore);

    // Paused: nothing is attempted, even a manual "Sync now", and no request is made.
    const callsBefore = env.server.log.length;
    expect(await pass(env, { mode: "manual" })).toMatchObject({ outcome: "paused-auth", attempted: [] });
    expect(env.server.log).toHaveLength(callsBefore);

    // Sign in again.
    await resumeAfterAuth(env.store);
    expect(await isPausedForAuth(env.store)).toBe(false);
    const resumed = await pass(env);
    expect(resumed).toMatchObject({ outcome: "completed", synced: ["2026casj:1", "2026casj:2"] });
    expect(env.server.photoRows.size).toBe(1);
  });

  it("a 401 while uploading a photo pauses without marking the photo or entry failed", async () => {
    const env = makeEnv();
    await queueEntry(env, 1, { photos: 1 });
    env.server.failNext("uploadPhoto", authError());
    const result = await pass(env);
    expect(result.outcome).toBe("paused-auth");
    const [photo] = await env.store.listPhotos();
    expect(photo).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect(photo.blob).toBeInstanceOf(Blob);
    expect(await entryOf(env, 1)).toMatchObject({ status: "pending", attempts: 0, entryDirty: false });
    await resumeAfterAuth(env.store);
    await pass(env);
    expect((await entryOf(env, 1)).status).toBe("synced");
  });

  it("an expired session on the events row also pauses", async () => {
    const env = makeEnv();
    await queueEntry(env, 1);
    env.server.failNext("ensureEvent", authError());
    expect((await pass(env)).outcome).toBe("paused-auth");
    expect((await entryOf(env, 1)).attempts).toBe(0);
  });
});

describe("partial photo failure", () => {
  it("2 of 3 photos fail: entry NOT synced, nothing lost; the next pass uploads only the missing ones", async () => {
    const env = makeEnv();
    const queued = await queueEntry(env, 254, { photos: 3 });
    const [p1, p2, p3] = await env.store.listPhotos();
    const bad = new Set([p1.storagePath, p3.storagePath]);
    env.server.failNext("uploadPhoto", unknownError(), { times: 2, when: (path) => bad.has(path as string) });

    const first = await pass(env);

    expect(first.failed).toEqual(["2026casj:254"]);
    expect(first.synced).toEqual([]);
    const e = await entryOf(env, 254);
    expect(e).toMatchObject({ status: "failed", attempts: 1, entryDirty: false, lastError: { kind: "unknown" } });
    expect(e.nextAttemptAt).toBe(env.clock.now() + 2_000);
    const byId = Object.fromEntries((await env.store.listPhotos()).map((p) => [p.id, p]));
    expect(byId[p2.id]).toMatchObject({ status: "uploaded", blob: null });
    for (const p of [p1, p3]) {
      expect(byId[p.id]).toMatchObject({ status: "failed", attempts: 1, lastError: { kind: "unknown" } });
      expect(byId[p.id].blob).toBeInstanceOf(Blob); // never dropped
    }
    expect([...env.server.photoRows.keys()]).toEqual([p2.id]);

    env.server.log.length = 0;
    env.clock.advance(2_000);
    const second = await pass(env);

    expect(second.synced).toEqual(["2026casj:254"]);
    expect(env.server.log).toEqual([
      `upload:${p1.storagePath}`,
      `row:${p1.id}->${queued.id}`,
      `upload:${p3.storagePath}`,
      `row:${p3.id}->${queued.id}`,
    ]); // no event, no RPC, p2 not re-uploaded
    expect(env.server.photoRows.size).toBe(3);
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("object uploaded but the row insert failed: the retry only has to insert the row", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    env.server.failNext("insertPhotoRow", unknownError());
    await pass(env);
    expect(env.server.objects.size).toBe(1);
    expect(env.server.photoRows.size).toBe(0);
    env.clock.advance(2_000);
    await pass(env);
    expect(env.server.photoRows.size).toBe(1);
    expect((await entryOf(env, 254)).status).toBe("synced");
  });

  it("a photo the server refuses (permission) does not stop the others and is not retried automatically", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 2 });
    const [p1, p2] = await env.store.listPhotos();
    env.server.failNext("uploadPhoto", permissionError(), { times: 5, when: (path) => path === p1.storagePath });
    await pass(env);
    const e = await entryOf(env, 254);
    expect(e).toMatchObject({ status: "failed", nextAttemptAt: null, lastError: { kind: "permission" } });
    expect(env.server.photoRows.has(p2.id)).toBe(true);

    env.server.log.length = 0;
    env.clock.advance(3_600_000);
    expect((await pass(env)).attempted).toEqual([]);
    expect(env.server.log).toEqual([]);

    env.server.clearFaults();
    await pass(env, { mode: "manual" });
    expect((await entryOf(env, 254)).status).toBe("synced");
    expect(env.server.photoRows.has(p1.id)).toBe(true);
  });

  it("a photo whose blob is missing fails as 'invalid' instead of crashing the pass", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ photos }) => ({
      write: { putPhotos: [{ ...photos[0], blob: null }] },
      result: undefined,
    }));
    const result = await pass(env);
    expect(result.failed).toEqual(["2026casj:254"]);
    expect((await entryOf(env, 254)).lastError?.kind).toBe("invalid");
  });
});

describe("two scouts create the same team offline", () => {
  async function twoScouts(aAt: number, bAt: number) {
    const a = makeEnv({ idPrefix: 1 });
    const b = makeEnv({ idPrefix: 2 });
    b.server = a.server; // one database, two phones
    a.clock.set(aAt);
    b.clock.set(bAt);
    await queueEntry(a, 254, { photos: 1, answers: { who: "A" } });
    await queueEntry(b, 254, { photos: 2, answers: { who: "B" } });
    return { a, b };
  }
  const T0 = Date.parse("2026-11-09T20:00:00.000Z");

  it("first RPC wins the id; the NEWER second scout's content wins; its photos are re-pointed to the surviving id", async () => {
    const { a, b } = await twoScouts(T0, T0 + 10_000);
    const aEntry = await entryOf(a, 254);
    const bEntry = await entryOf(b, 254);
    expect(aEntry.id).not.toBe(bEntry.id);
    const bPhotos = await b.store.listPhotos();
    expect(bPhotos.every((p) => p.entryId === bEntry.id)).toBe(true);

    await pass(a);
    await pass(b);

    const server = a.server.entryFor("2026casj", 254)!;
    expect(server.id).toBe(aEntry.id); // first row keeps its id
    expect(server.payload.answers).toEqual({ who: "B" }); // newer content won
    const bDone = await entryOf(b, 254);
    expect(bDone).toMatchObject({ status: "synced", superseded: false, serverId: aEntry.id });
    expect(bDone.id).toBe(bEntry.id); // local id unchanged
    // Every photo row (FK enforced by the fake) hangs off the surviving id.
    expect([...a.server.photoRows.values()].map((r) => r.entryId)).toEqual([aEntry.id, aEntry.id, aEntry.id]);
    expect(a.server.photoRows.size).toBe(3);
  });

  it("an OLDER second scout is dropped: local becomes synced + superseded, photos still attach to the surviving id", async () => {
    const { a, b } = await twoScouts(T0 + 10_000, T0);
    const aEntry = await entryOf(a, 254);

    await pass(a);
    await pass(b);

    const server = a.server.entryFor("2026casj", 254)!;
    expect(server.id).toBe(aEntry.id);
    expect(server.payload.answers).toEqual({ who: "A" }); // B's older write was dropped
    const bDone = await entryOf(b, 254);
    expect(bDone).toMatchObject({ status: "synced", superseded: true, serverId: aEntry.id, entryDirty: false });
    expect(bDone.payload.answers).toEqual({ who: "B" }); // B's local copy is kept for the UI to show
    expect(new Date(bDone.serverUpdatedAt!).getTime()).toBe(T0 + 10_000);
    expect(a.server.photoRows.size).toBe(3);
    expect([...a.server.photoRows.values()].every((r) => r.entryId === aEntry.id)).toBe(true);
  });

  it("B can sync first: then A is the one that is re-pointed/superseded, same invariants", async () => {
    const { a, b } = await twoScouts(T0, T0 + 10_000);
    const bEntry = await entryOf(b, 254);
    await pass(b);
    await pass(a);
    const server = a.server.entryFor("2026casj", 254)!;
    expect(server.id).toBe(bEntry.id);
    expect(await entryOf(a, 254)).toMatchObject({ status: "synced", superseded: true, serverId: bEntry.id });
    expect([...a.server.photoRows.values()].every((r) => r.entryId === bEntry.id)).toBe(true);
  });

  it("after the surviving id is known, later edits are sent with it and win normally", async () => {
    const { a, b } = await twoScouts(T0, T0 + 10_000);
    await pass(a);
    await pass(b);
    const survivor = (await entryOf(a, 254)).id;
    b.clock.advance(60_000);
    await saveEntryLocally(b.store, { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, notes: "later" } }, b.ops);
    b.server.log.length = 0;
    await pass(b);
    expect(b.server.log.find((l) => l.startsWith("upsert:"))).toContain(`:${survivor}`);
    expect(b.server.entryFor("2026casj", 254)?.payload.notes).toBe("later");
  });
});

describe("device clock sanity", () => {
  it("an updatedAt far in the future is not sent as-is: it is clamped to now (and flagged)", async () => {
    const env = makeEnv();
    const e = await queueEntry(env, 254);
    const threeDays = new Date(env.clock.now() + 3 * 24 * 3_600_000).toISOString();
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry }) => ({
      write: { entry: { ...entry!, updatedAt: threeDays, createdAt: threeDays } },
      result: undefined,
    }));
    await pass(env);
    expect(env.server.entryFor("2026casj", 254)?.updatedAtMs).toBe(env.clock.now());
    const done = await entryOf(env, 254);
    expect(done.clockAdjusted).toBe(true);
    expect(done.updatedAt).toBe(new Date(env.clock.now()).toISOString());
    expect(done.status).toBe("synced");
    expect(done.id).toBe(e.id);
  });
});

describe("quota errors", () => {
  it("server storage quota on a photo: failed with kind 'quota', no automatic retry, other photos still go", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 2 });
    const [p1, p2] = await env.store.listPhotos();
    env.server.failNext("uploadPhoto", serverQuotaError(), { times: 9, when: (path) => path === p1.storagePath });
    await pass(env);
    expect(await entryOf(env, 254)).toMatchObject({ status: "failed", nextAttemptAt: null, lastError: { kind: "quota" } });
    expect(env.server.photoRows.has(p2.id)).toBe(true);
    env.clock.advance(3_600_000);
    expect((await pass(env)).attempted).toEqual([]);
  });

  it("server quota on the entry itself: failed 'quota', not retried automatically", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", serverQuotaError());
    await pass(env);
    expect(await entryOf(env, 254)).toMatchObject({ status: "failed", nextAttemptAt: null, lastError: { kind: "quota" } });
  });

  it("DEVICE quota while recording sync progress: pass reports storage-error 'quota', data is intact, and the next pass converges without duplicating anything", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    // Fail the write that records the RPC result (the first entry write with a serverId).
    env.store.memory.onWrite = (store, _key, value) => {
      if (store === "entries" && (value as LocalEntry).serverId !== null)
        throw new DOMException("full", "QuotaExceededError");
    };
    const result = await pass(env);
    env.store.memory.onWrite = null;

    expect(result.outcome).toBe("storage-error");
    expect(result.error).toMatchObject({ kind: "quota" });
    expect(env.server.count("upsert:")).toBe(1); // server did get it
    expect(await env.store.listPhotos()).toHaveLength(1); // photo (and blob) untouched

    env.clock.advance(3 * 60_000); // past the dead claim's lease
    await pass(env);
    expect((await entryOf(env, 254)).status).toBe("synced");
    expect(env.server.entries.size).toBe(1);
    expect(env.server.photoRows.size).toBe(1);
  });
});

describe("single-flight", () => {
  it("overlapping triggers (focus + online + manual) share ONE pass", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    env.server.onCall = async (op) => {
      if (op === "upsertEntry") await gate;
    };

    const first = pass(env);
    const second = pass(env, { mode: "manual" });
    const third = pass(env, { mode: "online" });
    await Promise.resolve();
    expect(isSyncRunning(env.store)).toBe(true);
    expect(second).toBe(first);
    expect(third).toBe(first);

    release();
    const [r1, r2, r3] = await Promise.all([first, second, third]);
    expect(r1).toBe(r2);
    expect(r3).toBe(r1);
    expect(env.server.count("upsert:")).toBe(1);
    expect(env.server.count("upload:")).toBe(1);
    expect(isSyncRunning(env.store)).toBe(false);
  });

  it("a new pass can start once the previous one settled (also after a failure)", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    env.server.failNext("upsertEntry", networkError());
    await pass(env);
    expect(isSyncRunning(env.store)).toBe(false);
    env.clock.advance(2_000);
    expect((await pass(env)).synced).toEqual(["2026casj:254"]);
  });

  it("different stores do not block each other", async () => {
    const a = makeEnv({ idPrefix: 1 });
    const b = makeEnv({ idPrefix: 2 });
    await queueEntry(a, 1);
    await queueEntry(b, 1);
    const [ra, rb] = await Promise.all([pass(a), pass(b)]);
    expect(ra).not.toBe(rb);
    expect(ra.synced).toHaveLength(1);
    expect(rb.synced).toHaveLength(1);
  });
});

describe("edit while syncing", () => {
  it("an edit made while the RPC is in flight is NOT lost: it is sent in the same pass and the entry ends synced only after it", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { answers: { v: 1 } });
    let edited = false;
    env.server.onCall = async (op) => {
      if (op === "upsertEntry" && !edited) {
        edited = true;
        env.clock.advance(5_000);
        await saveEntryLocally(
          env.store,
          { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, answers: { v: 2 } } },
          env.ops,
        );
      }
    };

    const result = await pass(env);

    expect(result.synced).toEqual(["2026casj:254"]);
    expect(env.server.count("upsert:")).toBe(2);
    expect(env.server.entryFor("2026casj", 254)?.payload.answers).toEqual({ v: 2 });
    const done = await entryOf(env, 254);
    expect(done).toMatchObject({ status: "synced", entryDirty: false, superseded: false });
    expect(done.payload.answers).toEqual({ v: 2 });
  });

  it("if the pass stops right after the older version landed, the newer edit is still owed (pending, dirty, intact)", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { answers: { v: 1 } });
    const controller = new AbortController();
    env.server.onCall = async (op) => {
      if (op === "upsertEntry") {
        env.clock.advance(5_000);
        await saveEntryLocally(
          env.store,
          { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, answers: { v: 2 } } },
          env.ops,
        );
        controller.abort(); // stop after this RPC
      }
    };

    const result = await pass(env, { signal: controller.signal });

    expect(result.outcome).toBe("aborted");
    expect(env.server.entryFor("2026casj", 254)?.payload.answers).toEqual({ v: 1 });
    const e = await entryOf(env, 254);
    expect(e.status).toBe("pending"); // NOT synced
    expect(e.entryDirty).toBe(true); // the v2 upsert is still owed
    expect(e.payload.answers).toEqual({ v: 2 });
    expect(e.claim).toBeNull();

    env.server.onCall = null;
    await pass(env);
    expect(env.server.entryFor("2026casj", 254)?.payload.answers).toEqual({ v: 2 });
    expect((await entryOf(env, 254)).status).toBe("synced");
  });

  it("a photo added while the entry is syncing is picked up (not stranded under a 'synced' entry)", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    let added = false;
    env.server.onCall = async (op) => {
      if (op === "upsertEntry" && !added) {
        added = true;
        await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg("late") }, env.ops);
      }
    };
    await pass(env);
    expect(env.server.photoRows.size).toBe(1);
    expect((await entryOf(env, 254)).status).toBe("synced");
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("a photo added mid-sync is re-pointed too when the surviving id differs (no dangling FK)", async () => {
    const a = makeEnv({ idPrefix: 1 });
    const b = makeEnv({ idPrefix: 2 });
    b.server = a.server;
    await queueEntry(a, 254);
    b.clock.advance(10_000);
    await queueEntry(b, 254);
    await pass(a);
    let added = false;
    b.server.onCall = async (op) => {
      if (op === "upsertEntry" && !added) {
        added = true;
        await addPhotoLocally(b.store, { event: EVENT, teamNumber: 254, blob: jpeg() }, b.ops);
      }
    };
    await pass(b);
    const survivor = (await entryOf(a, 254)).id;
    expect(a.server.photoRows.size).toBe(1);
    expect([...a.server.photoRows.values()][0].entryId).toBe(survivor);
  });
});

describe("photo removal sync", () => {
  async function syncedWithPhoto() {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    const [photo] = await env.store.listPhotos();
    await pass(env);
    // The uploaded record was pruned: the scout removes it from what the server shows.
    env.clock.advance(1_000);
    const serverPhoto = { id: photo.id, entryId: (await entryOf(env, 254)).id, storagePath: photo.storagePath };
    return { env, photo, serverPhoto };
  }

  it("deletes the ROW first, then the object, then drops the local record", async () => {
    const { env, photo, serverPhoto } = await syncedWithPhoto();
    await removePhotoLocally(env.store, { event: EVENT, teamNumber: 254, photoId: photo.id, serverPhoto }, env.ops);
    env.server.log.length = 0;
    await pass(env);
    expect(env.server.log).toEqual([`delrow:${photo.id}`, `delobj:${photo.storagePath}`]);
    expect(env.server.photoRows.size).toBe(0);
    expect(env.server.objects.size).toBe(0);
    expect(await env.store.listPhotos()).toEqual([]);
    expect((await entryOf(env, 254)).status).toBe("synced");
  });

  it("a removal whose row delete fails keeps the record and fails the entry (retryable)", async () => {
    const { env, photo, serverPhoto } = await syncedWithPhoto();
    await removePhotoLocally(env.store, { event: EVENT, teamNumber: 254, photoId: photo.id, serverPhoto }, env.ops);
    env.server.failNext("deletePhotoRow", unknownError());
    await pass(env);
    expect(await env.store.listPhotos()).toHaveLength(1);
    expect((await entryOf(env, 254)).status).toBe("failed");
    expect(env.server.photoRows.size).toBe(1);
    env.clock.advance(2_000);
    await pass(env);
    expect(env.server.photoRows.size).toBe(0);
  });

  it("a failed OBJECT delete (server refuses) is harmless: the row is gone, so the removal completes", async () => {
    const { env, photo, serverPhoto } = await syncedWithPhoto();
    await removePhotoLocally(env.store, { event: EVENT, teamNumber: 254, photoId: photo.id, serverPhoto }, env.ops);
    env.server.failNext("deletePhotoObject", permissionError());
    await pass(env);
    expect(env.server.photoRows.size).toBe(0);
    expect(await env.store.listPhotos()).toEqual([]);
    expect((await entryOf(env, 254)).status).toBe("synced");
  });

  it("an object delete that fails for NETWORK reasons keeps the removal queued so the object is cleaned up later", async () => {
    const { env, photo, serverPhoto } = await syncedWithPhoto();
    await removePhotoLocally(env.store, { event: EVENT, teamNumber: 254, photoId: photo.id, serverPhoto }, env.ops);
    env.server.failNext("deletePhotoObject", networkError());
    const result = await pass(env);
    expect(result.outcome).toBe("network-error");
    expect(await env.store.listPhotos()).toHaveLength(1);
    env.clock.advance(2_000);
    await pass(env);
    expect(env.server.objects.size).toBe(0);
    expect(await env.store.listPhotos()).toEqual([]);
  });

  it("a photo removed WHILE it is uploading never ends up as a server row", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    const [photo] = await env.store.listPhotos();
    env.server.onCall = async (op) => {
      if (op === "uploadPhoto") {
        env.server.onCall = null;
        await removePhotoLocally(env.store, { event: EVENT, teamNumber: 254, photoId: photo.id }, env.ops);
      }
    };
    await pass(env);
    expect(env.server.count("row:")).toBe(0); // no row was ever created for it
    expect(env.server.photoRows.size).toBe(0);
    expect(env.server.objects.size).toBe(0); // object removed by the queued removal
    expect(await env.store.listPhotos()).toEqual([]);
    expect((await entryOf(env, 254)).status).toBe("synced");
  });
});

describe("abort and recovery", () => {
  it("an already-aborted signal does nothing", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    const c = new AbortController();
    c.abort();
    expect(await pass(env, { signal: c.signal })).toMatchObject({ outcome: "aborted", attempted: [] });
    expect(env.server.log).toEqual([]);
  });

  it("aborting mid-pass hands the entry back as pending with attempts untouched", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 2 });
    const c = new AbortController();
    env.server.onCall = async (op) => {
      if (op === "uploadPhoto") c.abort();
    };
    const result = await pass(env, { signal: c.signal });
    expect(result.outcome).toBe("aborted");
    expect(await entryOf(env, 254)).toMatchObject({ status: "pending", attempts: 0, claim: null });
    for (const p of await env.store.listPhotos()) expect(p.status).not.toBe("uploading");
    env.server.onCall = null;
    await pass(env);
    expect((await entryOf(env, 254)).status).toBe("synced");
    expect(env.server.photoRows.size).toBe(2);
  });

  it("a 'syncing' entry left by a dead process is taken over only after its lease expires", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 1 });
    await env.store.transact({ eventKey: "2026casj", teamNumber: 254 }, ({ entry, photos }) => ({
      write: {
        entry: { ...entry!, status: "syncing", claim: { revision: entry!.revision, claimedAt: env.clock.now() } },
        putPhotos: [{ ...photos[0], status: "uploading" }],
      },
      result: undefined,
    }));
    env.clock.advance(60_000); // < 2 minute lease: maybe another tab is working on it
    expect((await pass(env)).attempted).toEqual([]);
    env.clock.advance(61_000);
    expect((await pass(env)).synced).toEqual(["2026casj:254"]);
    expect(env.server.photoRows.size).toBe(1);
  });

  it("a long pass keeps its lease alive (heartbeat), so slow uploads are not stolen", async () => {
    const env = makeEnv();
    await queueEntry(env, 254, { photos: 3 });
    const claims: number[] = [];
    env.server.onCall = async (op) => {
      if (op === "uploadPhoto") {
        env.clock.advance(100_000); // each upload takes 100s on bad wifi
        claims.push((await entryOf(env, 254)).claim!.claimedAt);
      }
    };
    await pass(env);
    // claimedAt moves forward between uploads even though total time (300s) > lease (120s)
    expect(new Set(claims).size).toBe(3);
  });
});

describe("storage failures", () => {
  it("StorageUnavailableError from the store ends the pass with outcome 'storage-error' (does not throw)", async () => {
    const env = makeEnv();
    await queueEntry(env, 254);
    const broken = new Proxy(env.store, {
      get(target, prop, receiver) {
        if (prop === "listEntries") {
          return async () => {
            const { StorageUnavailableError } = await import("./errors");
            throw new StorageUnavailableError();
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const result = await runSyncPass(broken, env.server.deps(), { now: env.clock.now });
    expect(result.outcome).toBe("storage-error");
    expect(result.error).toMatchObject({ kind: "unavailable" });
  });
});
