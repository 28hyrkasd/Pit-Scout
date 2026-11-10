import type { ConnectivityStatus } from "@/lib/offline/connectivity";
import { getSyncCounts, listLocalEntries, type SyncCounts } from "@/lib/offline/local";
import type { SyncMode } from "@/lib/offline/plan";
import type { OfflineStore } from "@/lib/offline/store";
import {
  isPausedForAuth,
  resumeAfterAuth,
  runSyncPass,
  type SyncDeps,
  type SyncPassOutcome,
  type SyncPassResult,
} from "@/lib/offline/sync";
import type { LocalEntry } from "@/lib/offline/types";

/*
 * Drives sync passes for the UI. Framework-free (no React, no window at import time) so the
 * trigger rules are unit-tested with a memory store and a fake server:
 *
 *   triggers: connectivity flips to online, app focus / visible, window 'online', after each
 *   local save, every 30 s while something is unsynced, and the manual "Sync now".
 *
 * Passes are single-flight twice over: per store inside the core, and per tab here; the optional
 * `runExclusive` (navigator.locks) keeps two tabs from working on the same queue. All of it is
 * safe because every step of a pass is idempotent (see src/lib/offline/README.md).
 */

export type SyncReason = "save" | "focus" | "online" | "interval" | "manual";

/** What `runExclusive` returns when another tab already holds the lock. */
export const SKIPPED = Symbol("sync-skipped");

export type SyncSnapshot = {
  /** The store is open and the controller is attached. */
  ready: boolean;
  /** false: IndexedDB unavailable, everything is in memory. */
  persistent: boolean;
  /** Why the store is not persistent (an error message, never a secret). */
  storeReason: string | null;
  counts: SyncCounts | null;
  /** Every local entry (the sheet lists the ones that are not synced). */
  entries: LocalEntry[];
  /** A pass started by this tab is running. */
  syncing: boolean;
  /** 401 during a pass: nothing syncs until the scout signs in again. */
  pausedForAuth: boolean;
  /** ms epoch of the last entry fully synced. */
  lastSyncAt: number | null;
  /** How the last pass ended (null before the first). */
  lastOutcome: SyncPassOutcome | null;
  /** Bumped on every refresh, so hooks that read the store know to read again. */
  version: number;
};

export const INITIAL_SNAPSHOT: SyncSnapshot = {
  ready: false,
  persistent: true,
  storeReason: null,
  counts: null,
  entries: [],
  syncing: false,
  pausedForAuth: false,
  lastSyncAt: null,
  lastOutcome: null,
  version: 0,
};

export type Attachment = {
  store: OfflineStore;
  persistent: boolean;
  storeReason?: string | null;
  syncDeps: SyncDeps;
  connectivity: {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => ConnectivityStatus;
  };
  /** Cheap authenticated check ("is the session valid again?"). Without it, resuming happens only via resumeAndSync(). */
  checkAuth?: () => Promise<boolean>;
  /** Wrap a pass so only one tab runs it. `wait: true` queues behind the other tab instead of skipping. */
  runExclusive?: <T>(task: () => Promise<T>, options: { wait: boolean }) => Promise<T | typeof SKIPPED>;
  /** Called after every pass that ran (the provider invalidates entry queries when it changed server state). */
  onPassSettled?: (result: SyncPassResult) => void;
  now?: () => number;
  random?: () => number;
  /** Default 30 s. */
  intervalMs?: number;
  windowTarget?: EventTarget;
  documentTarget?: EventTarget & { visibilityState?: string };
};

const DEFAULT_INTERVAL_MS = 30_000;

/** Did a pass probably change what the SERVER holds (so entry queries should refetch)? */
export function changedServerState(result: SyncPassResult): boolean {
  return result.synced.length > 0 || (result.outcome === "completed" && result.attempted.length > 0);
}

function modeFor(reason: SyncReason): SyncMode {
  return reason === "manual" ? "manual" : reason === "online" ? "online" : "auto";
}

export class SyncController {
  private snapshot: SyncSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private attachment: Attachment | null = null;
  private cleanups: (() => void)[] = [];
  private current: Promise<SyncPassResult | null> | null = null;
  private lastConnectivity: ConnectivityStatus = "unknown";

