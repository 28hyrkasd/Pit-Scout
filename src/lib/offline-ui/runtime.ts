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
