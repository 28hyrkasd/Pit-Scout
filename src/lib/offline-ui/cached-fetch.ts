import type * as z from "zod";
import { cacheGet, cachePut } from "@/lib/offline/cache";
import type { OfflineStore } from "@/lib/offline/store";

/** `cachedAt` is null for data that just came from the network, else the ms epoch it was saved. */
export type Cached<T> = { value: T; cachedAt: number | null };

/**
 * Network first, device cache as the fallback.
 *
 *  - fetch succeeds: the value is written through to the cache (a failed write is ignored:
 *    the cache is an optimization) and returned with `cachedAt: null`.
 *  - fetch fails and `shouldFallback(error)` says the failure is about reachability: the
 *    cached copy is returned with its save time, so the UI can say "Showing saved data from …".
 *  - fetch fails any other way (e.g. signed out, not found), or there is no usable cache:
 *    the ORIGINAL error is thrown, so the existing error states and retry buttons work.
 *
 * The store is requested lazily (`getStore`), so reads that succeed never wait for IndexedDB to open
 * before the network call starts.
 */
export async function readThrough<T>(args: {
  getStore: () => Promise<OfflineStore>;
  key: string;
  schema: z.ZodType<T>;
  fetch: () => Promise<T>;
  shouldFallback: (error: unknown) => boolean;
  now?: () => number;
}): Promise<Cached<T>> {
  let value: T;
  try {
    value = await args.fetch();
  } catch (error) {
    if (!args.shouldFallback(error)) throw error;
    const hit = await args
      .getStore()
      .then((store) => cacheGet(store, args.key, args.schema))
      .catch(() => null);
    if (!hit) throw error;
    return { value: hit.value, cachedAt: hit.savedAt };
  }
  try {
    const store = await args.getStore();
    await cachePut(store, args.key, value, args.now);
  } catch {
    // no store: nothing to write through to
  }
  return { value, cachedAt: null };
}
