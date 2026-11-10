"use client";

import { useQuery } from "@tanstack/react-query";
import { cacheGet } from "@/lib/offline/cache";
import { readThrough } from "@/lib/offline-ui/cached-fetch";
import {
  entriesCacheKeys,
  findTeamEntry,
  photoRecordListSchema,
  savedEntryListSchema,
  type CachedPhotoRecord,
} from "@/lib/offline-ui/entries-cache";
import { isSupabaseReachabilityError } from "@/lib/offline-ui/reachability";
import { getOfflineStore } from "@/lib/offline-ui/runtime";
import { withTimeout } from "@/lib/offline-ui/timeout";
import { listEntryPhotos, signPhotoUrls } from "@/lib/photos/storage";
import { createClient } from "@/lib/supabase/client";
import { parseEntryRow, type SavedEntry } from "./rpc";
import { classifySaveError, SaveError } from "./save-error";

export const entryKeys = {
  all: ["entries"] as const,
  one: (eventKey: string, teamNumber: number) =>
    ["entries", eventKey, teamNumber] as const,
  photos: (entryId: string) => ["entries", "photos", entryId] as const,
  /** Every entry for one event (the team list). Under ["entries"], so saving refreshes it. */
  event: (eventKey: string) => ["entries", "event", eventKey] as const,
};

/**
 * How long a Supabase read may take before it counts as a network failure. On venue wifi that is
 * connected but has no internet a request can hang for minutes; the screen needs an answer sooner.
 */
const READ_TIMEOUT_MS = 12_000;

function bounded<T>(request: PromiseLike<T>): Promise<T> {
  return withTimeout(
    Promise.resolve(request),
    READ_TIMEOUT_MS,
    () => new SaveError("network", "Can't reach the server. Check your connection and try again."),
  );
}

/**
 * Retry only the failures that might clear up by themselves, and only once. A network failure is NOT
 * retried: while offline TanStack would pause the retry and leave the screen loading forever. The
 * saved copy answers instead, or the screen shows an error with a Try again button; the query also
 * refetches by itself when connectivity returns (see OfflineProvider).
 */
const retryUnknownOnce = (count: number, error: unknown) =>
  classifySaveError(error).kind === "unknown" && count < 1;

/** What useEntry resolves with. */
export type EntryLoad = {
  /** The SERVER's entry for the team (or null: nobody has scouted it). Merge with the device's own record before showing. */
  entry: SavedEntry | null;
  /** null: fresh from the server. Otherwise when the saved copy being shown was stored. */
  cachedAt: number | null;
};

/**
 * The server's entry for one team at one event, or null if nobody has scouted it yet.
 * When the server cannot be reached, the entry is looked up in the cached event list (saved whenever the
 * team list loads); if there is no cache at all the network error surfaces and the caller decides
 * (the editor opens from the device's own record or a blank form).
 */
export function useEntry(eventKey: string | null, teamNumber: number) {
  return useQuery({
    queryKey: entryKeys.one(eventKey ?? "", teamNumber),
    enabled: eventKey !== null,
    queryFn: async (): Promise<EntryLoad> => {
      const supabase = createClient();
      try {
        const { data, error, status } = await bounded(
          supabase
            .from("scouting_entries")
            .select("*")
            .eq("event_key", eventKey ?? "")
            .eq("team_number", teamNumber)
            .maybeSingle(),
        );
        if (error) throw classifySaveError(error, status);
        if (data === null) return { entry: null, cachedAt: null };
        const entry = parseEntryRow(data);
        if (!entry) throw classifySaveError(new Error("unexpected entry shape"));
        return { entry, cachedAt: null };
      } catch (error) {
        if (!isSupabaseReachabilityError(error)) throw error;
        const { store } = await getOfflineStore();
        const hit = await cacheGet(store, entriesCacheKeys.eventEntries(eventKey ?? ""), savedEntryListSchema);
        if (!hit) throw error;
        return { entry: findTeamEntry(hit.value, teamNumber), cachedAt: hit.savedAt };
      }
    },
    // Another scout may have saved since; always check when the form opens.
    staleTime: 0,
    retry: retryUnknownOnce,
  });
}

