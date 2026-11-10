"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocalEntries, useLocalEntry, useLocalPhotos } from "@/components/offline/use-local-data";
import { useEntry, useEntryPhotos, useEventEntries } from "@/lib/entries/api";
import type { SavedEntry } from "@/lib/entries/rpc";
import { mergeEntry, mergeEventEntries, serverEntryIdFor, type MergedEntry } from "@/lib/offline-ui/merge-entries";
import { mergePhotos } from "@/lib/offline-ui/merge-photos";
import { isSupabaseReachabilityError } from "@/lib/offline-ui/reachability";

/** After this long without an answer from the server, screens stop waiting and use what the device has. */
const SERVER_WAIT_MS = 8_000;

/** true once `active` has been true for `ms` (and false again as soon as it stops being active). */
function useWaitedLongerThan(active: boolean, ms: number): boolean {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setWaited(true), ms);
    return () => {
      clearTimeout(timer);
      setWaited(false);
    };
  }, [active, ms]);
  return active && waited;
}

/**
 * One team's entry as the scout should see it: the device's own record merged over the server's.
 *
 *  - Opens from the device's record immediately when there is one (it never waits for the network).
 *  - With no local record it waits for the server, but only so long (SERVER_WAIT_MS).
 *  - `serverUnknown`: we could not learn what the server has (offline with no cache, or timed out). The
 *    editor then opens from the device record or a blank form; the detail page shows an error with Retry.
 */
export function useTeamEntry(eventKey: string | null, teamNumber: number) {
  const server = useEntry(eventKey, teamNumber);
  const local = useLocalEntry(eventKey, teamNumber);
  const hasLocal = local.entry !== null;

  const waitingForServer = server.isPending && eventKey !== null;
  const gaveUp = useWaitedLongerThan(waitingForServer && !hasLocal, SERVER_WAIT_MS);

  const serverLoad = server.data;
  const serverEntry: SavedEntry | null = serverLoad?.entry ?? null;
  const merged = useMemo(() => mergeEntry(serverEntry, local.entry), [serverEntry, local.entry]);

  const serverUnknown = serverLoad === undefined && (server.isError || gaveUp);
  const serverUnreachable = serverUnknown && (gaveUp || isSupabaseReachabilityError(server.error));
  const loading = !local.ready || (!hasLocal && waitingForServer && !gaveUp);

  return {
    loading,
    merged,
    /** The server's version (what to pass to the core as `base`), or null. */
    serverEntry,
    local: local.entry,
    serverUnknown,
    /** Unknown because of connectivity (as opposed to e.g. a permission or sign-in problem). */
    serverUnreachable,
    serverError: server.error,
    /** When the server's version shown came from the device cache, else null. */
    cachedAt: serverLoad?.cachedAt ?? null,
    refetch: server.refetch,
  };
}

/** Every entry for an event, device records merged over the server's, plus the facts the team list needs. */
export function useMergedEventEntries(eventKey: string | null) {
  const server = useEventEntries(eventKey);
  const local = useLocalEntries(eventKey);

  const merged = useMemo(
    () => (eventKey === null ? [] : mergeEventEntries(server.data?.entries, local.entries, eventKey)),
    [server.data, local.entries, eventKey],
  );
  const entries = useMemo(() => merged.map((m) => m.entry), [merged]);
  const byTeam = useMemo(() => new Map<number, MergedEntry>(merged.map((m) => [m.entry.teamNumber, m])), [merged]);

  return {
    loading: !local.ready || server.isPending,
    merged,
    entries,
    byTeam,
    /** The server's list could not be loaded and nothing is cached: only this device's records are shown. */
    serverUnavailable: server.isError && server.data === undefined,
    error: server.error,
    cachedAt: server.data?.cachedAt ?? null,
    refetch: server.refetch,
  };
}

/**
 * The photos of a team: the server's (signed URLs when online), minus removals queued on the device, plus the
 * photos only the device has. `serverEntryId` is null for an entry the server has never seen (nothing to ask).
 */
export function useTeamPhotos(eventKey: string | null, teamNumber: number, merged: MergedEntry | null) {
  const serverEntryId = serverEntryIdFor(merged);
  const server = useEntryPhotos(serverEntryId);
  const local = useLocalPhotos(eventKey, teamNumber);

  const photos = useMemo(
    () => mergePhotos({ server: server.data?.photos ?? [], local: local.photos, previewUrls: local.previewUrls }),
    [server.data, local.photos, local.previewUrls],
  );

  return {
    photos,
    serverEntryId,
    /** Server photo records (path etc.) by id, needed to queue a removal for a photo this device never had. */
    serverPhotos: server.data?.photos ?? [],
    /** Waiting on something we need to show a complete list. */
    loading: !local.ready || (serverEntryId !== null && server.isPending),
    error: serverEntryId !== null && server.isError ? server.error : null,
    cachedAt: server.data?.cachedAt ?? null,
    refetch: server.refetch,
  };
}
