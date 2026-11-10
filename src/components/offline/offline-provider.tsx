"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { SaveError } from "@/lib/entries/save-error";
import { entryKeys } from "@/lib/entries/api";
import type { ConnectivityMonitor, ConnectivityStatus } from "@/lib/offline/connectivity";
import { createSupabaseSyncDeps } from "@/lib/offline/supabase-deps";
import type { SyncPassResult } from "@/lib/offline/sync";
import type { OfflineStore } from "@/lib/offline/store";
import { getConnectivityMonitor, getOfflineStore } from "@/lib/offline-ui/runtime";
import {
  INITIAL_SNAPSHOT,
  SyncController,
  changedServerState,
  createLockRunner,
  withStepTimeouts,
  type SyncSnapshot,
} from "@/lib/offline-ui/sync-controller";
import { withTimeout } from "@/lib/offline-ui/timeout";
import { createClient } from "@/lib/supabase/client";

/** A single network step of a sync pass (and an upload) may take this long before it counts as a network failure. */
const STEP_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 90_000;

export type OfflineContextValue = {
  /** Live state of the sync queue (counts, entries, syncing, paused, last sync time, store health). */
  snapshot: SyncSnapshot;
  /** From the active probe, NOT navigator.onLine. */
  connectivity: ConnectivityStatus;
  /** null until IndexedDB (or the in-memory fallback) is open. Components must tolerate null. */
  store: OfflineStore | null;
  /** Re-run the connectivity probe now. */
  probeNow: () => Promise<ConnectivityStatus>;
  /** The "Sync now" button: a manual pass that retries everything not synced. */
  syncNow: () => Promise<SyncPassResult | null>;
  /** After signing in again: lift the pause and sync. */
  resumeAfterSignIn: () => Promise<SyncPassResult | null>;
  /** Call right after writing to the device store (a save): refreshes the counts and triggers a pass. Resolves when that pass ends. */
  notifyLocalChange: () => Promise<SyncPassResult | null>;
};

const NOT_READY = async () => null;
const DEFAULT_VALUE: OfflineContextValue = {
  snapshot: INITIAL_SNAPSHOT,
  connectivity: "unknown",
  store: null,
  probeNow: async () => "unknown",
  syncNow: NOT_READY,
  resumeAfterSignIn: NOT_READY,
  notifyLocalChange: NOT_READY,
};

const OfflineContext = createContext<OfflineContextValue>(DEFAULT_VALUE);

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}

/**
 * Owns the offline machinery for the whole app: opens the device store once, runs the connectivity monitor, and
 * drives sync passes (see SyncController for the triggers). Everything that touches indexedDB / window happens
 * in effects; the server render and hydration see the "nothing known yet" snapshot.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [controller] = useState(() => new SyncController());
  // The tab-wide monitor: query functions read the same one (isKnownOffline) so screens and the indicator agree.
  const [monitor] = useState<ConnectivityMonitor>(getConnectivityMonitor);
  const [store, setStore] = useState<OfflineStore | null>(null);

  const connectivity = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getServerSnapshot);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);

  // TanStack Query should believe the PROBE, not navigator.onLine: a paused retry resumes (and stale queries
  // refetch) the moment the probe says we are back, and nothing waits on a "connected but dead" wifi.
  useEffect(() => {
    onlineManager.setEventListener((setOnline) => {
      setOnline(monitor.getSnapshot() !== "offline");
      return monitor.subscribe(() => setOnline(monitor.getSnapshot() !== "offline"));
    });
  }, [monitor]);

  // Reads answer from the device cache while offline (see readThrough's preferCache). The moment the connection
  // is back, refetch what is on screen so "Showing saved data" gives way to the real thing.
  useEffect(() => {
    let previous = monitor.getSnapshot();
    return monitor.subscribe(() => {
      const next = monitor.getSnapshot();
      if (previous === "offline" && next === "online") void queryClient.invalidateQueries();
      previous = next;
    });
  }, [monitor, queryClient]);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;
    monitor.start();

    void getOfflineStore().then(({ store: opened, persistent, reason }) => {
      if (cancelled) return;
      setStore(opened);
      const supabase = createClient();
      detach = controller.attach({
        store: opened,
        persistent,
        storeReason: reason?.message ?? null,
        syncDeps: withStepTimeouts(
          createSupabaseSyncDeps(supabase),
          (promise, ms) =>
            withTimeout(promise, ms, () => new SaveError("network", "The connection timed out.")),
          { stepMs: STEP_TIMEOUT_MS, uploadMs: UPLOAD_TIMEOUT_MS },
        ),
        connectivity: monitor,
        // "Is the session valid again?" without touching any data: used while paused for sign-in.
        checkAuth: async () => {
          const { data, error } = await supabase.auth.getUser();
          return !error && data.user !== null;
        },
        // One tab at a time; degrades to "just run" without Web Locks.
        runExclusive: createLockRunner(typeof navigator !== "undefined" ? navigator.locks : undefined),
        onPassSettled: (result) => {
          // What the server holds may have changed: refetch the entry queries (the team list and detail merge in
          // the device's records, which refresh through the controller's own snapshot).
          if (changedServerState(result)) void queryClient.invalidateQueries({ queryKey: entryKeys.all });
        },
        windowTarget: window,
        documentTarget: document,
      });
    });

    return () => {
      cancelled = true;
      detach?.();
      monitor.stop();
    };
  }, [controller, monitor, queryClient]);

  const probeNow = useCallback(() => monitor.probeNow(), [monitor]);
  const syncNow = useCallback(() => controller.syncNow(), [controller]);
  const resumeAfterSignIn = useCallback(() => controller.resumeAndSync(), [controller]);
  const notifyLocalChange = useCallback(() => controller.afterLocalChange(), [controller]);

  const value = useMemo<OfflineContextValue>(
    () => ({ snapshot, connectivity, store, probeNow, syncNow, resumeAfterSignIn, notifyLocalChange }),
    [snapshot, connectivity, store, probeNow, syncNow, resumeAfterSignIn, notifyLocalChange],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