  /** Arrow properties so they can go straight into useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): SyncSnapshot => this.snapshot;
  getServerSnapshot = (): SyncSnapshot => INITIAL_SNAPSHOT;

  private set(partial: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const l of [...this.listeners]) l();
  }

  /** Start working with an open store. Returns the detach function (for effect cleanup). */
  attach(attachment: Attachment): () => void {
    this.detach();
    this.attachment = attachment;
    this.lastConnectivity = attachment.connectivity.getSnapshot();

    const unsubscribe = attachment.connectivity.subscribe(() => {
      const now = attachment.connectivity.getSnapshot();
      const was = this.lastConnectivity;
      this.lastConnectivity = now;
      if (now === "online" && was !== "online") void this.trigger("online");
    });
    const timer = setInterval(() => void this.tick(), attachment.intervalMs ?? DEFAULT_INTERVAL_MS);

    const { windowTarget, documentTarget } = attachment;
    const onFocus = () => void this.onAppFocus();
    const onOnline = () => void this.trigger("online");
    const onVisibility = () => {
      if (documentTarget?.visibilityState === "visible") void this.onAppFocus();
    };
    windowTarget?.addEventListener("focus", onFocus);
    windowTarget?.addEventListener("online", onOnline);
    documentTarget?.addEventListener("visibilitychange", onVisibility);

    this.cleanups = [
      unsubscribe,
      () => clearInterval(timer),
      () => windowTarget?.removeEventListener("focus", onFocus),
      () => windowTarget?.removeEventListener("online", onOnline),
      () => documentTarget?.removeEventListener("visibilitychange", onVisibility),
    ];

    this.set({ ready: true, persistent: attachment.persistent, storeReason: attachment.storeReason ?? null });
    // Whatever was left from the last session: show it, and try to send it.
    void this.onAppFocus();
    return () => this.detach();
  }

  detach() {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.attachment = null;
    this.current = null;
    this.snapshot = INITIAL_SNAPSHOT;
    for (const l of [...this.listeners]) l();
  }

  /** Re-read counts, entries and flags from the store. Never throws (a storage hiccup keeps the old snapshot). */
  async refresh(): Promise<void> {
    const attachment = this.attachment;
    if (!attachment) return;
    const { store } = attachment;
    try {
      const [counts, entries, paused, lastSyncAt] = await Promise.all([
        getSyncCounts(store),
        listLocalEntries(store),
        isPausedForAuth(store),
        store.getMeta("lastSyncAt"),
      ]);
      if (this.attachment !== attachment) return; // detached while reading
      this.set({ counts, entries, pausedForAuth: paused, lastSyncAt: lastSyncAt ?? null, version: this.snapshot.version + 1 });
    } catch {
      // Keep what we had. The very first read failing must still release screens waiting for "loaded".
      if (this.snapshot.version === 0) this.set({ version: 1 });
    }
  }

  /** Call after the UI wrote to the store (a save): refresh the numbers, then send it. */
  async afterLocalChange(): Promise<SyncPassResult | null> {
    await this.refresh();
    return this.trigger("save");
  }

  /** The manual "Sync now" button. If a pass is running, waits for it, then runs another in manual mode (which retries everything). */
  async syncNow(): Promise<SyncPassResult | null> {
    if (!this.attachment) return null;
    if (this.current) await this.current;
    return this.run("manual");
  }

  /** "Try again" after signing in: lifts the pause unconditionally, then syncs. A 401 simply pauses again. */
  async resumeAndSync(): Promise<SyncPassResult | null> {
    const attachment = this.attachment;
    if (!attachment) return null;
    await resumeAfterAuth(attachment.store);
    await this.refresh();
    return this.syncNow();
  }

  /** Every automatic trigger funnels through here. */
  trigger(reason: SyncReason): Promise<SyncPassResult | null> {
    const attachment = this.attachment;
    if (!attachment) return Promise.resolve(null);
    if (reason === "manual") return this.syncNow();
    // Do not start requests on a network the probe says is dead; the online flip will trigger again.
    if (attachment.connectivity.getSnapshot() === "offline") return Promise.resolve(null);
    if (reason === "save") return this.runAfterCurrent("auto");
    return this.run(modeFor(reason));
  }

  /** Window focus / tab visible: refresh the numbers (another tab may have changed them) and sync or check the sign-in. */
  async onAppFocus(): Promise<void> {
    if (!this.attachment) return;
    await this.refresh();
    if (this.snapshot.pausedForAuth) await this.maybeResume();
    else if ((this.snapshot.counts?.unsynced ?? 0) > 0) await this.trigger("focus");
  }

