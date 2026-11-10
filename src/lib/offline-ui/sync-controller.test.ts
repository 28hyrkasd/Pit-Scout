import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectivityStatus } from "@/lib/offline/connectivity";
import { getLocalEntry } from "@/lib/offline/local";
import { isPausedForAuth } from "@/lib/offline/sync";
import { SaveError } from "@/lib/entries/save-error";
import { authError, makeEnv, networkError, queueEntry, type Env } from "@/lib/offline/test-utils";
import {
  INITIAL_SNAPSHOT,
  SKIPPED,
  SyncController,
  changedServerState,
  createLockRunner,
  withStepTimeouts,
  type Attachment,
} from "./sync-controller";

/** A connectivity source the test can flip. */
function fakeConnectivity(initial: ConnectivityStatus = "online") {
  let status = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => status,
    set(next: ConnectivityStatus) {
      status = next;
      for (const l of [...listeners]) l();
    },
  };
}

function setup(options: { connectivity?: ConnectivityStatus; extra?: Partial<Attachment> } = {}) {
  const env: Env = makeEnv();
  const connectivity = fakeConnectivity(options.connectivity);
  const controller = new SyncController();
  const settled: string[] = [];
  const attachment: Attachment = {
    store: env.store,
    persistent: true,
    syncDeps: env.server.deps(),
    connectivity,
    now: env.clock.now,
    random: () => 0,
    onPassSettled: (r) => settled.push(r.outcome),
    ...options.extra,
  };
  return { env, connectivity, controller, attachment, settled };
}

