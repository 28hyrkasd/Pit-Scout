"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as z from "zod";
import { appEventSchema } from "@/lib/external/schemas";
import { cacheKeys, cacheSchemas } from "@/lib/offline/cache";
import { readThrough } from "@/lib/offline-ui/cached-fetch";
import { isApiReachabilityError } from "@/lib/offline-ui/reachability";
import { getOfflineStore } from "@/lib/offline-ui/runtime";
import { hasUnsavedChanges } from "@/lib/unsaved-guard";
import { ApiError, apiGet } from "./client";
import { loginRedirectUrl } from "./login-redirect";

/**
 * Query keys live in one place so invalidation and cache seeding (Phase 8 persists
 * these to IndexedDB) cannot drift out of sync with the hooks.
 */
export const queryKeys = {
  events: (year: number, q: string) => ["tba", "events", year, q] as const,
  teams: (eventKey: string) => ["tba", "teams", eventKey] as const,
  epa: (eventKey: string) => ["statbotics", "epa", eventKey] as const,
} as const;

/**
 * Send the user to /login when a READ reports an expired session (our API routes or a direct
 * Supabase read). Skipped while a form holds unsaved on-screen edits (see loginRedirectUrl).
 * Scouting saved on this device lives in IndexedDB, which this redirect never touches.
 *
 * This is a deliberate FULL page load, not router.push(): it makes the proxy run fresh and
 * throws away the in-memory query cache from the signed-out session, so no stale
 * authenticated UI is left on screen.
 */
export function handleUnauthorized(error: unknown) {
  if (typeof window === "undefined") return;
  const url = loginRedirectUrl(error, window.location, hasUnsavedChanges());
  if (url) window.location.assign(url);
}

/**
 * Do not retry errors that retrying cannot fix. A NETWORK failure is not retried either: on bad wifi a
 * retry just waits (and while the app believes it is offline, TanStack pauses retries, which would leave the
 * screen loading forever). Instead the error shows with a "Try again" button, and the query refetches by
 * itself the moment connectivity returns (see OfflineProvider).
 */
function shouldRetry(failureCount: number, error: unknown) {
  if (
    error instanceof ApiError &&
    (error.kind === "unauthorized" || error.kind === "not_found" || error.kind === "invalid" || error.kind === "network")
  ) {
    return false;
  }
  return failureCount < 2;
}

/** What the cached team / EPA queries resolve with. */
export type CachedApiResult<T> = {
  data: T;
  fetchedAt: string;
  /** null: fresh from the server. Otherwise the ms epoch of the saved copy being shown (an offline fallback). */
  cachedAt: number | null;
};

/**
 * apiGet, written through to the device cache on success and falling back to the cache when the server
 * cannot be reached (network failure or the upstream being down). A cached answer carries `cachedAt` so the
 * screen can say "Showing saved data from …"; with no cache the original error surfaces.
 */
async function cachedApiGet<T>(args: {
  path: string;
  schema: z.ZodType<T>;
  cacheKey: string;
  signal: AbortSignal;
}): Promise<CachedApiResult<T>> {
  let fetchedAt = "";
  const result = await readThrough<T>({
    getStore: () => getOfflineStore().then((opened) => opened.store),
    key: args.cacheKey,
    schema: args.schema,
    fetch: async () => {
      const res = await apiGet(args.path, args.schema, args.signal);
      fetchedAt = res.fetchedAt;
      return res.data;
    },
    shouldFallback: isApiReachabilityError,
  });
  return {
    data: result.value,
    fetchedAt: result.cachedAt === null ? fetchedAt : new Date(result.cachedAt).toISOString(),
    cachedAt: result.cachedAt,
  };
}

export function useEventSearch(year: number, query: string) {
  return useQuery({
    queryKey: queryKeys.events(year, query),
    queryFn: ({ signal }) =>
      apiGet(`/api/tba/events/${year}?q=${encodeURIComponent(query)}`, z.array(appEventSchema), signal),
    // While the scout types, keep showing the previous results instead of flashing empty.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
}

export function useEventTeams(eventKey: string | null) {
  return useQuery({
    queryKey: queryKeys.teams(eventKey ?? ""),
    queryFn: ({ signal }) =>
      cachedApiGet({
        path: `/api/tba/event/${eventKey}/teams`,
        schema: cacheSchemas.teams,
        cacheKey: cacheKeys.teams(eventKey ?? ""),
        signal,
      }),
    enabled: eventKey !== null,
    retry: shouldRetry,
  });
}

export function useEventEpa(eventKey: string | null) {
  return useQuery({
    queryKey: queryKeys.epa(eventKey ?? ""),
    queryFn: ({ signal }) =>
      cachedApiGet({
        path: `/api/statbotics/event/${eventKey}`,
        schema: cacheSchemas.epa,
        cacheKey: cacheKeys.epa(eventKey ?? ""),
        signal,
      }),
    enabled: eventKey !== null,
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
}