export type EventEntriesLoad = { entries: SavedEntry[]; cachedAt: number | null };

/**
 * Every saved entry for one event, in ONE query: the team list rates and filters
 * all teams client-side. Rows that do not match the expected shape are skipped
 * (they would otherwise break the whole list). Written through to the device cache; served
 * from it (with `cachedAt`) when the server cannot be reached.
 */
export function useEventEntries(eventKey: string | null) {
  return useQuery({
    queryKey: entryKeys.event(eventKey ?? ""),
    enabled: eventKey !== null,
    queryFn: async (): Promise<EventEntriesLoad> => {
      const result = await readThrough<SavedEntry[]>({
        getStore: () => getOfflineStore().then((opened) => opened.store),
        key: entriesCacheKeys.eventEntries(eventKey ?? ""),
        schema: savedEntryListSchema,
        fetch: async () => {
          const supabase = createClient();
          const { data, error, status } = await bounded(
            supabase.from("scouting_entries").select("*").eq("event_key", eventKey ?? ""),
          );
          if (error) throw classifySaveError(error, status);
          return (data ?? []).flatMap((row) => {
            const entry = parseEntryRow(row);
            return entry ? [entry] : [];
          });
        },
        shouldFallback: isSupabaseReachabilityError,
      });
      return { entries: result.value, cachedAt: result.cachedAt };
    },
    // Other scouts save all day; check again whenever the list is opened.
    staleTime: 0,
    retry: retryUnknownOnce,
  });
}

export type EntryPhoto = {
  id: string;
  storagePath: string;
  url: string | null;
  /** No URL because the server could not be reached (shown as "Photo unavailable offline"), not because the object is gone. */
  offline: boolean;
};

export type EntryPhotosLoad = {
  photos: EntryPhoto[];
  /** null: the photo list is fresh. Otherwise when the saved list being shown was stored. */
  cachedAt: number | null;
  /** Every photo got a signed URL (or genuinely has none). false: refetch soon. */
  complete: boolean;
};

/**
 * Photos for an entry, each with a signed URL (null when the object could not be signed). The photo LIST
 * (ids and paths, not the expiring URLs) is cached on the device, so offline the tiles are still there as
 * "Photo unavailable offline" placeholders and can still be removed.
 */
export function useEntryPhotos(entryId: string | null) {
  return useQuery({
    queryKey: entryKeys.photos(entryId ?? ""),
    enabled: entryId !== null,
    queryFn: async (): Promise<EntryPhotosLoad> => {
      const id = entryId ?? "";
      const supabase = createClient();
      const listed = await readThrough<CachedPhotoRecord[]>({
        getStore: () => getOfflineStore().then((opened) => opened.store),
        key: entriesCacheKeys.entryPhotos(id),
        schema: photoRecordListSchema,
        fetch: async () => {
          const records = await bounded(listEntryPhotos(supabase, id));
          return records.map((r) => ({ id: r.id, storagePath: r.storagePath }));
        },
        shouldFallback: isSupabaseReachabilityError,
      });

      let urls = new Map<string, string>();
      let complete = listed.cachedAt === null;
      if (listed.cachedAt === null) {
        try {
          urls = await bounded(signPhotoUrls(supabase, listed.value.map((r) => r.storagePath)));
        } catch (error) {
          if (!isSupabaseReachabilityError(error)) throw error;
          complete = false;
        }
      }
      return {
        photos: listed.value.map((r) => {
          const url = urls.get(r.storagePath) ?? null;
          return { id: r.id, storagePath: r.storagePath, url, offline: url === null && !complete };
        }),
        cachedAt: listed.cachedAt,
        complete,
      };
    },
    // Signed URLs last an hour; refresh well before they expire. An incomplete result (offline) is always stale.
    staleTime: (query) => (query.state.data?.complete ? 30 * 60_000 : 0),
    retry: retryUnknownOnce,
  });
}