/** Let promise chains started by event handlers finish. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

describe("SyncController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts not-ready, becomes ready on attach with counts from the store, and not-ready again on detach", async () => {
    const { env, controller, attachment } = setup();
    expect(controller.getSnapshot()).toBe(INITIAL_SNAPSHOT);
    expect(controller.getServerSnapshot()).toBe(INITIAL_SNAPSHOT);
    await queueEntry(env, 254);
    const detach = controller.attach({ ...attachment, connectivity: fakeConnectivity("offline") });
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ ready: true, persistent: true });
    expect(controller.getSnapshot().counts?.unsynced).toBe(1);
    detach();
    expect(controller.getSnapshot().ready).toBe(false);
  });

  it("sends entries left from the last session when it attaches while online", async () => {
    const { env, controller, attachment, settled } = setup();
    await queueEntry(env, 254);
    controller.attach(attachment);
    await flush();
    expect(env.server.entryFor("2026casj", 254)).toBeDefined();
    expect(settled).toEqual(["completed"]);
    expect((await getLocalEntry(env.store, "2026casj", 254))?.status).toBe("synced");
    expect(controller.getSnapshot().counts?.unsynced).toBe(0);
    expect(controller.getSnapshot().lastSyncAt).not.toBeNull();
  });

  it("afterLocalChange refreshes the counts, then syncs (a save)", async () => {
    const { env, controller, attachment } = setup();
    controller.attach(attachment);
    await flush();
    await queueEntry(env, 971);
    const result = await controller.afterLocalChange();
    expect(result?.synced).toEqual(["2026casj:971"]);
    expect(env.server.entryFor("2026casj", 971)).toBeDefined();
  });

  it("does not start requests while the probe says offline, but syncs as soon as it flips online", async () => {
    const { env, controller, attachment, connectivity } = setup({ connectivity: "offline" });
    controller.attach(attachment);
    await flush();
    await queueEntry(env, 254);
    expect(await controller.afterLocalChange()).toBeNull();
    expect(env.server.log).toEqual([]);
    expect(controller.getSnapshot().counts?.unsynced).toBe(1);

    connectivity.set("online");
    await flush();
    expect(env.server.entryFor("2026casj", 254)).toBeDefined();
    expect(controller.getSnapshot().counts?.unsynced).toBe(0);
  });

  it("does not trigger on unknown -> offline or online -> online", async () => {
    const { env, controller, attachment, connectivity, settled } = setup({ connectivity: "unknown" });
    controller.attach(attachment);
    await flush();
    await queueEntry(env, 254);
    await controller.refresh();
    connectivity.set("offline");
    await flush();
    expect(settled).toEqual([]);
  });

  it("runs on the interval only while something is unsynced", async () => {
    const { env, controller, attachment, settled } = setup({ extra: { intervalMs: 30_000 } });
    controller.attach(attachment);
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toEqual([]); // nothing queued: no pass
    await queueEntry(env, 254);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toEqual(["completed"]);
  });

  it("window 'online' and focus both trigger a pass", async () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    const { env, controller, attachment } = setup({ extra: { windowTarget: win, documentTarget: doc } });
    controller.attach(attachment);
    await flush();

    await queueEntry(env, 1);
    win.dispatchEvent(new Event("online"));
    await flush();
    expect(env.server.entryFor("2026casj", 1)).toBeDefined();

    await queueEntry(env, 2);
    win.dispatchEvent(new Event("focus"));
    await flush();
    expect(env.server.entryFor("2026casj", 2)).toBeDefined();

    await queueEntry(env, 3);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(env.server.entryFor("2026casj", 3)).toBeDefined();
  });

  it("visibilitychange to hidden does nothing", async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    const { env, controller, attachment } = setup({ extra: { documentTarget: doc } });
    controller.attach(attachment);
    await flush();
    await queueEntry(env, 4);
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(env.server.entryFor("2026casj", 4)).toBeUndefined();
  });

  it("detach removes every listener and the timer", async () => {
    const win = new EventTarget();
    const { env, controller, attachment } = setup({ extra: { windowTarget: win } });
    const detach = controller.attach(attachment);
    await flush();
    detach();
    await queueEntry(env, 5);
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(env.server.entryFor("2026casj", 5)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("sign-in pause", () => {
    it("401 pauses, keeps the data pending, and surfaces pausedForAuth", async () => {
      const { env, controller, attachment } = setup();
      await queueEntry(env, 254);
      env.server.failNext("ensureEvent", authError());
      controller.attach(attachment);
      await flush();
      expect(controller.getSnapshot()).toMatchObject({ pausedForAuth: true, lastOutcome: "paused-auth" });
      expect((await getLocalEntry(env.store, "2026casj", 254))?.status).toBe("pending");
      expect(env.server.entryFor("2026casj", 254)).toBeUndefined();
    });

    it("resumeAndSync lifts the pause and sends everything; a still-expired session pauses again", async () => {
      const { env, controller, attachment } = setup();
      await queueEntry(env, 254);
      env.server.failNext("ensureEvent", authError(), { times: 2 });
      controller.attach(attachment);
      await flush();

      const again = await controller.resumeAndSync();
      expect(again?.outcome).toBe("paused-auth");
      expect(controller.getSnapshot().pausedForAuth).toBe(true);

      const ok = await controller.resumeAndSync();
      expect(ok?.outcome).toBe("completed");
      expect(controller.getSnapshot().pausedForAuth).toBe(false);
      expect(env.server.entryFor("2026casj", 254)).toBeDefined();
    });

    it("on focus while paused it checks the session and resumes only when valid", async () => {
      const win = new EventTarget();
      let valid = false;
      const checkAuth = vi.fn(async () => valid);
      const { env, controller, attachment } = setup({ extra: { windowTarget: win, checkAuth } });
      await queueEntry(env, 254);
      env.server.failNext("ensureEvent", authError());
      controller.attach(attachment);
      await flush();
      expect(controller.getSnapshot().pausedForAuth).toBe(true);
      checkAuth.mockClear();

      win.dispatchEvent(new Event("focus")); // signed out still
      await flush();
      expect(checkAuth).toHaveBeenCalled();
      expect(controller.getSnapshot().pausedForAuth).toBe(true);

      valid = true; // signed in in another tab
      win.dispatchEvent(new Event("focus"));
      await flush();
      expect(controller.getSnapshot().pausedForAuth).toBe(false);
      expect(await isPausedForAuth(env.store)).toBe(false);
      expect(env.server.entryFor("2026casj", 254)).toBeDefined();
    });

    it("a throwing checkAuth counts as 'not signed in' and nothing blows up", async () => {
      const win = new EventTarget();
      const checkAuth = vi.fn(async () => {
        throw new Error("network down");
      });
      const { env, controller, attachment } = setup({ extra: { windowTarget: win, checkAuth } });
      await queueEntry(env, 254);
      env.server.failNext("ensureEvent", authError());
      controller.attach(attachment);
      await flush();
      win.dispatchEvent(new Event("focus"));
      await flush();
      expect(controller.getSnapshot().pausedForAuth).toBe(true);
    });
  });

  describe("manual sync", () => {
    it("retries a failed entry the core stopped retrying by itself", async () => {
      const { env, controller, attachment } = setup();
      await queueEntry(env, 254);
      env.server.failNext("upsertEntry", { code: "42501", message: "denied" });
      controller.attach(attachment);
      await flush();
      expect((await getLocalEntry(env.store, "2026casj", 254))?.status).toBe("failed");
      expect(controller.getSnapshot().counts?.needsManualRetry).toBe(1);

      // The interval does not retry it (non-retryable)...
      await vi.advanceTimersByTimeAsync(60_000);
      expect(env.server.entryFor("2026casj", 254)).toBeUndefined();

      // ...but "Sync now" does.
      const result = await controller.syncNow();
      expect(result?.synced).toEqual(["2026casj:254"]);
    });

    it("joins a running pass, then runs its own manual pass after it", async () => {
      const { env, controller, attachment } = setup();
      controller.attach(attachment);
      await flush();
      await queueEntry(env, 254);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      env.server.onCall = async (op) => {
        if (op === "ensureEvent") await gate;
      };
      const auto = controller.trigger("interval");
      await flush();
      expect(controller.getSnapshot().syncing).toBe(true);
      const manual = controller.syncNow();
      release();
      await auto;
      const result = await manual;
      expect(result).not.toBeNull();
      expect(controller.getSnapshot().syncing).toBe(false);
    });

    it("reports a network failure as an outcome, not an exception", async () => {
      const { env, controller, attachment } = setup({ connectivity: "unknown" });
      controller.attach(attachment);
      await flush();
      await queueEntry(env, 254);
      env.server.failNext("ensureEvent", networkError());
      const result = await controller.syncNow();
      expect(result?.outcome).toBe("network-error");
      expect(controller.getSnapshot().lastOutcome).toBe("network-error");
      expect(controller.getSnapshot().syncing).toBe(false);
    });
  });

  it("calls onPassSettled for every pass that ran", async () => {
    const { env, controller, attachment, settled } = setup();
    controller.attach(attachment);
    await flush();
    await queueEntry(env, 254);
    await controller.afterLocalChange();
    expect(settled).toEqual(["completed"]);
  });

  it("a save while a pass is running gets its own pass afterwards (the running one may have already looked at the queue)", async () => {
    const { env, controller, attachment } = setup();
    controller.attach(attachment);
    await flush();
    await queueEntry(env, 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    env.server.onCall = async (op) => {
      if (op === "ensureEvent" && first) {
        first = false;
        await gate;
      }
    };
    const running = controller.trigger("interval");
    await flush();
    await queueEntry(env, 2);
    // Simulate the pass having already scanned: team 2 is saved after.
    const afterSave = controller.afterLocalChange();
    release();
    await running;
    await afterSave;
    expect(env.server.entryFor("2026casj", 1)).toBeDefined();
    expect(env.server.entryFor("2026casj", 2)).toBeDefined();
  });

  it("survives a pass that rejects unexpectedly (programmer error) and stops showing 'syncing'", async () => {
    const { env, controller, attachment } = setup();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const buggyStore = new Proxy(env.store, {
      get(target, prop, receiver) {
        if (prop === "transact")
          return async () => {
            throw new Error("a bug, not a storage or network error");
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    controller.attach({ ...attachment, store: buggyStore });
    await flush();
    await queueEntry(env, 254);
    await expect(controller.syncNow()).resolves.toBeNull();
    expect(controller.getSnapshot().syncing).toBe(false);
    quiet.mockRestore();
  });

  it("notifies subscribers when the snapshot changes", async () => {
    const { env, controller, attachment } = setup();
    const seen: number[] = [];
    controller.subscribe(() => seen.push(controller.getSnapshot().version));
    controller.attach(attachment);
    await flush();
    await queueEntry(env, 254);
    await controller.refresh();
    expect(seen.length).toBeGreaterThan(1);
    expect(controller.getSnapshot().version).toBeGreaterThan(0);
  });

  describe("runExclusive (cross-tab lock)", () => {
    it("an automatic pass that loses the lock is skipped without touching the server; a manual one waits", async () => {
      const calls: { wait: boolean }[] = [];
      let held = true;
      const runExclusive: Attachment["runExclusive"] = async (task, options) => {
        calls.push(options);
        if (held && !options.wait) return SKIPPED;
        return task();
      };
      const { env, controller, attachment, settled } = setup({ extra: { runExclusive } });
      controller.attach(attachment);
      await flush();
      await queueEntry(env, 254);
      expect(await controller.afterLocalChange()).toBeNull();
      expect(env.server.entryFor("2026casj", 254)).toBeUndefined();
      expect(settled).toEqual([]);
      held = false;
      expect((await controller.syncNow())?.synced).toEqual(["2026casj:254"]);
      expect(calls.at(-1)).toEqual({ wait: true });
    });
  });
});

describe("createLockRunner", () => {
  it("is undefined when Web Locks do not exist", () => {
    expect(createLockRunner(undefined)).toBeUndefined();
  });

  it("uses ifAvailable for automatic passes (and SKIPPED when another tab holds it)", async () => {
    const request = vi.fn(async (_name: string, _o: unknown, cb: (lock: unknown) => Promise<unknown>) => cb(null));
    const run = createLockRunner({ request: request as never })!;
    expect(await run(async () => "ran", { wait: false })).toBe(SKIPPED);
    expect(request).toHaveBeenCalledWith("pit-scout-sync", { ifAvailable: true }, expect.any(Function));
  });

  it("runs the task when it has the lock; manual passes queue (exclusive, no ifAvailable)", async () => {
    const request = vi.fn(async (_name: string, _o: unknown, cb: (lock: unknown) => Promise<unknown>) => cb({}));
    const run = createLockRunner({ request: request as never })!;
    expect(await run(async () => "ran", { wait: true })).toBe("ran");
    expect(request).toHaveBeenCalledWith("pit-scout-sync", { mode: "exclusive" }, expect.any(Function));
  });
});

describe("withStepTimeouts / changedServerState", () => {
  it("wraps every dependency with the right limit (uploads get the longer one)", async () => {
    const seen: number[] = [];
    const wrap = <T,>(p: Promise<T>, ms: number) => {
      seen.push(ms);
      return p;
    };
    const ok = async () => undefined as never;
    const deps = withStepTimeouts(
      { ensureEvent: ok, upsertEntry: ok, uploadPhoto: ok, insertPhotoRow: ok, deletePhotoRow: ok, deletePhotoObject: ok },
      wrap,
      { stepMs: 10, uploadMs: 99 },
    );
    await deps.ensureEvent({} as never);
    await deps.upsertEntry({} as never);
    await deps.uploadPhoto("p", new Blob());
    await deps.insertPhotoRow({} as never);
    await deps.deletePhotoRow("x");
    await deps.deletePhotoObject("p");
    expect(seen).toEqual([10, 10, 99, 10, 10, 10]);
  });

  it("a timed-out step becomes a network failure: the pass ends and the entry stays retryable", async () => {
    const { env, controller, attachment } = setup({ connectivity: "unknown" });
    const wrap = async <T,>(): Promise<T> => {
      throw new SaveError("network", "The connection timed out.");
    };
    controller.attach({ ...attachment, syncDeps: withStepTimeouts(attachment.syncDeps, wrap, { stepMs: 1, uploadMs: 1 }) });
    vi.useFakeTimers();
    await queueEntry(env, 254);
    const result = await controller.syncNow();
    expect(result?.outcome).toBe("network-error");
    const entry = await getLocalEntry(env.store, "2026casj", 254);
    expect(entry?.lastError?.kind).toBe("network");
    expect(entry?.nextAttemptAt).not.toBeNull(); // the core will retry on its own
  });

  it("changedServerState: true when something synced or a completed pass attempted entries", () => {
    const base = { synced: [], failed: [], attempted: [] };
    expect(changedServerState({ ...base, outcome: "completed" })).toBe(false);
    expect(changedServerState({ ...base, outcome: "completed", attempted: ["a"], failed: ["a"] })).toBe(true);
    expect(changedServerState({ ...base, outcome: "network-error", attempted: ["a"] })).toBe(false);
    expect(changedServerState({ ...base, outcome: "paused-auth", attempted: ["a"] })).toBe(false);
    expect(changedServerState({ ...base, outcome: "network-error", synced: ["a"] })).toBe(true);
  });
});
