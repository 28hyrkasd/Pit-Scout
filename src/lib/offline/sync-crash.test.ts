import { describe, expect, it } from "vitest";
import { addPhotoLocally, removePhotoLocally, saveEntryLocally } from "./local";
import { runSyncPass } from "./sync";
import {
  CrashController,
  EMPTY_PAYLOAD,
  EVENT,
  crashingStore,
  jpeg,
  makeEnv,
  noJitter,
  queueEntry,
  type Env,
} from "./test-utils";

/*
 * "Interrupted upload" proof. Every side effect (each server call and each
 * local commit) is a possible place for the process to die. For every such point
 * we kill the pass right after it, "reboot", run fresh passes, and require the
 * server AND the device to end up exactly as in a run that was never interrupted.
 */

const FINAL_PASSES = 4;

async function converge(env: Env) {
  for (let i = 0; i < FINAL_PASSES; i++) {
    env.clock.advance(10 * 60_000); // past any lease and any backoff
    await runSyncPass(env.store, env.server.deps(), {
      now: env.clock.now,
      random: noJitter,
      mode: "manual",
    });
  }
}

async function finalState(env: Env) {
  return {
    server: env.server.snapshot(),
    entries: (await env.store.listEntries()).map((e) => ({
      key: e.key,
      status: e.status,
      serverId: e.serverId,
      entryDirty: e.entryDirty,
      superseded: e.superseded,
      attempts: e.attempts,
    })),
    photos: await env.store.listPhotos(),
  };
}

function crashMatrix(
  name: string,
  setup: () => Promise<Env>,
  minSteps: number,
) {
  it(`${name}: crash after EVERY step converges to the uninterrupted result`, async () => {
    // Baseline, also counting how many steps a clean pass has.
    const baseEnv = await setup();
    const counter = new CrashController(null);
    baseEnv.server.crash = counter;
    await runSyncPass(crashingStore(baseEnv.store, counter), baseEnv.server.deps(), {
      now: baseEnv.clock.now,
      random: noJitter,
    });
    const totalSteps = counter.steps;
    expect(totalSteps).toBeGreaterThanOrEqual(minSteps);
    baseEnv.server.crash = null;
    await converge(baseEnv);
    const expected = await finalState(baseEnv);
    expect(expected.entries.every((e) => e.status === "synced")).toBe(true);
    expect(expected.photos).toEqual([]);

    for (let k = 1; k <= totalSteps + 1; k++) {
      const env = await setup();
      const crash = new CrashController(k);
      env.server.crash = crash;
      const result = await runSyncPass(crashingStore(env.store, crash), env.server.deps(), {
        now: env.clock.now,
        random: noJitter,
      });
      if (k <= totalSteps) {
        expect(result.outcome, `crash point ${k}`).toBe("storage-error");
        expect(crash.crashed).toBe(true);
      }

      crash.reboot();
      env.server.crash = null;
      await converge(env);
      expect(await finalState(env), `crash point ${k}/${totalSteps}`).toEqual(expected);
    }
  });
}

describe("interrupted syncs are resumable", () => {
  crashMatrix(
    "entry + 3 photos",
    async () => {
      const env = makeEnv();
      await queueEntry(env, 254, { photos: 3, answers: { a: 1 } });
      return env;
    },
    12,
  );

  crashMatrix(
    "two entries (oldest first)",
    async () => {
      const env = makeEnv();
      await queueEntry(env, 1, { photos: 1 });
      env.clock.advance(1_000);
      await queueEntry(env, 2, { photos: 1 });
      return env;
    },
    12,
  );

  crashMatrix(
    "queued removal of a synced photo",
    async () => {
      const env = makeEnv();
      await queueEntry(env, 254, { photos: 1 });
      const [photo] = await env.store.listPhotos();
      await runSyncPass(env.store, env.server.deps(), { now: env.clock.now, random: noJitter });
      env.clock.advance(1_000);
      const entry = (await env.store.getEntry("2026casj:254"))!;
      await removePhotoLocally(
        env.store,
        {
          event: EVENT,
          teamNumber: 254,
          photoId: photo.id,
          serverPhoto: { id: photo.id, entryId: entry.id, storagePath: photo.storagePath },
        },
        env.ops,
      );
      return env;
    },
    3,
  );

  crashMatrix(
    "second scout with a different UUID for the same team (re-pointing photos)",
    async () => {
      const a = makeEnv({ idPrefix: 1 });
      const b = makeEnv({ idPrefix: 2 });
      b.server = a.server;
      await queueEntry(a, 254, { photos: 1, answers: { who: "A" } });
      b.clock.advance(10_000);
      await queueEntry(b, 254, { photos: 2, answers: { who: "B" } });
      await runSyncPass(a.store, a.server.deps(), { now: a.clock.now, random: noJitter });
      return b; // the pass under test is B's, which must re-point its photos
    },
    10,
  );

  crashMatrix(
    "edit + new photo on an already-synced entry",
    async () => {
      const env = makeEnv();
      await queueEntry(env, 254, { photos: 1 });
      await runSyncPass(env.store, env.server.deps(), { now: env.clock.now, random: noJitter });
      env.clock.advance(5_000);
      await saveEntryLocally(
        env.store,
        { event: EVENT, teamNumber: 254, payload: { ...EMPTY_PAYLOAD, notes: "edited" } },
        env.ops,
      );
      await addPhotoLocally(env.store, { event: EVENT, teamNumber: 254, blob: jpeg("2") }, env.ops);
      return env;
    },
    6,
  );
});
