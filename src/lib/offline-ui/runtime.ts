import { ConnectivityMonitor } from "@/lib/offline/connectivity";
import { openOfflineStoreWithFallback } from "@/lib/offline/idb-backend";
import type { OfflineStore } from "@/lib/offline/store";

export type OpenedStore = { store: OfflineStore; persistent: boolean; reason?: Error };

let opened: Promise<OpenedStore> | null = null;

/**
 * The one offline store for this tab, opened on first use. Browser only: call it from effects,
 * event handlers and query functions, never during render (it touches indexedDB).
 *
 * Shared by the OfflineProvider and by query functions (which write fetched data through to the
 * cache), so both always talk to the SAME store. Never rejects: when IndexedDB is unavailable it
 * resolves with an in-memory store and `persistent: false`.
 */
export function getOfflineStore(): Promise<OpenedStore> {
  opened ??= openOfflineStoreWithFallback();
  return opened;
}

let monitor: ConnectivityMonitor | null = null;

function createMonitor(): ConnectivityMonitor {
  const hasDom = typeof window !== "undefined";
  return new ConnectivityMonitor({
    fetch: (url, init) => fetch(url, init),
    windowTarget: hasDom ? window : undefined,
    documentTarget: hasDom ? document : undefined,
  });
}

/**
 * The one connectivity monitor for this tab. The OfflineProvider starts and stops it and shows its status;
 * query functions only READ it (see isKnownOffline), so both always agree. On the server every render gets
 * its own throwaway instance, so nothing is shared between requests.
 */
export function getConnectivityMonitor(): ConnectivityMonitor {
  if (typeof window === "undefined") return createMonitor();
  monitor ??= createMonitor();
  return monitor;
}

/**
 * true only when the active probe says we are offline (never "unknown": that is just "not checked yet").
 * Reads use it to answer from the device straight away instead of waiting for a request that cannot succeed.
 */
export function isKnownOffline(): boolean {
  return typeof window !== "undefined" && getConnectivityMonitor().getSnapshot() === "offline";
}