  private async tick(): Promise<void> {
    if (!this.attachment || this.current) return;
    await this.refresh();
    if (this.snapshot.pausedForAuth) await this.maybeResume();
    else if ((this.snapshot.counts?.unsynced ?? 0) > 0) await this.trigger("interval");
  }

  /** While paused: has the scout signed in again (maybe in another tab)? If so, lift the pause and sync. */
  private async maybeResume(): Promise<SyncPassResult | null> {
    const attachment = this.attachment;
    if (!attachment?.checkAuth) return null;
    if (attachment.connectivity.getSnapshot() === "offline") return null;
    let valid = false;
    try {
      valid = await attachment.checkAuth();
    } catch {
      valid = false;
    }
    if (!valid || this.attachment !== attachment) return null;
    await resumeAfterAuth(attachment.store);
    await this.refresh();
    return this.run("online");
  }

  /** Save: a running pass may already have looked at the queue, so run one more after it. */
  private async runAfterCurrent(mode: SyncMode): Promise<SyncPassResult | null> {
    if (this.current) await this.current;
    return this.run(mode);
  }

  private run(mode: SyncMode): Promise<SyncPassResult | null> {
    if (this.current) return this.current;
    const pass: Promise<SyncPassResult | null> = this.execute(mode).finally(() => {
      if (this.current === pass) this.current = null;
    });
    this.current = pass;
    return pass;
  }

  private async execute(mode: SyncMode): Promise<SyncPassResult | null> {
    const attachment = this.attachment;
    if (!attachment) return null;
    this.set({ syncing: true });
    let result: SyncPassResult | null = null;
    try {
      const task = () =>
        runSyncPass(attachment.store, attachment.syncDeps, { mode, now: attachment.now, random: attachment.random });
      const out = attachment.runExclusive
        ? await attachment.runExclusive(task, { wait: mode === "manual" })
        : await task();
      if (out !== SKIPPED) result = out;
    } catch (error) {
      // runSyncPass only rejects for programmer errors; never take the app down for one.
      console.error("Sync pass failed unexpectedly:", error instanceof Error ? error.message : "unknown error");
    }
    if (this.attachment !== attachment) return result;
    if (result) attachment.onPassSettled?.(result);
    await this.refresh();
    this.set({ syncing: false, ...(result ? { lastOutcome: result.outcome } : {}) });
    return result;
  }
}

// ---------------------------------------------------------------------------

type LockManagerLike = {
  request: <T>(
    name: string,
    options: { ifAvailable?: boolean; mode?: "exclusive" | "shared" },
    callback: (lock: unknown) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Cross-tab exclusivity with the Web Locks API; returns undefined when it does not exist (old
 * browsers), in which case passes just run (the core's lease and idempotency keep that safe).
 * An automatic pass skips when another tab holds the lock; a manual one waits its turn.
 */
export function createLockRunner(
  locks: LockManagerLike | undefined,
  name = "pit-scout-sync",
): Attachment["runExclusive"] {
  if (!locks) return undefined;
  return async <T>(task: () => Promise<T>, options: { wait: boolean }) =>
    locks.request<T | typeof SKIPPED>(name, options.wait ? { mode: "exclusive" } : { ifAvailable: true }, async (lock) =>
      lock ? task() : SKIPPED,
    );
}

/**
 * Bound every network step of a pass. A request on dead venue wifi can hang for minutes and a hung step
 * would hold the (single-flight) pass forever. When the timeout wins, the step fails as a NETWORK error
 * (the pass ends; network failures never count toward the retry limit) and a later pass repeats it; every dependency is idempotent
 * (duplicate upload / row / upsert is success), so the abandoned request finishing late is harmless.
 */
export function withStepTimeouts(
  deps: SyncDeps,
  wrap: <T>(promise: Promise<T>, ms: number) => Promise<T>,
  limits: { stepMs: number; uploadMs: number },
): SyncDeps {
  return {
    ensureEvent: (e) => wrap(deps.ensureEvent(e), limits.stepMs),
    upsertEntry: (i) => wrap(deps.upsertEntry(i), limits.stepMs),
    uploadPhoto: (p, b) => wrap(deps.uploadPhoto(p, b), limits.uploadMs),
    insertPhotoRow: (r) => wrap(deps.insertPhotoRow(r), limits.stepMs),
    deletePhotoRow: (id) => wrap(deps.deletePhotoRow(id), limits.stepMs),
    deletePhotoObject: (p) => wrap(deps.deletePhotoObject(p), limits.stepMs),
  };
}
