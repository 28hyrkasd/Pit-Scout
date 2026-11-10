"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as z from "zod";
import { appEpaSchema, appEventSchema, appTeamSchema } from "@/lib/external/schemas";
import { ApiError, apiGet } from "./client";

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
 * Send the user to /login when a query reports an expired session.
 *
 * This is a deliberate FULL page load, not router.push(): it makes the proxy run
 * fresh and throws away the in-memory query cache from the signed-out session, so
 * no stale authenticated UI is left on screen.
 */
export function handleUnauthorized(error: unknown) {
  if (error instanceof ApiError && error.kind === "unauthorized" && typeof window !== "undefined") {
    const next = window.location.pathname + window.location.search;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation, see above
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
}

/** Do not retry errors that retrying cannot fix. */
function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && (error.kind === "unauthorized" || error.kind === "not_found" || error.kind === "invalid")) {
    return false;
  }
  return failureCount < 2;
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
    queryFn: ({ signal }) => apiGet(`/api/tba/event/${eventKey}/teams`, z.array(appTeamSchema), signal),
    enabled: eventKey !== null,
    retry: shouldRetry,
  });
}

export function useEventEpa(eventKey: string | null) {
  return useQuery({
    queryKey: queryKeys.epa(eventKey ?? ""),
    queryFn: ({ signal }) => apiGet(`/api/statbotics/event/${eventKey}`, z.array(appEpaSchema), signal),
    enabled: eventKey !== null,
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
}
