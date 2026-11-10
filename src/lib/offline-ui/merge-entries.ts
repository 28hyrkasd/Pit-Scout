import type { SavedEntry } from "@/lib/entries/rpc";
import type { LocalEntry } from "@/lib/offline/types";

/*
 * Local-over-server merge for scouting entries (pure, no I/O, no clock).
 *
 * The scout's device may hold a version of an entry that the server has not seen
 * yet (saved offline) or that the server copy we hold is older than. Screens show
 * the merged result so a just-saved offline entry appears immediately.
 */

export type SyncBadgeKind = "pending" | "syncing" | "failed";

/** "Not synced yet" and friends. Always rendered with an icon AND this text (never color alone). */
export type SyncBadge = { kind: SyncBadgeKind; text: string };

export const SUPERSEDED_NOTICE =
  "A newer version from another scout was already saved, so your changes were not applied. Their version is the one shown.";

export type MergedEntry = {
  /** What to show. Its `id` is the id of the row photos hang off (server id when known). */
  entry: SavedEntry;
  /** Whose content `entry` is. */
  source: "server" | "local";
  /** Set while the device still owes the server something for this team (even when the server copy is shown). */
  badge: SyncBadge | null;
  /** This device's version lost to a newer server version (only after it synced). */
  superseded: boolean;
  /** The raw local record, if any (null when the device has nothing for this team). */
  local: LocalEntry | null;
};

function instant(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** A LocalEntry as the SavedEntry the screens already know how to render. */
export function localToSaved(local: LocalEntry): SavedEntry {
  return {
    // Photos hang off the row that exists on the server; before the first sync that is our own id.
    id: local.serverId ?? local.id,
    eventKey: local.eventKey,
    teamNumber: local.teamNumber,
    answers: local.payload.answers as SavedEntry["answers"],
    rating: local.payload.rating,
    notes: local.payload.notes,
    scoutedBy: local.payload.scoutedBy,
    createdAt: local.createdAt,
    updatedAt: local.updatedAt,
  };
}

/** Badge for an entry the server does not fully have yet; null once everything is synced. */
export function syncBadge(local: Pick<LocalEntry, "status" | "nextAttemptAt">): SyncBadge | null {
  switch (local.status) {
    case "synced":
      return null;
    case "syncing":
      return { kind: "syncing", text: "Syncing…" };
    case "pending":
      return { kind: "pending", text: "Not synced yet" };
    case "failed":
      // nextAttemptAt === null: the core will not retry on its own; the scout has to tap Sync now.
      return local.nextAttemptAt === null
        ? { kind: "failed", text: "Sync failed" }
        : { kind: "pending", text: "Not synced yet" };
  }
}

/**
 * Merge one team's server entry with this device's record.
 *
 *  - No local record: the server's.
 *  - Local not synced: the local version wins unless the server's is strictly newer
 *    (another scout saved later; ours will end up `superseded`). The badge stays either way.
 *  - Local synced and superseded: the server's version when we have it (that is what is on the
 *    server); otherwise ours, because it is all this device has.
 *  - Local synced, not superseded: the server's version, unless ours is strictly newer
 *    (the refetch has not landed yet, or the cached server copy is from before our sync).
 *
 * Compared as instants: Postgres returns "…+00:00" for what we sent as "…Z".
 */
export function mergeEntry(
  server: SavedEntry | null | undefined,
  local: LocalEntry | null | undefined,
): MergedEntry | null {
  if (!local) {
    return server ? { entry: server, source: "server", badge: null, superseded: false, local: null } : null;
  }

  const badge = syncBadge(local);
  const localSaved = localToSaved(local);
  const localIsNewer = !server || instant(local.updatedAt) > instant(server.updatedAt);

  if (local.status !== "synced") {
    // Ties go to local: it is the scout's own latest action.
    const localWins = !server || instant(local.updatedAt) >= instant(server.updatedAt);
    return {
      entry: localWins ? localSaved : (server as SavedEntry),
      source: localWins ? "local" : "server",
      badge,
      superseded: false,
      local,
    };
  }

  if (local.superseded) {
    return {
      entry: server ?? localSaved,
      source: server ? "server" : "local",
      badge: null,
      superseded: true,
      local,
    };
  }

  const useServer = server != null && !localIsNewer;
  return {
    entry: useServer ? server : localSaved,
    source: useServer ? "server" : "local",
    badge: null,
    superseded: false,
    local,
  };
}

/**
 * Merge the event-wide lists, one MergedEntry per team. Teams only the server knows,
 * only this device knows, or both all appear. `server` may be empty or missing entirely
 * (offline with nothing cached): the result is then the device's entries alone.
 * If the server list somehow has two rows for a team (it should not), the newest wins.
 */
export function mergeEventEntries(
  server: readonly SavedEntry[] | null | undefined,
  local: readonly LocalEntry[] | null | undefined,
  eventKey: string,
): MergedEntry[] {
  const serverByTeam = new Map<number, SavedEntry>();
  for (const entry of server ?? []) {
    if (entry.eventKey !== eventKey) continue;
    const existing = serverByTeam.get(entry.teamNumber);
    if (!existing || instant(entry.updatedAt) > instant(existing.updatedAt)) serverByTeam.set(entry.teamNumber, entry);
  }
  const localByTeam = new Map<number, LocalEntry>();
  for (const entry of local ?? []) if (entry.eventKey === eventKey) localByTeam.set(entry.teamNumber, entry);

  const teams = new Set([...serverByTeam.keys(), ...localByTeam.keys()]);
  const merged: MergedEntry[] = [];
  for (const team of [...teams].sort((a, b) => a - b)) {
    const m = mergeEntry(serverByTeam.get(team), localByTeam.get(team));
    if (m) merged.push(m);
  }
  return merged;
}

/**
 * The id of the entry row on the SERVER (what photos are listed under), or null when the server has never seen
 * this team's entry (created offline, not synced yet) so there is nothing to ask it about.
 */
export function serverEntryIdFor(merged: Pick<MergedEntry, "entry" | "source" | "local"> | null): string | null {
  if (!merged) return null;
  if (merged.local?.serverId) return merged.local.serverId;
  return merged.source === "server" ? merged.entry.id : null;
}
