import * as z from "zod";
import { appEpaSchema, appTeamSchema } from "@/lib/external/schemas";
import { fieldListSchema } from "./schema";
import type { OfflineStore } from "./store";

/*
 * A generic "server data I may need offline" cache (field definitions, team
 * lists, TBA / Statbotics responses) in the `cache` object store.
 *
 * Rules:
 *  - Reads are validated against a zod schema. An entry that is corrupt, from an
 *    older app version, or the wrong shape is DISCARDED (deleted, null returned),
 *    never trusted and never thrown into the UI.
 *  - Writes never throw into the UI: a full disk (or any storage failure) is
 *    returned as { ok: false }. A cache is an optimization; losing a write is fine.
 *  - Stale entries are still returned (flagged), because stale data beats a
 *    blank screen in a pit with no wifi. The caller decides whether to refetch.
 */

const EVENT_KEY = /^[0-9]{4}[a-z0-9]+$/;

function safeEventKey(eventKey: string): string {
  if (!EVENT_KEY.test(eventKey)) throw new Error(`Invalid event key: ${eventKey}`);
  return eventKey;
}

/** Stable key builders. The `:v1` suffix is the data-shape version: bump it to orphan old entries. */
export const cacheKeys = {
  fields: () => "fields:v1",
  teams: (eventKey: string) => `teams:${safeEventKey(eventKey)}:v1`,
  epa: (eventKey: string) => `epa:${safeEventKey(eventKey)}:v1`,
  eventStatus: (eventKey: string) => `event-status:${safeEventKey(eventKey)}:v1`,
} as const;

/** Schemas for the keys above whose shape the app owns. */
export const cacheSchemas = {
  fields: fieldListSchema,
  teams: z.array(appTeamSchema),
  epa: z.array(appEpaSchema),
} as const;

export type CacheHit<T> = {
  value: T;
  /** ms epoch the value was stored. */
  savedAt: number;
  /** true when older than maxAgeMs. Still usable. */
  stale: boolean;
};

export type CachePutResult = { ok: true } | { ok: false; error: Error };

/** Store a value. Never throws. */
export async function cachePut(
  store: OfflineStore,
  key: string,
  value: unknown,
  now: () => number = Date.now,
): Promise<CachePutResult> {
  try {
    await store.putCacheRecord(key, { value, savedAt: now() });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Read and validate. Returns null when there is nothing usable (missing,
 * corrupt, wrong shape, or the store failed). Never throws.
 */
export async function cacheGet<T>(
  store: OfflineStore,
  key: string,
  schema: z.ZodType<T>,
  options: { maxAgeMs?: number; now?: () => number } = {},
): Promise<CacheHit<T> | null> {
  let record;
  try {
    record = await store.getCacheRecord(key);
  } catch {
    return null;
  }
  if (!record) return null;

  const parsed = schema.safeParse(record.value);
  if (!parsed.success) {
    // Schema mismatch (old version / corruption): drop it so it can't be hit again.
    try {
      await store.deleteCacheRecord(key);
    } catch {
      // best effort
    }
    return null;
  }
  const nowMs = (options.now ?? Date.now)();
  return {
    value: parsed.data,
    savedAt: record.savedAt,
    // A savedAt in the future (clock changed) is treated as stale rather than fresh forever.
    stale:
      options.maxAgeMs !== undefined &&
      (record.savedAt > nowMs || nowMs - record.savedAt > options.maxAgeMs),
  };
}

export async function cacheDelete(store: OfflineStore, key: string): Promise<void> {
  try {
    await store.deleteCacheRecord(key);
  } catch {
    // best effort
  }
}
